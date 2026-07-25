"""Run the resumable formal GPU experiment pipeline used by Google Colab."""

from __future__ import annotations

import argparse
import copy
import csv
import itertools
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import torch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.batch_train import run_batch  # noqa: E402
from scripts.generate_results import generate_results  # noqa: E402
from scripts.optimize_reward_weights import optimize  # noqa: E402
from scripts.run_ablation import run_ablation  # noqa: E402
from scripts.run_comparison import run_comparison  # noqa: E402
from scripts.run_generalization import run_generalization  # noqa: E402
from scripts.search_transformer_arch import benchmark_architecture  # noqa: E402
from src.environment.reward_calculator import RewardWeights  # noqa: E402
from src.experiments.io import atomic_write_json, git_metadata, load_yaml  # noqa: E402

STAGES = (
    "reward",
    "features",
    "architecture",
    "highway",
    "urban",
    "comparison",
    "ablation",
    "generalization",
    "results",
)
DEFAULT_WEIGHTS = {
    "effective_delivery": 0.25,
    "coverage": 0.30,
    "latency": 0.20,
    "overhead": 0.10,
    "missed": 0.10,
    "fairness": 0.05,
}


class PipelinePaused(RuntimeError):
    """Signal a normal, resumable stop before the Colab runtime budget expires."""


class FormalPipeline:
    def __init__(
        self,
        persistent_root: Path,
        work_root: Path,
        *,
        time_budget_minutes: float,
        smoke: bool,
        allow_cpu: bool,
    ) -> None:
        self.persistent_root = persistent_root.expanduser().resolve()
        self.work_root = work_root.expanduser().resolve()
        self.persistent_root.mkdir(parents=True, exist_ok=True)
        self.work_root.mkdir(parents=True, exist_ok=True)
        self.deadline = time.monotonic() + time_budget_minutes * 60
        self.smoke = smoke
        self.allow_cpu = allow_cpu
        self.state_path = self.persistent_root / "pipeline_state.json"
        self.state = (
            json.loads(self.state_path.read_text(encoding="utf-8"))
            if self.state_path.is_file()
            else {"stages": {}}
        )
        self._initialize_manifest()

    def _initialize_manifest(self) -> None:
        current_git = git_metadata()
        requested_mode = "smoke" if self.smoke else "formal"
        previous_mode = self.state.get("run_mode")
        if previous_mode and previous_mode != requested_mode:
            raise RuntimeError(
                f"the persisted experiment is {previous_mode}, not {requested_mode}; "
                "use a different persistent root"
            )
        previous_commit = self.state.get("git", {}).get("commit")
        current_commit = current_git.get("commit")
        if previous_commit and current_commit and previous_commit != current_commit:
            raise RuntimeError(
                "the persisted experiment belongs to a different git commit; "
                "use a new persistent root"
            )
        self.state.update(
            {
                "git": current_git,
                "run_mode": requested_mode,
                "runtime": {
                    "python": sys.version.split()[0],
                    "torch": torch.__version__,
                    "cuda_available": torch.cuda.is_available(),
                    "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                },
            }
        )
        self._save_state()

    def _save_state(self) -> None:
        atomic_write_json(self.state_path, self.state)

    def status(self) -> dict[str, Any]:
        stages = self.state.setdefault("stages", {})
        return {
            "run_mode": self.state["run_mode"],
            "git": self.state["git"],
            "runtime": self.state["runtime"],
            "stages": {name: stages.get(name, {"status": "pending"}) for name in STAGES},
            "next_stage": next(
                (name for name in STAGES if stages.get(name, {}).get("status") != "completed"),
                None,
            ),
        }

    def run(self, requested_stage: str) -> dict[str, Any]:
        stage = self.status()["next_stage"] if requested_stage == "next" else requested_stage
        if stage is None:
            return self.status()
        if stage not in STAGES:
            raise ValueError(f"unknown stage: {stage}")
        if stage in {"reward", "features", "architecture", "highway", "urban", "ablation"}:
            if not torch.cuda.is_available() and not self.allow_cpu:
                raise RuntimeError("formal training requires a CUDA runtime")
        self.state["stages"][stage] = {"status": "running"}
        self._save_state()
        try:
            result = getattr(self, f"_run_{stage}")()
        except PipelinePaused:
            self.state["stages"][stage] = {"status": "paused"}
            self._save_state()
            raise
        self.state["stages"][stage] = {
            "status": "completed",
            "result": self._stage_result_summary(stage, result),
        }
        self._save_state()
        return self.status()

    @staticmethod
    def _stage_result_summary(stage: str, result: dict[str, Any]) -> dict[str, Any]:
        keys = (
            "run_mode",
            "selected",
            "weights",
            "validation_scores",
            "relative_improvement_over_default",
            "evaluated",
            "selected_transformer",
            "best_validation_mean",
            "expected_runs",
            "completed_runs",
            "convergence_rate",
            "champion",
            "expected_result_rows",
            "completed_result_rows",
            "figures",
        )
        summary = {key: result[key] for key in keys if key in result}
        if stage == "ablation":
            summary["variants"] = sorted(result)
        return summary

    def _remaining_minutes(self) -> float:
        return max(0.0, (self.deadline - time.monotonic()) / 60)

    def _require_remaining_time(self) -> float:
        remaining = self._remaining_minutes()
        if remaining <= 30:
            raise PipelinePaused
        return remaining

    def _scale(self, formal: int, smoke: int = 1) -> int:
        return smoke if self.smoke else formal

    def _batch_config(
        self,
        domain: str,
        *,
        weights: dict[str, float],
        train_configs: int,
        validation_configs: int,
        seeds: list[int],
        episodes: int,
        feature_mode: str = "basic",
        transformer: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        config = copy.deepcopy(load_yaml(f"configs/batch_training_{domain}.yaml"))
        config["run_mode"] = "smoke" if self.smoke else "formal"
        config["dataset"] = {
            "train_configs": train_configs,
            "validation_configs": validation_configs,
            "test_configs": 0,
        }
        config["training_seeds"] = seeds
        config["training"].update(
            {
                "episodes_per_config": episodes,
                "validation_interval_episodes": min(10, episodes),
                "early_stopping_patience_episodes": max(min(20, episodes), 1),
                "evaluation_episodes": 1 if self.smoke else 3,
            }
        )
        config["champion_selection"].update(
            {"shortlist_size": min(5, train_configs * len(seeds)), "evaluation_episodes": 1}
        )
        config["reward_profile"] = "candidate"
        config["reward_profiles"] = {"candidate": weights}
        config["environment_overrides"] = {"feature_mode": feature_mode}
        if transformer:
            config["ppo_overrides"] = {"transformer": transformer}
        return config

    def _run_candidate_batch(self, config: dict[str, Any], relative_output: Path) -> dict[str, Any]:
        existing_summary = self.persistent_root / relative_output / "summary.json"
        existing_selection = self.persistent_root / relative_output / "champion/selection.json"
        if existing_summary.is_file() and existing_selection.is_file():
            existing = json.loads(existing_summary.read_text(encoding="utf-8"))
            if (
                existing.get("completed_runs") == existing.get("expected_runs")
                and not existing.get("failed_runs")
                and existing.get("champion")
            ):
                return existing
        remaining = self._require_remaining_time()
        summary = run_batch(
            config,
            self.persistent_root / relative_output,
            resume=True,
            retry_failed=True,
            work_output=self.work_root / relative_output,
            time_budget_minutes=remaining,
            retain_per_config_best=True,
        )
        if summary.get("paused"):
            raise PipelinePaused
        if summary["failed_runs"]:
            raise RuntimeError(f"batch contains failed runs: {relative_output}")
        if summary["completed_runs"] != summary["expected_runs"] or not summary["champion"]:
            raise RuntimeError(f"batch is incomplete: {relative_output}")
        return summary

    @staticmethod
    def _validation_score(path: Path) -> float:
        selection = json.loads((path / "champion" / "selection.json").read_text(encoding="utf-8"))
        return float(selection["validation_mean"])

    def _reward_candidates(self) -> dict[str, dict[str, float]]:
        output = self.persistent_root / "reward_weights"
        best_path = output / "best_weights.json"
        if not best_path.is_file():
            optimize(load_yaml("configs/reward_optimization.yaml"), output)
        rows = list(csv.DictReader((output / "grid_search_results.csv").open(encoding="utf-8")))
        candidates = {"default": DEFAULT_WEIGHTS}
        seen = {tuple(RewardWeights.from_mapping(DEFAULT_WEIGHTS).__dict__.values())}
        for row in rows:
            raw = {
                key: float(row[key])
                for key in (
                    "effective_delivery",
                    "coverage",
                    "latency",
                    "overhead",
                    "missed",
                    "fairness",
                )
            }
            normalized = RewardWeights.from_mapping(raw).__dict__
            signature = tuple(normalized.values())
            if signature in seen:
                continue
            candidates[f"candidate_{len(candidates)}"] = normalized
            seen.add(signature)
            if len(candidates) == (2 if self.smoke else 4):
                break
        return candidates

    def _run_reward(self) -> dict[str, Any]:
        candidates = self._reward_candidates()
        scores: dict[str, float] = {}
        for name, weights in candidates.items():
            domain_scores = []
            for domain, validation_count in (("highway", 4), ("urban", 3)):
                config = self._batch_config(
                    domain,
                    weights=weights,
                    train_configs=self._scale(3),
                    validation_configs=self._scale(validation_count),
                    seeds=[3101] if self.smoke else [3101, 3102],
                    episodes=self._scale(20, 2),
                )
                relative = Path("selection/reward") / name / domain
                self._run_candidate_batch(config, relative)
                domain_scores.append(self._validation_score(self.persistent_root / relative))
            scores[name] = sum(domain_scores) / len(domain_scores)
        selected = max(scores, key=scores.get)
        result = {
            "selected": selected,
            "weights": candidates[selected],
            "validation_scores": scores,
            "relative_improvement_over_default": (
                (scores[selected] - scores["default"]) / abs(scores["default"])
                if scores["default"]
                else None
            ),
        }
        atomic_write_json(self.persistent_root / "selection/reward_selection.json", result)
        self._delete_unselected_models(Path("selection/reward"), selected)
        return result

    def _selected_reward(self) -> dict[str, float]:
        path = self.persistent_root / "selection/reward_selection.json"
        if not path.is_file():
            raise RuntimeError("reward selection must complete first")
        return json.loads(path.read_text(encoding="utf-8"))["weights"]

    def _run_features(self) -> dict[str, Any]:
        scores: dict[str, float] = {}
        for mode in ("basic", "enhanced"):
            domain_scores = []
            for domain, validation_count in (("highway", 4), ("urban", 3)):
                config = self._batch_config(
                    domain,
                    weights=self._selected_reward(),
                    train_configs=self._scale(5),
                    validation_configs=self._scale(validation_count),
                    seeds=[3101] if self.smoke else [3111, 3112, 3113],
                    episodes=self._scale(50, 2),
                    feature_mode=mode,
                )
                relative = Path("selection/features") / mode / domain
                self._run_candidate_batch(config, relative)
                domain_scores.append(self._validation_score(self.persistent_root / relative))
            scores[mode] = sum(domain_scores) / len(domain_scores)
        selected = max(scores, key=scores.get)
        result = {"selected": selected, "validation_scores": scores}
        atomic_write_json(self.persistent_root / "selection/feature_selection.json", result)
        self._delete_unselected_models(Path("selection/features"), selected)
        return result

    def _selected_feature(self) -> str:
        path = self.persistent_root / "selection/feature_selection.json"
        if not path.is_file():
            raise RuntimeError("feature selection must complete first")
        return str(json.loads(path.read_text(encoding="utf-8"))["selected"])

    def _architecture_candidates(self) -> list[dict[str, int]]:
        values = itertools.product((2, 4, 6), (4, 8, 12), (128, 256, 512), (2, 4))
        candidates = [
            {
                "num_layers": layers,
                "num_heads": heads,
                "d_model": dimension,
                "ffn_ratio": ratio,
            }
            for layers, heads, dimension, ratio in values
        ]
        return candidates[:2] if self.smoke else candidates

    def _train_architecture(
        self, identifier: str, architecture: dict[str, int], variant: str
    ) -> dict[str, Any]:
        transformer = {
            "num_layers": architecture["num_layers"],
            "num_heads": architecture["num_heads"],
            "d_model": architecture["d_model"],
            "feedforward_dim": architecture["d_model"] * architecture["ffn_ratio"],
            "variant": variant,
        }
        scores = []
        for domain, train_count, validation_count in (("highway", 3, 4), ("urban", 2, 3)):
            config = self._batch_config(
                domain,
                weights=self._selected_reward(),
                train_configs=self._scale(train_count),
                validation_configs=self._scale(validation_count),
                seeds=[3201],
                episodes=self._scale(20, 2),
                feature_mode=self._selected_feature(),
                transformer=transformer,
            )
            relative = Path("arch_search/training") / identifier / domain
            self._run_candidate_batch(config, relative)
            scores.append(self._validation_score(self.persistent_root / relative))
        benchmark = benchmark_architecture(architecture, variant, 1)
        return {
            **architecture,
            "variant": variant,
            "validation_mean": sum(scores) / len(scores),
            "parameters": benchmark["parameters"],
            "inference_latency_ms": benchmark["inference_latency_ms"],
        }

    def _run_architecture(self) -> dict[str, Any]:
        output = self.persistent_root / "arch_search"
        output.mkdir(parents=True, exist_ok=True)
        progress_path = output / "formal_progress.json"
        progress = (
            json.loads(progress_path.read_text(encoding="utf-8"))
            if progress_path.is_file()
            else {"rows": []}
        )
        rows = list(progress["rows"])
        completed = {
            (row["variant"], row["num_layers"], row["num_heads"], row["d_model"], row["ffn_ratio"])
            for row in rows
        }
        for architecture in self._architecture_candidates():
            signature = ("standard", *architecture.values())
            if signature in completed:
                continue
            identifier = (
                f"standard_l{architecture['num_layers']}_h{architecture['num_heads']}_"
                f"d{architecture['d_model']}_r{architecture['ffn_ratio']}"
            )
            rows.append(self._train_architecture(identifier, architecture, "standard"))
            atomic_write_json(progress_path, {"rows": rows})
        standard = sorted(
            (row for row in rows if row["variant"] == "standard"),
            key=lambda row: (-float(row["validation_mean"]), float(row["inference_latency_ms"])),
        )
        for candidate in standard[: (1 if self.smoke else 3)]:
            architecture = {
                key: int(candidate[key])
                for key in ("num_layers", "num_heads", "d_model", "ffn_ratio")
            }
            signature = ("graph", *architecture.values())
            if signature in completed:
                continue
            identifier = (
                f"graph_l{architecture['num_layers']}_h{architecture['num_heads']}_"
                f"d{architecture['d_model']}_r{architecture['ffn_ratio']}"
            )
            rows.append(self._train_architecture(identifier, architecture, "graph"))
            atomic_write_json(progress_path, {"rows": rows})
        rows.sort(
            key=lambda row: (-float(row["validation_mean"]), float(row["inference_latency_ms"]))
        )
        with (output / "search_results.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        best = rows[0]
        selected = {
            "d_model": int(best["d_model"]),
            "num_heads": int(best["num_heads"]),
            "num_layers": int(best["num_layers"]),
            "feedforward_dim": int(best["d_model"]) * int(best["ffn_ratio"]),
            "variant": best["variant"],
        }
        result = {
            "run_mode": "smoke" if self.smoke else "formal",
            "evaluated": len(rows),
            "selected_transformer": selected,
            "best_validation_mean": best["validation_mean"],
        }
        atomic_write_json(output / "best_architecture.json", result)
        self._retain_architecture_winner(best)
        winner = (
            f"{best['variant']}_l{best['num_layers']}_h{best['num_heads']}_"
            f"d{best['d_model']}_r{best['ffn_ratio']}"
        )
        self._check_projected_storage(output / "training" / winner)
        return result

    def _selected_transformer(self) -> dict[str, Any]:
        path = self.persistent_root / "arch_search/best_architecture.json"
        if not path.is_file():
            raise RuntimeError("architecture search must complete first")
        return json.loads(path.read_text(encoding="utf-8"))["selected_transformer"]

    def _run_domain(self, domain: str) -> dict[str, Any]:
        config = copy.deepcopy(load_yaml(f"configs/batch_training_{domain}.yaml"))
        config["reward_profile"] = "selected"
        config["reward_profiles"] = {"selected": self._selected_reward()}
        config["environment_overrides"] = {"feature_mode": self._selected_feature()}
        config["ppo_overrides"] = {"transformer": self._selected_transformer()}
        if self.smoke:
            config["run_mode"] = "smoke"
            config["dataset"] = {"train_configs": 2, "validation_configs": 1, "test_configs": 1}
            config["training_seeds"] = config["training_seeds"][:2]
            config["training"].update(
                {
                    "episodes_per_config": 2,
                    "validation_interval_episodes": 1,
                    "early_stopping_patience_episodes": 2,
                    "evaluation_episodes": 1,
                }
            )
            config["champion_selection"].update({"shortlist_size": 2})
        relative = Path(f"{domain}_batch")
        summary = self._run_candidate_batch(config, relative)
        self._check_projected_storage(self.persistent_root / relative)
        self._write_frozen_manifest()
        return summary

    def _run_highway(self) -> dict[str, Any]:
        return self._run_domain("highway")

    def _run_urban(self) -> dict[str, Any]:
        return self._run_domain("urban")

    def _comparison_config(self) -> dict[str, Any]:
        config = copy.deepcopy(load_yaml("configs/comparison_test.yaml"))
        config["models"] = {
            domain: str(self.persistent_root / f"{domain}_batch/champion/model_best.zip")
            for domain in ("highway", "urban")
        }
        config["environment"]["feature_mode"] = self._selected_feature()
        config["reward_weights"] = self._selected_reward()
        if self.smoke:
            config["run_mode"] = "smoke"
            config["dataset"].update(
                {"train_configs": 2, "validation_configs": 1, "test_configs": 1}
            )
            config["test_seeds"] = config["test_seeds"][:1]
        return config

    def _run_comparison(self) -> dict[str, Any]:
        result = run_comparison(
            self._comparison_config(), self.persistent_root / "comparison_results", resume=True
        )
        if result["failures"]:
            raise RuntimeError("comparison contains failures")
        return result

    def _run_ablation(self) -> dict[str, Any]:
        results = {}
        for variant, filename, directory in (
            ("transformer_only", "ablation_transformer_only.yaml", "ablation_transformer"),
            ("rl_only", "ablation_rl_only.yaml", "ablation_rl"),
        ):
            config = copy.deepcopy(load_yaml(f"configs/{filename}"))
            config["reward_profiles"] = {"selected": self._selected_reward()}
            config["reward_profile"] = "selected"
            config["environment_overrides"] = {"feature_mode": self._selected_feature()}
            config["environment"]["feature_mode"] = self._selected_feature()
            config["reward_weights"] = self._selected_reward()
            config["ppo_overrides"] = {"transformer": self._selected_transformer()}
            if self.smoke:
                config["run_mode"] = "smoke"
                config["dataset"].update(
                    {"train_configs": 1, "validation_configs": 1, "test_configs": 1}
                )
                config["training_seeds"] = config["training_seeds"][:1]
                config["test_seeds"] = config["test_seeds"][:1]
                config["training"].update({"episodes_per_config": 2})
            results[variant] = run_ablation(
                config,
                self.persistent_root / directory,
                resume=True,
                work_output=self.work_root / directory if variant == "rl_only" else None,
                time_budget_minutes=self._require_remaining_time(),
            )
            if results[variant].get("status") == "paused":
                raise PipelinePaused
        return results

    def _run_generalization(self) -> dict[str, Any]:
        result = run_generalization(
            self._comparison_config(),
            self.persistent_root / "generalization_results",
            resume=True,
        )
        if result["failures"]:
            raise RuntimeError("generalization contains failures")
        return result

    def _run_results(self) -> dict[str, Any]:
        return generate_results(
            self.persistent_root / "paper_figures",
            experiments_root=self.persistent_root,
            allow_smoke=self.smoke,
        )

    def _write_frozen_manifest(self) -> None:
        atomic_write_json(
            self.persistent_root / "frozen_training_manifest.json",
            {
                "reward_weights": self._selected_reward(),
                "feature_mode": self._selected_feature(),
                "transformer": self._selected_transformer(),
                "git": self.state["git"],
            },
        )

    def _check_projected_storage(self, model_root: Path) -> None:
        models = list(model_root.glob("config_*/seed_*/model_best.zip"))
        if not models:
            return
        projected = int(sum(path.stat().st_size for path in models) / len(models) * 100)
        required = projected + 5 * 1024**3
        free = shutil.disk_usage(self.persistent_root).free
        if free < required:
            raise RuntimeError(
                f"insufficient persistent storage: need about {required / 1024**3:.1f} GiB, "
                f"have {free / 1024**3:.1f} GiB"
            )

    def _delete_unselected_models(self, relative_root: Path, selected: str) -> None:
        root = self.persistent_root / relative_root
        for candidate in root.iterdir() if root.is_dir() else ():
            if candidate.name == selected:
                continue
            for model in candidate.rglob("*.zip"):
                model.unlink()

    def _retain_architecture_winner(self, best: dict[str, Any]) -> None:
        winner = (
            f"{best['variant']}_l{best['num_layers']}_h{best['num_heads']}_"
            f"d{best['d_model']}_r{best['ffn_ratio']}"
        )
        root = self.persistent_root / "arch_search/training"
        for candidate in root.iterdir() if root.is_dir() else ():
            if candidate.name == winner:
                continue
            for model in candidate.rglob("*.zip"):
                model.unlink()


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("next", *STAGES), default="next")
    parser.add_argument("--persistent-root", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--time-budget-minutes", type=float, default=540)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--allow-cpu", action="store_true", help="only for smoke validation")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if arguments.time_budget_minutes <= 0:
        print("time budget must be positive", file=sys.stderr)
        return 2
    pipeline = FormalPipeline(
        arguments.persistent_root,
        arguments.work_root,
        time_budget_minutes=arguments.time_budget_minutes,
        smoke=arguments.smoke,
        allow_cpu=arguments.allow_cpu,
    )
    if arguments.status:
        print(json.dumps(pipeline.status(), indent=2, ensure_ascii=False))
        return 0
    try:
        result = pipeline.run(arguments.stage)
    except PipelinePaused:
        print(json.dumps(pipeline.status(), indent=2, ensure_ascii=False))
        return 75
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

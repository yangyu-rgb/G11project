"""Warm-start the v4 champion and produce a safety-constrained v5 course demo."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.generate_demo_lite_results import generate_demo_lite_results  # noqa: E402
from scripts.run_adaptive_demo_pipeline import (  # noqa: E402
    AdaptiveDemoPaused,
    AdaptiveDemoPipeline,
    EpisodeLogCallback,
    _mean_metrics,
    validation_score,
)
from scripts.run_comparison import run_comparison  # noqa: E402
from src.experiments.evaluation import evaluate_episode, make_environment  # noqa: E402
from src.experiments.io import atomic_write_json, git_metadata  # noqa: E402
from src.experiments.scenario_matrix import ScenarioDefinition  # noqa: E402
from src.models.ppo_agent import PPOAgent  # noqa: E402

STAGES = ("fine_tuning", "comparison", "results")


class SafetyFineTunePipeline(AdaptiveDemoPipeline):
    def __init__(
        self,
        source_root: Path,
        persistent_root: Path,
        work_root: Path,
        *,
        config_path: str | Path,
        time_budget_minutes: float,
        allow_cpu: bool = False,
    ) -> None:
        super().__init__(
            persistent_root,
            work_root,
            config_path=config_path,
            time_budget_minutes=time_budget_minutes,
            allow_cpu=allow_cpu,
        )
        self.source_root = source_root.expanduser().resolve()
        self.state_path = self.root / "safety_finetune_state.json"
        self.state = (
            json.loads(self.state_path.read_text(encoding="utf-8"))
            if self.state_path.is_file()
            else {"stages": {}}
        )
        self.state.update(
            {
                "run_mode": "adaptive_safety_finetune",
                "scope": "highway-only safety-constrained course demo",
                "protocol": "adaptive-v5",
                "source_root": str(self.source_root),
                "git": git_metadata(),
            }
        )
        self._validate_source()
        self._validate_protocol()
        self._save()

    def _validate_source(self) -> None:
        required = (
            self.source_root / "champion/model_best.zip",
            self.source_root / "champion/selection.json",
        )
        missing = [str(path) for path in required if not path.is_file()]
        if missing:
            raise FileNotFoundError(f"v4 champion artifacts are missing: {missing}")
        if self.source_root == self.root:
            raise ValueError("v5 output root must differ from the read-only v4 source root")

    def _validate_protocol(self) -> None:
        source_test_seeds = set(map(int, self.config["source_test_seeds"]))
        final_test_seeds = set(map(int, self.config["test_seeds"]))
        validation_seeds = set(map(int, self.config["fine_tuning"]["validation_seeds"]))
        if source_test_seeds & final_test_seeds:
            raise ValueError("v5 final holdout seeds must be new relative to v4")
        if validation_seeds & final_test_seeds:
            raise ValueError("validation and final holdout seeds must be disjoint")

    def status(self) -> dict[str, Any]:
        stages = self.state.setdefault("stages", {})
        return {
            "run_mode": self.state["run_mode"],
            "protocol": self.state["protocol"],
            "source_root": self.state["source_root"],
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
            raise ValueError(f"unknown v5 stage: {stage}")
        if stage == "fine_tuning":
            import torch

            if not torch.cuda.is_available() and not self.allow_cpu:
                raise RuntimeError("v5 fine-tuning requires a CUDA runtime")
        self.state["stages"][stage] = {"status": "running"}
        self._save()
        try:
            result = getattr(self, f"_run_{stage}")()
        except AdaptiveDemoPaused:
            self.state["stages"][stage] = {"status": "paused"}
            self._save()
            raise
        self.state["stages"][stage] = {"status": "completed", "result": result}
        self._save()
        return self.status()

    def _weighted_training_paths(
        self, training: list[tuple[ScenarioDefinition, Path]]
    ) -> list[Path]:
        paths = [path for _, path in training]
        high = [
            path
            for definition, path in training
            if float(definition.parameters["events"]["severity"]) > 0.75
        ]
        repeats = int(self.config["fine_tuning"]["high_severity_oversampling"]) - 1
        return paths + high * max(repeats, 0)

    def _evaluate_safety(
        self,
        agent: PPOAgent,
        validation: list[tuple[ScenarioDefinition, Path]],
    ) -> dict[str, float | bool]:
        rows: list[dict[str, float | int | None]] = []
        high_rows: list[dict[str, float | int | None]] = []
        for definition, scenario_path in validation:
            severity = float(definition.parameters["events"]["severity"])
            for seed in map(int, self.config["fine_tuning"]["validation_seeds"]):
                environment = make_environment(
                    scenario_path,
                    "highway",
                    seed,
                    self._evaluation_config(),
                    action_mode="adaptive_radius",
                )
                try:
                    row = evaluate_episode(
                        environment,
                        lambda _environment, observation: np.asarray(
                            agent.predict_raw(observation, deterministic=True), dtype=np.int64
                        ),
                        reset_seed=seed,
                        safety_window_ms=float(self.config["safety_window_ms"]),
                    )
                finally:
                    environment.close()
                rows.append(row)
                if severity > 0.75:
                    high_rows.append(row)
        metrics = _mean_metrics(rows)
        high_metrics = _mean_metrics(high_rows)
        gate = self.config["validation_gate"]
        eligible = (
            metrics["affected_vehicle_coverage"] >= float(gate["minimum_coverage"])
            and high_metrics["affected_vehicle_coverage"]
            >= float(gate["minimum_high_severity_coverage"])
            and metrics["timely_event_rate"] >= float(gate["minimum_timely_event_rate"])
            and metrics["normalized_channel_cost"] <= float(gate["maximum_channel_cost"])
        )
        minimum_coverage = min(
            metrics["affected_vehicle_coverage"],
            high_metrics["affected_vehicle_coverage"],
        )
        score = (
            validation_score(metrics)
            + 0.50 * high_metrics["affected_vehicle_coverage"]
            - 5.0 * max(0.0, float(gate["minimum_coverage"]) - minimum_coverage)
        )
        return {
            **metrics,
            "high_severity_coverage": high_metrics["affected_vehicle_coverage"],
            "high_severity_timely_event_rate": high_metrics["timely_event_rate"],
            "minimum_safety_coverage": minimum_coverage,
            "score": score,
            "eligible": eligible,
        }

    def _finetune_candidate(
        self,
        seed: int,
        train_paths: list[Path],
        validation: list[tuple[ScenarioDefinition, Path]],
    ) -> dict[str, Any]:
        candidate = self.root / "candidates" / f"seed_{seed}"
        candidate.mkdir(parents=True, exist_ok=True)
        summary_path = candidate / "summary.json"
        if summary_path.is_file():
            previous = json.loads(summary_path.read_text(encoding="utf-8"))
            if previous.get("status") == "completed":
                return previous
        environment = self._training_environment(seed, train_paths)
        checkpoint = candidate / "checkpoint_latest.zip"
        origin_path = candidate / "origin.json"
        try:
            source = (
                checkpoint if checkpoint.is_file() else self.source_root / "champion/model_best.zip"
            )
            agent = PPOAgent.load(source, environment)
            settings = self.config["fine_tuning"]
            agent.configure_finetuning(
                learning_rate=float(settings["learning_rate"]),
                clip_epsilon=float(settings["clip_epsilon"]),
                entropy_coef=float(settings["entropy_coef"]),
                n_epochs=int(settings["n_epochs"]),
                seed=seed,
            )
            if origin_path.is_file():
                origin = json.loads(origin_path.read_text(encoding="utf-8"))
            else:
                origin = {"source_timesteps": int(agent.model.num_timesteps)}
                atomic_write_json(origin_path, origin)
            source_timesteps = int(origin["source_timesteps"])
            target = source_timesteps + int(settings["additional_timesteps"])
            interval = int(settings["evaluation_interval_timesteps"])
            history_path = candidate / "validation_history.json"
            history = (
                json.loads(history_path.read_text(encoding="utf-8"))
                if history_path.is_file()
                else []
            )
            best_eligible = max(
                (float(item["score"]) for item in history if item.get("eligible")),
                default=-float("inf"),
            )
            best_safety = max(
                (float(item["minimum_safety_coverage"]) for item in history),
                default=-float("inf"),
            )
            stale = 0
            while agent.model.num_timesteps < target:
                if time.monotonic() >= self.deadline - 900:
                    agent.save(candidate / "checkpoint_latest")
                    raise AdaptiveDemoPaused
                callback = EpisodeLogCallback()
                remaining = target - agent.model.num_timesteps
                agent.train(min(interval, remaining), callback, reset_num_timesteps=False)
                self._append_rewards(
                    candidate / "training_log.csv", callback.rewards, callback.timesteps
                )
                agent.save(candidate / "checkpoint_latest")
                metrics = self._evaluate_safety(agent, validation)
                record = {
                    "timesteps": int(agent.model.num_timesteps),
                    "additional_timesteps": int(agent.model.num_timesteps) - source_timesteps,
                    **metrics,
                }
                history.append(record)
                atomic_write_json(history_path, history)
                if float(metrics["minimum_safety_coverage"]) > best_safety:
                    best_safety = float(metrics["minimum_safety_coverage"])
                    agent.save(candidate / "model_best_safety")
                if metrics["eligible"] and float(metrics["score"]) > best_eligible:
                    best_eligible = float(metrics["score"])
                    stale = 0
                    agent.save(candidate / "model_best_eligible")
                    atomic_write_json(candidate / "best_validation.json", record)
                elif int(record["additional_timesteps"]) >= int(settings["minimum_timesteps"]):
                    stale += 1
                if (
                    int(record["additional_timesteps"]) >= int(settings["minimum_timesteps"])
                    and best_eligible > -float("inf")
                    and stale >= int(settings["early_stopping_patience_evaluations"])
                ):
                    break
            eligible_path = candidate / "model_best_eligible.zip"
            selected = (
                eligible_path if eligible_path.is_file() else candidate / "model_best_safety.zip"
            )
            best = (
                json.loads((candidate / "best_validation.json").read_text(encoding="utf-8"))
                if eligible_path.is_file()
                else max(history, key=lambda item: float(item["minimum_safety_coverage"]))
            )
            summary = {
                "status": "completed",
                "seed": seed,
                "source_timesteps": source_timesteps,
                "final_timesteps": int(agent.model.num_timesteps),
                "eligible": eligible_path.is_file(),
                "best_validation": best,
                "model": str(selected),
            }
            atomic_write_json(summary_path, summary)
            return summary
        finally:
            environment.close()

    def _run_fine_tuning(self) -> dict[str, Any]:
        training = self._materialize_split("train")
        validation = self._materialize_split("validation")
        paths = self._weighted_training_paths(training)
        candidates = [
            self._finetune_candidate(seed, paths, validation)
            for seed in map(int, self.config["fine_tuning"]["branch_seeds"])
        ]
        eligible = [candidate for candidate in candidates if candidate["eligible"]]
        pool = eligible or candidates
        champion = max(
            pool,
            key=lambda item: (
                float(item["best_validation"]["minimum_safety_coverage"]),
                float(item["best_validation"]["score"]),
            ),
        )
        champion_directory = self.root / "champion"
        champion_directory.mkdir(exist_ok=True)
        shutil.copy2(champion["model"], champion_directory / "model_best.zip")
        atomic_write_json(champion_directory / "selection.json", champion)
        return {
            "candidate_count": len(candidates),
            "eligible_candidate_count": len(eligible),
            "champion_seed": champion["seed"],
            "validation": champion["best_validation"],
        }

    def _comparison_config(self) -> dict[str, Any]:
        result = super()._comparison_config()
        result["protocol"] = "adaptive-v5"
        return result

    def _run_comparison(self) -> dict[str, Any]:
        result = run_comparison(
            self._comparison_config(), self.root / "comparison_results", resume=True
        )
        if result["failures"]:
            raise RuntimeError(f"v5 comparison failures: {result['failures']}")
        ai = result["methods"]["ai"]
        broadcast = result["methods"]["broadcast"]
        urgency = result["methods"]["urgency"]
        high = result["severity_groups"]["high"]["ai"]
        acceptance = self.config["acceptance"]
        best_baseline_coverage = max(
            result["methods"][method]["affected_vehicle_coverage"]["mean"]
            for method in ("broadcast", "distance", "urgency")
        )

        def relative_reduction(value: float, baseline: float) -> float:
            return 1.0 - value / baseline

        checks = {
            "coverage": ai["affected_vehicle_coverage"]["mean"]
            >= float(acceptance["minimum_coverage"]),
            "high_severity_coverage": high["affected_vehicle_coverage"]["mean"]
            >= float(acceptance["minimum_high_severity_coverage"]),
            "timely_events": ai["timely_event_rate"]["mean"]
            >= float(acceptance["minimum_timely_event_rate"]),
            "overhead": ai["communication_overhead"]["mean"]
            <= float(acceptance["maximum_overhead"]),
            "channel_cost": ai["normalized_channel_cost"]["mean"]
            <= float(acceptance["maximum_channel_cost"]),
            "latency": ai["p95_latency_ms"]["mean"] <= float(acceptance["maximum_p95_latency_ms"]),
            "all_latencies_sane": all(
                method["p95_latency_ms"]["mean"]
                <= float(acceptance["maximum_baseline_p95_latency_ms"])
                for method in result["methods"].values()
            ),
            "near_best_baseline_coverage": (
                best_baseline_coverage - ai["affected_vehicle_coverage"]["mean"]
                <= float(acceptance["maximum_coverage_gap_vs_best_baseline"])
            ),
            "latency_reduction_vs_broadcast": relative_reduction(
                ai["p95_latency_ms"]["mean"], broadcast["p95_latency_ms"]["mean"]
            )
            >= float(acceptance["minimum_latency_reduction_vs_broadcast"]),
            "overhead_reduction_vs_broadcast": relative_reduction(
                ai["communication_overhead"]["mean"],
                broadcast["communication_overhead"]["mean"],
            )
            >= float(acceptance["minimum_overhead_reduction_vs_broadcast"]),
            "channel_cost_reduction_vs_urgency": relative_reduction(
                ai["normalized_channel_cost"]["mean"],
                urgency["normalized_channel_cost"]["mean"],
            )
            >= float(acceptance["minimum_channel_cost_reduction_vs_urgency"]),
        }
        result["acceptance"] = {"passed": all(checks.values()), "checks": checks}
        atomic_write_json(self.root / "comparison_results/summary.json", result)
        return {
            "completed_result_rows": result["completed_result_rows"],
            "acceptance": result["acceptance"],
        }

    def _run_results(self) -> dict[str, Any]:
        return generate_demo_lite_results(
            self.root / "presentation_results", experiments_root=self.root
        )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--persistent-root", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--config", default="configs/adaptive_demo_safety_finetune.yaml")
    parser.add_argument("--stage", choices=("next", *STAGES), default="next")
    parser.add_argument("--time-budget-minutes", type=float, default=150)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--allow-cpu", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    pipeline = SafetyFineTunePipeline(
        arguments.source_root,
        arguments.persistent_root,
        arguments.work_root,
        config_path=arguments.config,
        time_budget_minutes=arguments.time_budget_minutes,
        allow_cpu=arguments.allow_cpu,
    )
    if arguments.status:
        print(json.dumps(pipeline.status(), indent=2, ensure_ascii=False))
        return 0
    try:
        result = pipeline.run(arguments.stage)
    except AdaptiveDemoPaused:
        print(json.dumps(pipeline.status(), indent=2, ensure_ascii=False))
        return 75
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

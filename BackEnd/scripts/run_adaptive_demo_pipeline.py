"""Train and evaluate the structured-action Transformer-PPO course demo."""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import DummyVecEnv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.generate_demo_lite_results import generate_demo_lite_results  # noqa: E402
from scripts.run_comparison import run_comparison  # noqa: E402
from src.experiments.evaluation import (  # noqa: E402
    baseline_action_provider,
    evaluate_episode,
    make_environment,
)
from src.experiments.io import atomic_write_json, git_metadata, load_yaml, sha256_file  # noqa: E402
from src.experiments.scenario_matrix import (  # noqa: E402
    ScenarioDefinition,
    build_scenario_matrix,
    materialize_scenario,
)
from src.experiments.presentation_gate import evaluate_directional_behavior  # noqa: E402
from src.models.ppo_agent import PPOAgent  # noqa: E402
from src.training.train_ppo import _make_environment, create_agent  # noqa: E402

STAGES = ("training", "comparison", "results")


class AdaptiveDemoPaused(RuntimeError):
    """Signal a safe, resumable wall-clock pause."""


class EpisodeLogCallback(BaseCallback):
    def __init__(self) -> None:
        super().__init__()
        self.rewards: list[float] = []
        self.timesteps: list[int] = []

    def _on_step(self) -> bool:
        for info in self.locals.get("infos", []):
            if "episode" in info:
                self.rewards.append(float(info["episode"]["r"]))
                self.timesteps.append(int(self.num_timesteps))
        return True


def validation_score(metrics: dict[str, float]) -> float:
    """Rank coverage first, then delivery, timeliness, overhead, and latency."""
    coverage = metrics["affected_vehicle_coverage"]
    shortfall = max(0.0, 0.95 - coverage)
    return (
        coverage
        - 2.0 * shortfall
        + 0.20 * metrics["effective_delivery_rate"]
        + 0.15 * metrics["timely_event_rate"]
        - 0.05 * min(metrics["communication_overhead"] / 12.0, 1.0)
        - 0.05 * min(metrics.get("normalized_channel_cost", 1.0) / 4.0, 1.0)
        - 0.05 * min(metrics["p95_latency_ms"] / 100.0, 1.0)
    )


def _mean_metrics(rows: list[dict[str, float | int | None]]) -> dict[str, float]:
    fields = (
        "affected_vehicle_coverage",
        "affected_vehicle_selection_coverage",
        "effective_delivery_rate",
        "timely_event_rate",
        "communication_overhead",
        "normalized_channel_cost",
        "p95_latency_ms",
    )
    result: dict[str, float] = {}
    for field in fields:
        values = [float(row[field]) for row in rows if row.get(field) is not None]
        result[field] = float(np.mean(values)) if values else float("inf")
    return result


class AdaptiveDemoPipeline:
    def __init__(
        self,
        persistent_root: Path,
        work_root: Path,
        *,
        config_path: str | Path,
        time_budget_minutes: float,
        allow_cpu: bool = False,
    ) -> None:
        self.root = persistent_root.expanduser().resolve()
        self.work = work_root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.work.mkdir(parents=True, exist_ok=True)
        self.config = load_yaml(config_path)
        self.allow_cpu = allow_cpu
        self.deadline = time.monotonic() + time_budget_minutes * 60
        self.state_path = self.root / "adaptive_demo_state.json"
        self.state = (
            json.loads(self.state_path.read_text(encoding="utf-8"))
            if self.state_path.is_file()
            else {"stages": {}}
        )
        self.state.update(
            {
                "run_mode": "adaptive_demo",
                "scope": "highway-only structured-action course demo",
                "git": git_metadata(),
            }
        )
        self._save()

    def _save(self) -> None:
        atomic_write_json(self.state_path, self.state)

    def status(self) -> dict[str, Any]:
        stages = self.state.setdefault("stages", {})
        return {
            "run_mode": self.state["run_mode"],
            "scope": self.state["scope"],
            "git": self.state["git"],
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
            raise ValueError(f"unknown adaptive-demo stage: {stage}")
        if stage == "training":
            import torch

            if not torch.cuda.is_available() and not self.allow_cpu:
                raise RuntimeError("adaptive-demo training requires a CUDA runtime")
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

    def _matrix(self) -> list[ScenarioDefinition]:
        dataset = self.config["dataset"]
        return build_scenario_matrix(
            "highway",
            load_yaml(self.config["base_scenario_config"]),
            train_count=int(dataset["train_configs"]),
            validation_count=int(dataset["validation_configs"]),
            test_count=int(dataset["test_configs"]),
        )

    def _materialize_split(self, split: str) -> list[tuple[ScenarioDefinition, Path]]:
        selected = [item for item in self._matrix() if item.split == split]
        values = []
        for index, definition in enumerate(selected):
            path = materialize_scenario(
                definition,
                self.root / "scenarios" / split / definition.scenario_id,
                seed=40_000 + index,
            )
            values.append((definition, path))
        return values

    def _resolved_training_config(self, scenario_path: Path, seed: int) -> dict[str, Any]:
        config = load_yaml(self.config["base_training_config"])
        config.update(
            {
                "seed": seed,
                "scenario": {
                    "type": "highway",
                    "directory": str(scenario_path),
                    "generate_if_missing": False,
                },
                "environment": {**self.config["environment"], "reward_mode": "full"},
                "network": self.config["network"],
                "action": self.config["action"],
                "reward": {"weights": self.config["reward_weights"]},
                "evaluation": {"safety_window_ms": self.config["safety_window_ms"]},
                "ppo": self.config["ppo"],
            }
        )
        return config

    def _training_environment(self, seed: int, paths: list[Path]) -> DummyVecEnv:
        factories = []
        for index, path in enumerate(paths):
            resolved = self._resolved_training_config(path, seed + index * 1000)
            factories.append(lambda resolved=resolved, path=path: _make_environment(resolved, path))
        return DummyVecEnv(factories)

    def _evaluate_candidate(
        self,
        agent: PPOAgent,
        validation: list[tuple[ScenarioDefinition, Path]],
    ) -> dict[str, float]:
        rows: list[dict[str, float | int | None]] = []
        for _, scenario_path in validation:
            for seed in map(int, self.config["training"]["validation_seeds"]):
                environment = make_environment(
                    scenario_path,
                    "highway",
                    seed,
                    {
                        "environment": self.config["environment"],
                        "network": {"highway_mode": self.config["network"]["mode"], **{
                            key: value
                            for key, value in self.config["network"].items()
                            if key not in {"mode", "scenario"}
                        }},
                        "reward_weights": self.config["reward_weights"],
                        "safety_window_ms": self.config["safety_window_ms"],
                        "action": self.config["action"],
                    },
                    action_mode=str(self.config["action"]["mode"]),
                )
                try:
                    rows.append(
                        evaluate_episode(
                            environment,
                            lambda _environment, observation: np.asarray(
                                agent.predict_raw(observation, deterministic=True),
                                dtype=np.int64,
                            ),
                            reset_seed=seed,
                            safety_window_ms=float(self.config["safety_window_ms"]),
                        )
                    )
                finally:
                    environment.close()
        metrics = _mean_metrics(rows)
        metrics["score"] = validation_score(metrics)
        return metrics

    @staticmethod
    def _append_rewards(path: Path, rewards: list[float], timesteps: list[int]) -> None:
        if len(rewards) != len(timesteps):
            raise ValueError("reward and timestep logs must have equal length")
        new_file = not path.is_file()
        existing = 0
        if not new_file:
            with path.open(encoding="utf-8") as stream:
                existing = sum(1 for _ in csv.DictReader(stream))
        with path.open("a", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=("episode", "timesteps", "reward"))
            if new_file:
                writer.writeheader()
            for offset, (reward, timesteps_value) in enumerate(
                zip(rewards, timesteps, strict=True), start=1
            ):
                writer.writerow(
                    {
                        "episode": existing + offset,
                        "timesteps": timesteps_value,
                        "reward": f"{reward:.8f}",
                    }
                )

    def _train_candidate(
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
        try:
            if checkpoint.is_file():
                agent = PPOAgent.load(checkpoint, environment)
            else:
                config = self._resolved_training_config(train_paths[0], seed)
                config["tensorboard_log"] = candidate / "tensorboard"
                agent = create_agent(config, environment)  # type: ignore[arg-type]
            training = self.config["training"]
            maximum = int(training["max_timesteps"])
            interval = int(training["evaluation_interval_timesteps"])
            patience = int(training["early_stopping_patience_evaluations"])
            history_path = candidate / "validation_history.json"
            history = (
                json.loads(history_path.read_text(encoding="utf-8"))
                if history_path.is_file()
                else []
            )
            best_score = max((float(item["score"]) for item in history), default=-float("inf"))
            stale = 0
            while agent.model.num_timesteps < maximum and stale < patience:
                if time.monotonic() >= self.deadline - 1800:
                    agent.save(candidate / "checkpoint_latest")
                    raise AdaptiveDemoPaused
                callback = EpisodeLogCallback()
                remaining = maximum - agent.model.num_timesteps
                agent.train(min(interval, remaining), callback, reset_num_timesteps=False)
                self._append_rewards(
                    candidate / "training_log.csv", callback.rewards, callback.timesteps
                )
                agent.save(candidate / "checkpoint_latest")
                metrics = self._evaluate_candidate(agent, validation)
                record = {"timesteps": agent.model.num_timesteps, **metrics}
                history.append(record)
                atomic_write_json(history_path, history)
                if metrics["score"] > best_score:
                    best_score = metrics["score"]
                    stale = 0
                    agent.save(candidate / "model_best")
                    atomic_write_json(candidate / "best_validation.json", record)
                else:
                    stale += 1
                pilot = int(training["pilot_timesteps"])
                if (
                    agent.model.num_timesteps >= pilot
                    and len(history) == 2
                    and metrics["affected_vehicle_coverage"]
                    < float(training["pilot_minimum_coverage"])
                ):
                    raise RuntimeError(
                        f"pilot coverage gate failed for seed {seed}: "
                        f"{metrics['affected_vehicle_coverage']:.3f}"
                    )
            best = json.loads((candidate / "best_validation.json").read_text(encoding="utf-8"))
            summary = {
                "status": "completed",
                "seed": seed,
                "timesteps": agent.model.num_timesteps,
                "best_validation": best,
                "model": str(candidate / "model_best.zip"),
            }
            atomic_write_json(summary_path, summary)
            if checkpoint.is_file():
                checkpoint.unlink()
            return summary
        finally:
            environment.close()

    def _run_training(self) -> dict[str, Any]:
        training = self._materialize_split("train")
        validation = self._materialize_split("validation")
        calibration = self._run_calibration(training[:3])
        train_paths = [path for _, path in training]
        candidates = [
            self._train_candidate(seed, train_paths, validation)
            for seed in map(int, self.config["training"]["candidate_seeds"])
        ]
        champion = max(
            candidates,
            key=lambda item: float(item["best_validation"]["score"]),
        )
        champion_directory = self.root / "champion"
        champion_directory.mkdir(exist_ok=True)
        shutil.copy2(champion["model"], champion_directory / "model_best.zip")
        atomic_write_json(champion_directory / "selection.json", champion)
        return {
            "calibration": calibration,
            "candidate_count": len(candidates),
            "champion_seed": champion["seed"],
            "validation": champion["best_validation"],
        }

    def _evaluation_config(self) -> dict[str, Any]:
        return {
            "environment": self.config["environment"],
            "network": {
                "highway_mode": self.config["network"]["mode"],
                **{
                    key: value
                    for key, value in self.config["network"].items()
                    if key not in {"mode", "scenario"}
                },
            },
            "reward_weights": self.config["reward_weights"],
            "safety_window_ms": self.config["safety_window_ms"],
            "action": self.config["action"],
        }

    def _run_calibration(
        self, scenarios: list[tuple[ScenarioDefinition, Path]]
    ) -> dict[str, Any]:
        """Fail quickly when the network model produces non-physical pilot metrics."""
        rows: list[dict[str, Any]] = []
        config = self._evaluation_config()
        methods = ("broadcast", "distance", "urgency")
        for definition, scenario_path in scenarios:
            for method in methods:
                environment = make_environment(
                    scenario_path, "highway", 9001, config, action_mode="individual"
                )
                try:
                    metrics = evaluate_episode(
                        environment,
                        baseline_action_provider(method),
                        reset_seed=9001,
                        safety_window_ms=float(self.config["safety_window_ms"]),
                    )
                finally:
                    environment.close()
                p95 = metrics["p95_latency_ms"]
                coverage = float(metrics["affected_vehicle_coverage"])
                if p95 is None or not math.isfinite(float(p95)) or not 0 < float(p95) <= 200:
                    raise RuntimeError(
                        f"network calibration failed for {definition.scenario_id}/{method}: "
                        f"P95={p95} ms"
                    )
                if not 0 <= coverage <= 1:
                    raise RuntimeError("network calibration produced invalid coverage")
                rows.append(
                    {"scenario_id": definition.scenario_id, "method": method, **metrics}
                )
        result = {"status": "passed", "rows": rows}
        atomic_write_json(self.root / "network_calibration.json", result)
        return {"status": "passed", "evaluated_rows": len(rows)}

    def _comparison_config(self) -> dict[str, Any]:
        network = {
            "highway_mode": self.config["network"]["mode"],
            **{
                key: value
                for key, value in self.config["network"].items()
                if key not in {"mode", "scenario"}
            },
        }
        return {
            "run_mode": "demo_lite",
            "domains": ["highway"],
            "safety_window_ms": self.config["safety_window_ms"],
            "base_scenario_configs": {"highway": self.config["base_scenario_config"]},
            "models": {"highway": str(self.root / "champion/model_best.zip")},
            "dataset": self.config["dataset"],
            "test_seeds": self.config["test_seeds"],
            "environment": self.config["environment"],
            "network": network,
            "reward_weights": self.config["reward_weights"],
            "action": self.config["action"],
        }

    def _training_quality_checks(self) -> dict[str, bool]:
        selection = json.loads(
            (self.root / "champion" / "selection.json").read_text(encoding="utf-8")
        )
        candidate = self.root / "candidates" / f"seed_{selection['seed']}"
        with (candidate / "training_log.csv").open(encoding="utf-8") as stream:
            rewards = [float(row["reward"]) for row in csv.DictReader(stream)]
        window = min(100, max(1, len(rewards) // 10))
        improved = bool(rewards) and (
            float(np.mean(rewards[-window:])) - float(np.mean(rewards[:window]))
            >= float(self.config["acceptance"]["minimum_reward_improvement"])
        )
        history = json.loads(
            (candidate / "validation_history.json").read_text(encoding="utf-8")
        )
        passes = [float(item["affected_vehicle_coverage"]) >= 0.95 for item in history]
        required = int(self.config["acceptance"]["validation_consecutive_passes"])
        stable = any(
            all(passes[index : index + required])
            for index in range(len(passes) - required + 1)
        )
        return {"training_improved": improved, "validation_stable": stable}

    def _run_comparison(self) -> dict[str, Any]:
        result = run_comparison(
            self._comparison_config(), self.root / "comparison_results", resume=True
        )
        if result["failures"]:
            raise RuntimeError(f"adaptive comparison failures: {result['failures']}")
        ai = result["methods"]["ai"]
        broadcast = result["methods"]["broadcast"]
        rule_methods = [result["methods"][name] for name in ("distance", "urgency")]
        acceptance = self.config["acceptance"]
        behavior = evaluate_directional_behavior(
            self.root / "champion/model_best.zip",
            [path for _, path in self._materialize_split("test")],
            self._evaluation_config(),
            seeds=tuple(map(int, self.config["test_seeds"])),
        )
        best_rule_coverage = max(
            method["affected_vehicle_coverage"]["mean"] for method in rule_methods
        )
        gap = float(acceptance["maximum_primary_gap_vs_best_rule"])
        checks = {
            "coverage": ai["affected_vehicle_coverage"]["mean"]
            >= float(acceptance["minimum_coverage"]),
            "overhead": ai["communication_overhead"]["mean"]
            <= float(acceptance["maximum_overhead"]),
            "channel_cost": ai["normalized_channel_cost"]["mean"]
            <= float(acceptance["maximum_channel_cost"]),
            "timely_events": ai["timely_event_rate"]["mean"] >= 0.90,
            "latency": ai["p95_latency_ms"]["mean"]
            <= float(acceptance["maximum_p95_latency_ms"]),
            "all_latencies_sane": all(
                method["p95_latency_ms"]["mean"]
                <= float(acceptance["maximum_baseline_p95_latency_ms"])
                for method in result["methods"].values()
            ),
            "p95_vs_broadcast": ai["p95_latency_ms"]["mean"]
            <= broadcast["p95_latency_ms"]["mean"]
            * float(acceptance["maximum_p95_vs_broadcast_ratio"]),
            "near_best_rule": (
                best_rule_coverage - ai["affected_vehicle_coverage"]["mean"] <= gap
            ),
            **self._training_quality_checks(),
            "directional_behavior": bool(behavior["passed"]),
        }
        checks["pareto_efficient"] = not any(
            method["affected_vehicle_coverage"]["mean"]
            >= ai["affected_vehicle_coverage"]["mean"] + gap
            and method["p95_latency_ms"]["mean"] <= ai["p95_latency_ms"]["mean"] * (1 - gap)
            and method["communication_overhead"]["mean"]
            <= ai["communication_overhead"]["mean"] * (1 - gap)
            and method["normalized_channel_cost"]["mean"]
            <= ai["normalized_channel_cost"]["mean"] * (1 - gap)
            for method in rule_methods
        )
        result["behavioral_gate"] = behavior
        result["acceptance"] = {"passed": all(checks.values()), "checks": checks}
        atomic_write_json(self.root / "comparison_results/summary.json", result)
        return {
            "completed_result_rows": result["completed_result_rows"],
            "acceptance": result["acceptance"],
        }

    def _run_results(self) -> dict[str, Any]:
        result = generate_demo_lite_results(
            self.root / "presentation_results", experiments_root=self.root
        )
        summary = json.loads(
            (self.root / "comparison_results" / "summary.json").read_text(encoding="utf-8")
        )
        acceptance = summary.get("acceptance", {"passed": False, "checks": {}})
        if not acceptance.get("passed"):
            raise RuntimeError("champion failed acceptance and cannot receive a model manifest")
        model_path = self.root / "champion" / "model_best.zip"
        manifest = {
            "eligible": True,
            "action_mode": self.config["action"]["mode"],
            "observation_schema_version": 2,
            "training_run": self.state.get("git", {}),
            "model_sha256": sha256_file(model_path),
            "acceptance": acceptance,
            "metrics": summary.get("methods", {}).get("ai", {}),
        }
        atomic_write_json(self.root / "champion" / "model_manifest.json", manifest)
        return {**result, "model_manifest": str(self.root / "champion/model_manifest.json")}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--persistent-root", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--config", default="configs/adaptive_demo_training.yaml")
    parser.add_argument("--stage", choices=("next", *STAGES), default="next")
    parser.add_argument("--time-budget-minutes", type=float, default=270)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--allow-cpu", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if arguments.time_budget_minutes <= 30:
        print("time budget must be greater than 30 minutes", file=sys.stderr)
        return 2
    pipeline = AdaptiveDemoPipeline(
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

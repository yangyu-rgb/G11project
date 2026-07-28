"""Warm-start v5 and train the constrained Transformer-PPO v6 course demo."""

from __future__ import annotations

import csv
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.generate_demo_lite_results import generate_demo_lite_results  # noqa: E402
from scripts.run_adaptive_demo_pipeline import (  # noqa: E402
    AdaptiveDemoPaused,
    _mean_metrics,
    validation_score,
)
from scripts.run_comparison import run_comparison  # noqa: E402
from scripts.run_safety_finetune_pipeline import (  # noqa: E402
    STAGES,
    SafetyFineTunePipeline,
)
from src.environment.v2x_env import V2XEnv  # noqa: E402
from src.experiments.evaluation import evaluate_episode, make_environment  # noqa: E402
from src.experiments.io import (  # noqa: E402
    atomic_write_json,
    git_metadata,
    load_yaml,
)
from src.experiments.scenario_matrix import (  # noqa: E402
    ScenarioDefinition,
    build_safety_scenario_matrix,
    materialize_scenario,
)
from src.models.ppo_agent import PPOAgent  # noqa: E402


class ConstrainedSafetyPipeline(SafetyFineTunePipeline):
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
        self.root = persistent_root.expanduser().resolve()
        self.work = work_root.expanduser().resolve()
        self.source_root = source_root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.work.mkdir(parents=True, exist_ok=True)
        self.config = load_yaml(config_path)
        self.allow_cpu = allow_cpu
        self.deadline = time.monotonic() + time_budget_minutes * 60
        self.state_path = self.root / "constrained_safety_state.json"
        self.state = (
            json.loads(self.state_path.read_text(encoding="utf-8"))
            if self.state_path.is_file()
            else {"stages": {}}
        )
        self.state.update(
            {
                "run_mode": "constrained_safety_finetune",
                "scope": "highway-only safety-constrained course demo",
                "protocol": "constrained-v6",
                "source_root": str(self.source_root),
                "git": git_metadata(),
            }
        )
        self._validate_source()
        self._validate_protocol()
        self._save()

    def _matrix(self) -> list[ScenarioDefinition]:
        dataset = self.config["dataset"]
        return build_safety_scenario_matrix(
            load_yaml(self.config["base_scenario_config"]),
            train_count=int(dataset["train_configs"]),
            validation_count=int(dataset["validation_configs"]),
            test_count=int(dataset["test_configs"]),
        )

    def _boundary_stats(self, scenario_path: Path) -> dict[str, float | int]:
        environment = self.config["environment"]
        audit = V2XEnv(
            scenario_path,
            episode_steps=int(environment["episode_steps"]),
            max_vehicles=int(environment["max_vehicles"]),
            max_events=int(environment["max_events"]),
            severity_aware_critical_radius=True,
            low_severity_radius_m=float(environment["low_severity_radius_m"]),
            medium_severity_radius_m=float(environment["medium_severity_radius_m"]),
            high_severity_radius_m=float(environment["high_severity_radius_m"]),
            feature_mode=str(environment["feature_mode"]),
            history_window=int(environment["history_window"]),
        )
        boundary_count = 0
        affected_count = 0
        for step, events in enumerate(audit._events_by_step):
            frame = audit.frames[step]
            for event in events:
                sender = audit._nearest_vehicle(frame.vehicles, event)
                for vehicle in frame.vehicles:
                    if sender is not None and vehicle.vehicle_id == sender.vehicle_id:
                        continue
                    distance = math.dist((vehicle.x, vehicle.y), (event.x, event.y))
                    affected_count += int(distance <= 375.0)
                    boundary_count += int(300.0 < distance <= 375.0)
        audit.close()
        return {
            "affected_vehicle_count": affected_count,
            "boundary_vehicle_count": boundary_count,
            "boundary_fraction": (boundary_count / affected_count if affected_count else 0.0),
        }

    def _materialize_split(self, split: str) -> list[tuple[ScenarioDefinition, Path]]:
        selected = [item for item in self._matrix() if item.split == split]
        quality = self.config["scenario_quality"]
        values: list[tuple[ScenarioDefinition, Path]] = []
        audits: list[dict[str, Any]] = []
        split_offset = 0 if split == "train" else 10_000
        for index, definition in enumerate(selected):
            scenario_path = self.root / "scenarios" / split / definition.scenario_id
            severity = float(definition.parameters["events"]["severity"])
            maximum_attempts = int(quality["maximum_generation_attempts"]) if severity > 0.75 else 1
            accepted = False
            for attempt in range(maximum_attempts):
                seed = int(quality["geometry_seed_base"]) + split_offset + index * 100 + attempt
                materialize_scenario(definition, scenario_path, seed=seed)
                stats = self._boundary_stats(scenario_path)
                accepted = severity <= 0.75 or (
                    int(stats["boundary_vehicle_count"])
                    >= int(quality["minimum_boundary_vehicle_count"])
                    or float(stats["boundary_fraction"])
                    >= float(quality["minimum_boundary_fraction"])
                )
                if accepted:
                    audits.append(
                        {
                            "scenario_id": definition.scenario_id,
                            "split": split,
                            "severity": severity,
                            "geometry_seed": seed,
                            "generation_attempt": attempt + 1,
                            **stats,
                        }
                    )
                    break
            if not accepted:
                raise RuntimeError(
                    f"unable to create discriminative high-risk scenario: {definition.scenario_id}"
                )
            values.append((definition, scenario_path))
        atomic_write_json(self.root / f"{split}_scenario_quality.json", audits)
        return values

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
                    action_mode="safety_adaptive_radius",
                )
                try:
                    row = evaluate_episode(
                        environment,
                        lambda _environment, observation: np.asarray(
                            agent.predict_raw(observation, deterministic=True),
                            dtype=np.int64,
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
        worst_high = min(float(row["affected_vehicle_coverage"]) for row in high_rows)
        override_values = [
            float(row["safety_override_rate"])
            for row in rows
            if row.get("safety_override_rate") is not None
        ]
        override_rate = float(np.mean(override_values)) if override_values else 0.0
        gate = self.config["validation_gate"]
        eligible = (
            metrics["affected_vehicle_coverage"] >= float(gate["minimum_coverage"])
            and high_metrics["affected_vehicle_coverage"]
            >= float(gate["minimum_high_severity_coverage"])
            and high_metrics["affected_vehicle_selection_coverage"]
            >= float(gate["minimum_high_severity_selection_coverage"])
            and worst_high >= float(gate["minimum_worst_high_severity_coverage"])
            and metrics["timely_event_rate"] >= float(gate["minimum_timely_event_rate"])
            and metrics["normalized_channel_cost"] <= float(gate["maximum_channel_cost"])
        )
        minimum_coverage = min(
            metrics["affected_vehicle_coverage"],
            high_metrics["affected_vehicle_coverage"],
            worst_high,
        )
        score = (
            validation_score(metrics)
            + 0.60 * high_metrics["affected_vehicle_coverage"]
            + 0.20 * high_metrics["affected_vehicle_selection_coverage"]
            - 0.10 * override_rate
            - 5.0 * max(0.0, float(gate["minimum_coverage"]) - minimum_coverage)
        )
        return {
            **metrics,
            "high_severity_coverage": high_metrics["affected_vehicle_coverage"],
            "high_severity_selection_coverage": high_metrics["affected_vehicle_selection_coverage"],
            "high_severity_timely_event_rate": high_metrics["timely_event_rate"],
            "worst_high_severity_coverage": worst_high,
            "safety_override_rate": override_rate,
            "minimum_safety_coverage": minimum_coverage,
            "score": score,
            "eligible": eligible,
        }

    def _comparison_config(self) -> dict[str, Any]:
        result = super()._comparison_config()
        result["protocol"] = "constrained-v6"
        result["action"] = self.config["action"]
        return result

    @staticmethod
    def _metric_mean(summary: dict[str, Any], method: str, metric: str) -> float:
        return float(summary["methods"][method][metric]["mean"])

    def _run_comparison(self) -> dict[str, Any]:
        comparison_config = self._comparison_config()
        result = run_comparison(comparison_config, self.root / "comparison_results", resume=True)
        if result["failures"]:
            raise RuntimeError(f"v6 comparison failures: {result['failures']}")

        source_config = dict(comparison_config)
        source_config["protocol"] = "adaptive-v5-on-v6-holdout"
        source_config["models"] = {"highway": str(self.source_root / "champion/model_best.zip")}
        source_config["action"] = {
            **self.config["action"],
            "mode": "adaptive_radius",
        }
        source = run_comparison(source_config, self.root / "source_v5_comparison", resume=True)
        if source["failures"]:
            raise RuntimeError(f"v5 comparison failures: {source['failures']}")

        ai = result["methods"]["ai"]
        broadcast = result["methods"]["broadcast"]
        urgency = result["methods"]["urgency"]
        high = result["severity_groups"]["high"]["ai"]
        source_high = source["severity_groups"]["high"]["ai"]
        high_improvement = float(high["affected_vehicle_coverage"]["mean"]) - float(
            source_high["affected_vehicle_coverage"]["mean"]
        )
        acceptance = self.config["acceptance"]

        def reduction(value: float, baseline: float) -> float:
            return 1.0 - value / baseline

        checks = {
            "coverage": float(ai["affected_vehicle_coverage"]["mean"])
            >= float(acceptance["minimum_coverage"]),
            "high_severity_coverage": float(high["affected_vehicle_coverage"]["mean"])
            >= float(acceptance["minimum_high_severity_coverage"]),
            "high_severity_selection_coverage": float(
                high["affected_vehicle_selection_coverage"]["mean"]
            )
            >= float(acceptance["minimum_high_severity_selection_coverage"]),
            "high_severity_improvement_vs_v5": high_improvement
            >= float(acceptance["minimum_high_severity_improvement_vs_v5"]),
            "timely_events": float(ai["timely_event_rate"]["mean"])
            >= float(acceptance["minimum_timely_event_rate"]),
            "overhead": float(ai["communication_overhead"]["mean"])
            <= float(acceptance["maximum_overhead"]),
            "channel_cost": float(ai["normalized_channel_cost"]["mean"])
            <= float(acceptance["maximum_channel_cost"]),
            "latency": float(ai["p95_latency_ms"]["mean"])
            <= float(acceptance["maximum_p95_latency_ms"]),
            "latency_reduction_vs_broadcast": reduction(
                float(ai["p95_latency_ms"]["mean"]),
                float(broadcast["p95_latency_ms"]["mean"]),
            )
            >= float(acceptance["minimum_latency_reduction_vs_broadcast"]),
            "overhead_reduction_vs_broadcast": reduction(
                float(ai["communication_overhead"]["mean"]),
                float(broadcast["communication_overhead"]["mean"]),
            )
            >= float(acceptance["minimum_overhead_reduction_vs_broadcast"]),
            "channel_cost_reduction_vs_urgency": reduction(
                float(ai["normalized_channel_cost"]["mean"]),
                float(urgency["normalized_channel_cost"]["mean"]),
            )
            >= float(acceptance["minimum_channel_cost_reduction_vs_urgency"]),
        }
        upgrade = {
            "v5": {
                "coverage": self._metric_mean(source, "ai", "affected_vehicle_coverage"),
                "high_severity_coverage": float(source_high["affected_vehicle_coverage"]["mean"]),
                "high_severity_selection_coverage": float(
                    source_high["affected_vehicle_selection_coverage"]["mean"]
                ),
            },
            "v6": {
                "coverage": self._metric_mean(result, "ai", "affected_vehicle_coverage"),
                "high_severity_coverage": float(high["affected_vehicle_coverage"]["mean"]),
                "high_severity_selection_coverage": float(
                    high["affected_vehicle_selection_coverage"]["mean"]
                ),
            },
            "high_severity_coverage_improvement": high_improvement,
        }
        result["acceptance"] = {"passed": all(checks.values()), "checks": checks}
        result["model_upgrade"] = upgrade
        atomic_write_json(self.root / "comparison_results/summary.json", result)
        atomic_write_json(self.root / "model_upgrade.json", upgrade)
        return {
            "completed_result_rows": result["completed_result_rows"],
            "acceptance": result["acceptance"],
            "model_upgrade": upgrade,
        }

    def _write_v6_artifacts(self, output: Path) -> None:
        upgrade = json.loads((self.root / "model_upgrade.json").read_text(encoding="utf-8"))
        metrics = ("coverage", "high_severity_coverage", "high_severity_selection_coverage")
        with (output / "table_v5_v6_upgrade.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow(("metric", "v5", "v6", "absolute_improvement"))
            for metric in metrics:
                writer.writerow(
                    (
                        metric,
                        upgrade["v5"][metric],
                        upgrade["v6"][metric],
                        upgrade["v6"][metric] - upgrade["v5"][metric],
                    )
                )
        figure, axis = plt.subplots(figsize=(8.4, 5.0), constrained_layout=True)
        x_values = np.arange(len(metrics))
        width = 0.34
        for index, version in enumerate(("v5", "v6")):
            values = [float(upgrade[version][metric]) for metric in metrics]
            bars = axis.bar(
                x_values + (index - 0.5) * width,
                values,
                width,
                label=version.upper(),
                color=("#94A3B8", "#2563EB")[index],
            )
            axis.bar_label(bars, fmt="%.3f", padding=3)
        axis.axhline(0.95, color="#111827", linestyle="--", label="95% target")
        axis.set(
            xticks=x_values,
            xticklabels=("Overall coverage", "High-risk delivery", "High-risk selection"),
            ylim=(0, 1.08),
            ylabel="Rate",
            title="Safety-Constrained Upgrade on the Same Fresh Holdout",
        )
        axis.grid(axis="y", alpha=0.2)
        axis.legend(frameon=False)
        figure.savefig(output / "fig_v5_v6_safety_upgrade.png", dpi=300)
        plt.close(figure)

        detailed = list(
            csv.DictReader(
                (self.root / "comparison_results/detailed_results.csv").open(encoding="utf-8")
            )
        )
        ai_rows = [row for row in detailed if row["method"] == "ai"]
        audit_rows = []
        for group in ("low", "medium", "high"):
            rows = [row for row in ai_rows if row["severity_group"] == group]
            audit_rows.append(
                {
                    "severity_group": group,
                    "raw_radius_m": float(
                        np.mean([float(row["mean_raw_radius_m"]) for row in rows])
                    ),
                    "executed_radius_m": float(
                        np.mean([float(row["mean_executed_radius_m"]) for row in rows])
                    ),
                    "override_rate": float(
                        np.mean([float(row["safety_override_rate"]) for row in rows])
                    ),
                }
            )
        with (output / "table_action_audit_by_severity.csv").open(
            "w", newline="", encoding="utf-8"
        ) as stream:
            writer = csv.DictWriter(stream, fieldnames=audit_rows[0].keys())
            writer.writeheader()
            writer.writerows(audit_rows)
        figure, radius_axis = plt.subplots(figsize=(8.4, 5.0), constrained_layout=True)
        groups = [row["severity_group"].title() for row in audit_rows]
        radius_axis.plot(
            groups,
            [row["raw_radius_m"] for row in audit_rows],
            marker="o",
            label="Raw PPO radius",
        )
        radius_axis.plot(
            groups,
            [row["executed_radius_m"] for row in audit_rows],
            marker="o",
            label="Executed safe radius",
        )
        override_axis = radius_axis.twinx()
        override_axis.bar(
            groups,
            [row["override_rate"] for row in audit_rows],
            alpha=0.18,
            color="#DC2626",
            label="Override rate",
        )
        radius_axis.set(
            ylabel="Receiver Radius (m)",
            xlabel="Emergency Severity",
            title="Raw Policy and Safety-Projected Actions",
        )
        override_axis.set(ylabel="Safety Override Rate", ylim=(0, 1.05))
        handles, labels = radius_axis.get_legend_handles_labels()
        other_handles, other_labels = override_axis.get_legend_handles_labels()
        radius_axis.legend(handles + other_handles, labels + other_labels, frameon=False)
        radius_axis.grid(alpha=0.2)
        figure.savefig(output / "fig_action_audit_by_severity.png", dpi=300)
        plt.close(figure)

    def _run_results(self) -> dict[str, Any]:
        output = self.root / "presentation_results"
        manifest = generate_demo_lite_results(output, experiments_root=self.root)
        self._write_v6_artifacts(output)
        manifest["figures"] = sorted(path.name for path in output.iterdir())
        atomic_write_json(output / "manifest.json", manifest)
        return manifest


def parse_arguments() -> Any:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--persistent-root", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--config", default="configs/constrained_safety_training_v6.yaml")
    parser.add_argument("--stage", choices=("next", *STAGES), default="next")
    parser.add_argument("--time-budget-minutes", type=float, default=150)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--allow-cpu", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    pipeline = ConstrainedSafetyPipeline(
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

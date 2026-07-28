"""Evaluate the full PPO+Transformer method against three fixed baselines."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.experiments.evaluation import (  # noqa: E402
    baseline_action_provider,
    evaluate_episode,
    make_environment,
    model_action_provider,
    write_detailed_csv,
)
from src.experiments.io import atomic_write_json, backend_path, git_metadata, load_yaml  # noqa: E402
from src.experiments.metrics import METRIC_SCHEMA_VERSION  # noqa: E402
from src.experiments.scenario_matrix import (  # noqa: E402
    build_scenario_matrix,
    make_single_event_matrix,
    materialize_scenario,
)
from src.experiments.statistics import (  # noqa: E402
    holm_adjust,
    paired_wilcoxon,
    summarize_values,
)

METHODS = ("ai", "broadcast", "distance", "urgency")
OPTIONAL_METHODS = ("fixed_directional_corridor",)
SUPPORTED_DOMAINS = ("highway", "urban")
PRIMARY_METRICS = (
    "p95_latency_ms",
    "effective_delivery_rate",
    "affected_vehicle_coverage",
    "affected_vehicle_selection_coverage",
    "communication_overhead",
    "normalized_channel_cost",
    "timely_event_rate",
)
CaseRunner = Callable[[Path, str, int, str, Path | None, dict[str, Any]], dict[str, Any]]


def severity_group(value: float | None) -> str | None:
    if value is None:
        return None
    if value < 0.5:
        return "low"
    if value <= 0.75:
        return "medium"
    return "high"


def run_case(
    scenario_path: Path,
    domain: str,
    seed: int,
    method: str,
    model_path: Path | None,
    config: dict[str, Any],
) -> dict[str, Any]:
    action_mode = (
        str(config.get("action", {}).get("mode", "individual")) if method == "ai" else "individual"
    )
    environment = make_environment(
        scenario_path,
        domain,
        seed,
        config,
        action_mode=action_mode,
    )
    try:
        if method == "ai":
            if model_path is None or not model_path.is_file():
                raise FileNotFoundError(f"trained model is missing: {model_path}")
            action_provider = model_action_provider(model_path, environment)
        else:
            baseline = config.get("fixed_directional_baseline", {})
            action_provider = baseline_action_provider(
                method,
                fixed_directional_radius_m=float(baseline.get("radius_m", 300.0)),
                fixed_directional_bandwidth_fraction=float(baseline.get("bandwidth_fraction", 0.5)),
            )
        return evaluate_episode(
            environment,
            action_provider,
            reset_seed=seed,
            safety_window_ms=float(config.get("safety_window_ms", 100)),
        )
    finally:
        environment.close()


def _finite_values(rows: list[dict[str, Any]], metric: str) -> list[float]:
    return [
        float(row[metric])
        for row in rows
        if row.get(metric) is not None and math.isfinite(float(row[metric]))
    ]


def summarize_rows(
    rows: list[dict[str, Any]], methods: tuple[str, ...] = METHODS
) -> dict[str, Any]:
    grouped: dict[str, dict[str, Any]] = {}
    for method in methods:
        method_rows = [row for row in rows if row["method"] == method]
        grouped[method] = {
            metric: summarize_values(values)
            for metric in (
                "mean_latency_ms",
                "p50_latency_ms",
                "p95_latency_ms",
                "p99_latency_ms",
                "timeout_rate",
                *PRIMARY_METRICS[1:],
                "safety_override_rate",
                "mean_raw_radius_m",
                "mean_executed_radius_m",
            )
            if (values := _finite_values(method_rows, metric))
        }

    raw_p_values: dict[str, float] = {}
    directions: dict[str, bool] = {}
    for baseline in methods[1:]:
        for metric in PRIMARY_METRICS:
            ai_by_case = {
                row["case_id"]: float(row[metric])
                for row in rows
                if row["method"] == "ai" and row.get(metric) is not None
            }
            baseline_by_case = {
                row["case_id"]: float(row[metric])
                for row in rows
                if row["method"] == baseline and row.get(metric) is not None
            }
            paired_ids = sorted(ai_by_case.keys() & baseline_by_case.keys())
            key = f"ai_vs_{baseline}:{metric}"
            if paired_ids:
                left = [ai_by_case[item] for item in paired_ids]
                right = [baseline_by_case[item] for item in paired_ids]
                raw_p_values[key] = paired_wilcoxon(left, right)
                lower_is_better = metric in {
                    "p95_latency_ms",
                    "communication_overhead",
                    "normalized_channel_cost",
                }
                directions[key] = (
                    (sum(left) < sum(right)) if lower_is_better else (sum(left) > sum(right))
                )
    adjusted = holm_adjust(raw_p_values)
    significance = {
        key: {
            "p_value": raw_p_values[key],
            "holm_adjusted_p": value,
            "ai_better": directions[key],
            "significant": value < 0.05,
        }
        for key, value in adjusted.items()
    }
    return {"methods": grouped, "paired_wilcoxon_holm": significance}


def run_comparison(
    config: dict[str, Any],
    output: str | Path,
    *,
    resume: bool = False,
    case_runner: CaseRunner = run_case,
) -> dict[str, Any]:
    output_directory = backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    domains = tuple(config.get("domains", SUPPORTED_DOMAINS))
    if not domains or any(domain not in SUPPORTED_DOMAINS for domain in domains):
        raise ValueError("domains must contain highway and/or urban")
    if len(set(domains)) != len(domains):
        raise ValueError("domains must not contain duplicates")
    methods = tuple(config.get("methods", METHODS))
    supported_methods = set(METHODS) | set(OPTIONAL_METHODS)
    if (
        not methods
        or methods[0] != "ai"
        or any(method not in supported_methods for method in methods)
    ):
        raise ValueError("methods must start with ai and contain only supported comparison methods")
    if len(set(methods)) != len(methods):
        raise ValueError("methods must not contain duplicates")
    if "fixed_directional_corridor" in methods and any(domain != "highway" for domain in domains):
        raise ValueError("fixed_directional_corridor is only defined for highway scenarios")
    for domain in domains:
        base = load_yaml(config["base_scenario_configs"][domain])
        dataset = config["dataset"]
        definitions = build_scenario_matrix(
            domain,  # type: ignore[arg-type]
            base,
            train_count=int(dataset.get("train_configs", 50)),
            validation_count=int(dataset.get("validation_configs", 7)),
            test_count=int(dataset.get("test_configs", 10)),
        )
        if bool(dataset.get("single_event", False)):
            definitions = make_single_event_matrix(definitions)
        tests = [definition for definition in definitions if definition.split == "test"]
        model_path = backend_path(config["models"][domain])
        for definition in tests:
            for seed in map(int, config["test_seeds"]):
                case_id = f"{domain}:{definition.scenario_id}:seed_{seed}"
                case_path = (
                    output_directory
                    / "case_checkpoints"
                    / domain
                    / definition.scenario_id
                    / f"seed_{seed}.json"
                )
                if resume and case_path.is_file():
                    checkpoint = json.loads(case_path.read_text(encoding="utf-8"))
                    checkpoint_methods = tuple(row["method"] for row in checkpoint.get("rows", []))
                    if (
                        checkpoint.get("metric_schema_version") == METRIC_SCHEMA_VERSION
                        and checkpoint_methods == methods
                    ):
                        rows.extend(checkpoint["rows"])
                        continue
                try:
                    scenario_path = materialize_scenario(
                        definition,
                        output_directory
                        / "scenarios"
                        / domain
                        / definition.scenario_id
                        / f"seed_{seed}",
                        seed=seed,
                    )
                    case_rows = []
                    event_severity = (
                        float(definition.parameters["events"]["severity"])
                        if domain == "highway"
                        else None
                    )
                    for method in methods:
                        metrics = case_runner(
                            scenario_path,
                            domain,
                            seed,
                            method,
                            model_path if method == "ai" else None,
                            config,
                        )
                        case_rows.append(
                            {
                                "case_id": case_id,
                                "domain": domain,
                                "scenario_id": definition.scenario_id,
                                "seed": seed,
                                "event_severity": event_severity,
                                "severity_group": severity_group(event_severity),
                                "method": method,
                                **metrics,
                            }
                        )
                    atomic_write_json(
                        case_path,
                        {
                            "case_id": case_id,
                            "metric_schema_version": METRIC_SCHEMA_VERSION,
                            "methods": list(methods),
                            "rows": case_rows,
                        },
                    )
                    rows.extend(case_rows)
                except Exception as exc:  # noqa: BLE001 - preserve the remaining matrix
                    failures.append({"case_id": case_id, "error": f"{type(exc).__name__}: {exc}"})
    write_detailed_csv(output_directory / "detailed_results.csv", rows)
    expected_cases = (
        len(domains) * int(config["dataset"].get("test_configs", 10)) * len(config["test_seeds"])
    )
    grouped_by_severity = {
        group: summarize_rows(
            [row for row in rows if row.get("severity_group") == group],
            methods,
        )["methods"]
        for group in ("low", "medium", "high")
        if any(row.get("severity_group") == group for row in rows)
    }
    ai_rows = [row for row in rows if row["method"] == "ai"]
    zero_affected_cases = sum(int(row.get("affected_vehicle_count", 0)) == 0 for row in ai_rows)
    summary = {
        "run_mode": config.get("run_mode", "formal"),
        "protocol": config.get("protocol"),
        "metric_schema_version": METRIC_SCHEMA_VERSION,
        "expected_case_count": expected_cases,
        "expected_result_rows": expected_cases * len(methods),
        "completed_result_rows": len(rows),
        "coverage_eligibility": {
            "total_cases": len(ai_rows),
            "eligible_cases": len(ai_rows) - zero_affected_cases,
            "zero_affected_cases": zero_affected_cases,
            "undefined_cases_are_excluded": True,
        },
        "failures": failures,
        **summarize_rows(rows, methods),
        "severity_groups": grouped_by_severity,
        "git": git_metadata(),
    }
    atomic_write_json(output_directory / "summary.json", summary)
    return summary


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = _parse_arguments()
    summary = run_comparison(load_yaml(arguments.config), arguments.output, resume=arguments.resume)
    print(json.dumps(summary, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

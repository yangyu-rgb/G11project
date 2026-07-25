"""Measure within-domain and cross-domain generalization on locked test scenarios."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.run_comparison import run_case  # noqa: E402
from src.experiments.evaluation import write_detailed_csv  # noqa: E402
from src.experiments.io import atomic_write_json, backend_path, git_metadata, load_yaml  # noqa: E402
from src.experiments.scenario_matrix import build_scenario_matrix, materialize_scenario  # noqa: E402
from src.experiments.statistics import summarize_values  # noqa: E402

TRANSFERS = (
    ("highway", "highway"),
    ("urban", "urban"),
    ("highway", "urban"),
    ("urban", "highway"),
)
METRICS = (
    "mean_latency_ms",
    "effective_delivery_rate",
    "affected_vehicle_coverage",
    "communication_overhead",
    "timely_event_rate",
)


def _relative_drop(
    within: float | None, cross: float | None, *, lower_better: bool
) -> float | None:
    if within is None or cross is None or within == 0:
        return None
    return ((cross - within) if lower_better else (within - cross)) / abs(within)


def run_generalization(
    config: dict[str, Any], output: str | Path, *, resume: bool = False
) -> dict[str, Any]:
    output_directory = backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    failures = []
    for source, target in TRANSFERS:
        base = load_yaml(config["base_scenario_configs"][target])
        dataset = config["dataset"]
        definitions = build_scenario_matrix(
            target,  # type: ignore[arg-type]
            base,
            train_count=int(dataset.get("train_configs", 50)),
            validation_count=int(dataset.get("validation_configs", 7)),
            test_count=int(dataset.get("test_configs", 10)),
        )
        model = backend_path(config["models"][source])
        for definition in (item for item in definitions if item.split == "test"):
            for seed in map(int, config["test_seeds"]):
                case_id = f"{source}_to_{target}:{definition.scenario_id}:seed_{seed}"
                case_path = (
                    output_directory
                    / "case_checkpoints"
                    / f"{source}_to_{target}"
                    / definition.scenario_id
                    / f"seed_{seed}.json"
                )
                if resume and case_path.is_file():
                    rows.append(json.loads(case_path.read_text(encoding="utf-8"))["row"])
                    continue
                try:
                    scenario = materialize_scenario(
                        definition,
                        output_directory
                        / "scenarios"
                        / target
                        / definition.scenario_id
                        / f"seed_{seed}",
                        seed=seed,
                    )
                    metrics = run_case(scenario, target, seed, "ai", model, config)
                    row = {
                        "case_id": case_id,
                        "domain": target,
                        "scenario_id": definition.scenario_id,
                        "seed": seed,
                        "method": f"{source}_to_{target}",
                        "source_domain": source,
                        "target_domain": target,
                        **metrics,
                    }
                    atomic_write_json(case_path, {"case_id": case_id, "row": row})
                    rows.append(row)
                except Exception as exc:  # noqa: BLE001 - keep independent cases running
                    failures.append({"case_id": case_id, "error": f"{type(exc).__name__}: {exc}"})
    write_detailed_csv(output_directory / "detailed_results.csv", rows)
    transfers: dict[str, Any] = {}
    for source, target in TRANSFERS:
        name = f"{source}_to_{target}"
        selected = [row for row in rows if row["method"] == name]
        transfers[name] = {
            metric: summarize_values(
                [float(row[metric]) for row in selected if row.get(metric) is not None]
            )
            for metric in METRICS
            if any(row.get(metric) is not None for row in selected)
        }
    drops: dict[str, Any] = {}
    for source, target in (("highway", "urban"), ("urban", "highway")):
        within = transfers[f"{source}_to_{source}"]
        cross = transfers[f"{source}_to_{target}"]
        drops[f"{source}_to_{target}"] = {
            metric: _relative_drop(
                within.get(metric, {}).get("mean"),
                cross.get(metric, {}).get("mean"),
                lower_better=metric in {"mean_latency_ms", "communication_overhead"},
            )
            for metric in METRICS
        }
    summary = {
        "run_mode": config.get("run_mode", "formal"),
        "completed_result_rows": len(rows),
        "failures": failures,
        "transfers": transfers,
        "relative_performance_drop": drops,
        "git": git_metadata(),
    }
    atomic_write_json(output_directory / "summary.json", summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/comparison_test.yaml")
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume", action="store_true")
    arguments = parser.parse_args()
    summary = run_generalization(
        load_yaml(arguments.config), arguments.output, resume=arguments.resume
    )
    print(json.dumps(summary, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

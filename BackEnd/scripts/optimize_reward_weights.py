"""Grid-search normalized reward weights from validation trace summaries."""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import sys
from pathlib import Path
from typing import Any

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.environment.reward_calculator import RewardWeights  # noqa: E402


def _path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()


def validation_objective(case: dict[str, float]) -> float:
    return (
        0.4 * float(case["coverage"])
        + 0.3 * (1.0 - float(case["normalized_latency"]))
        + 0.3 * (1.0 - float(case["overhead"]))
    )


def optimize(config: dict[str, Any], output: str | Path) -> dict[str, Any]:
    output_directory = _path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    grid = tuple(float(value) for value in config["search_values"])
    fairness = float(config.get("fairness_weight", 0.1))
    cases = list(config["validation_cases"])
    if len(cases) != 7:
        raise ValueError("reward optimization requires exactly seven validation cases")
    case_objective = sum(validation_objective(case) for case in cases) / len(cases)
    rows: list[dict[str, float]] = []
    for values in itertools.product(grid, repeat=5):
        raw = dict(
            zip(
                ("effective_delivery", "coverage", "latency", "overhead", "missed"),
                values,
                strict=True,
            )
        )
        weights = RewardWeights.from_mapping({**raw, "fairness": fairness})
        component_score = (
            weights.effective_delivery
            * sum(float(case["effective_delivery"]) for case in cases)
            / 7
            + weights.coverage * sum(float(case["coverage"]) for case in cases) / 7
            - weights.latency * sum(float(case["normalized_latency"]) for case in cases) / 7
            - weights.overhead * sum(float(case["overhead"]) for case in cases) / 7
            - weights.missed * sum(float(case["missed"]) for case in cases) / 7
            - weights.fairness * sum(float(case["fairness"]) for case in cases) / 7
        )
        rows.append(
            {
                **raw,
                "fairness": fairness,
                "reward_score": component_score,
                "validation_objective": case_objective,
            }
        )
    rows.sort(key=lambda row: row["reward_score"], reverse=True)
    with (output_directory / "grid_search_results.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    best_raw = {
        key: rows[0][key]
        for key in ("effective_delivery", "coverage", "latency", "overhead", "missed", "fairness")
    }
    best = RewardWeights.from_mapping(best_raw)
    result = {
        "run_mode": config.get("run_mode", "smoke"),
        "evaluated_configurations": len(rows),
        "validation_scenarios": len(cases),
        "weights_raw": best_raw,
        "weights_normalized": best.__dict__,
        "validation_objective": case_objective,
        "formal_retraining_required": True,
        "note": "Offline trace ranking narrows candidates; improvement claims require GPU retraining.",
    }
    (output_directory / "best_weights.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    config = yaml.safe_load(_path(arguments.config).read_text(encoding="utf-8"))
    print(json.dumps(optimize(config, arguments.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

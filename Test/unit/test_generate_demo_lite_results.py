"""Artifact checks for the reduced course-demo result generator."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from scripts.generate_demo_lite_results import generate_demo_lite_results  # noqa: E402


def _summary(run_mode: str = "demo_lite") -> dict[str, object]:
    metric = {"mean": 0.8, "std": 0.1, "ci95": [0.7, 0.9], "count": 2}
    methods = {
        method: {
            name: metric
            for name in (
                "p95_latency_ms",
                "effective_delivery_rate",
                "affected_vehicle_coverage",
                "communication_overhead",
                "timely_event_rate",
            )
        }
        for method in ("ai", "broadcast", "distance", "urgency")
    }
    return {
        "run_mode": run_mode,
        "completed_result_rows": 40,
        "expected_result_rows": 40,
        "failures": [],
        "methods": methods,
    }


def test_generate_demo_lite_outputs_are_explicitly_preliminary(tmp_path: Path) -> None:
    root = tmp_path / "demo-lite"
    comparison = root / "comparison_results/summary.json"
    comparison.parent.mkdir(parents=True)
    comparison.write_text(json.dumps(_summary()), encoding="utf-8")
    training_log = root / "highway_batch/config_001/seed_101/training_log.csv"
    training_log.parent.mkdir(parents=True)
    with training_log.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["episode", "reward", "validation_mean"])
        writer.writeheader()
        writer.writerow({"episode": 1, "reward": 0.2, "validation_mean": 0.2})
        writer.writerow({"episode": 2, "reward": 0.4, "validation_mean": 0.4})

    manifest = generate_demo_lite_results(root / "presentation_results", experiments_root=root)

    assert manifest["run_mode"] == "demo_lite"
    assert manifest["completed_result_rows"] == 40
    assert (root / "presentation_results/table_comparison.csv").is_file()
    assert (root / "presentation_results/fig_metric_comparison.png").stat().st_size > 0
    assert (root / "presentation_results/fig_training_curve.png").stat().st_size > 0
    report = (root / "DEMO_LITE_RESULTS_SUMMARY.md").read_text(encoding="utf-8")
    assert "preliminary" in report
    assert "not a paper-scale" in report


def test_generate_demo_lite_rejects_formal_or_incomplete_inputs(tmp_path: Path) -> None:
    root = tmp_path / "demo-lite"
    comparison = root / "comparison_results/summary.json"
    comparison.parent.mkdir(parents=True)
    comparison.write_text(json.dumps(_summary("formal")), encoding="utf-8")
    with pytest.raises(ValueError, match="run_mode=demo_lite"):
        generate_demo_lite_results(root / "results", experiments_root=root)

    incomplete = _summary()
    incomplete["completed_result_rows"] = 4
    comparison.write_text(json.dumps(incomplete), encoding="utf-8")
    with pytest.raises(ValueError, match="matrix is incomplete"):
        generate_demo_lite_results(root / "results", experiments_root=root)

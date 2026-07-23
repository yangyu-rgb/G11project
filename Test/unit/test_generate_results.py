"""Smoke-level artifact generation test with explicit publication guard."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from scripts.generate_results import generate_results  # noqa: E402


def _write(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_generate_results_labels_smoke_and_refuses_publication(tmp_path: Path) -> None:
    root = tmp_path / "experiments"
    metric = {"mean": 0.8, "std": 0.1, "ci95": [0.7, 0.9], "count": 2}
    methods = {
        method: {
            name: metric
            for name in (
                "mean_latency_ms",
                "effective_delivery_rate",
                "affected_vehicle_coverage",
                "communication_overhead",
                "timely_event_rate",
            )
        }
        for method in ("ai", "broadcast", "distance", "urgency")
    }
    _write(
        root / "comparison_results/summary.json",
        {
            "run_mode": "smoke",
            "completed_result_rows": 8,
            "expected_result_rows": 8,
            "failures": [],
            "methods": methods,
            "paired_wilcoxon_holm": {},
        },
    )
    for directory, variant in (
        ("ablation_transformer", "transformer_only"),
        ("ablation_rl", "rl_only"),
    ):
        _write(
            root / directory / "summary.json",
            {"run_mode": "smoke", "variant": variant, "metrics": methods["ai"]},
        )
    _write(
        root / "generalization_results/summary.json",
        {
            "run_mode": "smoke",
            "failures": [],
            "relative_performance_drop": {
                "highway_to_urban": {"effective_delivery_rate": 0.1},
                "urban_to_highway": {"effective_delivery_rate": 0.15},
            },
        },
    )

    with pytest.raises(ValueError, match="formal runs"):
        generate_results(tmp_path / "figures", experiments_root=root)
    manifest = generate_results(tmp_path / "figures", experiments_root=root, allow_smoke=True)

    assert manifest["run_mode"] == "smoke"
    assert (tmp_path / "figures/table_comparison.tex").is_file()
    assert (tmp_path / "figures/fig_ablation.png").stat().st_size > 0
    assert (root / "RESULTS_SUMMARY.md").is_file()

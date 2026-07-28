"""Small fixed-matrix orchestration test for the comparison runner."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
import json

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

import scripts.run_comparison as comparison  # noqa: E402


def test_comparison_produces_four_paired_rows_per_case(tmp_path: Path, monkeypatch: Any) -> None:
    calls = 0

    def fake_materialize(definition: Any, output: Path, *, seed: int) -> Path:
        del definition, seed
        output.mkdir(parents=True, exist_ok=True)
        return output

    def fake_case(
        scenario: Path,
        domain: str,
        seed: int,
        method: str,
        model: Path | None,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        del scenario, domain, seed, model, config
        score = {"ai": 0.9, "broadcast": 0.5, "distance": 0.6, "urgency": 0.7}[method]
        return {
            "mean_latency_ms": 100 - score,
            "p50_latency_ms": 50.0,
            "p95_latency_ms": 95.0,
            "p99_latency_ms": 99.0,
            "timeout_rate": 0.0,
            "effective_delivery_rate": score,
            "affected_vehicle_coverage": score,
            "communication_overhead": 2 - score,
            "normalized_channel_cost": 1.5 - score,
            "timely_event_rate": score,
        }

    monkeypatch.setattr(comparison, "materialize_scenario", fake_materialize)
    config = {
        "run_mode": "smoke",
        "base_scenario_configs": {
            "highway": "configs/scenarios/highway_emergency.yaml",
            "urban": "configs/scenarios/urban_intersection.yaml",
        },
        "models": {"highway": "missing.zip", "urban": "missing.zip"},
        "dataset": {"train_configs": 1, "validation_configs": 1, "test_configs": 1},
        "test_seeds": [7],
    }
    summary = comparison.run_comparison(config, tmp_path / "results", case_runner=fake_case)

    assert summary["expected_result_rows"] == 8
    assert summary["completed_result_rows"] == 8
    assert not summary["failures"]
    assert summary["metric_schema_version"] == 2
    assert (tmp_path / "results/detailed_results.csv").is_file()

    resumed = comparison.run_comparison(
        config, tmp_path / "results", resume=True, case_runner=fake_case
    )
    assert resumed["completed_result_rows"] == 8
    assert calls == 8

    checkpoint = next((tmp_path / "results/case_checkpoints").rglob("*.json"))
    stale = json.loads(checkpoint.read_text(encoding="utf-8"))
    stale.pop("metric_schema_version")
    checkpoint.write_text(json.dumps(stale), encoding="utf-8")
    comparison.run_comparison(config, tmp_path / "results", resume=True, case_runner=fake_case)
    assert calls == 12


def test_comparison_can_run_highway_only_matrix(tmp_path: Path, monkeypatch: Any) -> None:
    def fake_materialize(definition: Any, output: Path, *, seed: int) -> Path:
        del definition, seed
        output.mkdir(parents=True, exist_ok=True)
        return output

    def fake_case(
        scenario: Path,
        domain: str,
        seed: int,
        method: str,
        model: Path | None,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        del scenario, domain, seed, method, model, config
        return {
            "mean_latency_ms": 20.0,
            "p50_latency_ms": 20.0,
            "p95_latency_ms": 25.0,
            "p99_latency_ms": 28.0,
            "timeout_rate": 0.0,
            "effective_delivery_rate": 0.8,
            "affected_vehicle_coverage": 0.9,
            "communication_overhead": 1.2,
            "normalized_channel_cost": 0.4,
            "timely_event_rate": 0.8,
        }

    monkeypatch.setattr(comparison, "materialize_scenario", fake_materialize)
    config = {
        "run_mode": "demo_lite",
        "domains": ["highway"],
        "methods": [
            "ai",
            "broadcast",
            "distance",
            "urgency",
            "fixed_directional_corridor",
        ],
        "base_scenario_configs": {
            "highway": "configs/scenarios/highway_emergency.yaml",
        },
        "models": {"highway": "missing.zip"},
        "dataset": {"train_configs": 4, "validation_configs": 2, "test_configs": 1},
        "test_seeds": [1701],
    }
    summary = comparison.run_comparison(config, tmp_path / "highway_results", case_runner=fake_case)

    assert summary["expected_case_count"] == 1
    assert summary["expected_result_rows"] == 5
    assert summary["completed_result_rows"] == 5
    assert not summary["failures"]

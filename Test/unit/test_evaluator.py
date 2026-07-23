"""Tests for common V2X evaluation metrics."""

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.evaluation.evaluator import compare_methods, evaluate_selection  # noqa: E402


VEHICLES = [
    {"id": "sender", "x": 0, "y": 0},
    {"id": "near_1", "x": 100, "y": 0},
    {"id": "near_2", "x": 200, "y": 0},
    {"id": "far", "x": 600, "y": 0},
]
EVENT = {"x": 0, "y": 0, "sender_id": "sender", "severity": 0.8}


def test_evaluator_reports_latency_delivery_and_overhead() -> None:
    metrics = evaluate_selection(VEHICLES, EVENT, ["near_1", "near_2"], seed=1)

    assert metrics.sent_count == 2
    assert metrics.effective_delivery_count == 2
    assert metrics.effective_delivery_rate == 1
    assert metrics.communication_overhead == 1
    assert metrics.mean_latency_ms is not None
    assert metrics.p50_latency_ms is not None
    assert metrics.p95_latency_ms is not None
    assert metrics.p99_latency_ms is not None


def test_zero_effective_deliveries_have_null_overhead() -> None:
    metrics = evaluate_selection(VEHICLES, EVENT, ["far"], seed=1)

    assert metrics.effective_delivery_count == 0
    assert metrics.effective_delivery_rate == 0
    assert metrics.communication_overhead is None


def test_compare_methods_outputs_ai_and_three_baselines() -> None:
    result = compare_methods(
        VEHICLES,
        EVENT,
        ai_selector=lambda vehicles, event: ["near_1"],
        seed=4,
    )

    assert set(result) == {"ai", "broadcast", "distance", "urgency"}
    assert result["ai"]["sent_count"] == 1
    assert result["broadcast"]["sent_count"] == 3
    assert result["distance"]["sent_count"] == 2
    assert result["urgency"]["sent_count"] == 2


def test_evaluator_rejects_invalid_total_bandwidth_fraction() -> None:
    with pytest.raises(ValueError, match="bandwidth_fraction"):
        evaluate_selection(VEHICLES, EVENT, ["near_1"], bandwidth_fraction=1.1)

"""Tests for the segmented M2 reward objective."""

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.environment.reward_calculator import SegmentedLatency, calculate_reward  # noqa: E402


def test_segmented_latency_is_recorded_and_combined() -> None:
    result = calculate_reward(
        {"event:a"},
        {"event:a"},
        [60],
        mode="full",
        segmented_latencies=[SegmentedLatency(decision_ms=10, queue_ms=20, transmission_ms=30)],
    )

    assert result.avg_delay_penalty == pytest.approx(0.6)
    assert result.decision_delay_penalty == pytest.approx(0.1)
    assert result.queue_delay_penalty == pytest.approx(0.2)
    assert result.transmission_delay_penalty == pytest.approx(0.3)


def test_severity_thresholds_weight_coverage() -> None:
    result = calculate_reward(
        {"high", "medium", "low"},
        {"high"},
        [],
        mode="full",
        receiver_severities={"high": 0.8, "medium": 0.4, "low": 0.39},
    )

    assert result.coverage_rate == pytest.approx(2 / 3.5)


def test_fairness_uses_normalized_receiver_coverage_variance() -> None:
    balanced = calculate_reward(
        {"a", "b"},
        {"a", "b"},
        [],
        mode="full",
        receiver_coverage_history={"a": 0.5, "b": 0.5},
    )
    unequal = calculate_reward(
        {"a", "b"},
        {"a"},
        [],
        mode="full",
        receiver_coverage_history={"a": 1.0, "b": 0.0},
    )

    assert balanced.fairness_penalty == 0
    assert unequal.fairness_penalty == 1

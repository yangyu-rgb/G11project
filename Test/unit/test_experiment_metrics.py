"""Tests for experiment aggregation and deterministic statistics."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.experiments.metrics import aggregate_episode_metrics  # noqa: E402
from src.experiments.statistics import (  # noqa: E402
    bootstrap_mean_ci,
    holm_adjust,
    paired_wilcoxon,
)


def test_aggregate_episode_metrics_uses_critical_and_safety_window() -> None:
    metrics = aggregate_episode_metrics(
        [
            {
                "critical_receiver_ids_by_event": {"event-1": ["a", "b"]},
                "transmissions": [
                    {
                        "event_id": "event-1",
                        "receiver_id": "a",
                        "critical": True,
                        "delivered": True,
                        "latency_ms": 25,
                    },
                    {
                        "event_id": "event-1",
                        "receiver_id": "b",
                        "critical": True,
                        "delivered": True,
                        "latency_ms": 125,
                    },
                    {
                        "event_id": "event-1",
                        "receiver_id": "c",
                        "critical": False,
                        "delivered": False,
                        "latency_ms": 20,
                    },
                ],
            }
        ],
        safety_window_ms=100,
    )

    assert metrics.effective_delivery_rate == pytest.approx(1 / 3)
    assert metrics.affected_vehicle_coverage == 1.0
    assert metrics.affected_vehicle_selection_coverage == 1.0
    assert metrics.communication_overhead == 3.0
    assert metrics.normalized_channel_cost == 3.0
    assert metrics.timely_event_rate == 0.0
    assert metrics.p50_latency_ms == 75.0


def test_metrics_report_safety_action_audit() -> None:
    metrics = aggregate_episode_metrics(
        [
            {
                "critical_receiver_ids_by_event": {"event-1": ["a", "b"]},
                "raw_structured_action": [2, 0, 1],
                "executed_structured_action": [3, 2, 4],
                "raw_radius_m": 300,
                "executed_radius_m": 375,
                "safety_override": True,
                "transmissions": [
                    {
                        "event_id": "event-1",
                        "receiver_id": "a",
                        "critical": True,
                        "delivered": True,
                        "latency_ms": 20,
                        "bandwidth_fraction": 0.5,
                    },
                    {
                        "event_id": "event-1",
                        "receiver_id": "b",
                        "critical": True,
                        "delivered": True,
                        "latency_ms": 20,
                        "bandwidth_fraction": 0.5,
                    },
                ],
            }
        ]
    )

    assert metrics.safety_override_rate == 1.0
    assert metrics.mean_raw_radius_m == 300
    assert metrics.mean_executed_radius_m == 375


def test_statistics_are_deterministic_and_holm_monotonic() -> None:
    values = [0.1, 0.3, 0.5, 0.7]
    assert bootstrap_mean_ci(values) == bootstrap_mean_ci(values)
    assert paired_wilcoxon(values, values) == 1.0
    adjusted = holm_adjust({"a": 0.01, "b": 0.04, "c": 0.03})
    assert adjusted["a"] <= adjusted["c"] <= adjusted["b"]

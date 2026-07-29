"""Unit coverage for simulation attention and decision serialization."""

import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from app.simulation_service import build_state_update, summarize_attention  # noqa: E402
from src.environment.v2x_env import (  # noqa: E402
    EmergencyEvent,
    SimulationSnapshot,
    VehicleSnapshot,
)


def _snapshot() -> SimulationSnapshot:
    return SimulationSnapshot(
        step_index=0,
        timestamp=2.0,
        vehicles=(
            VehicleSnapshot("vehicle-0", 0.0, 0.0, 10.0, 90.0),
            VehicleSnapshot("vehicle-1", 100.0, 0.0, 10.0, 90.0),
        ),
        events=(EmergencyEvent("event-0", "emergency_braking", 0.0, 0.0, 2.0, 0.9),),
    )


def test_summarize_attention_uses_final_layer_head_mean_and_event_max() -> None:
    observation = {
        "vehicles": np.zeros((3, 5), dtype=np.float32),
        "vehicle_mask": np.asarray([1, 1, 0]),
        "events": np.zeros((2, 4), dtype=np.float32),
        "event_mask": np.asarray([1, 0]),
    }
    raw_attention = np.zeros((1, 2, 2, 5, 5), dtype=np.float32)
    raw_attention[0, 0, :, 3, :2] = [0.2, 0.1]
    raw_attention[0, 1, :, 3, :2] = [0.8, 0.2]

    records, by_vehicle = summarize_attention(
        raw_attention,
        observation,
        ("vehicle-0", "vehicle-1"),
        _snapshot().events,
    )

    assert records[0] == {
        "vehicle_id": "vehicle-0",
        "event_id": "event-0",
        "weight": 1.0,
    }
    assert records[1]["vehicle_id"] == "vehicle-1"
    assert records[1]["weight"] == pytest.approx(0.25)
    assert by_vehicle == pytest.approx({"vehicle-0": 1.0, "vehicle-1": 0.25})


def test_state_update_extends_decision_without_removing_legacy_fields() -> None:
    action = np.asarray([1, 1, 2, 4], dtype=np.int64)
    info = {
        "selected_receiver_ids": ["vehicle-0", "vehicle-1"],
        "critical_receiver_ids": ["vehicle-1"],
        "transmissions": [],
    }

    update = build_state_update(
        _snapshot(),
        action,
        info,
        attention_weights=[{"vehicle_id": "vehicle-0", "event_id": "event-0", "weight": 1.0}],
        attention_by_vehicle={"vehicle-0": 1.0, "vehicle-1": 0.3},
        method="ai",
    )

    assert update["decision"]["selected_receivers"] == ["vehicle-0", "vehicle-1"]
    assert update["decision"]["selected_vehicles"] == ["vehicle-0", "vehicle-1"]
    assert update["decision"]["selection_reason"] == {
        "vehicle-0": "high_attention",
        "vehicle-1": "critical_distance",
    }
    assert update["decision"]["candidate_vehicles"] == [
        {
            "id": "vehicle-1",
            "distance_m": 100.0,
            "status": "selected",
            "longitudinal_m": 0.0,
            "lateral_m": pytest.approx(0.0),
            "lane_relation": "same",
            "risk_class": "ahead",
        }
    ]
    assert update["method"] == "ai"


def test_state_update_allows_baseline_selection_reason_override() -> None:
    update = build_state_update(
        _snapshot(),
        np.asarray([0, 1, 1, 2], dtype=np.int64),
        {
            "selected_receiver_ids": ["vehicle-1"],
            "critical_receiver_ids": ["vehicle-1"],
            "transmissions": [],
        },
        selection_reason_override={"vehicle-1": "urgency_priority"},
    )

    assert update["decision"]["selection_reason"] == {"vehicle-1": "urgency_priority"}


def test_state_update_exposes_auditable_directional_action() -> None:
    action = np.asarray([3, 1, 2, 5], dtype=np.int64)
    update = build_state_update(
        _snapshot(),
        action,
        {
            "selected_receiver_ids": ["vehicle-1"],
            "critical_receiver_ids": ["vehicle-1"],
            "transmissions": [],
            "action_mode": "directional_corridor",
            "structured_action": action.tolist(),
            "corridor_radius_m": 300.0,
            "corridor_lane_scope": "same_and_adjacent",
        },
        method="ai",
    )

    assert update["decision"]["structured_action"] == [3, 1, 2, 5]
    assert update["decision"]["bandwidth_fraction"] == pytest.approx(0.6)
    assert update["decision"]["corridor_radius_m"] == pytest.approx(300.0)
    assert update["decision"]["receiver_relations"] == [
        {
            "id": "vehicle-1",
            "distance_m": 100.0,
            "longitudinal_m": 0.0,
            "lateral_m": pytest.approx(0.0),
            "lane_relation": "same",
            "risk_class": "ahead",
            "selected": True,
            "outcome": "selected",
            "corridor_limit_m": 300.0,
        }
    ]


def test_directional_receiver_audit_explains_selected_and_excluded_vehicles() -> None:
    snapshot = SimulationSnapshot(
        step_index=0,
        timestamp=2.0,
        vehicles=(
            VehicleSnapshot("source", 300.0, -8.0, 10.0, 90.0, "highway_0"),
            VehicleSnapshot("selected", 200.0, -8.0, 10.0, 90.0, "highway_0"),
            VehicleSnapshot("ahead", 400.0, -8.0, 10.0, 90.0, "highway_0"),
            VehicleSnapshot("adjacent", 200.0, -4.8, 10.0, 90.0, "highway_1"),
            VehicleSnapshot("far", -100.0, -8.0, 10.0, 90.0, "highway_0"),
            VehicleSnapshot("other-lane", 200.0, -1.6, 10.0, 90.0, "highway_2"),
        ),
        events=(
            EmergencyEvent(
                "event-0", "emergency_braking", 300.0, -8.0, 2.0, 0.9, "source"
            ),
        ),
    )
    action = np.asarray([3, 0, 2, 5], dtype=np.int64)
    update = build_state_update(
        snapshot,
        action,
        {
            "selected_receiver_ids": ["selected"],
            "critical_receiver_ids": ["selected"],
            "transmissions": [],
            "action_mode": "directional_corridor",
            "structured_action": action.tolist(),
            "corridor_radius_m": 300.0,
            "corridor_lane_scope": "same",
        },
        method="ai",
    )

    outcomes = {
        item["id"]: item["outcome"]
        for item in update["decision"]["receiver_relations"]
    }
    assert outcomes == {
        "selected": "selected",
        "ahead": "ahead",
        "adjacent": "outside_lane_scope",
        "far": "outside_corridor",
        "other-lane": "outside_lane_scope",
    }

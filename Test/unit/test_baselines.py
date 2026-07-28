"""Tests for M1 receiver-selection baselines."""

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.environment.network_model import Priority  # noqa: E402
from src.environment.simulation_types import (  # noqa: E402
    EmergencyEvent,
    SimulationSnapshot,
    VehicleSnapshot,
)
from src.evaluation.baselines import (  # noqa: E402
    build_fixed_directional_corridor_action,
    select_receivers,
    select_urgency_resources,
)


VEHICLES = [
    {"id": "sender", "x": 0, "y": 0},
    {"id": "inside", "x": 299, "y": 0},
    {"id": "boundary", "x": 300, "y": 0},
    {"id": "outside", "x": 301, "y": 0},
]
EVENT = {"x": 0, "y": 0, "sender_id": "sender", "severity": 0.8}


def test_broadcast_selects_every_candidate_vehicle() -> None:
    assert select_receivers(VEHICLES, EVENT, "broadcast") == [
        "inside",
        "boundary",
        "outside",
    ]


def test_distance_selects_vehicles_at_or_inside_300_metres() -> None:
    assert select_receivers(VEHICLES, EVENT, "distance") == ["inside", "boundary"]


def test_urgency_selects_vehicles_at_or_inside_300_metres() -> None:
    assert select_receivers(VEHICLES, EVENT, "urgency") == ["inside", "boundary"]


@pytest.mark.parametrize(
    ("severity", "expected_priority", "expected_bandwidth"),
    [
        (0.39, Priority.LOW, 0.2),
        (0.4, Priority.MEDIUM, 0.3),
        (0.7, Priority.MEDIUM, 0.3),
        (0.71, Priority.HIGH, 0.5),
    ],
)
def test_urgency_resources_follow_severity_boundaries(
    severity: float,
    expected_priority: Priority,
    expected_bandwidth: float,
) -> None:
    allocation = select_urgency_resources(VEHICLES, {**EVENT, "severity": severity})

    assert allocation.receiver_ids == ("inside", "boundary")
    assert allocation.priority is expected_priority
    assert allocation.bandwidth_fraction == expected_bandwidth


def test_urgency_resources_require_finite_numeric_severity() -> None:
    with pytest.raises(ValueError, match="severity"):
        select_urgency_resources(VEHICLES, {**EVENT, "severity": float("nan")})


def test_unknown_baseline_is_rejected() -> None:
    with pytest.raises(ValueError, match="method"):
        select_receivers(VEHICLES, EVENT, "unknown")  # type: ignore[arg-type]


def test_fixed_directional_baseline_selects_only_rear_corridor() -> None:
    class Environment:
        max_vehicles = 4
        vehicle_ids = ("sender", "rear", "adjacent", "ahead")

    vehicles = (
        VehicleSnapshot("sender", 100, -4.8, 20, 90, "highway_1"),
        VehicleSnapshot("rear", 40, -4.8, 22, 90, "highway_1"),
        VehicleSnapshot("adjacent", 20, -1.6, 22, 90, "highway_2"),
        VehicleSnapshot("ahead", 140, -4.8, 20, 90, "highway_1"),
    )
    snapshot = SimulationSnapshot(
        0,
        10,
        vehicles,
        (EmergencyEvent("event", "emergency_braking", 100, -4.8, 10, 0.9, "sender"),),
    )

    action, reasons = build_fixed_directional_corridor_action(  # type: ignore[arg-type]
        Environment(), snapshot, radius_m=300, bandwidth_fraction=0.5
    )

    assert action.tolist() == [0, 1, 1, 0, 2, 4]
    assert set(reasons) == {"rear", "adjacent"}

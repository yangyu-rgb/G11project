"""Deterministic action construction for the live comparison WebSocket."""

from __future__ import annotations

import math
from typing import Literal

import numpy as np

from src.environment.network_model import Priority
from src.environment.v2x_env import EmergencyEvent, SimulationSnapshot, V2XEnv

ComparisonBaseline = Literal["broadcast", "distance", "urgency"]
COMPARISON_BASELINES: tuple[ComparisonBaseline, ...] = (
    "broadcast",
    "distance",
    "urgency",
)


def validate_baseline(value: str) -> ComparisonBaseline:
    """Return a supported baseline name or raise a protocol-friendly error."""
    if value not in COMPARISON_BASELINES:
        choices = ", ".join(COMPARISON_BASELINES)
        raise ValueError(f"baseline must be one of: {choices}")
    return value  # type: ignore[return-value]


def _sender_id(snapshot: SimulationSnapshot, event: EmergencyEvent) -> str | None:
    if not snapshot.vehicles:
        return None
    return min(
        snapshot.vehicles,
        key=lambda vehicle: math.dist((vehicle.x, vehicle.y), (event.x, event.y)),
    ).vehicle_id


def _urgency_resources(severity: float) -> tuple[Priority, float]:
    if severity > 0.7:
        return Priority.HIGH, 0.5
    if severity >= 0.4:
        return Priority.MEDIUM, 0.3
    return Priority.LOW, 0.2


def build_baseline_action(
    environment: V2XEnv,
    snapshot: SimulationSnapshot,
    method: ComparisonBaseline,
) -> tuple[np.ndarray, dict[str, str]]:
    """Build an environment action and human-readable reasons for one baseline."""
    validate_baseline(method)
    selected_ids: set[str] = set()

    for event in snapshot.events:
        sender_id = _sender_id(snapshot, event)
        for vehicle in snapshot.vehicles:
            if vehicle.vehicle_id == sender_id:
                continue
            distance = math.dist((vehicle.x, vehicle.y), (event.x, event.y))
            if method == "broadcast" or distance <= environment.critical_radius_m:
                selected_ids.add(vehicle.vehicle_id)

    priority = Priority.HIGH
    bandwidth_fraction = 1.0
    if method == "urgency" and snapshot.events:
        priority, bandwidth_fraction = _urgency_resources(
            max(event.severity for event in snapshot.events)
        )

    action = np.zeros(environment.max_vehicles + 2, dtype=np.int64)
    selected_slots = {
        slot
        for slot, vehicle_id in enumerate(environment.vehicle_ids)
        if vehicle_id in selected_ids
    }
    for slot in selected_slots:
        action[slot] = 1
    action[-2] = int(priority)
    action[-1] = max(0, min(9, round(bandwidth_fraction * 10) - 1))

    reason = {
        "broadcast": "broadcast",
        "distance": "critical_distance",
        "urgency": "urgency_priority",
    }[method]
    return action, {vehicle_id: reason for vehicle_id in sorted(selected_ids)}

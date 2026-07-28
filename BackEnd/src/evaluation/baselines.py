"""Receiver-selection baselines for M1 V2X evaluation."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import numpy as np

from src.environment.network_model import Priority
from src.environment.receiver_relevance import directional_relations
from src.environment.simulation_types import EmergencyEvent, SimulationSnapshot

BaselineMethod = Literal["broadcast", "distance", "urgency"]
COMPARISON_BASELINES: tuple[BaselineMethod, ...] = ("broadcast", "distance", "urgency")


class BaselineEnvironment(Protocol):
    critical_radius_m: float
    max_vehicles: int
    vehicle_ids: Sequence[str]

    def snapshot(self) -> SimulationSnapshot: ...


@dataclass(frozen=True)
class BaselineAllocation:
    """Receiver and resource decision produced by a structured baseline."""

    receiver_ids: tuple[str, ...]
    priority: Priority
    bandwidth_fraction: float


def validate_baseline(value: str) -> BaselineMethod:
    """Return a supported baseline name or raise a protocol-friendly error."""
    if value not in COMPARISON_BASELINES:
        choices = ", ".join(COMPARISON_BASELINES)
        raise ValueError(f"baseline must be one of: {choices}")
    return value  # type: ignore[return-value]


def _coordinate(item: Mapping[str, Any], key: str) -> float:
    try:
        return float(item[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"item must contain a numeric '{key}' value") from exc


def select_receivers(
    vehicles: Sequence[Mapping[str, Any]],
    event: Mapping[str, Any],
    method: BaselineMethod = "broadcast",
    *,
    distance_threshold_m: float = 300.0,
) -> list[str]:
    """Select candidate receiver IDs using a deterministic baseline."""
    if method not in ("broadcast", "distance", "urgency"):
        raise ValueError("method must be 'broadcast', 'distance', or 'urgency'")
    if distance_threshold_m <= 0:
        raise ValueError("distance_threshold_m must be positive")

    sender_id = event.get("sender_id")
    event_position = (_coordinate(event, "x"), _coordinate(event, "y"))
    selected: list[str] = []
    for vehicle in vehicles:
        try:
            vehicle_id = str(vehicle["id"])
        except KeyError as exc:
            raise ValueError("vehicle must contain an 'id'") from exc
        if vehicle_id == sender_id:
            continue
        if method in ("distance", "urgency"):
            vehicle_position = (_coordinate(vehicle, "x"), _coordinate(vehicle, "y"))
            if math.dist(vehicle_position, event_position) > distance_threshold_m:
                continue
        selected.append(vehicle_id)
    return selected


def select_urgency_resources(
    vehicles: Sequence[Mapping[str, Any]],
    event: Mapping[str, Any],
    *,
    distance_threshold_m: float = 300.0,
) -> BaselineAllocation:
    """Allocate receivers, priority, and total bandwidth from event severity."""
    try:
        severity = float(event["severity"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("event must contain a numeric 'severity' value") from exc
    if not math.isfinite(severity):
        raise ValueError("event severity must be finite")

    priority, bandwidth_fraction = _urgency_resources(severity)

    return BaselineAllocation(
        receiver_ids=tuple(
            select_receivers(
                vehicles,
                event,
                "urgency",
                distance_threshold_m=distance_threshold_m,
            )
        ),
        priority=priority,
        bandwidth_fraction=bandwidth_fraction,
    )


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
    environment: BaselineEnvironment,
    snapshot: SimulationSnapshot,
    method: BaselineMethod,
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


def build_fixed_directional_corridor_action(
    environment: BaselineEnvironment,
    snapshot: SimulationSnapshot,
    *,
    radius_m: float = 300.0,
    priority: Priority = Priority.HIGH,
    bandwidth_fraction: float = 0.5,
) -> tuple[np.ndarray, dict[str, str]]:
    """Build a non-learning directional baseline with fixed resources."""
    if radius_m <= 0:
        raise ValueError("directional baseline radius must be positive")
    if not 0 < bandwidth_fraction <= 1:
        raise ValueError("directional baseline bandwidth must be in (0, 1]")
    selected_ids: set[str] = set()
    for event in snapshot.events:
        selected_ids.update(
            directional_relations(
                snapshot.vehicles,
                event,
                same_lane_radius_m=radius_m,
                adjacent_radius_factor=0.5,
            )
        )
    action = np.zeros(environment.max_vehicles + 2, dtype=np.int64)
    for slot, vehicle_id in enumerate(environment.vehicle_ids):
        if vehicle_id in selected_ids:
            action[slot] = 1
    action[-2] = int(priority)
    action[-1] = max(0, min(9, round(bandwidth_fraction * 10) - 1))
    return action, {vehicle_id: "fixed_directional_corridor" for vehicle_id in sorted(selected_ids)}

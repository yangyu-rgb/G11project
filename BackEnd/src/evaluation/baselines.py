"""Receiver-selection baselines for M1 V2X evaluation."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from src.environment.network_model import Priority

BaselineMethod = Literal["broadcast", "distance", "urgency"]


@dataclass(frozen=True)
class BaselineAllocation:
    """Receiver and resource decision produced by a structured baseline."""

    receiver_ids: tuple[str, ...]
    priority: Priority
    bandwidth_fraction: float


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

    if severity > 0.7:
        priority = Priority.HIGH
        bandwidth_fraction = 0.5
    elif severity >= 0.4:
        priority = Priority.MEDIUM
        bandwidth_fraction = 0.3
    else:
        priority = Priority.LOW
        bandwidth_fraction = 0.2

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

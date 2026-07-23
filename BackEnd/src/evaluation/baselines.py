"""Receiver-selection baselines for M1 V2X evaluation."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any, Literal

BaselineMethod = Literal["broadcast", "distance"]


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
    if method not in ("broadcast", "distance"):
        raise ValueError("method must be 'broadcast' or 'distance'")
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
        if method == "distance":
            vehicle_position = (_coordinate(vehicle, "x"), _coordinate(vehicle, "y"))
            if math.dist(vehicle_position, event_position) > distance_threshold_m:
                continue
        selected.append(vehicle_id)
    return selected

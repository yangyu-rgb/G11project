"""Serialization helpers shared by live and comparison simulation streams."""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np

from src.environment.v2x_env import EmergencyEvent, SimulationSnapshot

ATTENTION_LINK_THRESHOLD = 0.6
ATTENTION_TOP_K = 10


def summarize_attention(
    raw_attention: Any,
    observation: dict[str, Any],
    vehicle_ids: Sequence[str],
    events: Sequence[EmergencyEvent],
    *,
    top_k: int = ATTENTION_TOP_K,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    """Convert model attention into normalized event-to-active-vehicle weights.

    The final Transformer layer is averaged over its eight heads. Each event's
    vehicle-key weights are normalized by that event's maximum before the global
    top-k records are selected.
    """
    if raw_attention is None or not events:
        return [], {}

    attention = np.asarray(raw_attention)
    if attention.ndim == 5:
        attention = attention[0]
    if attention.ndim != 4:
        raise ValueError("attention must have shape [layers, heads, tokens, tokens]")
    final_layer = attention[-1].mean(axis=0)

    vehicle_mask = np.asarray(observation["vehicle_mask"], dtype=bool)
    event_mask = np.asarray(observation["event_mask"], dtype=bool)
    vehicle_token_count = int(np.asarray(observation["vehicles"]).shape[0])
    active_vehicle_slots = np.flatnonzero(vehicle_mask)
    active_event_slots = np.flatnonzero(event_mask)
    if not len(active_vehicle_slots) or not len(active_event_slots):
        return [], {}

    records: list[dict[str, Any]] = []
    max_by_vehicle: dict[str, float] = {}
    for event, event_slot in zip(events, active_event_slots, strict=False):
        raw_weights = final_layer[vehicle_token_count + event_slot, active_vehicle_slots]
        maximum = float(np.max(raw_weights)) if len(raw_weights) else 0.0
        normalized = raw_weights / maximum if maximum > 0 else np.zeros_like(raw_weights)
        for slot, weight in zip(active_vehicle_slots, normalized, strict=True):
            if slot >= len(vehicle_ids):
                continue
            vehicle_id = vehicle_ids[int(slot)]
            value = float(np.clip(weight, 0.0, 1.0))
            records.append({"vehicle_id": vehicle_id, "event_id": event.event_id, "weight": value})
            max_by_vehicle[vehicle_id] = max(max_by_vehicle.get(vehicle_id, 0.0), value)

    records.sort(key=lambda item: (-item["weight"], item["event_id"], item["vehicle_id"]))
    return records[:top_k], max_by_vehicle


def _candidate_vehicles(
    snapshot: SimulationSnapshot,
    critical_receiver_ids: Sequence[str],
    selected_receiver_ids: Sequence[str],
) -> list[dict[str, Any]]:
    critical = set(critical_receiver_ids)
    selected = set(selected_receiver_ids)
    return [
        {
            "id": vehicle.vehicle_id,
            "distance_m": min(
                math.dist((vehicle.x, vehicle.y), (event.x, event.y)) for event in snapshot.events
            ),
            "status": "selected" if vehicle.vehicle_id in selected else "candidate",
        }
        for vehicle in snapshot.vehicles
        if vehicle.vehicle_id in critical and snapshot.events
    ]


def build_state_update(
    snapshot: SimulationSnapshot,
    action: np.ndarray,
    info: dict[str, Any],
    *,
    attention_weights: list[dict[str, Any]] | None = None,
    attention_by_vehicle: dict[str, float] | None = None,
    method: str | None = None,
    selection_reason_override: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Serialize one environment transition without coupling it to a WebSocket."""
    selected_receivers = list(info["selected_receiver_ids"])
    transmissions = info["transmissions"]
    sender_ids = {
        transmission["sender_id"]
        for transmission in transmissions
        if transmission["sender_id"] is not None
    }
    selected_set = set(selected_receivers)
    vehicles = []
    for vehicle in snapshot.vehicles:
        angle_radians = math.radians(vehicle.angle)
        status = "normal"
        if vehicle.vehicle_id in selected_set:
            status = "receiving"
        if vehicle.vehicle_id in sender_ids:
            status = "sending"
        vehicles.append(
            {
                "id": vehicle.vehicle_id,
                "x": vehicle.x,
                "y": vehicle.y,
                "vx": vehicle.speed * math.sin(angle_radians),
                "vy": vehicle.speed * math.cos(angle_radians),
                "heading": vehicle.angle,
                "status": status,
            }
        )

    successful_count = sum(bool(item["delivered"]) for item in transmissions)
    transmission_count = len(transmissions)
    average_delay = (
        sum(float(item["latency_ms"]) for item in transmissions) / transmission_count
        if transmission_count
        else 0.0
    )
    delivery_rate = successful_count / transmission_count if transmission_count else 0.0
    communication_overhead = (
        transmission_count / successful_count if successful_count else float(transmission_count)
    )
    bandwidth_fraction = (int(action[-1]) + 1) / 10.0
    receiver_share = bandwidth_fraction / len(selected_receivers) if selected_receivers else 0.0
    priority_name = ("low", "medium", "high")[int(action[-2])]
    candidates = _candidate_vehicles(snapshot, info["critical_receiver_ids"], selected_receivers)
    candidate_ids = {candidate["id"] for candidate in candidates}
    vehicle_attention = attention_by_vehicle or {}
    selection_reason = selection_reason_override or {
        vehicle_id: (
            "high_attention"
            if vehicle_attention.get(vehicle_id, 0.0) >= ATTENTION_LINK_THRESHOLD
            else "critical_distance"
            if vehicle_id in candidate_ids
            else "policy_selected"
        )
        for vehicle_id in selected_receivers
    }

    update = {
        "type": "state_update",
        "timestamp": snapshot.timestamp,
        "vehicles": vehicles,
        "events": [
            {
                "id": event.event_id,
                "type": (
                    "emergency_brake"
                    if event.event_type == "emergency_braking"
                    else event.event_type
                ),
                "x": event.x,
                "y": event.y,
                "timestamp": event.timestamp,
                "severity": event.severity,
            }
            for event in snapshot.events
        ],
        "messages": [
            {
                "from": item["sender_id"],
                "to": item["receiver_id"],
                "status": "success" if item["delivered"] else "timeout",
                "delay_ms": float(item["latency_ms"]),
            }
            for item in transmissions
        ],
        "metrics": {
            "avg_delay_ms": average_delay,
            "delivery_rate": delivery_rate,
            "comm_overhead": communication_overhead,
        },
        "attention_weights": attention_weights or [],
        "decision": {
            "selected_receivers": selected_receivers,
            "priority": priority_name,
            "bandwidth_allocation": [receiver_share] * len(selected_receivers),
            "candidate_vehicles": candidates,
            "selected_vehicles": selected_receivers,
            "selection_reason": selection_reason,
        },
    }
    if method is not None:
        update["method"] = method
    return update

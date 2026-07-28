"""Auditable highway receiver geometry shared by training and inference."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from src.environment.simulation_types import EmergencyEvent, VehicleSnapshot


@dataclass(frozen=True)
class ReceiverRelation:
    vehicle_id: str
    longitudinal_m: float
    lateral_m: float
    lane_relation: str
    heading_delta_deg: float
    risk_class: str


def wrapped_heading_delta(first: float, second: float) -> float:
    return abs((float(first) - float(second) + 180.0) % 360.0 - 180.0)


def event_sender(
    vehicles: Iterable[VehicleSnapshot], event: EmergencyEvent
) -> VehicleSnapshot | None:
    values = tuple(vehicles)
    if event.source_vehicle_id:
        explicit = next(
            (vehicle for vehicle in values if vehicle.vehicle_id == event.source_vehicle_id), None
        )
        if explicit is not None:
            return explicit
    return min(
        values,
        key=lambda vehicle: math.dist((vehicle.x, vehicle.y), (event.x, event.y)),
        default=None,
    )


def _lane_relation(sender: VehicleSnapshot, receiver: VehicleSnapshot, lateral_m: float) -> str:
    if sender.lane_id and receiver.lane_id:
        if sender.lane_id == receiver.lane_id:
            return "same"
        try:
            sender_lane = int(sender.lane_id.rsplit("_", 1)[-1])
            receiver_lane = int(receiver.lane_id.rsplit("_", 1)[-1])
            return "adjacent" if abs(sender_lane - receiver_lane) == 1 else "other"
        except ValueError:
            pass
    if lateral_m < 1.6:
        return "same"
    if lateral_m <= 4.9:
        return "adjacent"
    return "other"


def receiver_relation(
    sender: VehicleSnapshot,
    receiver: VehicleSnapshot,
    event: EmergencyEvent,
) -> ReceiverRelation:
    heading_radians = math.radians(sender.angle)
    forward_x = math.sin(heading_radians)
    forward_y = math.cos(heading_radians)
    lateral_x = math.cos(heading_radians)
    lateral_y = -math.sin(heading_radians)
    event_delta_x = event.x - receiver.x
    event_delta_y = event.y - receiver.y
    longitudinal_m = event_delta_x * forward_x + event_delta_y * forward_y
    lateral_m = abs(event_delta_x * lateral_x + event_delta_y * lateral_y)
    heading_delta = wrapped_heading_delta(receiver.angle, sender.angle)
    lane_relation = _lane_relation(sender, receiver, lateral_m)
    if longitudinal_m <= 0:
        risk_class = "ahead"
    elif heading_delta > 45:
        risk_class = "opposite_direction"
    elif lane_relation == "same":
        risk_class = "following_lane"
    elif lane_relation == "adjacent":
        risk_class = "adjacent_lane"
    else:
        risk_class = "unrelated"
    return ReceiverRelation(
        vehicle_id=receiver.vehicle_id,
        longitudinal_m=max(0.0, float(longitudinal_m)),
        lateral_m=float(lateral_m),
        lane_relation=lane_relation,
        heading_delta_deg=float(heading_delta),
        risk_class=risk_class,
    )


def directional_relations(
    vehicles: Iterable[VehicleSnapshot],
    event: EmergencyEvent,
    *,
    same_lane_radius_m: float,
    adjacent_radius_factor: float = 0.5,
) -> dict[str, ReceiverRelation]:
    values = tuple(vehicles)
    sender = event_sender(values, event)
    if sender is None:
        return {}
    result: dict[str, ReceiverRelation] = {}
    adjacent_radius = same_lane_radius_m * adjacent_radius_factor
    for vehicle in values:
        if vehicle.vehicle_id == sender.vehicle_id:
            continue
        relation = receiver_relation(sender, vehicle, event)
        relevant = (
            relation.risk_class == "following_lane"
            and relation.longitudinal_m <= same_lane_radius_m
        ) or (
            relation.risk_class == "adjacent_lane"
            and relation.longitudinal_m <= adjacent_radius
        )
        if relevant:
            result[vehicle.vehicle_id] = relation
    return result

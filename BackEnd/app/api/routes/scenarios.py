"""Validated, short-lived scenarios created by the presentation editor."""

from __future__ import annotations

import json
import math
import shutil
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

router = APIRouter()

EDITOR_SCENARIO_ROOT = Path(tempfile.gettempdir()) / "g11project-editor-scenarios"
EDITOR_SCENARIO_LIFETIME_SECONDS = 24 * 60 * 60
EDITOR_EPISODE_STEPS = 10
CURRENT_MODEL_MAX_VEHICLES = 50
CURRENT_MODEL_MAX_EVENTS = 2
SAFE_IDENTIFIER_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
HIGHWAY_LANE_CENTERS = (-8.0, -4.8, -1.6)
MINIMUM_CENTER_GAP_METERS = 8.0
BRAKING_DURATION_SECONDS = 2.0


class EditorVehicle(BaseModel):
    id: str = Field(pattern=SAFE_IDENTIFIER_PATTERN)
    x: float = Field(ge=-10_000, le=10_000)
    y: float = Field(ge=-10_000, le=10_000)
    speed_kmh: float = Field(ge=0, le=150)
    heading: float = Field(ge=0, lt=360)


class EditorEvent(BaseModel):
    id: str = Field(pattern=SAFE_IDENTIFIER_PATTERN)
    type: Literal["emergency_braking", "obstacle", "collision_warning"]
    x: float = Field(ge=-10_000, le=10_000)
    y: float = Field(ge=-10_000, le=10_000)
    timestamp: float = Field(ge=0, le=EDITOR_EPISODE_STEPS - 1)
    severity: float = Field(ge=0, le=1)
    source_vehicle_id: str | None = Field(default=None, pattern=SAFE_IDENTIFIER_PATTERN)
    pre_brake_speed_kmh: float | None = Field(default=None, ge=0, le=150)
    post_brake_speed_kmh: float | None = Field(default=None, ge=0, le=150)

    @model_validator(mode="after")
    def validate_braking_profile(self) -> EditorEvent:
        speeds = (self.pre_brake_speed_kmh, self.post_brake_speed_kmh)
        if self.source_vehicle_id is None and any(value is not None for value in speeds):
            raise ValueError("braking speeds require source_vehicle_id")
        if self.source_vehicle_id is not None and any(value is None for value in speeds):
            raise ValueError("bound incidents require pre- and post-brake speeds")
        if speeds[0] is not None and speeds[1] is not None and speeds[1] >= speeds[0]:
            raise ValueError("post-brake speed must be lower than pre-brake speed")
        return self


class EditorScenarioRequest(BaseModel):
    schema_version: Literal[1] = 1
    name: str = Field(default="Custom Scenario", min_length=1, max_length=80)
    vehicles: list[EditorVehicle] = Field(min_length=1, max_length=100)
    events: list[EditorEvent] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> EditorScenarioRequest:
        vehicle_ids = [vehicle.id for vehicle in self.vehicles]
        event_ids = [event.id for event in self.events]
        if len(set(vehicle_ids)) != len(vehicle_ids):
            raise ValueError("vehicle ids must be unique")
        if len(set(event_ids)) != len(event_ids):
            raise ValueError("event ids must be unique")
        bound_events = [event for event in self.events if event.source_vehicle_id is not None]
        if len(bound_events) > 1:
            raise ValueError("the presentation editor supports one bound incident")
        vehicle_id_set = set(vehicle_ids)
        if any(event.source_vehicle_id not in vehicle_id_set for event in bound_events):
            raise ValueError("incident source_vehicle_id must reference an existing vehicle")
        if bound_events:
            for index, vehicle in enumerate(self.vehicles):
                for other in self.vehicles[index + 1 :]:
                    same_lane = abs(vehicle.y - other.y) < 1.6
                    if same_lane and abs(vehicle.x - other.x) < MINIMUM_CENTER_GAP_METERS:
                        raise ValueError("vehicles in the same lane must keep an 8 metre gap")
        return self


class EditorScenarioResponse(BaseModel):
    scenario_ref: str
    vehicle_count: int
    event_count: int
    ai_runnable: bool
    limitations: list[str]


def _cleanup_expired_scenarios(now: float | None = None) -> None:
    if not EDITOR_SCENARIO_ROOT.is_dir():
        return
    cutoff = (time.time() if now is None else now) - EDITOR_SCENARIO_LIFETIME_SECONDS
    for child in EDITOR_SCENARIO_ROOT.iterdir():
        if child.is_dir() and child.stat().st_mtime < cutoff:
            shutil.rmtree(child)


def _nearest_lane_index(y: float) -> int:
    return min(
        range(len(HIGHWAY_LANE_CENTERS)), key=lambda index: abs(y - HIGHWAY_LANE_CENTERS[index])
    )


def _incident_speed(event: EditorEvent, timestamp: float) -> float:
    before = float(event.pre_brake_speed_kmh or 0.0) / 3.6
    after = float(event.post_brake_speed_kmh or 0.0) / 3.6
    if timestamp <= event.timestamp:
        return before
    progress = min(1.0, (timestamp - event.timestamp) / BRAKING_DURATION_SECONDS)
    eased = 1.0 - (1.0 - progress) ** 3
    return before + (after - before) * eased


def _write_trajectory(
    path: Path,
    vehicles: list[EditorVehicle],
    events: list[EditorEvent],
) -> dict[str, tuple[float, float]]:
    bound_event = next((event for event in events if event.source_vehicle_id is not None), None)
    root = ET.Element("fcd-export")
    positions = {vehicle.id: (vehicle.x, vehicle.y) for vehicle in vehicles}
    speeds = {vehicle.id: vehicle.speed_kmh / 3.6 for vehicle in vehicles}
    headings = {vehicle.id: math.radians(vehicle.heading) for vehicle in vehicles}
    desired_speeds = dict(speeds)
    incident_position: dict[str, tuple[float, float]] = {}
    for step in range(EDITOR_EPISODE_STEPS):
        timestep = ET.SubElement(root, "timestep", time=str(float(step)))
        for vehicle in vehicles:
            x, y = positions[vehicle.id]
            speed_mps = speeds[vehicle.id]
            ET.SubElement(
                timestep,
                "vehicle",
                id=vehicle.id,
                x=f"{x:.3f}",
                y=f"{y:.3f}",
                speed=f"{speed_mps:.3f}",
                angle=f"{vehicle.heading:.3f}",
                lane=f"highway_{_nearest_lane_index(y)}",
            )
        if bound_event and step == math.ceil(bound_event.timestamp):
            incident_position[bound_event.id] = positions[str(bound_event.source_vehicle_id)]
        if step == EDITOR_EPISODE_STEPS - 1:
            continue

        next_positions: dict[str, tuple[float, float]] = {}
        next_speeds: dict[str, float] = {}
        for vehicle in vehicles:
            speed = desired_speeds[vehicle.id]
            if bound_event and vehicle.id == bound_event.source_vehicle_id:
                speed = _incident_speed(bound_event, float(step + 1))
            heading = headings[vehicle.id]
            x, y = positions[vehicle.id]
            next_positions[vehicle.id] = (
                x + math.sin(heading) * (speeds[vehicle.id] + speed) / 2,
                y + math.cos(heading) * (speeds[vehicle.id] + speed) / 2,
            )
            next_speeds[vehicle.id] = speed

        if bound_event:
            by_lane: dict[int, list[EditorVehicle]] = {}
            for vehicle in vehicles:
                by_lane.setdefault(_nearest_lane_index(vehicle.y), []).append(vehicle)
            for lane_vehicles in by_lane.values():
                ordered = sorted(
                    lane_vehicles, key=lambda item: positions[item.id][0], reverse=True
                )
                for leader, follower in zip(ordered, ordered[1:], strict=False):
                    leader_x = next_positions[leader.id][0]
                    follower_x, follower_y = next_positions[follower.id]
                    maximum_x = leader_x - MINIMUM_CENTER_GAP_METERS
                    if follower_x > maximum_x:
                        previous_x = positions[follower.id][0]
                        next_positions[follower.id] = (maximum_x, follower_y)
                        next_speeds[follower.id] = max(0.0, maximum_x - previous_x)

        positions = next_positions
        speeds = next_speeds
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
    return incident_position


def _write_events(
    path: Path,
    events: list[EditorEvent],
    incident_positions: dict[str, tuple[float, float]],
) -> None:
    serialized = []
    for event in events:
        x, y = incident_positions.get(event.id, (event.x, event.y))
        serialized.append(
            {
                "id": event.id,
                "type": event.type,
                "x": x,
                "y": y,
                "timestamp": event.timestamp,
                "severity": event.severity,
                "source_vehicle_id": event.source_vehicle_id,
                "pre_brake_speed_kmh": event.pre_brake_speed_kmh,
                "post_brake_speed_kmh": event.post_brake_speed_kmh,
            }
        )
    path.write_text(
        json.dumps(serialized, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def resolve_editor_scenario(reference: str) -> Path:
    prefix = "editor:"
    if not reference.startswith(prefix):
        raise FileNotFoundError(f"invalid editor scenario reference: {reference}")
    try:
        scenario_id = uuid.UUID(reference.removeprefix(prefix))
    except ValueError as exc:
        raise FileNotFoundError(f"invalid editor scenario reference: {reference}") from exc
    candidate = (EDITOR_SCENARIO_ROOT / str(scenario_id)).resolve()
    if candidate.parent != EDITOR_SCENARIO_ROOT.resolve() or not candidate.is_dir():
        raise FileNotFoundError(f"editor scenario does not exist: {scenario_id}")
    return candidate


@router.post("/scenarios/preview", response_model=EditorScenarioResponse)
def create_editor_scenario(payload: EditorScenarioRequest) -> EditorScenarioResponse:
    _cleanup_expired_scenarios()
    scenario_id = uuid.uuid4()
    scenario_directory = EDITOR_SCENARIO_ROOT / str(scenario_id)
    scenario_directory.mkdir(parents=True, exist_ok=False)
    incident_positions = _write_trajectory(
        scenario_directory / "trajectory.xml",
        payload.vehicles,
        payload.events,
    )
    _write_events(scenario_directory / "events.json", payload.events, incident_positions)

    limitations = []
    if len(payload.vehicles) > CURRENT_MODEL_MAX_VEHICLES:
        limitations.append("The production presentation model supports up to 50 vehicles")
    if len(payload.events) > CURRENT_MODEL_MAX_EVENTS:
        limitations.append("The production presentation model supports up to two incidents")
    return EditorScenarioResponse(
        scenario_ref=f"editor:{scenario_id}",
        vehicle_count=len(payload.vehicles),
        event_count=len(payload.events),
        ai_runnable=not limitations,
        limitations=limitations,
    )

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


class EditorScenarioRequest(BaseModel):
    schema_version: Literal[1] = 1
    name: str = Field(default="自定义场景", min_length=1, max_length=80)
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


def _write_trajectory(path: Path, vehicles: list[EditorVehicle]) -> None:
    root = ET.Element("fcd-export")
    for step in range(EDITOR_EPISODE_STEPS):
        timestep = ET.SubElement(root, "timestep", time=str(float(step)))
        for vehicle in vehicles:
            speed_mps = vehicle.speed_kmh / 3.6
            heading_radians = math.radians(vehicle.heading)
            x = vehicle.x + math.sin(heading_radians) * speed_mps * step
            y = vehicle.y + math.cos(heading_radians) * speed_mps * step
            ET.SubElement(
                timestep,
                "vehicle",
                id=vehicle.id,
                x=f"{x:.3f}",
                y=f"{y:.3f}",
                speed=f"{speed_mps:.3f}",
                angle=f"{vehicle.heading:.3f}",
                lane="editor",
            )
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def _write_events(path: Path, events: list[EditorEvent]) -> None:
    path.write_text(
        json.dumps([event.model_dump() for event in events], ensure_ascii=False, indent=2),
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
    _write_trajectory(scenario_directory / "trajectory.xml", payload.vehicles)
    _write_events(scenario_directory / "events.json", payload.events)

    limitations = []
    if len(payload.vehicles) > CURRENT_MODEL_MAX_VEHICLES:
        limitations.append("当前正式演示模型最多支持50辆车")
    if len(payload.events) > CURRENT_MODEL_MAX_EVENTS:
        limitations.append("当前正式演示模型最多支持2个事件")
    return EditorScenarioResponse(
        scenario_ref=f"editor:{scenario_id}",
        vehicle_count=len(payload.vehicles),
        event_count=len(payload.events),
        ai_runnable=not limitations,
        limitations=limitations,
    )

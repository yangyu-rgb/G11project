"""Integration coverage for validated editor-created preview scenarios."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import xml.etree.ElementTree as ET

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.api.routes.scenarios as scenario_routes
import app.main as main_module
from app.main import app


class DeterministicAgent:
    def predict_raw(self, observation: dict[str, Any], *, deterministic: bool = True) -> np.ndarray:
        del observation, deterministic
        return np.asarray([1] * 50 + [2, 4], dtype=np.int64)


class DirectionalAgent:
    def predict_raw(self, observation: dict[str, Any], *, deterministic: bool = True) -> np.ndarray:
        del observation, deterministic
        return np.asarray([4, 1, 2, 5], dtype=np.int64)


@pytest.fixture(autouse=True)
def editor_scenario_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "editor-scenarios"
    monkeypatch.setattr(scenario_routes, "EDITOR_SCENARIO_ROOT", root)
    return root


def _payload(vehicle_count: int = 2, event_count: int = 1) -> dict[str, Any]:
    event_types = ("emergency_braking", "obstacle", "collision_warning")
    return {
        "schema_version": 1,
        "name": "editor test",
        "vehicles": [
            {
                "id": f"vehicle_{index}",
                "x": 1000 + index * 30,
                "y": -4.8,
                "speed_kmh": 90,
                "heading": 90,
            }
            for index in range(vehicle_count)
        ],
        "events": [
            {
                "id": f"event_{index}",
                "type": event_types[index % len(event_types)],
                "x": 1100 + index * 10,
                "y": -4.8,
                "timestamp": index,
                "severity": 0.9,
            }
            for index in range(event_count)
        ],
    }


def test_editor_scenario_is_created_and_resolved_safely(
    editor_scenario_root: Path,
) -> None:
    response = TestClient(app).post("/api/v1/scenarios/preview", json=_payload())

    assert response.status_code == 200
    result = response.json()
    assert result["ai_runnable"] is True
    scenario_path = scenario_routes.resolve_editor_scenario(result["scenario_ref"])
    assert scenario_path.parent == editor_scenario_root
    assert (scenario_path / "trajectory.xml").is_file()
    assert (scenario_path / "events.json").is_file()


def test_editor_scenario_reports_current_model_capacity() -> None:
    response = TestClient(app).post(
        "/api/v1/scenarios/preview", json=_payload(vehicle_count=51, event_count=3)
    )

    assert response.status_code == 200
    result = response.json()
    assert result["ai_runnable"] is False
    assert len(result["limitations"]) == 2


def test_editor_scenario_rejects_duplicates_and_invalid_references() -> None:
    payload = _payload()
    payload["vehicles"][1]["id"] = payload["vehicles"][0]["id"]
    assert TestClient(app).post("/api/v1/scenarios/preview", json=payload).status_code == 422

    with pytest.raises(FileNotFoundError):
        scenario_routes.resolve_editor_scenario("editor:../../outside")


def test_editor_scenario_runs_through_existing_websocket(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        main_module,
        "_load_agent",
        lambda model_path, environment: DeterministicAgent(),
    )
    result = TestClient(app).post("/api/v1/scenarios/preview", json=_payload()).json()
    model_path = tmp_path / "model.zip"
    model_path.touch()

    endpoint = f"/ws/simulation/run?scenario={result['scenario_ref']}&model={model_path}&speed=5"
    with TestClient(app).websocket_connect(endpoint) as websocket:
        updates = [websocket.receive_json() for _ in range(10)]
        complete = websocket.receive_json()

    assert all(update["type"] == "state_update" for update in updates)
    assert updates[0]["vehicles"][0]["id"] == "vehicle_0"
    assert complete["type"] == "simulation_complete"


def test_editor_scenario_runs_with_the_presentation_action_wrapper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_path = tmp_path / "model.zip"
    model_path.touch()
    monkeypatch.setattr(
        main_module,
        "presentation_model_status",
        lambda: {
            "model": str(model_path),
            "eligible": True,
            "reason": None,
        },
    )
    monkeypatch.setattr(
        main_module,
        "_load_agent",
        lambda _model_path, _environment: DirectionalAgent(),
    )
    result = TestClient(app).post("/api/v1/scenarios/preview", json=_payload()).json()
    endpoint = f"/ws/simulation/run?scenario={result['scenario_ref']}&model={model_path}&speed=5"

    with TestClient(app).websocket_connect(endpoint) as websocket:
        update = websocket.receive_json()

    assert update["type"] == "state_update"
    assert update["decision"]["structured_action"] == [4, 1, 2, 5]


def test_editor_comparison_recreates_the_presentation_model_observation_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_path = tmp_path / "model.zip"
    model_path.touch()
    monkeypatch.setattr(
        main_module,
        "presentation_model_status",
        lambda: {
            "model": str(model_path),
            "eligible": True,
            "reason": None,
        },
    )

    observed: dict[str, object] = {}

    def load_agent(_model_path: Path, environment: object) -> DirectionalAgent:
        vehicle_space = environment.observation_space.spaces["vehicles"]  # type: ignore[attr-defined]
        observed["vehicle_shape"] = vehicle_space.shape
        observed["action_shape"] = environment.action_space.shape  # type: ignore[attr-defined]
        return DirectionalAgent()

    monkeypatch.setattr(main_module, "_load_agent", load_agent)
    preview = TestClient(app).post(
        "/api/v1/experiments/preview",
        json={"scenario": _payload(), "baseline": "broadcast"},
    )
    assert preview.status_code == 200
    experiment_ref = preview.json()["experiment_ref"]
    endpoint = (
        f"/ws/simulation/compare?experiment_ref={experiment_ref}"
        f"&model={model_path}&baseline=broadcast&speed=5"
    )

    with TestClient(app).websocket_connect(endpoint) as websocket:
        ai_update = websocket.receive_json()
        baseline_update = websocket.receive_json()

    assert ai_update["type"] == baseline_update["type"] == "state_update"
    assert observed["vehicle_shape"] == (50, 33)
    assert observed["action_shape"] == (4,)
    assert ai_update["decision"]["structured_action"] == [4, 1, 2, 5]
    assert ai_update["decision"]["corridor_radius_m"] == pytest.approx(375.0)
    assert ai_update["decision"]["bandwidth_fraction"] == pytest.approx(0.6)


def test_bound_incident_brakes_selected_vehicle_without_overlap(
    editor_scenario_root: Path,
) -> None:
    payload = _payload(vehicle_count=6)
    payload["vehicles"] = [
        {
            "id": f"vehicle_{index}",
            "x": 1000 + index * 24,
            "y": -4.8,
            "speed_kmh": 96,
            "heading": 90,
        }
        for index in range(6)
    ]
    payload["events"][0].update(
        {
            "timestamp": 2,
            "source_vehicle_id": "vehicle_3",
            "pre_brake_speed_kmh": 96,
            "post_brake_speed_kmh": 18,
        }
    )

    result = TestClient(app).post("/api/v1/scenarios/preview", json=payload).json()
    scenario_path = scenario_routes.resolve_editor_scenario(result["scenario_ref"])
    root = ET.parse(scenario_path / "trajectory.xml").getroot()
    frames = root.findall("timestep")
    selected_speeds = [
        float(
            next(
                item for item in frame.findall("vehicle") if item.attrib["id"] == "vehicle_3"
            ).attrib["speed"]
        )
        for frame in frames
    ]
    assert selected_speeds[2] == pytest.approx(96 / 3.6, abs=0.001)
    assert selected_speeds[4] == pytest.approx(18 / 3.6, abs=0.001)

    for frame in frames:
        positions = sorted(float(item.attrib["x"]) for item in frame.findall("vehicle"))
        assert all(right - left >= 8 for left, right in zip(positions, positions[1:], strict=False))

    event = json.loads((scenario_path / "events.json").read_text(encoding="utf-8"))[0]
    source_at_event = next(
        item for item in frames[2].findall("vehicle") if item.attrib["id"] == "vehicle_3"
    )
    assert event["x"] == pytest.approx(float(source_at_event.attrib["x"]))
    assert event["source_vehicle_id"] == "vehicle_3"
    assert event["pre_brake_speed_kmh"] == 96
    assert event["post_brake_speed_kmh"] == 18


def test_bound_incident_rejects_unknown_source_and_unsafe_spacing() -> None:
    unknown = _payload()
    unknown["events"][0].update(
        {
            "source_vehicle_id": "missing",
            "pre_brake_speed_kmh": 96,
            "post_brake_speed_kmh": 18,
        }
    )
    assert TestClient(app).post("/api/v1/scenarios/preview", json=unknown).status_code == 422

    overlapping = _payload()
    overlapping["vehicles"][1]["x"] = overlapping["vehicles"][0]["x"] + 5
    overlapping["events"][0].update(
        {
            "source_vehicle_id": "vehicle_0",
            "pre_brake_speed_kmh": 96,
            "post_brake_speed_kmh": 18,
        }
    )
    assert TestClient(app).post("/api/v1/scenarios/preview", json=overlapping).status_code == 422

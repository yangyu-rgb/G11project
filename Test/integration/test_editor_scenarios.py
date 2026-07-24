"""Integration coverage for validated editor-created preview scenarios."""

from __future__ import annotations

from pathlib import Path
from typing import Any

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


def test_editor_scenario_is_created_and_resolved_safely(editor_scenario_root: Path) -> None:
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

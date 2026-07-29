"""Integration coverage for the complete simulation WebSocket protocol."""

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app
from src.environment.v2x_env import V2XEnv


class DeterministicAgent:
    def predict_raw(self, observation: dict[str, Any], *, deterministic: bool = True) -> np.ndarray:
        del observation, deterministic
        return np.asarray([1] * 50 + [2, 4], dtype=np.int64)


@pytest.fixture
def simulation_resources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    timesteps = []
    for step in range(10):
        vehicles = "".join(
            f'<vehicle id="vehicle_{index}" x="{1000 + index * 20 + step * 5}" '
            f'y="{-1.6 - index}" speed="25" angle="90" />'
            for index in range(5)
        )
        timesteps.append(f'<timestep time="{step}">{vehicles}</timestep>')
    (tmp_path / "trajectory.xml").write_text(
        f"<fcd-export>{''.join(timesteps)}</fcd-export>", encoding="utf-8"
    )
    (tmp_path / "events.json").write_text(
        json.dumps(
            [
                {
                    "type": "emergency_braking",
                    "x": 1000,
                    "y": -1.6,
                    "timestamp": 0,
                    "severity": 0.9,
                }
            ]
        ),
        encoding="utf-8",
    )
    model_path = tmp_path / "model.zip"
    model_path.touch()
    monkeypatch.setattr(
        main_module,
        "_load_agent",
        lambda model_path, environment: DeterministicAgent(),
    )
    return tmp_path, model_path


def _endpoint(scenario_path: Path, model_path: Path) -> str:
    return f"/ws/simulation/run?scenario={scenario_path}&model={model_path}&speed=4"


def test_simulation_websocket_streams_ten_complete_state_updates(
    simulation_resources: tuple[Path, Path],
) -> None:
    scenario_path, model_path = simulation_resources

    with TestClient(app).websocket_connect(_endpoint(scenario_path, model_path)) as websocket:
        updates = [websocket.receive_json() for _ in range(10)]
        completion = websocket.receive_json()

    assert all(update["type"] == "state_update" for update in updates)
    assert [update["timestamp"] for update in updates] == list(range(10))
    first = updates[0]
    assert set(first) == {
        "type",
        "timestamp",
        "vehicles",
        "events",
        "messages",
        "metrics",
        "attention_weights",
        "decision",
    }
    assert set(first["vehicles"][0]) == {
        "id",
        "x",
        "y",
        "vx",
        "vy",
        "heading",
        "status",
    }
    assert first["events"][0]["id"] == "event-0"
    assert first["events"][0]["type"] == "emergency_brake"
    assert set(first["messages"][0]) == {"from", "to", "status", "delay_ms"}
    assert set(first["metrics"]) == {"avg_delay_ms", "delivery_rate", "comm_overhead"}
    assert first["attention_weights"] == []
    assert first["decision"]["priority"] == "high"
    assert set(first["decision"]) == {
        "selected_receivers",
        "priority",
        "bandwidth_allocation",
        "bandwidth_fraction",
        "candidate_vehicles",
        "selected_vehicles",
        "selection_reason",
        "inference_time_ms",
    }
    assert first["decision"]["inference_time_ms"] >= 0
    assert first["decision"]["selected_vehicles"] == first["decision"]["selected_receivers"]
    assert all(
        candidate["status"] in {"candidate", "selected"}
        for candidate in first["decision"]["candidate_vehicles"]
    )
    assert len(first["decision"]["bandwidth_allocation"]) == len(
        first["decision"]["selected_receivers"]
    )
    assert sum(first["decision"]["bandwidth_allocation"]) == pytest.approx(0.5)
    assert first["decision"]["bandwidth_fraction"] == pytest.approx(0.5)
    assert completion == {"type": "simulation_complete", "timestamp": 9.0}


def test_simulation_websocket_acknowledges_playback_controls(
    simulation_resources: tuple[Path, Path],
) -> None:
    scenario_path, model_path = simulation_resources

    with TestClient(app).websocket_connect(_endpoint(scenario_path, model_path)) as websocket:
        assert websocket.receive_json()["type"] == "state_update"

        websocket.send_json({"type": "control", "action": "pause"})
        assert websocket.receive_json() == {
            "type": "control_ack",
            "action": "pause",
            "playing": False,
            "speed": 4.0,
        }

        websocket.send_json({"type": "control", "action": "set_speed", "speed": 2})
        assert websocket.receive_json()["speed"] == 2.0

        websocket.send_json({"type": "control", "action": "reset"})
        reset_ack = websocket.receive_json()
        assert reset_ack["action"] == "reset"
        assert reset_ack["playing"] is False

        websocket.send_json({"type": "control", "action": "play"})
        play_ack = websocket.receive_json()
        assert play_ack["action"] == "play"
        assert play_ack["playing"] is True
        assert websocket.receive_json()["timestamp"] == 0


def test_simulation_websocket_reports_missing_resources(tmp_path: Path) -> None:
    with TestClient(app).websocket_connect(
        f"/ws/simulation/run?scenario={tmp_path}&model={tmp_path / 'missing.zip'}"
    ) as websocket:
        message = websocket.receive_json()

    assert message["type"] == "error"
    assert message["code"] == "resource_error"


def test_environment_factory_creates_real_v2x_environment(
    simulation_resources: tuple[Path, Path],
) -> None:
    scenario_path, _ = simulation_resources
    environment = main_module._create_environment(scenario_path)

    assert isinstance(environment, V2XEnv)
    assert environment.snapshot().timestamp == 0

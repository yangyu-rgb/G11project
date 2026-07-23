"""Integration coverage for synchronized AI/baseline comparison streaming."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

import app.main as main_module  # noqa: E402
from app.main import app  # noqa: E402


class DeterministicAgent:
    def predict_raw(self, observation: dict[str, Any], *, deterministic: bool = True) -> np.ndarray:
        del observation, deterministic
        return np.asarray([1] * 50 + [2, 4], dtype=np.int64)


@pytest.fixture
def comparison_resources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    timesteps = []
    for step in range(10):
        vehicles = "".join(
            f'<vehicle id="vehicle_{index}" x="{1000 + index * 100 + step * 5}" '
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
                    "id": "event-0",
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


def _endpoint(scenario_path: Path, model_path: Path, baseline: str = "distance") -> str:
    return (
        f"/ws/simulation/compare?scenario={scenario_path}&model={model_path}"
        f"&baseline={baseline}&speed=4"
    )


def test_compare_streams_timestamp_aligned_state_pairs(
    comparison_resources: tuple[Path, Path],
) -> None:
    scenario_path, model_path = comparison_resources

    with TestClient(app).websocket_connect(_endpoint(scenario_path, model_path)) as websocket:
        messages = [websocket.receive_json() for _ in range(20)]
        completion = websocket.receive_json()

    pairs = list(zip(messages[::2], messages[1::2], strict=True))
    assert len(pairs) == 10
    for expected_timestamp, (ai_update, baseline_update) in enumerate(pairs):
        assert ai_update["method"] == "ai"
        assert baseline_update["method"] == "distance"
        assert ai_update["timestamp"] == baseline_update["timestamp"] == expected_timestamp
        assert baseline_update["attention_weights"] == []
    assert pairs[0][1]["decision"]["selection_reason"] == {
        "vehicle_1": "critical_distance",
        "vehicle_2": "critical_distance",
    }
    assert completion == {"type": "simulation_complete", "timestamp": 9.0}


def test_compare_controls_both_environments(
    comparison_resources: tuple[Path, Path],
) -> None:
    scenario_path, model_path = comparison_resources

    with TestClient(app).websocket_connect(_endpoint(scenario_path, model_path)) as websocket:
        assert websocket.receive_json()["timestamp"] == 0
        assert websocket.receive_json()["timestamp"] == 0
        websocket.send_json({"type": "control", "action": "pause"})
        assert websocket.receive_json()["playing"] is False
        websocket.send_json({"type": "control", "action": "reset"})
        assert websocket.receive_json()["action"] == "reset"
        websocket.send_json({"type": "control", "action": "play"})
        assert websocket.receive_json()["playing"] is True
        assert websocket.receive_json()["timestamp"] == 0
        assert websocket.receive_json()["timestamp"] == 0


def test_compare_rejects_unknown_baseline(
    comparison_resources: tuple[Path, Path],
) -> None:
    scenario_path, model_path = comparison_resources

    with TestClient(app).websocket_connect(
        _endpoint(scenario_path, model_path, "random")
    ) as websocket:
        message = websocket.receive_json()

    assert message["type"] == "error"
    assert message["code"] == "invalid_parameters"
    assert "baseline" in message["message"]

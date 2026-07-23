"""Tests for deterministic live-comparison baseline actions."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from app.comparison import build_baseline_action, validate_baseline  # noqa: E402
from src.environment.network_model import Priority  # noqa: E402
from src.environment.v2x_env import V2XEnv  # noqa: E402


@pytest.fixture
def comparison_environment(tmp_path: Path) -> V2XEnv:
    frames = []
    for step in range(2):
        frames.append(
            f'<timestep time="{step}">'
            '<vehicle id="sender" x="0" y="0" speed="0" angle="90" />'
            '<vehicle id="near" x="200" y="0" speed="0" angle="90" />'
            '<vehicle id="far" x="400" y="0" speed="0" angle="90" />'
            "</timestep>"
        )
    (tmp_path / "trajectory.xml").write_text(
        f"<fcd-export>{''.join(frames)}</fcd-export>", encoding="utf-8"
    )
    (tmp_path / "events.json").write_text(
        json.dumps(
            [
                {
                    "id": "event-0",
                    "type": "emergency_braking",
                    "x": 0,
                    "y": 0,
                    "timestamp": 0,
                    "severity": 0.9,
                }
            ]
        ),
        encoding="utf-8",
    )
    return V2XEnv(tmp_path, episode_steps=2, seed=42)


@pytest.mark.parametrize(
    ("method", "selected", "priority", "bandwidth_index", "reason"),
    [
        ("broadcast", {"near", "far"}, Priority.HIGH, 9, "broadcast"),
        ("distance", {"near"}, Priority.HIGH, 9, "critical_distance"),
        ("urgency", {"near"}, Priority.HIGH, 4, "urgency_priority"),
    ],
)
def test_build_baseline_action(
    comparison_environment: V2XEnv,
    method: str,
    selected: set[str],
    priority: Priority,
    bandwidth_index: int,
    reason: str,
) -> None:
    action, reasons = build_baseline_action(
        comparison_environment,
        comparison_environment.snapshot(),
        validate_baseline(method),
    )

    selected_from_action = {
        vehicle_id
        for slot, vehicle_id in enumerate(comparison_environment.vehicle_ids)
        if action[slot]
    }
    assert selected_from_action == selected
    assert action[-2] == int(priority)
    assert action[-1] == bandwidth_index
    assert reasons == {vehicle_id: reason for vehicle_id in sorted(selected)}
    assert comparison_environment.action_space.contains(np.asarray(action))


def test_baseline_action_selects_nothing_without_an_active_event(
    comparison_environment: V2XEnv,
) -> None:
    comparison_environment.step(np.zeros(comparison_environment.max_vehicles + 2, dtype=np.int64))

    action, reasons = build_baseline_action(
        comparison_environment,
        comparison_environment.snapshot(),
        "distance",
    )

    assert not np.any(action[:-2])
    assert reasons == {}


def test_validate_baseline_rejects_unknown_method() -> None:
    with pytest.raises(ValueError, match="baseline must be one of"):
        validate_baseline("random")

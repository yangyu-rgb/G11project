"""Tests for the compact adaptive-radius PPO action."""

import math
import sys
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.environment.adaptive_radius_wrapper import (  # noqa: E402
    AdaptiveRadiusActionWrapper,
    DirectionalCorridorActionWrapper,
    SafetyProjectedActionWrapper,
)
from src.environment.simulation_types import (  # noqa: E402
    EmergencyEvent,
    SimulationSnapshot,
    VehicleSnapshot,
)


class ReceiverEnvironment(gym.Env):
    def __init__(self, events: tuple[EmergencyEvent, ...]) -> None:
        self.max_vehicles = 4
        self.vehicle_ids = ("sender", "near", "boundary", "far")
        self.vehicles = (
            VehicleSnapshot("sender", 0, 0, 0, 0),
            VehicleSnapshot("near", 149, 0, 0, 0),
            VehicleSnapshot("boundary", 300, 0, 0, 0),
            VehicleSnapshot("far", 600, 0, 0, 0),
        )
        self.events = events
        self.action_space = gym.spaces.MultiDiscrete([2, 2, 2, 2, 3, 10])
        self.observation_space = gym.spaces.Box(0, 1, shape=(1,), dtype=np.float32)

    def snapshot(self) -> SimulationSnapshot:
        return SimulationSnapshot(0, 0, self.vehicles, self.events)

    @staticmethod
    def _nearest_vehicle(
        vehicles: tuple[VehicleSnapshot, ...], event: EmergencyEvent
    ) -> VehicleSnapshot:
        return min(vehicles, key=lambda item: math.dist((item.x, item.y), (event.x, event.y)))

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        return np.zeros(1, dtype=np.float32), {}

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        return np.zeros(1, dtype=np.float32), 0.0, True, False, {"expanded": action}


EVENT = EmergencyEvent("event", "emergency_braking", 0, 0, 0, 0.8)


def test_radius_action_maps_receivers_and_resources() -> None:
    wrapper = AdaptiveRadiusActionWrapper(ReceiverEnvironment((EVENT,)))  # type: ignore[arg-type]

    expanded = wrapper.action(np.asarray([2, 1, 4], dtype=np.int64))

    assert expanded.tolist() == [0, 1, 1, 0, 1, 4]


def test_no_event_always_maps_to_no_receivers() -> None:
    wrapper = AdaptiveRadiusActionWrapper(ReceiverEnvironment(()))  # type: ignore[arg-type]

    expanded = wrapper.action(np.asarray([4, 2, 9], dtype=np.int64))

    assert expanded.tolist() == [0, 0, 0, 0, 2, 9]


def test_radius_options_must_be_strictly_increasing() -> None:
    with pytest.raises(ValueError, match="strictly increasing"):
        AdaptiveRadiusActionWrapper(  # type: ignore[arg-type]
            ReceiverEnvironment((EVENT,)), (300, 150)
        )


def test_high_severity_action_is_projected_into_safety_envelope() -> None:
    wrapper = SafetyProjectedActionWrapper(ReceiverEnvironment((EVENT,)))  # type: ignore[arg-type]

    _, reward, terminated, truncated, info = wrapper.step(
        np.asarray([2, 0, 1], dtype=np.int64)
    )

    assert info["expanded"] == pytest.approx([0, 1, 1, 0, 2, 4])
    assert info["raw_structured_action"] == [2, 0, 1]
    assert info["executed_structured_action"] == [3, 2, 4]
    assert info["executed_radius_m"] == 375
    assert info["safety_override_count"] == 3
    assert reward == pytest.approx(-0.15)
    assert terminated and not truncated


def test_safety_projection_does_not_override_without_an_event() -> None:
    wrapper = SafetyProjectedActionWrapper(ReceiverEnvironment(()))  # type: ignore[arg-type]

    _, _, _, _, info = wrapper.step(np.asarray([0, 0, 0], dtype=np.int64))

    assert info["executed_structured_action"] == [0, 0, 0]
    assert info["safety_override"] is False


def test_directional_corridor_selects_followers_and_never_the_vehicle_ahead() -> None:
    environment = ReceiverEnvironment((EmergencyEvent(
        "event", "emergency_braking", 100, -4.8, 0, 0.9, "sender"
    ),))
    environment.vehicles = (
        VehicleSnapshot("sender", 100, -4.8, 20, 90, "highway_1"),
        VehicleSnapshot("near", 74, -4.8, 22, 90, "highway_1"),
        VehicleSnapshot("boundary", 60, -1.6, 22, 90, "highway_2"),
        VehicleSnapshot("far", 130, -4.8, 20, 90, "highway_1"),
    )
    wrapper = DirectionalCorridorActionWrapper(environment)  # type: ignore[arg-type]

    expanded = wrapper.action(np.asarray([1, 1, 2, 4], dtype=np.int64))

    assert expanded.tolist() == [0, 1, 1, 0, 2, 4]


def test_directional_corridor_is_empty_without_an_event() -> None:
    wrapper = DirectionalCorridorActionWrapper(ReceiverEnvironment(()))  # type: ignore[arg-type]

    expanded = wrapper.action(np.asarray([4, 1, 1, 7], dtype=np.int64))

    assert expanded.tolist() == [0, 0, 0, 0, 1, 7]

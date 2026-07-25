"""Shared playback state and AI transition execution for WebSocket streams."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.simulation_service import summarize_attention
from src.environment.simulation_types import SimulationSnapshot

MIN_SIMULATION_SPEED = 0.25
MAX_SIMULATION_SPEED = 5.0


class SessionControlError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def validate_speed(value: object) -> float:
    try:
        speed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise SessionControlError(
            "invalid_speed",
            f"speed must be between {MIN_SIMULATION_SPEED} and {MAX_SIMULATION_SPEED}",
        ) from exc
    if not MIN_SIMULATION_SPEED <= speed <= MAX_SIMULATION_SPEED:
        raise SessionControlError(
            "invalid_speed",
            f"speed must be between {MIN_SIMULATION_SPEED} and {MAX_SIMULATION_SPEED}",
        )
    return speed


@dataclass
class PlaybackController:
    speed: float
    playing: bool = True
    complete: bool = False

    @classmethod
    def create(cls, speed: object) -> PlaybackController:
        return cls(speed=validate_speed(speed))

    @property
    def timeout(self) -> float | None:
        return 1.0 / self.speed if self.playing else None

    def mark_complete(self) -> None:
        self.complete = True
        self.playing = False

    def apply(self, command: dict[str, Any], reset: Callable[[], None]) -> dict[str, Any]:
        if command.get("type") != "control":
            raise SessionControlError("invalid_control", "control message type must be 'control'")

        action = command.get("action")
        if action == "play":
            if self.complete:
                raise SessionControlError(
                    "simulation_complete",
                    "reset the simulation before playing it again",
                )
            self.playing = True
        elif action == "pause":
            self.playing = False
        elif action == "reset":
            reset()
            self.complete = False
            self.playing = False
        elif action == "set_speed":
            if "speed" not in command:
                raise SessionControlError(
                    "invalid_speed",
                    f"speed must be between {MIN_SIMULATION_SPEED} and {MAX_SIMULATION_SPEED}",
                )
            self.speed = validate_speed(command["speed"])
        else:
            raise SessionControlError("invalid_control", f"unsupported control action: {action}")

        return {
            "type": "control_ack",
            "action": action,
            "playing": self.playing,
            "speed": self.speed,
        }


@dataclass(frozen=True)
class AIStepResult:
    observation: dict[str, Any]
    action: np.ndarray
    attention_weights: list[dict[str, Any]]
    attention_by_vehicle: dict[str, float]
    terminated: bool
    truncated: bool
    info: dict[str, Any]


def step_ai(
    agent: Any,
    environment: Any,
    observation: dict[str, Any],
    snapshot: SimulationSnapshot,
) -> AIStepResult:
    """Run one measured AI decision and environment transition."""
    if hasattr(agent, "predict_raw_with_attention"):
        decision_started = time.perf_counter()
        raw_action, raw_attention = agent.predict_raw_with_attention(observation)
        environment.record_decision_latency((time.perf_counter() - decision_started) * 1000)
    else:
        raw_action = agent.predict_raw(observation)
        raw_attention = None

    action = np.asarray(raw_action, dtype=np.int64)
    attention_weights, attention_by_vehicle = summarize_attention(
        raw_attention,
        observation,
        environment.vehicle_ids,
        snapshot.events,
    )
    next_observation, _, terminated, truncated, info = environment.step(action)
    return AIStepResult(
        observation=next_observation,
        action=action,
        attention_weights=attention_weights,
        attention_by_vehicle=attention_by_vehicle,
        terminated=terminated,
        truncated=truncated,
        info=info,
    )

"""Structured receiver selection for fast, safety-oriented PPO training."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from src.environment.receiver_relevance import directional_relations
from src.environment.v2x_env import V2XEnv

DEFAULT_RECEIVER_RADII_M = (150.0, 225.0, 300.0, 375.0, 5000.0)
DEFAULT_CORRIDOR_RADII_M = (75.0, 150.0, 225.0, 300.0, 375.0)


@dataclass(frozen=True)
class SafetyMinimum:
    radius_m: float
    priority: int
    bandwidth_fraction: float


class AdaptiveRadiusActionWrapper(gym.ActionWrapper):
    """Replace per-vehicle flags with radius, priority, and bandwidth decisions."""

    def __init__(
        self,
        environment: V2XEnv,
        receiver_radii_m: Sequence[float] = DEFAULT_RECEIVER_RADII_M,
    ) -> None:
        super().__init__(environment)
        radii = tuple(float(value) for value in receiver_radii_m)
        if not radii or any(not math.isfinite(value) or value <= 0 for value in radii):
            raise ValueError("receiver radii must contain finite positive values")
        if tuple(sorted(set(radii))) != radii:
            raise ValueError("receiver radii must be unique and strictly increasing")
        self.receiver_radii_m = radii
        self.action_space = spaces.MultiDiscrete(
            np.asarray([len(radii), 3, 10], dtype=np.int64)
        )

    @property
    def base_environment(self) -> V2XEnv:
        return self.env

    def action(self, action: np.ndarray) -> np.ndarray:
        structured = np.asarray(action, dtype=np.int64)
        if not self.action_space.contains(structured):
            raise ValueError("action is outside the adaptive-radius action space")
        radius = self.receiver_radii_m[int(structured[0])]
        snapshot = self.base_environment.snapshot()
        selected_ids: set[str] = set()
        sender_ids: set[str] = set()
        for event in snapshot.events:
            sender = self.base_environment._nearest_vehicle(snapshot.vehicles, event)
            if sender is not None:
                sender_ids.add(sender.vehicle_id)
            selected_ids.update(
                vehicle.vehicle_id
                for vehicle in snapshot.vehicles
                if math.dist((vehicle.x, vehicle.y), (event.x, event.y)) <= radius
            )
        selected_ids.difference_update(sender_ids)

        expanded = np.zeros(self.base_environment.max_vehicles + 2, dtype=np.int64)
        for slot, vehicle_id in enumerate(self.base_environment.vehicle_ids):
            if vehicle_id in selected_ids:
                expanded[slot] = 1
        expanded[-2] = int(structured[1])
        expanded[-1] = int(structured[2])
        return expanded


class DirectionalCorridorActionWrapper(gym.ActionWrapper):
    """Let PPO choose a physically valid rear corridor without post-hoc action edits."""

    def __init__(
        self,
        environment: V2XEnv,
        receiver_radii_m: Sequence[float] = DEFAULT_CORRIDOR_RADII_M,
    ) -> None:
        super().__init__(environment)
        radii = tuple(float(value) for value in receiver_radii_m)
        if not radii or any(not math.isfinite(value) or value <= 0 for value in radii):
            raise ValueError("corridor radii must contain finite positive values")
        if tuple(sorted(set(radii))) != radii:
            raise ValueError("corridor radii must be unique and strictly increasing")
        self.receiver_radii_m = radii
        self.base_environment.receiver_relevance_mode = "directional_corridor"
        # rear radius, lane scope (same / same+adjacent), priority, bandwidth
        self.action_space = spaces.MultiDiscrete(
            np.asarray([len(radii), 2, 3, 10], dtype=np.int64)
        )
        self._last_structured_action: np.ndarray | None = None

    @property
    def base_environment(self) -> V2XEnv:
        return self.env

    def action(self, action: np.ndarray) -> np.ndarray:
        structured = np.asarray(action, dtype=np.int64)
        if not self.action_space.contains(structured):
            raise ValueError("action is outside the directional-corridor action space")
        radius = self.receiver_radii_m[int(structured[0])]
        include_adjacent = bool(structured[1])
        snapshot = self.base_environment.snapshot()
        selected_ids: set[str] = set()
        for event in snapshot.events:
            relations = directional_relations(
                snapshot.vehicles,
                event,
                same_lane_radius_m=radius,
                adjacent_radius_factor=0.5 if include_adjacent else 0.0,
            )
            selected_ids.update(
                vehicle_id
                for vehicle_id, relation in relations.items()
                if include_adjacent or relation.lane_relation == "same"
            )
        expanded = np.zeros(self.base_environment.max_vehicles + 2, dtype=np.int64)
        for slot, vehicle_id in enumerate(self.base_environment.vehicle_ids):
            if vehicle_id in selected_ids:
                expanded[slot] = 1
        expanded[-2] = int(structured[2])
        expanded[-1] = int(structured[3])
        self._last_structured_action = structured.copy()
        return expanded

    def step(
        self, action: np.ndarray
    ) -> tuple[dict[str, np.ndarray], float, bool, bool, dict[str, object]]:
        expanded = self.action(action)
        observation, reward, terminated, truncated, info = self.env.step(expanded)
        structured = self._last_structured_action
        if structured is None:
            raise RuntimeError("corridor action audit was not recorded")
        audited = dict(info)
        audited.update(
            {
                "action_mode": "directional_corridor",
                "structured_action": structured.tolist(),
                "corridor_radius_m": self.receiver_radii_m[int(structured[0])],
                "corridor_lane_scope": "same_and_adjacent" if structured[1] else "same",
            }
        )
        return observation, reward, terminated, truncated, audited


class SafetyProjectedActionWrapper(AdaptiveRadiusActionWrapper):
    """Project PPO actions into a severity-dependent auditable safety envelope."""

    def __init__(
        self,
        environment: V2XEnv,
        receiver_radii_m: Sequence[float] = DEFAULT_RECEIVER_RADII_M,
        *,
        low_minimum: SafetyMinimum = SafetyMinimum(225.0, 0, 0.2),
        medium_minimum: SafetyMinimum = SafetyMinimum(300.0, 1, 0.3),
        high_minimum: SafetyMinimum = SafetyMinimum(375.0, 2, 0.5),
        override_penalty_per_component: float = 0.05,
    ) -> None:
        super().__init__(environment, receiver_radii_m)
        self.safety_minimums = (low_minimum, medium_minimum, high_minimum)
        if any(
            minimum.radius_m not in self.receiver_radii_m
            or minimum.priority not in range(3)
            or not 0 < minimum.bandwidth_fraction <= 1
            for minimum in self.safety_minimums
        ):
            raise ValueError("safety minimums must map to configured action levels")
        if override_penalty_per_component < 0:
            raise ValueError("override penalty must be non-negative")
        self.override_penalty_per_component = float(override_penalty_per_component)
        self._last_raw_action: np.ndarray | None = None
        self._last_executed_action: np.ndarray | None = None
        self._last_override_count = 0

    def _minimum(self) -> SafetyMinimum | None:
        events = self.base_environment.snapshot().events
        if not events:
            return None
        severity = max(event.severity for event in events)
        if severity < 0.5:
            return self.safety_minimums[0]
        if severity <= 0.75:
            return self.safety_minimums[1]
        return self.safety_minimums[2]

    def project_action(self, action: np.ndarray) -> np.ndarray:
        raw = np.asarray(action, dtype=np.int64)
        if not self.action_space.contains(raw):
            raise ValueError("action is outside the adaptive-radius action space")
        projected = raw.copy()
        minimum = self._minimum()
        if minimum is not None:
            minimum_radius_index = self.receiver_radii_m.index(minimum.radius_m)
            minimum_bandwidth_index = round(minimum.bandwidth_fraction * 10) - 1
            projected[0] = max(int(projected[0]), minimum_radius_index)
            projected[1] = max(int(projected[1]), minimum.priority)
            projected[2] = max(int(projected[2]), minimum_bandwidth_index)
        self._last_raw_action = raw.copy()
        self._last_executed_action = projected.copy()
        self._last_override_count = int(np.count_nonzero(raw != projected))
        return projected

    def action(self, action: np.ndarray) -> np.ndarray:
        return super().action(self.project_action(action))

    def step(
        self, action: np.ndarray
    ) -> tuple[dict[str, np.ndarray], float, bool, bool, dict[str, object]]:
        expanded = self.action(action)
        observation, reward, terminated, truncated, info = self.env.step(expanded)
        raw = self._last_raw_action
        executed = self._last_executed_action
        if raw is None or executed is None:
            raise RuntimeError("safety action audit was not recorded")
        penalty = self.override_penalty_per_component * self._last_override_count
        audited_info = dict(info)
        audited_info.update(
            {
                "raw_structured_action": raw.tolist(),
                "executed_structured_action": executed.tolist(),
                "raw_radius_m": self.receiver_radii_m[int(raw[0])],
                "executed_radius_m": self.receiver_radii_m[int(executed[0])],
                "safety_override": self._last_override_count > 0,
                "safety_override_count": self._last_override_count,
                "safety_override_penalty": penalty,
            }
        )
        return (
            observation,
            float(np.clip(reward - penalty, -1.0, 1.0)),
            terminated,
            truncated,
            audited_info,
        )


def maybe_wrap_adaptive_radius(
    environment: V2XEnv,
    *,
    action_mode: str = "individual",
    receiver_radii_m: Sequence[float] = DEFAULT_RECEIVER_RADII_M,
    corridor_radii_m: Sequence[float] = DEFAULT_CORRIDOR_RADII_M,
    safety_options: dict[str, float] | None = None,
) -> V2XEnv | AdaptiveRadiusActionWrapper | SafetyProjectedActionWrapper:
    if action_mode == "individual":
        return environment
    if action_mode == "adaptive_radius":
        return AdaptiveRadiusActionWrapper(environment, receiver_radii_m)
    if action_mode == "directional_corridor":
        return DirectionalCorridorActionWrapper(environment, corridor_radii_m)
    if action_mode == "safety_adaptive_radius":
        options = safety_options or {}
        return SafetyProjectedActionWrapper(
            environment,
            receiver_radii_m,
            override_penalty_per_component=float(
                options.get("override_penalty_per_component", 0.05)
            ),
        )
    raise ValueError(
        "action_mode must be 'individual', 'adaptive_radius', 'directional_corridor', or "
        "'safety_adaptive_radius'"
    )

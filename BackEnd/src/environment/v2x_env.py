"""Offline Gymnasium environment backed by SUMO FCD and emergency-event files."""

from __future__ import annotations

import bisect
import json
import math
import random
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from src.environment.network_model import Priority, SimpleNetworkModel
from src.environment.reward_calculator import RewardBreakdown, RewardWeights, calculate_reward


@dataclass(frozen=True)
class VehicleSnapshot:
    vehicle_id: str
    x: float
    y: float
    speed: float
    angle: float


@dataclass(frozen=True)
class TrajectoryFrame:
    timestamp: float
    vehicles: tuple[VehicleSnapshot, ...]


@dataclass(frozen=True)
class EmergencyEvent:
    event_id: str
    event_type: str
    x: float
    y: float
    timestamp: float
    severity: float


@dataclass(frozen=True)
class SimulationSnapshot:
    """Immutable view of the raw scenario state at the current environment step."""

    step_index: int
    timestamp: float
    vehicles: tuple[VehicleSnapshot, ...]
    events: tuple[EmergencyEvent, ...]


class V2XEnv(gym.Env[dict[str, np.ndarray], np.ndarray]):
    """Ten-step offline environment with stable padded observations and actions."""

    metadata = {"render_modes": ["ansi"], "render_fps": 10}

    def __init__(
        self,
        scenario_directory: str | Path,
        *,
        episode_steps: int = 10,
        max_vehicles: int = 50,
        max_events: int = 2,
        critical_radius_m: float = 300.0,
        road_length_m: float = 5000.0,
        lateral_extent_m: float = 10.0,
        delay_normalization_ms: float = 100.0,
        reward_mode: Literal["simple", "full"] = "simple",
        reward_weights: Mapping[str, float] | None = None,
        safety_window_ms: float = 100.0,
        network_mode: Literal["simple", "3gpp"] = "simple",
        network_scenario: Literal["highway", "urban"] = "highway",
        network_options: Mapping[str, float] | None = None,
        seed: int | None = None,
        render_mode: str | None = None,
    ) -> None:
        super().__init__()
        if episode_steps < 2:
            raise ValueError("episode_steps must be at least 2")
        if max_vehicles <= 0 or max_events <= 0:
            raise ValueError("max_vehicles and max_events must be positive")
        if critical_radius_m <= 0 or road_length_m <= 0 or lateral_extent_m <= 0:
            raise ValueError("distance settings must be positive")
        if safety_window_ms <= 0:
            raise ValueError("safety_window_ms must be positive")
        if render_mode not in (None, "ansi"):
            raise ValueError("render_mode must be None or 'ansi'")

        self.scenario_directory = Path(scenario_directory).expanduser().resolve()
        self.episode_steps = episode_steps
        self.max_vehicles = max_vehicles
        self.max_events = max_events
        self.critical_radius_m = critical_radius_m
        self.road_length_m = road_length_m
        self.lateral_extent_m = lateral_extent_m
        self.delay_normalization_ms = delay_normalization_ms
        self.reward_mode = reward_mode
        self.reward_weights = RewardWeights.from_mapping(reward_weights)
        self.safety_window_ms = safety_window_ms
        self.network_mode = network_mode
        self.network_scenario = network_scenario
        self._network_options = dict(network_options or {})
        self.render_mode = render_mode
        self._initial_seed = seed

        all_frames = self._load_trajectory(self.scenario_directory / "trajectory.xml")
        self.events = self._load_events(self.scenario_directory / "events.json")
        if len(self.events) > max_events:
            raise ValueError(
                f"scenario contains {len(self.events)} events; maximum is {max_events}"
            )
        if len(all_frames) < episode_steps:
            raise ValueError("trajectory does not contain enough frames for the requested episode")

        frame_indices = np.linspace(0, len(all_frames) - 1, episode_steps, dtype=int)
        self.frames = tuple(all_frames[index] for index in frame_indices)
        vehicle_ids = sorted(
            {vehicle.vehicle_id for frame in all_frames for vehicle in frame.vehicles}
        )
        if len(vehicle_ids) > max_vehicles:
            raise ValueError(
                f"scenario contains {len(vehicle_ids)} vehicles; maximum is {max_vehicles}"
            )
        self.vehicle_ids = tuple(vehicle_ids)
        self._vehicle_slots = {
            vehicle_id: index for index, vehicle_id in enumerate(self.vehicle_ids)
        }
        self._events_by_step = self._assign_events_to_steps()

        self.observation_space = spaces.Dict(
            {
                "vehicles": spaces.Box(
                    low=-1.0, high=1.0, shape=(max_vehicles, 5), dtype=np.float32
                ),
                "vehicle_mask": spaces.MultiBinary(max_vehicles),
                "events": spaces.Box(low=-1.0, high=1.0, shape=(max_events, 4), dtype=np.float32),
                "event_mask": spaces.MultiBinary(max_events),
                "network_state": spaces.Box(low=0.0, high=1.0, shape=(2,), dtype=np.float32),
            }
        )
        self.action_space = spaces.MultiDiscrete(
            np.asarray([2] * max_vehicles + [3, 10], dtype=np.int64)
        )
        self._step_index = 0
        self._current_load = 0.0
        self._network_model = self._create_network_model(seed)
        self._closed = False

    def _create_network_model(self, seed: int | None) -> SimpleNetworkModel:
        return SimpleNetworkModel(
            random_source=random.Random(seed),
            mode=self.network_mode,
            scenario=self.network_scenario,
            **self._network_options,
        )

    @staticmethod
    def _load_trajectory(path: Path) -> list[TrajectoryFrame]:
        try:
            root = ET.parse(path).getroot()
        except (OSError, ET.ParseError) as exc:
            raise ValueError(f"unable to read SUMO trajectory: {path}") from exc
        frames: list[TrajectoryFrame] = []
        for timestep in root.findall("timestep"):
            try:
                vehicles = tuple(
                    VehicleSnapshot(
                        vehicle_id=element.attrib["id"],
                        x=float(element.attrib["x"]),
                        y=float(element.attrib["y"]),
                        speed=float(element.attrib["speed"]),
                        angle=float(element.attrib["angle"]),
                    )
                    for element in timestep.findall("vehicle")
                )
                frames.append(TrajectoryFrame(float(timestep.attrib["time"]), vehicles))
            except (KeyError, ValueError) as exc:
                raise ValueError(f"invalid SUMO trajectory data in {path}") from exc
        if not frames:
            raise ValueError("trajectory must contain at least one timestep")
        return frames

    @staticmethod
    def _load_events(path: Path) -> tuple[EmergencyEvent, ...]:
        try:
            raw_events = json.loads(path.read_text(encoding="utf-8"))
            events = tuple(
                EmergencyEvent(
                    event_id=str(event.get("id", f"event-{index}")),
                    event_type=str(event["type"]),
                    x=float(event["x"]),
                    y=float(event["y"]),
                    timestamp=float(event["timestamp"]),
                    severity=float(event["severity"]),
                )
                for index, event in enumerate(raw_events)
            )
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"unable to read event data: {path}") from exc
        return tuple(sorted(events, key=lambda event: event.timestamp))

    def snapshot(self) -> SimulationSnapshot:
        """Return the current raw frame without exposing mutable environment internals."""
        frame = self.frames[min(self._step_index, self.episode_steps - 1)]
        return SimulationSnapshot(
            step_index=self._step_index,
            timestamp=frame.timestamp,
            vehicles=frame.vehicles,
            events=self._events_by_step[self._step_index],
        )

    def _assign_events_to_steps(self) -> tuple[tuple[EmergencyEvent, ...], ...]:
        assignments: list[list[EmergencyEvent]] = [[] for _ in self.frames]
        frame_times = [frame.timestamp for frame in self.frames]
        for event in self.events:
            target_index = bisect.bisect_left(frame_times, event.timestamp)
            if target_index < len(assignments):
                assignments[target_index].append(event)
        return tuple(tuple(events) for events in assignments)

    def _vehicle_features(self, vehicle: VehicleSnapshot) -> np.ndarray:
        angle_radians = math.radians(vehicle.angle)
        velocity_x = vehicle.speed * math.sin(angle_radians)
        velocity_y = vehicle.speed * math.cos(angle_radians)
        return np.asarray(
            [
                np.clip(2 * vehicle.x / self.road_length_m - 1, -1, 1),
                np.clip(vehicle.y / self.lateral_extent_m, -1, 1),
                np.clip(velocity_x / 40.0, -1, 1),
                np.clip(velocity_y / 40.0, -1, 1),
                (vehicle.angle % 360.0) / 180.0 - 1.0,
            ],
            dtype=np.float32,
        )

    def _event_features(self, event: EmergencyEvent) -> np.ndarray:
        event_codes = {
            "emergency_braking": 1.0,
            "obstacle": 0.5,
            "intersection_collision_warning": -1.0,
        }
        event_code = event_codes.get(event.event_type, 0.0)
        return np.asarray(
            [
                event_code,
                np.clip(2 * event.x / self.road_length_m - 1, -1, 1),
                np.clip(event.y / self.lateral_extent_m, -1, 1),
                np.clip(event.severity, 0, 1),
            ],
            dtype=np.float32,
        )

    def _observation(self) -> dict[str, np.ndarray]:
        frame = self.frames[min(self._step_index, self.episode_steps - 1)]
        vehicle_values = np.zeros((self.max_vehicles, 5), dtype=np.float32)
        vehicle_mask = np.zeros(self.max_vehicles, dtype=np.int8)
        for vehicle in frame.vehicles:
            slot = self._vehicle_slots[vehicle.vehicle_id]
            vehicle_values[slot] = self._vehicle_features(vehicle)
            vehicle_mask[slot] = 1

        event_values = np.zeros((self.max_events, 4), dtype=np.float32)
        event_mask = np.zeros(self.max_events, dtype=np.int8)
        for index, event in enumerate(self._events_by_step[self._step_index]):
            event_values[index] = self._event_features(event)
            event_mask[index] = 1

        return {
            "vehicles": vehicle_values,
            "vehicle_mask": vehicle_mask,
            "events": event_values,
            "event_mask": event_mask,
            "network_state": np.asarray(
                [1.0 - self._current_load, self._current_load], dtype=np.float32
            ),
        }

    @staticmethod
    def _nearest_vehicle(
        vehicles: tuple[VehicleSnapshot, ...], event: EmergencyEvent
    ) -> VehicleSnapshot | None:
        if not vehicles:
            return None
        return min(
            vehicles, key=lambda vehicle: math.dist((vehicle.x, vehicle.y), (event.x, event.y))
        )

    def _execute_action(self, action: np.ndarray) -> tuple[RewardBreakdown, dict[str, Any]]:
        frame = self.frames[self._step_index]
        active_events = self._events_by_step[self._step_index]
        selected_slots = np.flatnonzero(action[: self.max_vehicles])
        active_by_id = {vehicle.vehicle_id: vehicle for vehicle in frame.vehicles}
        selected_ids = {
            self.vehicle_ids[slot]
            for slot in selected_slots
            if slot < len(self.vehicle_ids) and self.vehicle_ids[slot] in active_by_id
        }
        priority = Priority(int(action[self.max_vehicles]))
        bandwidth_fraction = (int(action[self.max_vehicles + 1]) + 1) / 10.0
        critical_ids: set[str] = set()
        successful_ids: set[str] = set()
        timely_successful_ids: set[str] = set()
        reward_critical_ids: set[str] = set()
        reward_successful_ids: set[str] = set()
        reward_timely_ids: set[str] = set()
        latencies_ms: list[float] = []
        transmissions: list[dict[str, Any]] = []
        critical_ids_by_event: dict[str, list[str]] = {}
        sender_ids_by_event: dict[str, str | None] = {}

        for event in active_events:
            sender = self._nearest_vehicle(frame.vehicles, event)
            sender_id = sender.vehicle_id if sender else None
            event_critical_ids = {
                vehicle.vehicle_id
                for vehicle in frame.vehicles
                if vehicle.vehicle_id != sender_id
                and math.dist((vehicle.x, vehicle.y), (event.x, event.y)) <= self.critical_radius_m
            }
            critical_ids.update(event_critical_ids)
            reward_critical_ids.update(
                f"{event.event_id}:{receiver_id}" for receiver_id in event_critical_ids
            )
            critical_ids_by_event[event.event_id] = sorted(event_critical_ids)
            sender_ids_by_event[event.event_id] = sender_id
            for receiver_id in sorted(selected_ids - ({sender_id} if sender_id else set())):
                receiver = active_by_id[receiver_id]
                result = self._network_model.calculate_transmission(
                    (event.x, event.y),
                    (receiver.x, receiver.y),
                    message_size=512,
                    priority=priority,
                    current_load=self._current_load,
                )
                allocated = min(
                    result.allocated_bandwidth_mbps,
                    self._network_model.total_bandwidth_mbps * bandwidth_fraction,
                )
                self._current_load = min(
                    1.0,
                    self._current_load + allocated / self._network_model.total_bandwidth_mbps,
                )
                delivered = bool(self.np_random.random() >= result.packet_loss_rate)
                if delivered:
                    successful_ids.add(receiver_id)
                    reward_successful_ids.add(f"{event.event_id}:{receiver_id}")
                    if result.latency_ms <= self.safety_window_ms:
                        timely_successful_ids.add(receiver_id)
                        reward_timely_ids.add(f"{event.event_id}:{receiver_id}")
                latencies_ms.append(result.latency_ms)
                transmissions.append(
                    {
                        "event_id": event.event_id,
                        "sender_id": sender_id,
                        "receiver_id": receiver_id,
                        "delivered": delivered,
                        "critical": receiver_id in event_critical_ids,
                        "latency_ms": result.latency_ms,
                        "allocated_bandwidth_mbps": allocated,
                    }
                )

        breakdown = calculate_reward(
            reward_critical_ids if self.reward_mode == "full" else critical_ids,
            reward_successful_ids if self.reward_mode == "full" else successful_ids,
            latencies_ms,
            self.delay_normalization_ms,
            mode=self.reward_mode,
            timely_successful_receiver_ids=(
                reward_timely_ids if self.reward_mode == "full" else timely_successful_ids
            ),
            selected_receiver_count=len(transmissions),
            active_receiver_count=max(
                sum(
                    len(active_by_id) - (1 if sender_id else 0)
                    for sender_id in sender_ids_by_event.values()
                ),
                0,
            ),
            weights=self.reward_weights,
        )
        info = {
            "timestamp": frame.timestamp,
            "selected_receiver_ids": sorted(selected_ids),
            "critical_receiver_ids": sorted(critical_ids),
            "successful_receiver_ids": sorted(successful_ids),
            "timely_successful_receiver_ids": sorted(timely_successful_ids),
            "critical_receiver_ids_by_event": critical_ids_by_event,
            "sender_ids_by_event": sender_ids_by_event,
            "transmissions": transmissions,
            "delivery_success_rate": breakdown.delivery_success_rate,
            "avg_delay_penalty": breakdown.avg_delay_penalty,
            "effective_delivery_rate": breakdown.effective_delivery_rate,
            "coverage_rate": breakdown.coverage_rate,
            "overhead_penalty": breakdown.overhead_penalty,
            "miss_rate": breakdown.miss_rate,
            "reward": breakdown.reward,
        }
        return breakdown, info

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
        del options
        super().reset(seed=self._initial_seed if seed is None else seed)
        resolved_seed = self._initial_seed if seed is None else seed
        self._network_model = self._create_network_model(resolved_seed)
        self._step_index = 0
        self._current_load = 0.0
        self._closed = False
        observation = self._observation()
        return observation, {"timestamp": self.frames[0].timestamp}

    def step(
        self, action: np.ndarray
    ) -> tuple[dict[str, np.ndarray], float, bool, bool, dict[str, Any]]:
        if self._closed:
            raise RuntimeError("environment is closed")
        action_array = np.asarray(action, dtype=np.int64)
        if not self.action_space.contains(action_array):
            raise ValueError("action is outside the configured MultiDiscrete space")

        breakdown, info = self._execute_action(action_array)
        self._step_index += 1
        terminated = self._step_index >= self.episode_steps
        if terminated:
            self._step_index = self.episode_steps - 1
        observation = self._observation()
        return observation, breakdown.reward, terminated, False, info

    def render(self) -> str:
        frame = self.frames[min(self._step_index, self.episode_steps - 1)]
        return (
            f"V2XEnv(step={self._step_index}, time={frame.timestamp:.2f}, "
            f"vehicles={len(frame.vehicles)}, load={self._current_load:.3f})"
        )

    def close(self) -> None:
        self._closed = True

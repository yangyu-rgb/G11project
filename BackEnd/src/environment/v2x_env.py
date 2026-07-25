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
from src.environment.reward_calculator import (
    RewardBreakdown,
    RewardWeights,
    SegmentedLatency,
    calculate_reward,
)
from src.models.utils import (
    padded_history,
    relative_event_features,
    relative_vehicle_features,
    time_to_collision_seconds,
)


@dataclass(frozen=True)
class VehicleSnapshot:
    vehicle_id: str
    x: float
    y: float
    speed: float
    angle: float
    lane_id: str = ""


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
        feature_mode: Literal["basic", "enhanced"] = "basic",
        history_window: int = 5,
        ttc_max_seconds: float = 30.0,
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
        if feature_mode not in ("basic", "enhanced"):
            raise ValueError("feature_mode must be 'basic' or 'enhanced'")
        if history_window != 5:
            raise ValueError("the enhanced feature schema requires history_window=5")
        if ttc_max_seconds <= 0:
            raise ValueError("ttc_max_seconds must be positive")

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
        self.feature_mode = feature_mode
        self.history_window = history_window
        self.ttc_max_seconds = ttc_max_seconds
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

        self.vehicle_feature_dim = 5 if feature_mode == "basic" else 33
        self.observation_space = spaces.Dict(
            {
                "vehicles": spaces.Box(
                    low=-1.0,
                    high=1.0,
                    shape=(max_vehicles, self.vehicle_feature_dim),
                    dtype=np.float32,
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
        self._pending_decision_latency_ms = 0.0
        self._coverage_opportunities: dict[str, int] = {}
        self._coverage_successes: dict[str, int] = {}

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
                        lane_id=element.attrib.get("lane", ""),
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

    @staticmethod
    def _lane_number(lane_id: str) -> float:
        if not lane_id:
            return -1.0
        try:
            value = int(lane_id.rsplit("_", 1)[-1])
        except ValueError:
            return -1.0
        return float(np.clip(value / 5.0, 0.0, 1.0))

    def _vehicle_history(self, vehicle_id: str) -> tuple[tuple[float, float, float], ...]:
        values: list[tuple[float, float, float]] = []
        start = max(0, self._step_index - self.history_window + 1)
        for frame in self.frames[start : self._step_index + 1]:
            snapshot = next(
                (vehicle for vehicle in frame.vehicles if vehicle.vehicle_id == vehicle_id), None
            )
            if snapshot is not None:
                values.append((snapshot.x, snapshot.y, snapshot.speed))
        return padded_history(values, self.history_window)

    def _enhanced_vehicle_features(
        self,
        vehicle: VehicleSnapshot,
        frame: TrajectoryFrame,
        active_events: tuple[EmergencyEvent, ...],
    ) -> np.ndarray:
        basic = self._vehicle_features(vehicle).tolist()
        others = [item for item in frame.vehicles if item.vehicle_id != vehicle.vehicle_id]
        nearest = min(
            others,
            key=lambda item: math.dist((vehicle.x, vehicle.y), (item.x, item.y)),
            default=None,
        )
        vehicle_relative = (
            relative_vehicle_features(
                x=vehicle.x,
                y=vehicle.y,
                speed=vehicle.speed,
                angle=vehicle.angle,
                lane_id=vehicle.lane_id,
                other_x=nearest.x,
                other_y=nearest.y,
                other_speed=nearest.speed,
                other_angle=nearest.angle,
                other_lane_id=nearest.lane_id,
            )
            if nearest is not None
            else (0.0, 0.0, 0.0, 0.0)
        )
        nearest_event = min(
            active_events,
            key=lambda event: math.dist((vehicle.x, vehicle.y), (event.x, event.y)),
            default=None,
        )
        event_relative = (
            relative_event_features(
                x=vehicle.x,
                y=vehicle.y,
                angle=vehicle.angle,
                event_x=nearest_event.x,
                event_y=nearest_event.y,
                affected_radius_m=self.critical_radius_m,
            )
            if nearest_event is not None
            else (0.0, 0.0, 0.0)
        )
        history = self._vehicle_history(vehicle.vehicle_id)
        time_delta = max(
            self.frames[self._step_index].timestamp
            - self.frames[max(0, self._step_index - 1)].timestamp,
            1e-6,
        )
        acceleration = (history[-1][2] - history[-2][2]) / time_delta
        ttc = (
            time_to_collision_seconds(
                x=vehicle.x,
                y=vehicle.y,
                speed=vehicle.speed,
                angle=vehicle.angle,
                event_x=nearest_event.x,
                event_y=nearest_event.y,
                maximum_seconds=self.ttc_max_seconds,
            )
            if nearest_event is not None
            else self.ttc_max_seconds
        )
        recent_lanes: list[str] = []
        for frame_value in self.frames[max(0, self._step_index - 4) : self._step_index + 1]:
            item = next(
                (
                    candidate
                    for candidate in frame_value.vehicles
                    if candidate.vehicle_id == vehicle.vehicle_id
                ),
                None,
            )
            if item is not None:
                recent_lanes.append(item.lane_id)
        lane_changes = sum(a != b for a, b in zip(recent_lanes, recent_lanes[1:], strict=False))
        lane_frequency = lane_changes / max(len(recent_lanes) - 1, 1)
        trajectory = [
            coordinate
            for x, y, _ in history
            for coordinate in (
                float(np.clip(2 * x / self.road_length_m - 1, -1, 1)),
                float(np.clip(y / self.lateral_extent_m, -1, 1)),
            )
        ]
        speed_changes = [0.0]
        speed_changes.extend(
            float(np.clip((current[2] - previous[2]) / 40.0, -1, 1))
            for previous, current in zip(history, history[1:], strict=False)
        )
        heading_x = math.sin(math.radians(vehicle.angle))
        heading_y = math.cos(math.radians(vehicle.angle))
        front_count = 0
        rear_count = 0
        for other in others:
            if not vehicle.lane_id or other.lane_id != vehicle.lane_id:
                continue
            delta_x, delta_y = other.x - vehicle.x, other.y - vehicle.y
            distance = math.hypot(delta_x, delta_y)
            if distance > 100:
                continue
            if delta_x * heading_x + delta_y * heading_y >= 0:
                front_count += 1
            else:
                rear_count += 1
        values = (
            basic
            + list(vehicle_relative)
            + list(event_relative)
            + [
                float(np.clip(acceleration / 10.0, -1, 1)),
                float(np.clip(ttc / self.ttc_max_seconds, 0, 1)),
                lane_frequency,
            ]
            + trajectory
            + speed_changes
            + [
                self._lane_number(vehicle.lane_id),
                min(front_count / 10, 1),
                min(rear_count / 10, 1),
            ]
        )
        return np.asarray(values, dtype=np.float32)

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
        vehicle_values = np.zeros((self.max_vehicles, self.vehicle_feature_dim), dtype=np.float32)
        vehicle_mask = np.zeros(self.max_vehicles, dtype=np.int8)
        for vehicle in frame.vehicles:
            slot = self._vehicle_slots[vehicle.vehicle_id]
            vehicle_values[slot] = (
                self._vehicle_features(vehicle)
                if self.feature_mode == "basic"
                else self._enhanced_vehicle_features(
                    vehicle, frame, self._events_by_step[self._step_index]
                )
            )
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
        decision_latency_ms = self._pending_decision_latency_ms
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
        segmented_latencies: list[SegmentedLatency] = []
        transmissions: list[dict[str, Any]] = []
        critical_ids_by_event: dict[str, list[str]] = {}
        sender_ids_by_event: dict[str, str | None] = {}
        receiver_severities: dict[str, float] = {}

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
            for receiver_id in event_critical_ids:
                reward_id = f"{event.event_id}:{receiver_id}"
                receiver_severities[reward_id] = event.severity
                self._coverage_opportunities[receiver_id] = (
                    self._coverage_opportunities.get(receiver_id, 0) + 1
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
                    if receiver_id in event_critical_ids:
                        self._coverage_successes[receiver_id] = (
                            self._coverage_successes.get(receiver_id, 0) + 1
                        )
                    if result.latency_ms <= self.safety_window_ms:
                        timely_successful_ids.add(receiver_id)
                        reward_timely_ids.add(f"{event.event_id}:{receiver_id}")
                latencies_ms.append(result.latency_ms)
                segmented_latencies.append(
                    SegmentedLatency(
                        decision_ms=self._pending_decision_latency_ms,
                        queue_ms=result.queue_delay_ms,
                        transmission_ms=result.transmission_delay_ms,
                    )
                )
                transmissions.append(
                    {
                        "event_id": event.event_id,
                        "sender_id": sender_id,
                        "receiver_id": receiver_id,
                        "delivered": delivered,
                        "critical": receiver_id in event_critical_ids,
                        "latency_ms": result.latency_ms,
                        "decision_delay_ms": self._pending_decision_latency_ms,
                        "queue_delay_ms": result.queue_delay_ms,
                        "transmission_delay_ms": result.transmission_delay_ms,
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
            segmented_latencies=segmented_latencies,
            receiver_severities=receiver_severities,
            receiver_coverage_history={
                receiver_id: self._coverage_successes.get(receiver_id, 0) / opportunities
                for receiver_id, opportunities in self._coverage_opportunities.items()
            },
        )
        self._pending_decision_latency_ms = 0.0
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
            "fairness_penalty": breakdown.fairness_penalty,
            "latency_breakdown": {
                "decision": breakdown.decision_delay_penalty,
                "queue": breakdown.queue_delay_penalty,
                "transmission": breakdown.transmission_delay_penalty,
            },
            "decision_latency_ms": decision_latency_ms,
            "reward": breakdown.reward,
        }
        return breakdown, info

    def record_decision_latency(self, latency_ms: float) -> None:
        """Attach externally measured policy inference time to the next transition."""
        if not math.isfinite(latency_ms) or latency_ms < 0:
            raise ValueError("decision latency must be finite and non-negative")
        self._pending_decision_latency_ms = latency_ms

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
        self._pending_decision_latency_ms = 0.0
        self._coverage_opportunities.clear()
        self._coverage_successes.clear()
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

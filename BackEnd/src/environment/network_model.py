"""Simplified M1 V2X network abstraction."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from enum import IntEnum
from typing import Sequence

SPEED_OF_LIGHT_MPS = 299_792_458.0


class Priority(IntEnum):
    LOW = 0
    MEDIUM = 1
    HIGH = 2


@dataclass(frozen=True)
class TransmissionResult:
    latency_ms: float
    packet_loss_rate: float
    allocated_bandwidth_mbps: float


class SimpleNetworkModel:
    """Calculate latency, loss rate, and a capped share of available bandwidth."""

    _PRIORITY_SHARES = {
        Priority.LOW: 0.25,
        Priority.MEDIUM: 0.50,
        Priority.HIGH: 1.00,
    }

    def __init__(
        self,
        total_bandwidth_mbps: float = 100.0,
        base_delay_ms: float = 20.0,
        jitter_min_ms: float = 0.0,
        jitter_max_ms: float = 10.0,
        distance_threshold_m: float = 500.0,
        far_packet_loss_rate: float = 0.10,
        random_source: random.Random | None = None,
    ) -> None:
        if total_bandwidth_mbps <= 0 or base_delay_ms < 0:
            raise ValueError("bandwidth must be positive and base delay cannot be negative")
        if not 0 <= jitter_min_ms <= jitter_max_ms:
            raise ValueError("jitter bounds must satisfy 0 <= minimum <= maximum")
        if distance_threshold_m < 0:
            raise ValueError("distance threshold cannot be negative")
        if not 0 <= far_packet_loss_rate <= 1:
            raise ValueError("packet loss rate must be between 0 and 1")

        self.total_bandwidth_mbps = total_bandwidth_mbps
        self.base_delay_ms = base_delay_ms
        self.jitter_min_ms = jitter_min_ms
        self.jitter_max_ms = jitter_max_ms
        self.distance_threshold_m = distance_threshold_m
        self.far_packet_loss_rate = far_packet_loss_rate
        self.random_source = random_source or random.Random()

    @staticmethod
    def _position(position: Sequence[float], name: str) -> tuple[float, float]:
        if len(position) != 2:
            raise ValueError(f"{name} must contain exactly two coordinates")
        x_coordinate, y_coordinate = float(position[0]), float(position[1])
        if not math.isfinite(x_coordinate) or not math.isfinite(y_coordinate):
            raise ValueError(f"{name} coordinates must be finite")
        return x_coordinate, y_coordinate

    def calculate_transmission(
        self,
        sender_pos: Sequence[float],
        receiver_pos: Sequence[float],
        message_size: int,
        priority: int | Priority,
        current_load: float,
    ) -> TransmissionResult:
        """Return M1 transmission estimates without reserving mutable model state."""
        sender = self._position(sender_pos, "sender_pos")
        receiver = self._position(receiver_pos, "receiver_pos")
        if message_size <= 0:
            raise ValueError("message_size must be positive")
        try:
            resolved_priority = Priority(priority)
        except ValueError as exc:
            raise ValueError("priority must be 0 (low), 1 (medium), or 2 (high)") from exc
        if not 0 <= current_load <= 1:
            raise ValueError("current_load must be between 0 and 1")

        distance_m = math.dist(sender, receiver)
        propagation_delay_ms = distance_m / SPEED_OF_LIGHT_MPS * 1000
        jitter_ms = self.random_source.uniform(self.jitter_min_ms, self.jitter_max_ms)
        latency_ms = self.base_delay_ms + propagation_delay_ms + jitter_ms
        packet_loss_rate = (
            self.far_packet_loss_rate if distance_m > self.distance_threshold_m else 0.0
        )
        available_bandwidth_mbps = self.total_bandwidth_mbps * (1 - current_load)
        allocated_bandwidth_mbps = (
            available_bandwidth_mbps * self._PRIORITY_SHARES[resolved_priority]
        )
        return TransmissionResult(
            latency_ms=latency_ms,
            packet_loss_rate=packet_loss_rate,
            allocated_bandwidth_mbps=allocated_bandwidth_mbps,
        )

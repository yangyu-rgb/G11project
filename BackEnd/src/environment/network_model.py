"""Simplified M1 V2X network abstraction."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from enum import IntEnum
from typing import Literal, Sequence

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
    queue_delay_ms: float = 0.0
    transmission_delay_ms: float = 0.0
    propagation_delay_ms: float = 0.0


class SimpleNetworkModel:
    """Calculate network quality with the M1 model or a 3GPP-based model."""

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
        *,
        mode: Literal["simple", "3gpp"] = "simple",
        scenario: Literal["highway", "urban"] = "highway",
        carrier_frequency_ghz: float = 5.9,
        transmit_power_dbm: float = 23.0,
        noise_floor_dbm: float = -94.0,
        sinr_midpoint_db: float = 5.0,
        sinr_scale_db: float = 2.0,
        max_queue_delay_ms: float = 50.0,
        minimum_capacity_fraction: float = 0.05,
    ) -> None:
        if total_bandwidth_mbps <= 0 or base_delay_ms < 0:
            raise ValueError("bandwidth must be positive and base delay cannot be negative")
        if not 0 <= jitter_min_ms <= jitter_max_ms:
            raise ValueError("jitter bounds must satisfy 0 <= minimum <= maximum")
        if distance_threshold_m < 0:
            raise ValueError("distance threshold cannot be negative")
        if not 0 <= far_packet_loss_rate <= 1:
            raise ValueError("packet loss rate must be between 0 and 1")
        if mode not in ("simple", "3gpp"):
            raise ValueError("mode must be 'simple' or '3gpp'")
        if scenario not in ("highway", "urban"):
            raise ValueError("scenario must be 'highway' or 'urban'")
        if carrier_frequency_ghz <= 0:
            raise ValueError("carrier frequency must be positive")
        if not math.isfinite(transmit_power_dbm) or not math.isfinite(noise_floor_dbm):
            raise ValueError("transmit power and noise floor must be finite")
        if not math.isfinite(sinr_midpoint_db):
            raise ValueError("SINR midpoint must be finite")
        if sinr_scale_db <= 0:
            raise ValueError("SINR scale must be positive")
        if max_queue_delay_ms < 0:
            raise ValueError("maximum queue delay cannot be negative")
        if not 0 < minimum_capacity_fraction <= 1:
            raise ValueError("minimum capacity fraction must be in (0, 1]")

        self.total_bandwidth_mbps = total_bandwidth_mbps
        self.base_delay_ms = base_delay_ms
        self.jitter_min_ms = jitter_min_ms
        self.jitter_max_ms = jitter_max_ms
        self.distance_threshold_m = distance_threshold_m
        self.far_packet_loss_rate = far_packet_loss_rate
        self.random_source = random_source or random.Random()
        self.mode = mode
        self.scenario = scenario
        self.carrier_frequency_ghz = carrier_frequency_ghz
        self.transmit_power_dbm = transmit_power_dbm
        self.noise_floor_dbm = noise_floor_dbm
        self.sinr_midpoint_db = sinr_midpoint_db
        self.sinr_scale_db = sinr_scale_db
        self.max_queue_delay_ms = max_queue_delay_ms
        self.minimum_capacity_fraction = minimum_capacity_fraction

    @staticmethod
    def _position(position: Sequence[float], name: str) -> tuple[float, float]:
        if len(position) != 2:
            raise ValueError(f"{name} must contain exactly two coordinates")
        x_coordinate, y_coordinate = float(position[0]), float(position[1])
        if not math.isfinite(x_coordinate) or not math.isfinite(y_coordinate):
            raise ValueError(f"{name} coordinates must be finite")
        return x_coordinate, y_coordinate

    @staticmethod
    def _priority(priority: int | Priority) -> Priority:
        try:
            return Priority(priority)
        except ValueError as exc:
            raise ValueError("priority must be 0 (low), 1 (medium), or 2 (high)") from exc

    def calculate_path_loss_db(self, distance_m: float) -> float:
        """Return 3GPP path loss, clamping sub-metre distances to one metre."""
        if not math.isfinite(distance_m) or distance_m < 0:
            raise ValueError("distance must be finite and non-negative")

        effective_distance_m = max(distance_m, 1.0)
        frequency_term = 20 * math.log10(self.carrier_frequency_ghz)
        if self.scenario == "urban":
            return 28.0 + 22 * math.log10(effective_distance_m) + frequency_term
        return 32.4 + 20 * math.log10(effective_distance_m) + frequency_term

    def calculate_sinr_db(self, distance_m: float) -> float:
        """Return SINR from transmit power, path loss, and the configured noise floor."""
        received_power_dbm = self.transmit_power_dbm - self.calculate_path_loss_db(distance_m)
        return received_power_dbm - self.noise_floor_dbm

    def calculate_packet_loss_rate(self, sinr_db: float) -> float:
        """Map SINR to packet loss with a numerically stable logistic curve."""
        if not math.isfinite(sinr_db):
            raise ValueError("SINR must be finite")

        exponent = (sinr_db - self.sinr_midpoint_db) / self.sinr_scale_db
        if exponent >= 0:
            negative_exp = math.exp(-exponent)
            return negative_exp / (1 + negative_exp)
        positive_exp = math.exp(exponent)
        return 1 / (1 + positive_exp)

    def calculate_queue_delay_ms(self, current_load: float, priority: int | Priority) -> float:
        """Return load-dependent queueing delay with priority differentiation."""
        if not 0 <= current_load <= 1:
            raise ValueError("current_load must be between 0 and 1")
        resolved_priority = self._priority(priority)
        priority_factor = {
            Priority.LOW: 1.0,
            Priority.MEDIUM: 0.6,
            Priority.HIGH: 0.3,
        }[resolved_priority]
        return self.max_queue_delay_ms * current_load * priority_factor

    def calculate_transmission(
        self,
        sender_pos: Sequence[float],
        receiver_pos: Sequence[float],
        message_size: int,
        priority: int | Priority,
        current_load: float,
        bandwidth_fraction: float | None = None,
        receiver_count: int = 1,
    ) -> TransmissionResult:
        """Return M1 transmission estimates without reserving mutable model state."""
        sender = self._position(sender_pos, "sender_pos")
        receiver = self._position(receiver_pos, "receiver_pos")
        if message_size <= 0:
            raise ValueError("message_size must be positive")
        resolved_priority = self._priority(priority)
        if not 0 <= current_load <= 1:
            raise ValueError("current_load must be between 0 and 1")
        if bandwidth_fraction is not None and not 0 < bandwidth_fraction <= 1:
            raise ValueError("bandwidth_fraction must be in (0, 1]")
        if receiver_count <= 0:
            raise ValueError("receiver_count must be positive")
        resolved_bandwidth_fraction = 1.0 if bandwidth_fraction is None else bandwidth_fraction

        distance_m = math.dist(sender, receiver)
        propagation_delay_ms = distance_m / SPEED_OF_LIGHT_MPS * 1000
        jitter_ms = self.random_source.uniform(self.jitter_min_ms, self.jitter_max_ms)
        queue_delay_ms = 0.0
        if self.mode == "3gpp":
            queue_delay_ms = self.calculate_queue_delay_ms(current_load, resolved_priority)
            packet_loss_rate = self.calculate_packet_loss_rate(self.calculate_sinr_db(distance_m))
        else:
            packet_loss_rate = (
                self.far_packet_loss_rate if distance_m > self.distance_threshold_m else 0.0
            )
        # Reserve a small emergency-service capacity even at saturation, then share
        # the event allocation across receivers.  This avoids the former zero-
        # bandwidth singularity and makes the result independent of receiver order.
        available_bandwidth_mbps = self.total_bandwidth_mbps * max(
            1 - current_load, self.minimum_capacity_fraction
        )
        allocated_bandwidth_mbps = (
            available_bandwidth_mbps
            * self._PRIORITY_SHARES[resolved_priority]
            * resolved_bandwidth_fraction
            / receiver_count
        )
        serialization_delay_ms = (
            (message_size * 8) / (max(allocated_bandwidth_mbps, 1e-6) * 1000)
            if bandwidth_fraction is not None
            else 0.0
        )
        transmission_delay_ms = (
            self.base_delay_ms + jitter_ms + propagation_delay_ms + serialization_delay_ms
        )
        latency_ms = queue_delay_ms + transmission_delay_ms
        return TransmissionResult(
            latency_ms=latency_ms,
            packet_loss_rate=packet_loss_rate,
            allocated_bandwidth_mbps=allocated_bandwidth_mbps,
            queue_delay_ms=queue_delay_ms,
            transmission_delay_ms=transmission_delay_ms,
            propagation_delay_ms=propagation_delay_ms,
        )

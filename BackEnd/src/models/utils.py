"""Reusable neural-network utilities for environment encoders."""

from __future__ import annotations

import math
from collections.abc import Sequence

import torch
from torch import nn


def wrapped_angle_difference_degrees(first: float, second: float) -> float:
    """Return the signed shortest angle from ``second`` to ``first``."""
    return (float(first) - float(second) + 180.0) % 360.0 - 180.0


def relative_vehicle_features(
    *,
    x: float,
    y: float,
    speed: float,
    angle: float,
    lane_id: str,
    other_x: float,
    other_y: float,
    other_speed: float,
    other_angle: float,
    other_lane_id: str,
    distance_scale_m: float = 500.0,
    speed_scale_mps: float = 40.0,
) -> tuple[float, float, float, float]:
    """Calculate normalized nearest-neighbour motion and lane features."""
    distance = math.dist((x, y), (other_x, other_y))
    return (
        min(distance / distance_scale_m, 1.0),
        max(-1.0, min((other_speed - speed) / speed_scale_mps, 1.0)),
        wrapped_angle_difference_degrees(other_angle, angle) / 180.0,
        float(bool(lane_id) and lane_id == other_lane_id),
    )


def relative_event_features(
    *,
    x: float,
    y: float,
    angle: float,
    event_x: float,
    event_y: float,
    affected_radius_m: float = 300.0,
    distance_scale_m: float = 500.0,
) -> tuple[float, float, float]:
    """Calculate normalized distance, bearing difference and affected-area flag."""
    delta_x, delta_y = event_x - x, event_y - y
    distance = math.hypot(delta_x, delta_y)
    bearing = math.degrees(math.atan2(delta_x, delta_y)) % 360.0
    return (
        min(distance / distance_scale_m, 1.0),
        wrapped_angle_difference_degrees(bearing, angle) / 180.0,
        float(distance <= affected_radius_m),
    )


def time_to_collision_seconds(
    *,
    x: float,
    y: float,
    speed: float,
    angle: float,
    event_x: float,
    event_y: float,
    maximum_seconds: float = 30.0,
) -> float:
    """Estimate TTC from the velocity component pointing towards an event."""
    distance = math.dist((x, y), (event_x, event_y))
    if distance == 0:
        return 0.0
    heading_x = math.sin(math.radians(angle))
    heading_y = math.cos(math.radians(angle))
    direction_x = (event_x - x) / distance
    direction_y = (event_y - y) / distance
    closing_speed = speed * (heading_x * direction_x + heading_y * direction_y)
    if closing_speed <= 1e-6:
        return maximum_seconds
    return min(distance / closing_speed, maximum_seconds)


def padded_history(
    values: Sequence[tuple[float, float, float]], window: int = 5
) -> tuple[tuple[float, float, float], ...]:
    """Left-pad a trajectory window with its earliest available observation."""
    if window <= 0:
        raise ValueError("history window must be positive")
    if not values:
        return tuple((0.0, 0.0, 0.0) for _ in range(window))
    selected = list(values[-window:])
    return tuple([selected[0]] * (window - len(selected)) + selected)


class SinusoidalPositionalEncoding(nn.Module):
    """Add deterministic sinusoidal positions to batch-first token embeddings."""

    def __init__(self, d_model: int, max_length: int = 512) -> None:
        super().__init__()
        if d_model <= 0 or d_model % 2 != 0:
            raise ValueError("d_model must be a positive even integer")
        if max_length <= 0:
            raise ValueError("max_length must be positive")

        positions = torch.arange(max_length, dtype=torch.float32).unsqueeze(1)
        frequencies = torch.exp(
            torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10_000.0) / d_model)
        )
        encoding = torch.zeros(max_length, d_model, dtype=torch.float32)
        encoding[:, 0::2] = torch.sin(positions * frequencies)
        encoding[:, 1::2] = torch.cos(positions * frequencies)
        self.register_buffer("encoding", encoding.unsqueeze(0), persistent=False)

    def forward(self, tokens: torch.Tensor) -> torch.Tensor:
        if tokens.ndim != 3:
            raise ValueError("tokens must have shape [batch, token_count, d_model]")
        token_count = tokens.shape[1]
        if token_count > self.encoding.shape[1]:
            raise ValueError(f"token_count {token_count} exceeds maximum {self.encoding.shape[1]}")
        return tokens + self.encoding[:, :token_count].to(device=tokens.device, dtype=tokens.dtype)

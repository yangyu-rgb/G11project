"""Reward calculation for the M1 offline V2X environment."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Collection, Sequence


@dataclass(frozen=True)
class RewardBreakdown:
    """Normalized reward components returned for diagnostics."""

    delivery_success_rate: float
    avg_delay_penalty: float
    reward: float


def calculate_reward(
    critical_receiver_ids: Collection[str],
    successful_receiver_ids: Collection[str],
    latencies_ms: Sequence[float],
    delay_normalization_ms: float = 100.0,
) -> RewardBreakdown:
    """Calculate delivery success minus normalized average delay."""
    if delay_normalization_ms <= 0:
        raise ValueError("delay_normalization_ms must be positive")
    if any(not math.isfinite(value) or value < 0 for value in latencies_ms):
        raise ValueError("latencies_ms must contain finite non-negative values")

    critical = set(critical_receiver_ids)
    successful = set(successful_receiver_ids)
    delivery_success_rate = len(critical & successful) / len(critical) if critical else 0.0
    average_delay_ms = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    avg_delay_penalty = min(average_delay_ms / delay_normalization_ms, 1.0)
    reward = max(-1.0, min(1.0, delivery_success_rate - avg_delay_penalty))
    return RewardBreakdown(delivery_success_rate, avg_delay_penalty, reward)

"""Reward calculation for the M1 offline V2X environment."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Collection, Literal, Mapping, Sequence


@dataclass(frozen=True)
class RewardWeights:
    """Normalized coefficients for the complete M2 training objective."""

    effective_delivery: float = 0.25
    coverage: float = 0.30
    latency: float = 0.20
    overhead: float = 0.15
    missed: float = 0.10

    @classmethod
    def from_mapping(cls, values: Mapping[str, float] | None) -> "RewardWeights":
        if values is None:
            return cls()
        try:
            weights = cls(**{key: float(value) for key, value in values.items()})
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid complete reward weights") from exc
        if any(value < 0 for value in weights.__dict__.values()):
            raise ValueError("reward weights must be non-negative")
        if not math.isclose(sum(weights.__dict__.values()), 1.0, abs_tol=1e-6):
            raise ValueError("reward weights must sum to 1")
        return weights


@dataclass(frozen=True)
class RewardBreakdown:
    """Normalized reward components returned for diagnostics."""

    delivery_success_rate: float
    avg_delay_penalty: float
    reward: float
    effective_delivery_rate: float = 0.0
    coverage_rate: float = 0.0
    overhead_penalty: float = 0.0
    miss_rate: float = 0.0


def calculate_reward(
    critical_receiver_ids: Collection[str],
    successful_receiver_ids: Collection[str],
    latencies_ms: Sequence[float],
    delay_normalization_ms: float = 100.0,
    *,
    mode: Literal["simple", "full"] = "simple",
    timely_successful_receiver_ids: Collection[str] | None = None,
    selected_receiver_count: int | None = None,
    active_receiver_count: int | None = None,
    weights: RewardWeights | Mapping[str, float] | None = None,
) -> RewardBreakdown:
    """Calculate the backward-compatible simple or complete M2 objective."""
    if delay_normalization_ms <= 0:
        raise ValueError("delay_normalization_ms must be positive")
    if any(not math.isfinite(value) or value < 0 for value in latencies_ms):
        raise ValueError("latencies_ms must contain finite non-negative values")
    if mode not in ("simple", "full"):
        raise ValueError("reward mode must be 'simple' or 'full'")

    critical = set(critical_receiver_ids)
    successful = set(successful_receiver_ids)
    delivery_success_rate = len(critical & successful) / len(critical) if critical else 0.0
    average_delay_ms = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    avg_delay_penalty = min(average_delay_ms / delay_normalization_ms, 1.0)
    if mode == "simple":
        reward = max(-1.0, min(1.0, delivery_success_rate - avg_delay_penalty))
        return RewardBreakdown(delivery_success_rate, avg_delay_penalty, reward)

    selected_count = len(successful) if selected_receiver_count is None else selected_receiver_count
    active_count = (
        max(selected_count, 1) if active_receiver_count is None else active_receiver_count
    )
    if selected_count < 0 or active_count < 0:
        raise ValueError("receiver counts must be non-negative")
    timely = set(timely_successful_receiver_ids or successful)
    timely_critical_count = len(critical & timely)
    effective_delivery_rate = timely_critical_count / selected_count if selected_count else 0.0
    coverage_rate = len(critical & successful) / len(critical) if critical else 0.0
    miss_rate = 1.0 - coverage_rate if critical else 0.0
    overhead_penalty = min(selected_count / active_count, 1.0) if active_count else 0.0
    resolved_weights = (
        weights if isinstance(weights, RewardWeights) else RewardWeights.from_mapping(weights)
    )
    if not critical:
        reward = -resolved_weights.overhead * overhead_penalty
    else:
        reward = (
            resolved_weights.effective_delivery * effective_delivery_rate
            + resolved_weights.coverage * coverage_rate
            - resolved_weights.latency * avg_delay_penalty
            - resolved_weights.overhead * overhead_penalty
            - resolved_weights.missed * miss_rate
        )
    return RewardBreakdown(
        delivery_success_rate=delivery_success_rate,
        avg_delay_penalty=avg_delay_penalty,
        reward=max(-1.0, min(1.0, reward)),
        effective_delivery_rate=effective_delivery_rate,
        coverage_rate=coverage_rate,
        overhead_penalty=overhead_penalty,
        miss_rate=miss_rate,
    )

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
    overhead: float = 0.10
    missed: float = 0.10
    fairness: float = 0.05

    @classmethod
    def from_mapping(cls, values: Mapping[str, float] | None) -> "RewardWeights":
        if values is None:
            return cls()
        try:
            mapped = {key: float(value) for key, value in values.items()}
            if "fairness" not in mapped:
                mapped["fairness"] = 0.0
            weights = cls(**mapped)
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid complete reward weights") from exc
        if any(value < 0 for value in weights.__dict__.values()):
            raise ValueError("reward weights must be non-negative")
        total = sum(weights.__dict__.values())
        if total <= 0:
            raise ValueError("at least one reward weight must be positive")
        return cls(**{key: value / total for key, value in weights.__dict__.items()})


@dataclass(frozen=True)
class SegmentedLatency:
    """Latency components measured across decision and network processing."""

    decision_ms: float = 0.0
    queue_ms: float = 0.0
    transmission_ms: float = 0.0


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
    decision_delay_penalty: float = 0.0
    queue_delay_penalty: float = 0.0
    transmission_delay_penalty: float = 0.0
    fairness_penalty: float = 0.0


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
    segmented_latencies: Sequence[SegmentedLatency] | None = None,
    receiver_severities: Mapping[str, float] | None = None,
    receiver_coverage_history: Mapping[str, float] | None = None,
) -> RewardBreakdown:
    """Calculate the backward-compatible simple or complete M2 objective."""
    if delay_normalization_ms <= 0:
        raise ValueError("delay_normalization_ms must be positive")
    if any(not math.isfinite(value) or value < 0 for value in latencies_ms):
        raise ValueError("latencies_ms must contain finite non-negative values")
    segments = tuple(segmented_latencies or ())
    if any(
        not math.isfinite(value) or value < 0
        for segment in segments
        for value in (segment.decision_ms, segment.queue_ms, segment.transmission_ms)
    ):
        raise ValueError("segmented latency values must be finite and non-negative")
    if mode not in ("simple", "full"):
        raise ValueError("reward mode must be 'simple' or 'full'")

    critical = set(critical_receiver_ids)
    successful = set(successful_receiver_ids)
    delivery_success_rate = len(critical & successful) / len(critical) if critical else 0.0
    average_delay_ms = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    decision_ms = sum(item.decision_ms for item in segments) / len(segments) if segments else 0.0
    queue_ms = sum(item.queue_ms for item in segments) / len(segments) if segments else 0.0
    transmission_ms = (
        sum(item.transmission_ms for item in segments) / len(segments)
        if segments
        else average_delay_ms
    )
    if segments:
        average_delay_ms = decision_ms + queue_ms + transmission_ms
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
    severities = receiver_severities or {}

    def severity_weight(receiver_id: str) -> float:
        severity = float(severities.get(receiver_id, 0.5))
        return 2.0 if severity > 0.7 else 1.0 if severity >= 0.4 else 0.5

    total_critical_weight = sum(severity_weight(receiver_id) for receiver_id in critical)
    timely_weight = sum(severity_weight(receiver_id) for receiver_id in critical & timely)
    delivered_weight = sum(severity_weight(receiver_id) for receiver_id in critical & successful)
    selected_weight = sum(severity_weight(receiver_id) for receiver_id in successful)
    effective_delivery_rate = timely_weight / selected_weight if selected_weight else 0.0
    coverage_rate = delivered_weight / total_critical_weight if total_critical_weight else 0.0
    miss_rate = 1.0 - coverage_rate if critical else 0.0
    overhead_penalty = min(selected_count / active_count, 1.0) if active_count else 0.0
    coverage_values = tuple(float(value) for value in (receiver_coverage_history or {}).values())
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in coverage_values):
        raise ValueError("receiver coverage history values must be in [0, 1]")
    if len(coverage_values) < 2:
        fairness_penalty = 0.0
    else:
        mean_coverage = sum(coverage_values) / len(coverage_values)
        variance = sum((value - mean_coverage) ** 2 for value in coverage_values) / len(
            coverage_values
        )
        fairness_penalty = min(variance / 0.25, 1.0)
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
            - resolved_weights.fairness * fairness_penalty
        )
    return RewardBreakdown(
        delivery_success_rate=delivery_success_rate,
        avg_delay_penalty=avg_delay_penalty,
        reward=max(-1.0, min(1.0, reward)),
        effective_delivery_rate=effective_delivery_rate,
        coverage_rate=coverage_rate,
        overhead_penalty=overhead_penalty,
        miss_rate=miss_rate,
        decision_delay_penalty=min(decision_ms / delay_normalization_ms, 1.0),
        queue_delay_penalty=min(queue_ms / delay_normalization_ms, 1.0),
        transmission_delay_penalty=min(transmission_ms / delay_normalization_ms, 1.0),
        fairness_penalty=fairness_penalty,
    )

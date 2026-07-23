"""Common metrics and four-method comparison for V2X receiver selection."""

from __future__ import annotations

import math
import random
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from src.environment.network_model import Priority, SimpleNetworkModel
from src.evaluation.baselines import select_receivers, select_urgency_resources

ReceiverSelector = Callable[[Sequence[Mapping[str, Any]], Mapping[str, Any]], Sequence[str]]


@dataclass(frozen=True)
class EvaluationMetrics:
    mean_latency_ms: float | None
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    p99_latency_ms: float | None
    effective_delivery_rate: float
    communication_overhead: float | None
    sent_count: int
    effective_delivery_count: int

    def to_dict(self) -> dict[str, float | int | None]:
        return asdict(self)


def _position(item: Mapping[str, Any]) -> tuple[float, float]:
    try:
        position = (float(item["x"]), float(item["y"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("items must contain numeric x and y coordinates") from exc
    if not all(math.isfinite(value) for value in position):
        raise ValueError("coordinates must be finite")
    return position


def _latency_percentiles(latencies_ms: Sequence[float]) -> tuple[float | None, ...]:
    if not latencies_ms:
        return None, None, None, None
    values = np.asarray(latencies_ms, dtype=np.float64)
    return (
        float(values.mean()),
        float(np.percentile(values, 50)),
        float(np.percentile(values, 95)),
        float(np.percentile(values, 99)),
    )


def evaluate_selection(
    vehicles: Sequence[Mapping[str, Any]],
    event: Mapping[str, Any],
    receiver_ids: Sequence[str],
    *,
    critical_radius_m: float = 300.0,
    seed: int = 42,
    priority: Priority = Priority.HIGH,
    bandwidth_fraction: float | None = None,
) -> EvaluationMetrics:
    """Evaluate one receiver selection with the shared simplified network model."""
    if critical_radius_m <= 0:
        raise ValueError("critical_radius_m must be positive")
    if bandwidth_fraction is not None and not 0 <= bandwidth_fraction <= 1:
        raise ValueError("bandwidth_fraction must be between 0 and 1")
    event_position = _position(event)
    sender_id = event.get("sender_id")
    vehicles_by_id = {str(vehicle["id"]): vehicle for vehicle in vehicles}
    candidate_ids = set(vehicles_by_id) - ({str(sender_id)} if sender_id is not None else set())
    unknown_ids = set(receiver_ids) - candidate_ids
    if unknown_ids:
        raise ValueError(f"receiver selection contains unknown IDs: {sorted(unknown_ids)}")

    critical_ids = {
        vehicle_id
        for vehicle_id in candidate_ids
        if math.dist(_position(vehicles_by_id[vehicle_id]), event_position) <= critical_radius_m
    }
    random_source = random.Random(seed)
    network_model = SimpleNetworkModel(random_source=random.Random(seed))
    delivered_latencies: list[float] = []
    effective_delivery_count = 0
    current_load = 0.0
    unique_receiver_ids = tuple(dict.fromkeys(receiver_ids))
    per_receiver_bandwidth_fraction = (
        bandwidth_fraction / len(unique_receiver_ids)
        if bandwidth_fraction is not None and unique_receiver_ids
        else None
    )
    for receiver_id in unique_receiver_ids:
        result = network_model.calculate_transmission(
            event_position,
            _position(vehicles_by_id[receiver_id]),
            message_size=512,
            priority=priority,
            current_load=current_load,
        )
        allocated_bandwidth_mbps = result.allocated_bandwidth_mbps
        if per_receiver_bandwidth_fraction is not None:
            allocated_bandwidth_mbps = min(
                allocated_bandwidth_mbps,
                network_model.total_bandwidth_mbps * per_receiver_bandwidth_fraction,
            )
        current_load = min(
            1.0,
            current_load + allocated_bandwidth_mbps / network_model.total_bandwidth_mbps,
        )
        delivered = random_source.random() >= result.packet_loss_rate
        if delivered:
            delivered_latencies.append(result.latency_ms)
            if receiver_id in critical_ids:
                effective_delivery_count += 1

    sent_count = len(unique_receiver_ids)
    effective_delivery_rate = effective_delivery_count / sent_count if sent_count else 0.0
    communication_overhead = (
        sent_count / effective_delivery_count if effective_delivery_count else None
    )
    mean, p50, p95, p99 = _latency_percentiles(delivered_latencies)
    return EvaluationMetrics(
        mean_latency_ms=mean,
        p50_latency_ms=p50,
        p95_latency_ms=p95,
        p99_latency_ms=p99,
        effective_delivery_rate=effective_delivery_rate,
        communication_overhead=communication_overhead,
        sent_count=sent_count,
        effective_delivery_count=effective_delivery_count,
    )


def compare_methods(
    vehicles: Sequence[Mapping[str, Any]],
    event: Mapping[str, Any],
    ai_selector: ReceiverSelector,
    *,
    seed: int = 42,
) -> dict[str, dict[str, float | int | None]]:
    """Run AI and three baselines under identical network randomness."""
    urgency = select_urgency_resources(vehicles, event)
    selections = {
        "ai": list(ai_selector(vehicles, event)),
        "broadcast": select_receivers(vehicles, event, "broadcast"),
        "distance": select_receivers(vehicles, event, "distance"),
    }
    results = {
        method: evaluate_selection(vehicles, event, receivers, seed=seed).to_dict()
        for method, receivers in selections.items()
    }
    results["urgency"] = evaluate_selection(
        vehicles,
        event,
        urgency.receiver_ids,
        seed=seed,
        priority=urgency.priority,
        bandwidth_fraction=urgency.bandwidth_fraction,
    ).to_dict()
    return results

"""Experiment-level V2X metrics shared by comparison and ablation scripts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Sequence

import numpy as np


@dataclass(frozen=True)
class ExperimentMetrics:
    mean_latency_ms: float | None
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    p99_latency_ms: float | None
    timeout_rate: float
    effective_delivery_rate: float
    affected_vehicle_coverage: float
    affected_vehicle_selection_coverage: float
    communication_overhead: float | None
    normalized_channel_cost: float | None
    timely_event_rate: float
    safety_override_rate: float | None
    mean_raw_radius_m: float | None
    mean_executed_radius_m: float | None
    sent_count: int
    delivered_count: int
    effective_delivery_count: int
    affected_vehicle_count: int
    event_count: int

    def to_dict(self) -> dict[str, float | int | None]:
        return asdict(self)


def aggregate_episode_metrics(
    step_infos: Sequence[dict[str, Any]], *, safety_window_ms: float = 100.0
) -> ExperimentMetrics:
    if safety_window_ms <= 0:
        raise ValueError("safety_window_ms must be positive")
    transmissions = [item for info in step_infos for item in info.get("transmissions", [])]
    delivered = [item for item in transmissions if item["delivered"]]
    effective = [
        item
        for item in delivered
        if item.get("critical", False) and float(item["latency_ms"]) <= safety_window_ms
    ]
    critical_by_event: dict[str, set[str]] = {}
    for info in step_infos:
        for event_id, receiver_ids in info.get("critical_receiver_ids_by_event", {}).items():
            critical_by_event.setdefault(str(event_id), set()).update(map(str, receiver_ids))
    delivered_by_event: dict[str, set[str]] = {}
    timely_by_event: dict[str, set[str]] = {}
    selected_by_event: dict[str, set[str]] = {}
    for item in transmissions:
        event_id = str(item.get("event_id", "unknown"))
        selected_by_event.setdefault(event_id, set()).add(str(item["receiver_id"]))
    for item in delivered:
        if not item.get("critical", False):
            continue
        event_id = str(item.get("event_id", "unknown"))
        delivered_by_event.setdefault(event_id, set()).add(str(item["receiver_id"]))
        if float(item["latency_ms"]) <= safety_window_ms:
            timely_by_event.setdefault(event_id, set()).add(str(item["receiver_id"]))
    affected_count = sum(len(receivers) for receivers in critical_by_event.values())
    covered_count = sum(
        len(receivers & delivered_by_event.get(event_id, set()))
        for event_id, receivers in critical_by_event.items()
    )
    selected_covered_count = sum(
        len(receivers & selected_by_event.get(event_id, set()))
        for event_id, receivers in critical_by_event.items()
    )
    eligible_events = [receivers for receivers in critical_by_event.values() if receivers]
    timely_events = sum(
        receivers <= timely_by_event.get(event_id, set())
        for event_id, receivers in critical_by_event.items()
        if receivers
    )
    latencies = np.asarray([float(item["latency_ms"]) for item in delivered], dtype=np.float64)
    sent_count = len(transmissions)
    effective_count = len(effective)
    channel_units = sum(float(item.get("bandwidth_fraction", 1.0)) for item in transmissions)
    audited = [
        info
        for info in step_infos
        if info.get("raw_structured_action") is not None
        and info.get("critical_receiver_ids_by_event")
    ]
    raw_radii = [float(info["raw_radius_m"]) for info in audited]
    executed_radii = [float(info["executed_radius_m"]) for info in audited]
    return ExperimentMetrics(
        mean_latency_ms=float(latencies.mean()) if len(latencies) else None,
        p50_latency_ms=float(np.percentile(latencies, 50)) if len(latencies) else None,
        p95_latency_ms=float(np.percentile(latencies, 95)) if len(latencies) else None,
        p99_latency_ms=float(np.percentile(latencies, 99)) if len(latencies) else None,
        timeout_rate=(sent_count - len(delivered)) / sent_count if sent_count else 0.0,
        effective_delivery_rate=effective_count / sent_count if sent_count else 0.0,
        affected_vehicle_coverage=covered_count / affected_count if affected_count else 0.0,
        affected_vehicle_selection_coverage=(
            selected_covered_count / affected_count if affected_count else 0.0
        ),
        communication_overhead=sent_count / effective_count if effective_count else None,
        normalized_channel_cost=channel_units / effective_count if effective_count else None,
        timely_event_rate=timely_events / len(eligible_events) if eligible_events else 0.0,
        safety_override_rate=(
            sum(bool(info.get("safety_override")) for info in audited) / len(audited)
            if audited
            else None
        ),
        mean_raw_radius_m=float(np.mean(raw_radii)) if raw_radii else None,
        mean_executed_radius_m=(
            float(np.mean(executed_radii)) if executed_radii else None
        ),
        sent_count=sent_count,
        delivered_count=len(delivered),
        effective_delivery_count=effective_count,
        affected_vehicle_count=affected_count,
        event_count=len(eligible_events),
    )

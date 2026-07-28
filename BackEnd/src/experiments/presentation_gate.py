"""Behavioral qualification for a highway presentation champion."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from src.environment.receiver_relevance import event_sender, receiver_relation
from src.experiments.evaluation import make_environment
from src.models.ppo_agent import PPOAgent


def summarize_directional_incidents(
    incident_audits: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, float | int | bool]:
    """Summarize one record per unique scenario/event across repeated seeds."""
    unique_incident_count = len(incident_audits)
    canonical_signatures = {
        next(iter(audit["signatures"])) for audit in incident_audits.values() if audit["signatures"]
    }
    receiver_signature_count = len(canonical_signatures)
    unique_ratio = receiver_signature_count / max(unique_incident_count, 1)
    seed_consistent = all(len(audit["signatures"]) == 1 for audit in incident_audits.values())
    forward_notifications = sum(
        len(audit["forward_vehicle_ids"]) for audit in incident_audits.values()
    )
    follower_audits = [audit for audit in incident_audits.values() if audit["follower_opportunity"]]
    follower_selected = sum(
        bool(audit["follower_selected_on_all_seeds"]) for audit in follower_audits
    )
    follower_opportunities = len(follower_audits)
    nearest_coverage = follower_selected / max(follower_opportunities, 1)
    return {
        "passed": unique_incident_count > 0
        and forward_notifications == 0
        and nearest_coverage >= 1.0
        and seed_consistent
        and unique_ratio >= 0.8,
        "event_count": unique_incident_count,
        "unique_incident_count": unique_incident_count,
        "receiver_signature_count": receiver_signature_count,
        "policy_seed_consistent": seed_consistent,
        "forward_notifications": forward_notifications,
        "nearest_follower_opportunities": follower_opportunities,
        "nearest_follower_coverage": nearest_coverage,
        "receiver_signature_unique_ratio": unique_ratio,
    }


def evaluate_directional_behavior(
    model_path: Path,
    scenario_paths: Sequence[Path],
    config: dict[str, Any],
    *,
    seeds: Sequence[int],
) -> dict[str, float | int | bool]:
    """Audit unique incidents without counting repeated network seeds as new geometry."""
    agent = PPOAgent.load(model_path, device="cpu")
    incident_audits: dict[tuple[str, str], dict[str, Any]] = {}
    for scenario_path in scenario_paths:
        for seed in seeds:
            environment = make_environment(
                scenario_path,
                "highway",
                int(seed),
                config,
                action_mode="directional_corridor",
            )
            try:
                observation, _ = environment.reset(seed=int(seed))
                terminated = truncated = False
                while not (terminated or truncated):
                    snapshot = environment.base_environment.snapshot()
                    action = np.asarray(
                        agent.predict_raw(observation, deterministic=True), dtype=np.int64
                    )
                    observation, _, terminated, truncated, info = environment.step(action)
                    if not snapshot.events:
                        continue
                    selected_by_event: dict[str, set[str]] = {
                        event.event_id: set() for event in snapshot.events
                    }
                    for transmission in info.get("transmissions", []):
                        selected_by_event.setdefault(str(transmission["event_id"]), set()).add(
                            str(transmission["receiver_id"])
                        )
                    for event in snapshot.events:
                        selected = selected_by_event[event.event_id]
                        key = (str(scenario_path.resolve()), event.event_id)
                        audit = incident_audits.setdefault(
                            key,
                            {
                                "signatures": set(),
                                "forward_vehicle_ids": set(),
                                "follower_opportunity": False,
                                "follower_selected_on_all_seeds": True,
                            },
                        )
                        audit["signatures"].add(tuple(sorted(selected)))
                        sender = event_sender(snapshot.vehicles, event)
                        if sender is None:
                            continue
                        following = []
                        for vehicle in snapshot.vehicles:
                            if vehicle.vehicle_id == sender.vehicle_id:
                                continue
                            relation = receiver_relation(sender, vehicle, event)
                            if vehicle.vehicle_id in selected and relation.risk_class in {
                                "ahead",
                                "opposite_direction",
                                "unrelated",
                            }:
                                audit["forward_vehicle_ids"].add(vehicle.vehicle_id)
                            if relation.risk_class == "following_lane":
                                following.append(relation)
                        if following:
                            nearest = min(following, key=lambda relation: relation.longitudinal_m)
                            audit["follower_opportunity"] = True
                            audit["follower_selected_on_all_seeds"] = bool(
                                audit["follower_selected_on_all_seeds"]
                                and nearest.vehicle_id in selected
                            )
            finally:
                environment.close()
    return summarize_directional_incidents(incident_audits)

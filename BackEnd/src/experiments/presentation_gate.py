"""Behavioral qualification for a highway presentation champion."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from src.environment.receiver_relevance import ReceiverRelation, event_sender, receiver_relation
from src.experiments.evaluation import make_environment
from src.models.ppo_agent import PPOAgent


def is_required_nearest_follower(relation: ReceiverRelation, affected_radius_m: float) -> bool:
    """Return whether a same-direction follower belongs to the defined affected set."""
    return relation.risk_class == "following_lane" and relation.longitudinal_m <= affected_radius_m


def summarize_directional_incidents(
    incident_audits: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    """Summarize one record per unique scenario/event across repeated seeds."""
    unique_incident_count = len(incident_audits)
    canonical_signatures = {
        next(iter(audit["signatures"]))
        for audit in incident_audits.values()
        if len(audit["signatures"]) == 1
    }
    canonical_actions = {
        next(iter(audit.get("actions", set())))
        for audit in incident_audits.values()
        if len(audit.get("actions", set())) == 1
    }
    receiver_signature_count = len(canonical_signatures)
    unique_ratio = receiver_signature_count / max(unique_incident_count, 1)
    seed_consistent = all(len(audit["signatures"]) == 1 for audit in incident_audits.values())
    action_seed_consistent = all(
        len(audit.get("actions", set())) == 1 for audit in incident_audits.values()
    )
    forward_notifications = sum(
        len(audit["forward_vehicle_ids"]) for audit in incident_audits.values()
    )
    follower_audits = [audit for audit in incident_audits.values() if audit["follower_opportunity"]]
    follower_selected = sum(
        bool(audit["follower_selected_on_all_seeds"]) for audit in follower_audits
    )
    follower_opportunities = len(follower_audits)
    nearest_coverage = follower_selected / max(follower_opportunities, 1)
    incident_details = []
    for (scenario_path, event_id), audit in sorted(incident_audits.items()):
        signatures = sorted(audit["signatures"])
        actions = sorted(audit.get("actions", set()))
        incident_details.append(
            {
                "scenario": scenario_path,
                "event_id": event_id,
                "severity": audit.get("severity"),
                "affected_radius_m": audit.get("affected_radius_m"),
                "receiver_signatures": [list(signature) for signature in signatures],
                "structured_actions": [list(action) for action in actions],
                "corridor_radii_m": sorted(audit.get("corridor_radii_m", set())),
                "lane_scopes": sorted(audit.get("lane_scopes", set())),
                "priorities": sorted(audit.get("priorities", set())),
                "bandwidth_fractions": sorted(audit.get("bandwidth_fractions", set())),
                "forward_vehicle_ids": sorted(audit["forward_vehicle_ids"]),
                "missed_nearest_follower_ids": sorted(
                    audit.get("missed_nearest_follower_ids", set())
                ),
            }
        )
    context_adaptive_action = len(canonical_actions) >= 2
    return {
        "passed": unique_incident_count > 0
        and forward_notifications == 0
        and nearest_coverage >= 1.0
        and seed_consistent
        and action_seed_consistent
        and unique_ratio >= 0.8,
        "event_count": unique_incident_count,
        "unique_incident_count": unique_incident_count,
        "receiver_signature_count": receiver_signature_count,
        "policy_seed_consistent": seed_consistent,
        "action_seed_consistent": action_seed_consistent,
        "action_signature_count": len(canonical_actions),
        "context_adaptive_action": context_adaptive_action,
        "forward_notifications": forward_notifications,
        "nearest_follower_opportunities": follower_opportunities,
        "nearest_follower_coverage": nearest_coverage,
        "receiver_signature_unique_ratio": unique_ratio,
        "incidents": incident_details,
    }


def evaluate_directional_behavior(
    model_path: Path,
    scenario_paths: Sequence[Path],
    config: dict[str, Any],
    *,
    seeds: Sequence[int],
) -> dict[str, Any]:
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
                                "actions": set(),
                                "corridor_radii_m": set(),
                                "lane_scopes": set(),
                                "priorities": set(),
                                "bandwidth_fractions": set(),
                                "forward_vehicle_ids": set(),
                                "missed_nearest_follower_ids": set(),
                                "follower_opportunity": False,
                                "follower_selected_on_all_seeds": True,
                                "severity": float(event.severity),
                                "affected_radius_m": float(
                                    environment.base_environment.affected_radius_m(event)
                                ),
                            },
                        )
                        audit["signatures"].add(tuple(sorted(selected)))
                        structured_action = tuple(map(int, info["structured_action"]))
                        audit["actions"].add(structured_action)
                        audit["corridor_radii_m"].add(float(info["corridor_radius_m"]))
                        audit["lane_scopes"].add(str(info["corridor_lane_scope"]))
                        audit["priorities"].add(structured_action[2])
                        audit["bandwidth_fractions"].add((structured_action[3] + 1) / 10.0)
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
                            if is_required_nearest_follower(
                                relation, float(audit["affected_radius_m"])
                            ):
                                following.append(relation)
                        if following:
                            nearest = min(following, key=lambda relation: relation.longitudinal_m)
                            audit["follower_opportunity"] = True
                            audit["follower_selected_on_all_seeds"] = bool(
                                audit["follower_selected_on_all_seeds"]
                                and nearest.vehicle_id in selected
                            )
                            if nearest.vehicle_id not in selected:
                                audit["missed_nearest_follower_ids"].add(nearest.vehicle_id)
            finally:
                environment.close()
    return summarize_directional_incidents(incident_audits)

"""Behavioral qualification for a highway presentation champion."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from src.environment.receiver_relevance import event_sender, receiver_relation
from src.experiments.evaluation import make_environment
from src.models.ppo_agent import PPOAgent


def evaluate_directional_behavior(
    model_path: Path,
    scenario_paths: Sequence[Path],
    config: dict[str, Any],
    *,
    seeds: Sequence[int],
) -> dict[str, float | int | bool]:
    """Reject forward notifications, missed nearest followers, and invariant receiver sets."""
    agent = PPOAgent.load(model_path, device="cpu")
    forward_notifications = 0
    follower_opportunities = 0
    follower_selected = 0
    event_signatures: list[tuple[str, ...]] = []
    event_count = 0
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
                    action = np.asarray(agent.predict_raw(observation, deterministic=True), dtype=np.int64)
                    observation, _, terminated, truncated, info = environment.step(action)
                    if not snapshot.events:
                        continue
                    selected = set(info["selected_receiver_ids"])
                    event_count += len(snapshot.events)
                    event_signatures.append(tuple(sorted(selected)))
                    for event in snapshot.events:
                        sender = event_sender(snapshot.vehicles, event)
                        if sender is None:
                            continue
                        following = []
                        for vehicle in snapshot.vehicles:
                            if vehicle.vehicle_id == sender.vehicle_id:
                                continue
                            relation = receiver_relation(sender, vehicle, event)
                            if vehicle.vehicle_id in selected and relation.risk_class in {
                                "ahead", "opposite_direction", "unrelated"
                            }:
                                forward_notifications += 1
                            if relation.risk_class == "following_lane":
                                following.append(relation)
                        if following:
                            nearest = min(following, key=lambda relation: relation.longitudinal_m)
                            follower_opportunities += 1
                            follower_selected += int(nearest.vehicle_id in selected)
            finally:
                environment.close()
    unique_ratio = len(set(event_signatures)) / max(len(event_signatures), 1)
    nearest_coverage = follower_selected / max(follower_opportunities, 1)
    return {
        "passed": event_count > 0
        and forward_notifications == 0
        and nearest_coverage >= 1.0
        and unique_ratio >= 0.8,
        "event_count": event_count,
        "forward_notifications": forward_notifications,
        "nearest_follower_opportunities": follower_opportunities,
        "nearest_follower_coverage": nearest_coverage,
        "receiver_signature_unique_ratio": unique_ratio,
    }

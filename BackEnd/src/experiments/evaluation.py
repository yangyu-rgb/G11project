"""Shared fixed-test-set execution for comparison, ablation, and generalization."""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Literal

import numpy as np

from src.environment.adaptive_radius_wrapper import maybe_wrap_adaptive_radius
from src.environment.v2x_env import V2XEnv
from src.evaluation.baselines import (
    build_baseline_action,
    build_fixed_directional_corridor_action,
)
from src.experiments.metrics import aggregate_episode_metrics
from src.models.ppo_agent import PPOAgent

Method = Literal[
    "ai",
    "broadcast",
    "distance",
    "urgency",
    "fixed_directional_corridor",
]
ActionProvider = Callable[[V2XEnv, dict[str, np.ndarray]], np.ndarray]

RESULT_FIELDS = [
    "case_id",
    "domain",
    "scenario_id",
    "seed",
    "event_severity",
    "severity_group",
    "method",
    "mean_latency_ms",
    "p50_latency_ms",
    "p95_latency_ms",
    "p99_latency_ms",
    "timeout_rate",
    "effective_delivery_rate",
    "affected_vehicle_coverage",
    "affected_vehicle_selection_coverage",
    "communication_overhead",
    "normalized_channel_cost",
    "timely_event_rate",
    "safety_override_rate",
    "mean_raw_radius_m",
    "mean_executed_radius_m",
    "sent_count",
    "delivered_count",
    "effective_delivery_count",
    "affected_vehicle_count",
    "event_count",
]


def make_environment(
    scenario_directory: Path,
    domain: str,
    seed: int,
    config: dict[str, Any],
    *,
    action_mode: str = "individual",
) -> Any:
    """Create the unified 100-vehicle/3-event evaluation environment."""
    environment = config.get("environment", {})
    network = config.get("network", {})
    action = config.get("action", {})
    network_options = {
        key: float(value)
        for key, value in network.items()
        if key not in {"highway_mode", "urban_mode"}
    }
    base_environment = V2XEnv(
        scenario_directory,
        episode_steps=int(environment.get("episode_steps", 10)),
        max_vehicles=int(environment.get("max_vehicles", 100)),
        max_events=int(environment.get("max_events", 3)),
        critical_radius_m=float(environment.get("critical_radius_m", 300)),
        severity_aware_critical_radius=bool(
            environment.get("severity_aware_critical_radius", False)
        ),
        low_severity_radius_m=float(environment.get("low_severity_radius_m", 225)),
        medium_severity_radius_m=float(environment.get("medium_severity_radius_m", 300)),
        high_severity_radius_m=float(environment.get("high_severity_radius_m", 375)),
        road_length_m=float(environment.get("road_length_m", 5000)),
        lateral_extent_m=float(
            environment.get("lateral_extent_m", 500 if domain == "urban" else 10)
        ),
        delay_normalization_ms=float(environment.get("delay_normalization_ms", 100)),
        feature_mode=str(environment.get("feature_mode", "basic")),
        history_window=int(environment.get("history_window", 5)),
        ttc_max_seconds=float(environment.get("ttc_max_seconds", 30)),
        receiver_relevance_mode=(
            "directional_corridor" if action.get("mode") == "directional_corridor" else "radial"
        ),
        reward_mode="full",
        reward_weights=config.get("reward_weights"),
        safety_window_ms=float(config.get("safety_window_ms", 100)),
        network_mode=str(network.get(f"{domain}_mode", "simple")),
        network_scenario=domain,
        network_options=network_options,
        seed=seed,
    )
    return maybe_wrap_adaptive_radius(
        base_environment,
        action_mode=action_mode,
        receiver_radii_m=action.get("receiver_radii_m", (150, 225, 300, 375, 5000)),
        corridor_radii_m=action.get("corridor_radii_m", (75, 150, 225, 300, 375)),
        safety_options=action.get("safety"),
    )


def model_action_provider(model_path: Path, environment: V2XEnv) -> ActionProvider:
    agent = PPOAgent.load(model_path, environment)
    return lambda _environment, observation: np.asarray(
        agent.predict_raw(observation, deterministic=True), dtype=np.int64
    )


def baseline_action_provider(
    method: str,
    *,
    fixed_directional_radius_m: float = 300.0,
    fixed_directional_bandwidth_fraction: float = 0.5,
) -> ActionProvider:
    if method == "fixed_directional_corridor":
        return lambda environment, _observation: build_fixed_directional_corridor_action(
            environment,
            environment.snapshot(),
            radius_m=fixed_directional_radius_m,
            bandwidth_fraction=fixed_directional_bandwidth_fraction,
        )[0]
    if method not in {"broadcast", "distance", "urgency"}:
        raise ValueError(f"unsupported baseline: {method}")
    return lambda environment, _observation: build_baseline_action(
        environment,
        environment.snapshot(),
        method,  # type: ignore[arg-type]
    )[0]


def evaluate_episode(
    environment: V2XEnv,
    action_provider: ActionProvider,
    *,
    reset_seed: int,
    safety_window_ms: float = 100.0,
) -> dict[str, float | int | None]:
    observation, _ = environment.reset(seed=reset_seed)
    infos: list[dict[str, Any]] = []
    terminated = truncated = False
    while not (terminated or truncated):
        action = action_provider(environment, observation)
        observation, _, terminated, truncated, info = environment.step(action)
        infos.append(info)
    return aggregate_episode_metrics(infos, safety_window_ms=safety_window_ms).to_dict()


def write_detailed_csv(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=RESULT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

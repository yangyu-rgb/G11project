"""Shared fixed-test-set execution for comparison, ablation, and generalization."""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Literal

import numpy as np

from app.comparison import build_baseline_action
from src.environment.v2x_env import V2XEnv
from src.experiments.metrics import aggregate_episode_metrics
from src.models.ppo_agent import PPOAgent

Method = Literal["ai", "broadcast", "distance", "urgency"]
ActionProvider = Callable[[V2XEnv, dict[str, np.ndarray]], np.ndarray]

RESULT_FIELDS = [
    "case_id",
    "domain",
    "scenario_id",
    "seed",
    "method",
    "mean_latency_ms",
    "p50_latency_ms",
    "p95_latency_ms",
    "p99_latency_ms",
    "timeout_rate",
    "effective_delivery_rate",
    "affected_vehicle_coverage",
    "communication_overhead",
    "timely_event_rate",
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
) -> V2XEnv:
    """Create the unified 100-vehicle/3-event evaluation environment."""
    environment = config.get("environment", {})
    network = config.get("network", {})
    network_options = {
        key: float(value)
        for key, value in network.items()
        if key not in {"highway_mode", "urban_mode"}
    }
    return V2XEnv(
        scenario_directory,
        episode_steps=int(environment.get("episode_steps", 10)),
        max_vehicles=int(environment.get("max_vehicles", 100)),
        max_events=int(environment.get("max_events", 3)),
        critical_radius_m=float(environment.get("critical_radius_m", 300)),
        road_length_m=float(environment.get("road_length_m", 5000)),
        lateral_extent_m=float(
            environment.get("lateral_extent_m", 500 if domain == "urban" else 10)
        ),
        delay_normalization_ms=float(environment.get("delay_normalization_ms", 100)),
        reward_mode="full",
        reward_weights=config.get("reward_weights"),
        safety_window_ms=float(config.get("safety_window_ms", 100)),
        network_mode=str(network.get(f"{domain}_mode", "simple")),
        network_scenario=domain,
        network_options=network_options,
        seed=seed,
    )


def model_action_provider(model_path: Path, environment: V2XEnv) -> ActionProvider:
    agent = PPOAgent.load(model_path, environment)
    return lambda _environment, observation: np.asarray(
        agent.predict_raw(observation, deterministic=True), dtype=np.int64
    )


def baseline_action_provider(method: str) -> ActionProvider:
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

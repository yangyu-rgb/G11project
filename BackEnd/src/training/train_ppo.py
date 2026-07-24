"""Train the M1 PPO scheduler on an offline SUMO scenario."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.evaluation import evaluate_policy
from stable_baselines3.common.monitor import Monitor

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.generate_highway_scenario import generate_highway_scenario  # noqa: E402
from scripts.generate_urban_scenario import generate_urban_scenario  # noqa: E402
from src.environment.v2x_env import V2XEnv  # noqa: E402
from src.models.ppo_agent import PPOAgent  # noqa: E402


class EpisodeRewardTracker(BaseCallback):
    """Collect Monitor episode rewards and stop after the requested count."""

    def __init__(self, target_episodes: int) -> None:
        super().__init__()
        self.target_episodes = target_episodes
        self.episode_rewards: list[float] = []

    def _on_step(self) -> bool:
        for info in self.locals.get("infos", []):
            if "episode" in info:
                self.episode_rewards.append(float(info["episode"]["r"]))
        return len(self.episode_rewards) < self.target_episodes


def _backend_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()


def load_training_config(path: str | Path) -> dict[str, Any]:
    config_path = _backend_path(path)
    try:
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ValueError(f"unable to read training config: {config_path}") from exc
    if not isinstance(config, dict):
        raise ValueError("training configuration must be a mapping")
    return config


def _ensure_scenario(config: dict[str, Any]) -> Path:
    scenario = config["scenario"]
    scenario_directory = _backend_path(scenario["directory"])
    required = (scenario_directory / "trajectory.xml", scenario_directory / "events.json")
    if all(path.is_file() for path in required):
        return scenario_directory
    if not scenario.get("generate_if_missing", False):
        raise ValueError(f"scenario data is missing: {scenario_directory}")
    generators = {
        "highway": generate_highway_scenario,
        "urban": generate_urban_scenario,
    }
    scenario_type = str(scenario.get("type", "highway"))
    try:
        generator = generators[scenario_type]
    except KeyError as exc:
        raise ValueError(f"unsupported scenario type: {scenario_type}") from exc
    generator(
        scenario_directory,
        config_path=_backend_path(scenario["config"]),
        seed_override=int(config.get("seed", 42)),
    )
    return scenario_directory


def _make_environment(config: dict[str, Any], scenario_directory: Path) -> Monitor:
    environment = config["environment"]
    network = config.get("network", {})
    network_options = {
        key: float(value) for key, value in network.items() if key not in {"mode", "scenario"}
    }
    return Monitor(
        V2XEnv(
            scenario_directory,
            episode_steps=int(environment["episode_steps"]),
            max_vehicles=int(environment["max_vehicles"]),
            max_events=int(environment["max_events"]),
            critical_radius_m=float(environment["critical_radius_m"]),
            road_length_m=float(environment.get("road_length_m", 5000)),
            lateral_extent_m=float(environment.get("lateral_extent_m", 10)),
            delay_normalization_ms=float(environment["delay_normalization_ms"]),
            feature_mode=str(environment.get("feature_mode", "basic")),
            history_window=int(environment.get("history_window", 5)),
            ttc_max_seconds=float(environment.get("ttc_max_seconds", 30)),
            reward_mode=str(environment.get("reward_mode", "simple")),
            reward_weights=config.get("reward", {}).get("weights"),
            safety_window_ms=float(config.get("evaluation", {}).get("safety_window_ms", 100)),
            network_mode=str(network.get("mode", "simple")),
            network_scenario=str(network.get("scenario", "highway")),
            network_options=network_options,
            seed=int(config.get("seed", 42)),
        )
    )


def create_agent(config: dict[str, Any], environment: Monitor) -> PPOAgent:
    """Create the configured agent while keeping batch and single-run training aligned."""
    ppo = config["ppo"]
    output = config.get("tensorboard_log")
    return PPOAgent(
        environment,
        learning_rate=float(ppo["learning_rate"]),
        clip_epsilon=float(ppo["clip_epsilon"]),
        entropy_coef=float(ppo["entropy_coef"]),
        batch_size=int(ppo["batch_size"]),
        n_epochs=int(ppo["n_epochs"]),
        n_steps=int(ppo["n_steps"]),
        gamma=float(ppo["gamma"]),
        seed=int(config.get("seed", 42)),
        tensorboard_log=output,
        device=str(ppo.get("device", "auto")),
        verbose=int(ppo.get("verbose", 1)),
        feature_extractor=str(ppo.get("feature_extractor", "transformer")),
    )


def train(config: dict[str, Any], episodes: int, output: str | Path) -> dict[str, Any]:
    if episodes <= 0:
        raise ValueError("episodes must be positive")
    output_directory = _backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    tensorboard_directory = output_directory / "tensorboard"
    scenario_directory = _ensure_scenario(config)
    environment = _make_environment(config, scenario_directory)
    ppo = config["ppo"]
    config = {**config, "tensorboard_log": tensorboard_directory}
    agent = create_agent(config, environment)
    evaluation_episodes = int(config.get("evaluation_episodes", 5))
    initial_mean, _ = evaluate_policy(
        agent.model, environment, n_eval_episodes=evaluation_episodes, deterministic=True
    )
    best_model_path = agent.save(output_directory / "model")

    tracker = EpisodeRewardTracker(episodes)
    episode_steps = int(config["environment"]["episode_steps"])
    rollout_steps = int(ppo["n_steps"])
    total_timesteps = max(episodes * episode_steps, rollout_steps) + rollout_steps
    agent.train(total_timesteps, tracker)
    last_model_path = agent.save(output_directory / "last_model")
    trained_mean, _ = evaluate_policy(
        agent.model, environment, n_eval_episodes=evaluation_episodes, deterministic=True
    )
    if trained_mean >= initial_mean:
        best_model_path = agent.save(output_directory / "model")

    summary = {
        "episodes_requested": episodes,
        "episodes_completed": len(tracker.episode_rewards),
        "episode_rewards": tracker.episode_rewards,
        "initial_evaluation_mean": float(initial_mean),
        "trained_evaluation_mean": float(trained_mean),
        "selected_checkpoint": "trained" if trained_mean >= initial_mean else "initial",
        "non_degrading_checkpoint": True,
        "model": str(best_model_path),
        "last_model": str(last_model_path),
        "tensorboard": str(tensorboard_directory),
    }
    (output_directory / "training_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    environment.close()
    return summary


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Training YAML under BackEnd")
    parser.add_argument("--episodes", required=True, type=int)
    parser.add_argument("--output", required=True, help="Output directory under BackEnd")
    return parser.parse_args()


def main() -> int:
    arguments = _parse_arguments()
    try:
        summary = train(
            load_training_config(arguments.config), arguments.episodes, arguments.output
        )
    except (KeyError, OSError, ValueError) as exc:
        print(f"PPO training failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

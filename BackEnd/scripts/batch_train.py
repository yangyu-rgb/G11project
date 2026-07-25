"""Run resumable M2 PPO training over a deterministic scenario matrix."""

from __future__ import annotations

import argparse
import copy
import csv
import json
import os
import shutil
import sys
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from stable_baselines3.common.evaluation import evaluate_policy

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.experiments.io import (  # noqa: E402
    atomic_write_json,
    backend_path,
    git_metadata,
    load_yaml,
    sha256_file,
)
from src.experiments.scenario_matrix import (  # noqa: E402
    ScenarioDefinition,
    build_scenario_matrix,
    materialize_scenario,
)
from src.models.ppo_agent import PPOAgent  # noqa: E402
from src.training.train_ppo import (  # noqa: E402
    EpisodeRewardTracker,
    _make_environment,
    create_agent,
)

TrainRunner = Callable[[dict[str, Any], Path, Path, bool], dict[str, Any]]


def select_reward_profile(config: dict[str, Any], output: str | Path, *, resume: bool) -> str:
    """Select reward weights on pilot training plus the independent validation split."""
    output_directory = backend_path(output)
    selection_path = output_directory / "reward_profile_selection.json"
    if resume and selection_path.is_file():
        return str(json.loads(selection_path.read_text(encoding="utf-8"))["selected_profile"])
    selection = config["reward_profile_selection"]
    scores: dict[str, float] = {}
    for name in config["reward_profiles"]:
        pilot = copy.deepcopy(config)
        pilot["run_mode"] = "reward_profile_pilot"
        pilot["reward_profile"] = name
        pilot["dataset"]["train_configs"] = int(selection["train_configs"])
        pilot["training_seeds"] = list(pilot["training_seeds"][: int(selection["seed_count"])])
        pilot["training"]["episodes_per_config"] = int(selection["episodes_per_config"])
        pilot["champion_selection"]["shortlist_size"] = int(selection["shortlist_size"])
        pilot_summary = run_batch(
            pilot,
            output_directory / "reward_profile_pilot" / name,
            resume=resume,
            retry_failed=resume,
        )
        if pilot_summary["failed_runs"] or not pilot_summary["champion"]:
            raise RuntimeError(f"reward profile pilot failed: {name}")
        details = json.loads(
            (
                output_directory / "reward_profile_pilot" / name / "champion" / "selection.json"
            ).read_text(encoding="utf-8")
        )
        scores[name] = float(details["validation_mean"])
    selected = max(scores, key=scores.get)
    atomic_write_json(
        selection_path,
        {
            "selected_profile": selected,
            "validation_scores": scores,
            "selection_split": "validation",
        },
    )
    return selected


def _write_training_rows(
    path: Path, start_episode: int, rewards: list[float], value: float
) -> None:
    new_file = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["episode", "reward", "validation_mean"])
        if new_file:
            writer.writeheader()
        for offset, reward in enumerate(rewards, start=1):
            writer.writerow(
                {
                    "episode": start_episode + offset,
                    "reward": f"{reward:.8f}",
                    "validation_mean": f"{value:.8f}" if offset == len(rewards) else "",
                }
            )


def train_one_run(
    config: dict[str, Any], scenario_directory: Path, run_directory: Path, resume: bool
) -> dict[str, Any]:
    """Train one model in validation-sized chunks and persist every safe boundary."""
    run_directory.mkdir(parents=True, exist_ok=True)
    progress_path = run_directory / "progress.json"
    latest_path = run_directory / "checkpoint_latest.zip"
    best_path = run_directory / "model_best.zip"
    log_path = run_directory / "training_log.csv"
    progress = (
        json.loads(progress_path.read_text(encoding="utf-8"))
        if resume and progress_path.is_file()
        else {}
    )
    completed = int(progress.get("episodes_completed", 0))
    raw_best_validation = progress.get("best_validation_mean", "-inf")
    best_validation = (
        float(raw_best_validation) if raw_best_validation is not None else float("-inf")
    )
    stale_episodes = int(progress.get("stale_episodes", 0))
    training = config["batch"]
    episode_budget = int(training["episodes_per_config"])
    validation_interval = int(training["validation_interval_episodes"])
    patience = int(training["early_stopping_patience_episodes"])
    evaluation_episodes = int(training.get("evaluation_episodes", 3))
    environment = _make_environment(config, scenario_directory)
    validation_environment = _make_environment(
        {**config, "seed": int(config["seed"]) + 1_000_000}, scenario_directory
    )
    if resume and latest_path.is_file():
        agent = PPOAgent.load(
            latest_path, environment, device=str(config["ppo"].get("device", "auto"))
        )
    else:
        agent = create_agent(
            {**config, "tensorboard_log": run_directory / "tensorboard"}, environment
        )
    try:
        paused = False
        while completed < episode_budget and stale_episodes < patience:
            deadline = config.get("runtime", {}).get("deadline_monotonic")
            reserve_seconds = float(config.get("runtime", {}).get("reserve_seconds", 1800))
            if deadline is not None and time.monotonic() >= float(deadline) - reserve_seconds:
                paused = True
                break
            requested = min(validation_interval, episode_budget - completed)
            tracker = EpisodeRewardTracker(requested)
            episode_steps = int(config["environment"]["episode_steps"])
            rollout_steps = int(config["ppo"]["n_steps"])
            timesteps = max(requested * episode_steps, rollout_steps) + rollout_steps
            agent.train(timesteps, tracker, reset_num_timesteps=completed == 0)
            if not tracker.episode_rewards:
                raise RuntimeError("training chunk completed without an episode")
            previous_completed = completed
            completed += len(tracker.episode_rewards)
            validation_mean, _ = evaluate_policy(
                agent.model,
                validation_environment,
                n_eval_episodes=evaluation_episodes,
                deterministic=True,
            )
            _write_training_rows(
                log_path,
                previous_completed,
                tracker.episode_rewards,
                float(validation_mean),
            )
            agent.save(latest_path.with_suffix(""))
            if validation_mean > best_validation:
                best_validation = float(validation_mean)
                stale_episodes = 0
                agent.save(best_path.with_suffix(""))
            else:
                stale_episodes += len(tracker.episode_rewards)
            atomic_write_json(
                progress_path,
                {
                    "status": "running",
                    "episodes_completed": completed,
                    "best_validation_mean": best_validation,
                    "stale_episodes": stale_episodes,
                },
            )
        if paused:
            summary = {
                "status": "paused",
                "episodes_requested": episode_budget,
                "episodes_completed": completed,
                "best_validation_mean": (
                    best_validation if best_validation != float("-inf") else None
                ),
                "stale_episodes": stale_episodes,
            }
            atomic_write_json(progress_path, summary)
            return summary
        rewards = []
        if log_path.is_file():
            with log_path.open(encoding="utf-8") as stream:
                rewards = [float(row["reward"]) for row in csv.DictReader(stream)]
        summary = {
            "status": "completed",
            "episodes_requested": episode_budget,
            "episodes_completed": completed,
            "early_stopped": completed < episode_budget,
            "best_validation_mean": best_validation,
            "mean_final_reward": float(np.mean(rewards[-20:])) if rewards else None,
            "model": "model_best.zip",
            "training_log": "training_log.csv",
        }
        atomic_write_json(progress_path, summary)
        if latest_path.exists():
            latest_path.unlink()
        if config.get("storage", {}).get("compact_completed_models", False):
            compact_path = best_path.with_name("model_best_compact")
            compact_agent = PPOAgent.load(best_path, environment, device="cpu")
            compact_zip = compact_agent.save_inference(compact_path)
            os.replace(compact_zip, best_path)
        return summary
    finally:
        environment.close()
        validation_environment.close()


def _resolved_training_config(
    batch_config: dict[str, Any], scenario: ScenarioDefinition, scenario_path: Path, seed: int
) -> dict[str, Any]:
    config = copy.deepcopy(load_yaml(batch_config["base_training_config"]))
    config["seed"] = seed
    config["scenario"] = {
        "type": scenario.domain,
        "directory": str(scenario_path),
        "generate_if_missing": False,
    }
    config["environment"].update(
        {
            "max_vehicles": 100,
            "max_events": 3,
            "reward_mode": "full",
        }
    )
    config["network"]["scenario"] = scenario.domain
    if scenario.domain == "urban":
        config["network"]["mode"] = "3gpp"
    config["reward"] = {"weights": batch_config["reward_profiles"][batch_config["reward_profile"]]}
    config["ppo"]["feature_extractor"] = batch_config.get(
        "ppo_feature_extractor", config["ppo"].get("feature_extractor", "transformer")
    )
    config["environment"].update(batch_config.get("environment_overrides", {}))
    config["ppo"].update(batch_config.get("ppo_overrides", {}))
    config["evaluation"] = {"safety_window_ms": batch_config["safety_window_ms"]}
    config["batch"] = batch_config["training"]
    return config


def _select_on_independent_validation(
    candidates: list[dict[str, Any]],
    config: dict[str, Any],
    definitions: list[ScenarioDefinition],
    output_directory: Path,
) -> dict[str, Any]:
    """Select a champion without consulting the locked test split."""
    selection = config.get("champion_selection", {})
    shortlist_size = int(selection.get("shortlist_size", 10))
    shortlist = sorted(
        candidates,
        key=lambda item: float(item.get("best_validation_mean", "-inf")),
        reverse=True,
    )[:shortlist_size]
    validation_definitions = [item for item in definitions if item.split == "validation"]
    scores: dict[str, float] = {}
    for candidate in shortlist:
        values: list[float] = []
        for index, scenario in enumerate(validation_definitions):
            validation_seed = 20_000 + index
            scenario_path = materialize_scenario(
                scenario,
                output_directory / "validation" / scenario.scenario_id,
                seed=validation_seed,
            )
            resolved = _resolved_training_config(config, scenario, scenario_path, validation_seed)
            environment = _make_environment(resolved, scenario_path)
            try:
                agent = PPOAgent.load(candidate["model_path"], environment)
                mean_reward, _ = evaluate_policy(
                    agent.model,
                    environment,
                    n_eval_episodes=int(selection.get("evaluation_episodes", 1)),
                    deterministic=True,
                )
                values.append(float(mean_reward))
            finally:
                environment.close()
        scores[str(candidate["model_path"])] = float(np.mean(values))
    champion = max(shortlist, key=lambda item: scores[str(item["model_path"])])
    champion["independent_validation_mean"] = scores[str(champion["model_path"])]
    atomic_write_json(output_directory / "validation_scores.json", scores)
    return champion


def run_batch(
    config: dict[str, Any],
    output: str | Path,
    *,
    resume: bool = False,
    retry_failed: bool = False,
    shard_index: int = 0,
    shard_count: int = 1,
    work_output: str | Path | None = None,
    time_budget_minutes: float | None = None,
    retain_per_config_best: bool = False,
    train_runner: TrainRunner = train_one_run,
) -> dict[str, Any]:
    domain = str(config["domain"])
    base_scenario = load_yaml(config["base_scenario_config"])
    dataset = config["dataset"]
    matrix = build_scenario_matrix(
        domain,  # type: ignore[arg-type]
        base_scenario,
        train_count=int(dataset["train_configs"]),
        validation_count=int(dataset["validation_configs"]),
        test_count=int(dataset["test_configs"]),
    )
    output_directory = backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    work_directory = backend_path(work_output) if work_output is not None else output_directory
    work_directory.mkdir(parents=True, exist_ok=True)
    deadline = (
        time.monotonic() + float(time_budget_minutes) * 60
        if time_budget_minutes is not None
        else None
    )
    atomic_write_json(
        output_directory / "dataset_manifest.json",
        [
            {
                "scenario_id": item.scenario_id,
                "domain": item.domain,
                "split": item.split,
                "parameters": item.parameters,
            }
            for item in matrix
        ],
    )
    train_definitions = [item for item in matrix if item.split == "train"]
    seeds = [int(value) for value in config["training_seeds"]]
    jobs = [(scenario, seed) for scenario in train_definitions for seed in seeds]
    jobs = [job for index, job in enumerate(jobs) if index % shard_count == shard_index]
    paused = False
    for scenario, seed in jobs:
        persistent_run_directory = output_directory / scenario.scenario_id / f"seed_{seed}"
        status_path = persistent_run_directory / "status.json"
        if resume and status_path.is_file():
            previous = json.loads(status_path.read_text(encoding="utf-8"))
            if previous.get("status") == "completed":
                continue
            if previous.get("status") == "failed" and not retry_failed:
                continue
        if deadline is not None and time.monotonic() >= deadline - 1800:
            paused = True
            break
        run_directory = work_directory / scenario.scenario_id / f"seed_{seed}"
        if work_directory != output_directory:
            if run_directory.exists():
                shutil.rmtree(run_directory)
            if persistent_run_directory.exists():
                shutil.copytree(persistent_run_directory, run_directory)
        try:
            scenario_path = materialize_scenario(scenario, run_directory / "scenario", seed=seed)
            training_config = _resolved_training_config(config, scenario, scenario_path, seed)
            training_config["runtime"] = {
                "deadline_monotonic": deadline,
                "reserve_seconds": 1800,
            }
            training_config["storage"] = {
                "compact_completed_models": work_directory != output_directory,
            }
            config_path = run_directory / "resolved_training.yaml"
            config_path.write_text(
                yaml.safe_dump(training_config, sort_keys=False), encoding="utf-8"
            )
            result = train_runner(training_config, scenario_path, run_directory, resume)
            status = {
                **result,
                "scenario_id": scenario.scenario_id,
                "seed": seed,
                "config_sha256": sha256_file(config_path),
                "model_path": str(run_directory / "model_best.zip"),
            }
            atomic_write_json(run_directory / "status.json", status)
            if work_directory != output_directory:
                _replace_directory(run_directory, persistent_run_directory)
                status["model_path"] = str(persistent_run_directory / "model_best.zip")
                atomic_write_json(status_path, status)
                shutil.rmtree(run_directory, ignore_errors=True)
            if result.get("status") == "paused":
                paused = True
                break
        except Exception as exc:  # noqa: BLE001 - one failed run must not stop the batch
            status = {
                "status": "failed",
                "scenario_id": scenario.scenario_id,
                "seed": seed,
                "error": f"{type(exc).__name__}: {exc}",
            }
            atomic_write_json(status_path, status)
            if work_directory != output_directory:
                shutil.rmtree(run_directory, ignore_errors=True)
        _write_partial_summary(config, output_directory, jobs, paused=False)
    if retain_per_config_best:
        _retain_best_seed_per_config(output_directory, train_definitions, seeds)
    completed_runs, failed_runs = _collect_run_statuses(output_directory, jobs)
    convergence_threshold = float(config["success"]["reward_threshold"])
    converged = sum(
        float(item.get("mean_final_reward") or float("-inf")) > convergence_threshold
        for item in completed_runs
    )
    champion = None
    candidates = [
        item
        for item in completed_runs
        if item.get("model_path") and Path(str(item["model_path"])).is_file()
    ]
    if candidates and len(completed_runs) == len(jobs):
        if config.get("champion_selection", {}).get("enabled", False):
            champion = _select_on_independent_validation(
                candidates, config, matrix, output_directory
            )
        else:
            champion = max(
                candidates,
                key=lambda item: float(item.get("best_validation_mean", "-inf")),
            )
        champion_directory = output_directory / "champion"
        champion_directory.mkdir(exist_ok=True)
        shutil.copy2(champion["model_path"], champion_directory / "model_best.zip")
        atomic_write_json(
            champion_directory / "selection.json",
            {
                "selection_split": "validation",
                "scenario_id": champion["scenario_id"],
                "seed": champion["seed"],
                "validation_mean": champion.get(
                    "independent_validation_mean", champion.get("best_validation_mean")
                ),
            },
        )
    summary = {
        "run_mode": config.get("run_mode", "formal"),
        "domain": domain,
        "expected_runs": len(jobs),
        "completed_runs": len(completed_runs),
        "failed_runs": failed_runs,
        "paused": paused,
        "converged_runs": converged,
        "convergence_rate": converged / len(completed_runs) if completed_runs else 0.0,
        "champion": (
            {
                "model": "champion/model_best.zip",
                "scenario_id": champion["scenario_id"],
                "seed": champion["seed"],
            }
            if champion
            else None
        ),
        "git": git_metadata(),
    }
    atomic_write_json(output_directory / "summary.json", summary)
    return summary


def _replace_directory(source: Path, destination: Path) -> None:
    """Replace one persisted run only after its complete local copy is available."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp-{uuid.uuid4().hex}")
    shutil.copytree(source, temporary)
    if destination.exists():
        shutil.rmtree(destination)
    os.replace(temporary, destination)


def _collect_run_statuses(
    output_directory: Path, jobs: list[tuple[ScenarioDefinition, int]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for scenario, seed in jobs:
        path = output_directory / scenario.scenario_id / f"seed_{seed}" / "status.json"
        if not path.is_file():
            continue
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("status") == "completed":
            completed.append(value)
        elif value.get("status") == "failed":
            failed.append(value)
    return completed, failed


def _write_partial_summary(
    config: dict[str, Any],
    output_directory: Path,
    jobs: list[tuple[ScenarioDefinition, int]],
    *,
    paused: bool,
) -> None:
    completed, failed = _collect_run_statuses(output_directory, jobs)
    atomic_write_json(
        output_directory / "summary.json",
        {
            "run_mode": config.get("run_mode", "formal"),
            "domain": config["domain"],
            "expected_runs": len(jobs),
            "completed_runs": len(completed),
            "failed_runs": failed,
            "paused": paused,
            "git": git_metadata(),
        },
    )


def _retain_best_seed_per_config(
    output_directory: Path,
    definitions: list[ScenarioDefinition],
    seeds: list[int],
) -> None:
    for scenario in definitions:
        statuses = []
        for seed in seeds:
            status_path = output_directory / scenario.scenario_id / f"seed_{seed}" / "status.json"
            if status_path.is_file():
                status = json.loads(status_path.read_text(encoding="utf-8"))
                if status.get("status") == "completed":
                    statuses.append((status_path, status))
        if len(statuses) != len(seeds):
            continue
        selected_path, _ = max(
            statuses,
            key=lambda item: float(item[1].get("best_validation_mean", float("-inf"))),
        )
        for status_path, status in statuses:
            retained = status_path == selected_path
            model_path = status_path.parent / "model_best.zip"
            if not retained and model_path.exists():
                model_path.unlink()
            status["model_retained"] = retained
            status["model_path"] = str(model_path) if retained else None
            atomic_write_json(status_path, status)


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    parser.add_argument(
        "--work-output",
        help="optional fast local scratch directory; --output remains the persistent store",
    )
    parser.add_argument(
        "--time-budget-minutes",
        type=float,
        help="pause safely before this invocation exceeds its runtime budget",
    )
    parser.add_argument(
        "--retain-per-config-best",
        action="store_true",
        help="after all seeds finish, retain only the best model for each configuration",
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="run a 2-config x 2-seed, 2-episode capability check",
    )
    return parser.parse_args()


def main() -> int:
    arguments = _parse_arguments()
    if arguments.shard_count <= 0 or not 0 <= arguments.shard_index < arguments.shard_count:
        print("invalid shard selection", file=sys.stderr)
        return 2
    config = load_yaml(arguments.config)
    if arguments.smoke:
        config = copy.deepcopy(config)
        config["run_mode"] = "smoke"
        config["dataset"] = {"train_configs": 2, "validation_configs": 1, "test_configs": 1}
        config["training_seeds"] = list(config["training_seeds"][:2])
        config["training"].update(
            {
                "episodes_per_config": 2,
                "validation_interval_episodes": 1,
                "early_stopping_patience_episodes": 2,
                "evaluation_episodes": 1,
            }
        )
        config["champion_selection"]["shortlist_size"] = 2
        if config.get("reward_profile") == "auto":
            config["reward_profile"] = "balanced"
    elif config.get("reward_profile") == "auto":
        config["reward_profile"] = select_reward_profile(
            config, arguments.output, resume=arguments.resume
        )
    summary = run_batch(
        config,
        arguments.output,
        resume=arguments.resume,
        retry_failed=arguments.retry_failed,
        shard_index=arguments.shard_index,
        shard_count=arguments.shard_count,
        work_output=arguments.work_output,
        time_budget_minutes=arguments.time_budget_minutes,
        retain_per_config_best=arguments.retain_per_config_best,
    )
    print(json.dumps(summary, indent=2))
    if summary["failed_runs"]:
        return 1
    return 75 if summary.get("paused") else 0


if __name__ == "__main__":
    raise SystemExit(main())

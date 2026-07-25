"""Train and evaluate clean Transformer-only or handcrafted-feature PPO ablations."""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.batch_train import run_batch  # noqa: E402
from scripts.run_comparison import summarize_rows  # noqa: E402
from src.experiments.evaluation import (  # noqa: E402
    evaluate_episode,
    make_environment,
    model_action_provider,
    write_detailed_csv,
)
from src.experiments.io import atomic_write_json, backend_path, git_metadata, load_yaml  # noqa: E402
from src.experiments.scenario_matrix import build_scenario_matrix, materialize_scenario  # noqa: E402
from src.experiments.transformer_ranker import (  # noqa: E402
    TransformerReceiverRanker,
    load_ranker,
    ranking_action,
    save_ranker,
    tensor_observation,
)


def _broadcast_action(environment: Any) -> np.ndarray:
    action = np.ones(environment.max_vehicles + 2, dtype=np.int64)
    action[-2] = 2
    action[-1] = 9
    return action


def _collect_labels(environment: Any, seed: int) -> list[tuple[dict[str, np.ndarray], np.ndarray]]:
    observation, _ = environment.reset(seed=seed)
    examples = []
    terminated = truncated = False
    while not (terminated or truncated):
        before = {key: value.copy() for key, value in observation.items()}
        observation, _, terminated, truncated, info = environment.step(
            _broadcast_action(environment)
        )
        labels = np.zeros(environment.max_vehicles, dtype=np.float32)
        for vehicle_id in info["critical_receiver_ids"]:
            labels[environment._vehicle_slots[vehicle_id]] = 1  # noqa: SLF001
        if before["event_mask"].any():
            examples.append((before, labels))
    return examples


def _train_ranker(
    examples: list[tuple[dict[str, np.ndarray], np.ndarray]],
    *,
    epochs: int,
    learning_rate: float,
    seed: int,
    transformer_config: dict[str, Any] | None = None,
) -> tuple[TransformerReceiverRanker, float]:
    torch.manual_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    vehicle_feature_dim = int(examples[0][0]["vehicles"].shape[-1])
    model = TransformerReceiverRanker(vehicle_feature_dim, transformer_config).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    criterion = nn.BCEWithLogitsLoss(reduction="none")
    final_loss = math.inf
    for _ in range(epochs):
        losses = []
        model.train()
        for observation, labels in examples:
            tensors = {
                key: value.to(device) for key, value in tensor_observation(observation).items()
            }
            logits = model(tensors)[0]
            mask = torch.as_tensor(observation["vehicle_mask"], device=device).bool()
            label_tensor = torch.as_tensor(labels, device=device)
            loss = criterion(logits[mask], label_tensor[mask]).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach()))
        final_loss = float(np.mean(losses))
    return model.cpu(), final_loss


class AblationPaused(RuntimeError):
    """Signal a normal pause between independently persisted ablation runs."""


def _transformer_only_training(
    config: dict[str, Any], output: Path, *, resume: bool = False, deadline: float | None = None
) -> Path:
    domain = str(config["domain"])
    base = load_yaml(config["base_scenario_config"])
    dataset = config["dataset"]
    matrix = build_scenario_matrix(
        domain,  # type: ignore[arg-type]
        base,
        train_count=int(dataset["train_configs"]),
        validation_count=int(dataset["validation_configs"]),
        test_count=int(dataset["test_configs"]),
    )
    candidates: list[tuple[float, Path]] = []
    for definition in (item for item in matrix if item.split == "train"):
        for seed in map(int, config["training_seeds"]):
            run_directory = output / definition.scenario_id / f"seed_{seed}"
            model_path = run_directory / "model.pt"
            summary_path = run_directory / "training_summary.json"
            if resume and model_path.is_file() and summary_path.is_file():
                loss = float(json.loads(summary_path.read_text(encoding="utf-8"))["loss"])
                candidates.append((loss, model_path))
                continue
            if deadline is not None and time.monotonic() >= deadline - 1800:
                raise AblationPaused
            scenario = materialize_scenario(definition, run_directory / "scenario", seed=seed)
            environment = make_environment(scenario, domain, seed, config)
            try:
                examples = _collect_labels(environment, seed)
            finally:
                environment.close()
            model, loss = _train_ranker(
                examples,
                epochs=int(config["training"]["epochs"]),
                learning_rate=float(config["training"]["learning_rate"]),
                seed=seed,
                transformer_config=config.get("ppo_overrides", {}).get("transformer"),
            )
            save_ranker(
                model,
                model_path,
                {
                    "top_k": None,
                    "training_loss": loss,
                    "vehicle_feature_dim": int(examples[0][0]["vehicles"].shape[-1]),
                    "transformer_config": config.get("ppo_overrides", {}).get("transformer"),
                },
            )
            atomic_write_json(run_directory / "training_summary.json", {"loss": loss})
            candidates.append((loss, model_path))
    if not candidates:
        raise ValueError("no Transformer-only training runs were configured")
    champion_source = min(candidates, key=lambda item: item[0])[1]
    champion, metadata = load_ranker(champion_source)

    validation_examples: list[tuple[dict[str, np.ndarray], np.ndarray]] = []
    for index, definition in enumerate(item for item in matrix if item.split == "validation"):
        scenario = materialize_scenario(
            definition, output / "validation" / definition.scenario_id, seed=30_000 + index
        )
        environment = make_environment(scenario, domain, 30_000 + index, config)
        try:
            validation_examples.extend(_collect_labels(environment, 30_000 + index))
        finally:
            environment.close()
    utilities: dict[int, float] = {}
    for top_k in map(int, config["top_k_candidates"]):
        values = []
        for observation, labels in validation_examples:
            with torch.no_grad():
                scores = champion(tensor_observation(observation))[0]
            active = np.flatnonzero(observation["vehicle_mask"])
            selected = set(sorted(active, key=lambda i: float(scores[i]), reverse=True)[:top_k])
            critical = set(np.flatnonzero(labels))
            recall = len(selected & critical) / len(critical) if critical else 1.0
            values.append(recall - 0.05 * len(selected) / max(len(active), 1))
        utilities[top_k] = float(np.mean(values))
    selected_k = max(utilities, key=utilities.get)
    champion_path = output / "champion/model.pt"
    save_ranker(champion, champion_path, {**metadata, "top_k": selected_k})
    atomic_write_json(
        output / "champion/selection.json",
        {"selection_split": "validation", "top_k": selected_k, "utilities": utilities},
    )
    return champion_path


def _evaluate_variant(
    config: dict[str, Any],
    output: Path,
    model_path: Path,
    variant: str,
    *,
    resume: bool = False,
) -> list[dict[str, Any]]:
    domain = str(config["domain"])
    base = load_yaml(config["base_scenario_config"])
    dataset = config["dataset"]
    matrix = build_scenario_matrix(
        domain,  # type: ignore[arg-type]
        base,
        train_count=int(dataset["train_configs"]),
        validation_count=int(dataset["validation_configs"]),
        test_count=int(dataset["test_configs"]),
    )
    ranker = metadata = None
    if variant == "transformer_only":
        ranker, metadata = load_ranker(model_path)
    rows = []
    for definition in (item for item in matrix if item.split == "test"):
        for seed in map(int, config["test_seeds"]):
            case_path = output / "case_checkpoints" / definition.scenario_id / f"seed_{seed}.json"
            if resume and case_path.is_file():
                rows.append(json.loads(case_path.read_text(encoding="utf-8"))["row"])
                continue
            scenario = materialize_scenario(
                definition, output / "test" / definition.scenario_id / f"seed_{seed}", seed=seed
            )
            environment = make_environment(scenario, domain, seed, config)
            try:
                provider = (
                    (lambda env, obs: ranking_action(ranker, env, obs, int(metadata["top_k"])))
                    if ranker is not None and metadata is not None
                    else model_action_provider(model_path, environment)
                )
                metrics = evaluate_episode(environment, provider, reset_seed=seed)
            finally:
                environment.close()
            row = {
                "case_id": f"{domain}:{definition.scenario_id}:seed_{seed}",
                "domain": domain,
                "scenario_id": definition.scenario_id,
                "seed": seed,
                "method": variant,
                **metrics,
            }
            atomic_write_json(case_path, {"row": row})
            rows.append(row)
    return rows


def run_ablation(
    config: dict[str, Any],
    output: str | Path,
    *,
    resume: bool = False,
    work_output: str | Path | None = None,
    time_budget_minutes: float | None = None,
) -> dict[str, Any]:
    output_directory = backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    variant = str(config["variant"])
    deadline = (
        time.monotonic() + time_budget_minutes * 60 if time_budget_minutes is not None else None
    )
    if variant == "transformer_only":
        try:
            model_path = _transformer_only_training(
                config, output_directory, resume=resume, deadline=deadline
            )
        except AblationPaused:
            return {"status": "paused", "variant": variant}
    elif variant == "rl_only":
        batch_config = copy.deepcopy(config)
        batch_config["ppo_feature_extractor"] = "handcrafted"
        batch_summary = run_batch(
            batch_config,
            output_directory,
            resume=resume,
            retry_failed=resume,
            work_output=work_output,
            time_budget_minutes=time_budget_minutes,
            retain_per_config_best=work_output is not None,
        )
        if batch_summary.get("paused"):
            return {"status": "paused", "variant": variant}
        if batch_summary["failed_runs"] or not batch_summary["champion"]:
            raise RuntimeError("RL-only batch did not produce a champion")
        model_path = output_directory / str(batch_summary["champion"]["model"])
    else:
        raise ValueError("variant must be transformer_only or rl_only")
    rows = _evaluate_variant(config, output_directory, model_path, variant, resume=resume)
    write_detailed_csv(output_directory / "detailed_results.csv", rows)
    renamed = [{**row, "method": "ai"} for row in rows]
    summary = {
        "run_mode": config.get("run_mode", "formal"),
        "variant": variant,
        "completed_result_rows": len(rows),
        "metrics": summarize_rows(renamed)["methods"]["ai"],
        "model": str(model_path),
        "git": git_metadata(),
    }
    atomic_write_json(output_directory / "summary.json", summary)
    experiment_root = output_directory.parent
    comparison_path = experiment_root / "comparison_results/summary.json"
    transformer_path = experiment_root / "ablation_transformer/summary.json"
    rl_path = experiment_root / "ablation_rl/summary.json"
    if all(path.is_file() for path in (comparison_path, transformer_path, rl_path)):
        comparison = json.loads(comparison_path.read_text(encoding="utf-8"))
        transformer = json.loads(transformer_path.read_text(encoding="utf-8"))
        rl_summary = json.loads(rl_path.read_text(encoding="utf-8"))
        atomic_write_json(
            experiment_root / "ablation_summary.json",
            {
                "full": comparison["methods"]["ai"],
                "transformer_only": transformer["metrics"],
                "rl_only": rl_summary["metrics"],
            },
        )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--work-output")
    parser.add_argument("--time-budget-minutes", type=float)
    arguments = parser.parse_args()
    summary = run_ablation(
        load_yaml(arguments.config),
        arguments.output,
        resume=arguments.resume,
        work_output=arguments.work_output,
        time_budget_minutes=arguments.time_budget_minutes,
    )
    print(json.dumps(summary, indent=2))
    return 75 if summary.get("status") == "paused" else 0


if __name__ == "__main__":
    raise SystemExit(main())

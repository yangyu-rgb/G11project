"""Run a resumable CPU smoke benchmark or formal Transformer architecture matrix."""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import sys
import time
from pathlib import Path
from typing import Any

import optuna
import torch
import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.models.graph_transformer import GraphEnvironmentTransformer  # noqa: E402
from src.models.transformer import EnvironmentTransformer  # noqa: E402


def _path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()


def benchmark_architecture(config: dict[str, int], variant: str, repeats: int) -> dict[str, Any]:
    model_class = GraphEnvironmentTransformer if variant == "graph" else EnvironmentTransformer
    model = model_class(
        d_model=config["d_model"],
        num_heads=config["num_heads"],
        num_layers=config["num_layers"],
        feedforward_dim=config["d_model"] * config["ffn_ratio"],
        dropout=0,
    ).eval()
    vehicles = torch.randn(1, 50, 5)
    events = torch.randn(1, 2, 4)
    with torch.no_grad():
        model(vehicles, events)
        started = time.perf_counter()
        for _ in range(repeats):
            output = model(vehicles, events)
    latency_ms = (time.perf_counter() - started) * 1000 / repeats
    parameters = sum(parameter.numel() for parameter in model.parameters())
    return {
        **config,
        "variant": variant,
        "parameters": parameters,
        "inference_latency_ms": latency_ms,
        "finite": bool(torch.isfinite(output.global_embedding).all()),
        "selection_score": 1.0 / (1.0 + latency_ms) + 1.0 / (1.0 + parameters / 1_000_000),
    }


def search(config: dict[str, Any], output: str | Path) -> dict[str, Any]:
    output_directory = _path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    search_space = {
        "num_layers": list(config["layers"]),
        "num_heads": list(config["heads"]),
        "d_model": list(config["dimensions"]),
        "ffn_ratio": list(config["ffn_ratios"]),
    }
    total_combinations = len(list(itertools.product(*search_space.values())))
    limit = (
        int(config.get("smoke_limit", total_combinations))
        if config.get("run_mode") == "smoke"
        else total_combinations
    )
    rows: list[dict[str, Any]] = []

    def objective(trial: optuna.Trial) -> float:
        architecture = {
            name: int(trial.suggest_categorical(name, values))
            for name, values in search_space.items()
        }
        result = benchmark_architecture(
            architecture, "standard", int(config.get("benchmark_repeats", 2))
        )
        rows.append(result)
        return float(result["selection_score"])

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.GridSampler(search_space, seed=42),
        storage=f"sqlite:///{output_directory / 'study.db'}",
        study_name="transformer_architecture_search",
        load_if_exists=True,
    )
    remaining = max(0, limit - len(study.trials))
    if remaining:
        study.optimize(objective, n_trials=remaining)
    if not rows:
        rows = [
            benchmark_architecture(
                {key: int(value) for key, value in trial.params.items()},
                "standard",
                int(config.get("benchmark_repeats", 2)),
            )
            for trial in study.trials[:limit]
            if trial.state == optuna.trial.TrialState.COMPLETE
        ]
    graph_candidates = sorted(rows, key=lambda row: row["selection_score"], reverse=True)[
        : min(3, len(rows))
    ]
    rows.extend(
        benchmark_architecture(
            {
                key: int(candidate[key])
                for key in ("num_layers", "num_heads", "d_model", "ffn_ratio")
            },
            "graph",
            int(config.get("benchmark_repeats", 2)),
        )
        for candidate in graph_candidates
    )
    rows.sort(key=lambda row: row["selection_score"], reverse=True)
    with (output_directory / "search_results.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    result = {
        "run_mode": config.get("run_mode", "smoke"),
        "evaluated": len(rows),
        "formal_training_required": True,
        "best_smoke_benchmark": rows[0],
        "note": "This benchmark proves architecture viability only; validation reward requires GPU training.",
    }
    (output_directory / "best_architecture.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    config = yaml.safe_load(_path(arguments.config).read_text(encoding="utf-8"))
    print(json.dumps(search(config, arguments.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

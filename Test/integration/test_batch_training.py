"""Small orchestration smoke tests for resumable batch training."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

import scripts.batch_train as batch_module  # noqa: E402


def _config(tmp_path: Path) -> dict[str, Any]:
    base_training = yaml.safe_load(
        (BACKEND_DIRECTORY / "configs/training_config.yaml").read_text(encoding="utf-8")
    )
    base_scenario = yaml.safe_load(
        (BACKEND_DIRECTORY / "configs/scenarios/highway_emergency.yaml").read_text(encoding="utf-8")
    )
    training_path = tmp_path / "training.yaml"
    scenario_path = tmp_path / "scenario.yaml"
    training_path.write_text(yaml.safe_dump(base_training), encoding="utf-8")
    scenario_path.write_text(yaml.safe_dump(base_scenario), encoding="utf-8")
    return {
        "run_mode": "smoke",
        "domain": "highway",
        "base_training_config": str(training_path),
        "base_scenario_config": str(scenario_path),
        "safety_window_ms": 100,
        "dataset": {"train_configs": 2, "validation_configs": 1, "test_configs": 1},
        "training_seeds": [3, 5],
        "training": {
            "episodes_per_config": 2,
            "validation_interval_episodes": 1,
            "early_stopping_patience_episodes": 2,
            "evaluation_episodes": 1,
        },
        "reward_profile": "balanced",
        "reward_profiles": {
            "balanced": {
                "effective_delivery": 0.25,
                "coverage": 0.30,
                "latency": 0.20,
                "overhead": 0.15,
                "missed": 0.10,
            }
        },
        "success": {"reward_threshold": 0.0, "convergence_rate": 0.5},
    }


def test_batch_runs_two_configs_and_two_seeds_without_cross_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_materialize(definition: Any, output: Path, *, seed: int) -> Path:
        del definition, seed
        output.mkdir(parents=True, exist_ok=True)
        (output / "trajectory.xml").write_text("fixture", encoding="utf-8")
        (output / "events.json").write_text("[]", encoding="utf-8")
        return output

    def fake_train(
        config: dict[str, Any], scenario: Path, output: Path, resume: bool
    ) -> dict[str, Any]:
        del config, scenario, resume
        (output / "model_best.zip").write_bytes(b"model")
        (output / "training_log.csv").write_text("episode,reward\n1,0.7\n", encoding="utf-8")
        return {"status": "completed", "mean_final_reward": 0.7}

    monkeypatch.setattr(batch_module, "materialize_scenario", fake_materialize)
    summary = batch_module.run_batch(_config(tmp_path), tmp_path / "batch", train_runner=fake_train)

    assert summary["expected_runs"] == 4
    assert summary["completed_runs"] == 4
    assert summary["failed_runs"] == []
    assert json.loads((tmp_path / "batch/summary.json").read_text())["run_mode"] == "smoke"


def test_batch_resume_skips_completed_runs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def fake_materialize(definition: Any, output: Path, *, seed: int) -> Path:
        del definition, seed
        output.mkdir(parents=True, exist_ok=True)
        return output

    def fake_train(
        config: dict[str, Any], scenario: Path, output: Path, resume: bool
    ) -> dict[str, Any]:
        nonlocal calls
        del config, scenario, output, resume
        calls += 1
        return {"status": "completed", "mean_final_reward": 0.7}

    monkeypatch.setattr(batch_module, "materialize_scenario", fake_materialize)
    config = _config(tmp_path)
    batch_module.run_batch(config, tmp_path / "batch", train_runner=fake_train)
    batch_module.run_batch(config, tmp_path / "batch", resume=True, train_runner=fake_train)

    assert calls == 4

"""Contract tests for the resumable Colab formal experiment entrypoint."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

import scripts.run_formal_pipeline as pipeline_module  # noqa: E402


def test_pipeline_status_and_balanced_smoke_configuration(tmp_path: Path) -> None:
    pipeline = pipeline_module.FormalPipeline(
        tmp_path / "drive",
        tmp_path / "work",
        time_budget_minutes=45,
        smoke=True,
        allow_cpu=True,
    )

    status = pipeline.status()
    assert status["next_stage"] == "reward"
    assert status["stages"]["reward"]["status"] == "pending"
    config = pipeline._batch_config(  # noqa: SLF001 - verify the public CLI's resolved contract
        "highway",
        weights=pipeline_module.DEFAULT_WEIGHTS,
        train_configs=1,
        validation_configs=1,
        seeds=[7],
        episodes=2,
        feature_mode="enhanced",
        transformer={"d_model": 128, "num_heads": 4, "num_layers": 2},
    )
    assert config["environment_overrides"]["feature_mode"] == "enhanced"
    assert config["ppo_overrides"]["transformer"]["d_model"] == 128


def test_pipeline_refuses_to_mix_git_commits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    persistent = tmp_path / "drive"
    persistent.mkdir()
    (persistent / "pipeline_state.json").write_text(
        json.dumps({"git": {"commit": "old"}, "stages": {}}), encoding="utf-8"
    )
    monkeypatch.setattr(pipeline_module, "git_metadata", lambda: {"commit": "new", "dirty": False})

    with pytest.raises(RuntimeError, match="different git commit"):
        pipeline_module.FormalPipeline(
            persistent,
            tmp_path / "work",
            time_budget_minutes=45,
            smoke=True,
            allow_cpu=True,
        )


def test_pipeline_uses_full_architecture_matrix_outside_smoke(tmp_path: Path) -> None:
    pipeline = pipeline_module.FormalPipeline(
        tmp_path / "drive",
        tmp_path / "work",
        time_budget_minutes=45,
        smoke=False,
        allow_cpu=True,
    )

    assert len(pipeline._architecture_candidates()) == 54  # noqa: SLF001

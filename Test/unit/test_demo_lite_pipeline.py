"""Contract tests for the independent Colab demo-lite entrypoint."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

import scripts.run_demo_lite_pipeline as pipeline_module  # noqa: E402


def test_demo_lite_pipeline_runs_three_independent_stages(tmp_path: Path, monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    def fake_batch(config: dict[str, Any], output: Path, **kwargs: Any) -> dict[str, Any]:
        captured["training_config"] = config
        captured["training_output"] = output
        captured["training_kwargs"] = kwargs
        model = output / "champion/model_best.zip"
        model.parent.mkdir(parents=True, exist_ok=True)
        model.write_bytes(b"model")
        return {
            "expected_runs": 8,
            "completed_runs": 8,
            "failed_runs": [],
            "paused": False,
            "convergence_rate": 0.75,
            "champion": {"model": "champion/model_best.zip"},
        }

    def fake_comparison(config: dict[str, Any], output: Path, *, resume: bool) -> dict[str, Any]:
        captured["comparison_config"] = config
        captured["comparison_output"] = output
        captured["comparison_resume"] = resume
        return {
            "expected_result_rows": 40,
            "completed_result_rows": 40,
            "failures": [],
        }

    def fake_results(output: Path, *, experiments_root: Path) -> dict[str, Any]:
        captured["results_output"] = output
        captured["results_root"] = experiments_root
        return {
            "scope": "highway-only preliminary course demo",
            "completed_result_rows": 40,
            "figures": ["fig_metric_comparison.png"],
        }

    monkeypatch.setattr(pipeline_module, "run_batch", fake_batch)
    monkeypatch.setattr(pipeline_module, "run_comparison", fake_comparison)
    monkeypatch.setattr(pipeline_module, "generate_demo_lite_results", fake_results)
    monkeypatch.setattr(pipeline_module, "git_metadata", lambda: {"commit": "demo", "dirty": False})
    root = tmp_path / "demo-lite"
    pipeline = pipeline_module.DemoLitePipeline(
        root,
        tmp_path / "work",
        time_budget_minutes=60,
        allow_cpu=True,
    )

    assert pipeline.status()["next_stage"] == "training"
    assert pipeline.run("next")["next_stage"] == "comparison"
    assert pipeline.run("next")["next_stage"] == "results"
    assert pipeline.run("next")["next_stage"] is None
    assert captured["training_config"]["run_mode"] == "demo_lite"
    assert captured["training_config"]["dataset"]["train_configs"] == 4
    assert captured["training_config"]["ppo_overrides"]["transformer"]["d_model"] == 128
    assert captured["comparison_config"]["domains"] == ["highway"]
    assert captured["comparison_config"]["models"]["highway"] == str(
        root / "highway_batch/champion/model_best.zip"
    )
    assert captured["results_root"] == root


def test_demo_lite_notebook_uses_separate_drive_root() -> None:
    notebook_path = BACKEND_DIRECTORY / "notebooks/colab_demo_lite_training.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    source = "".join(line for cell in notebook["cells"] for line in cell.get("source", []))
    assert "G11project-demo-lite" in source
    assert "run_demo_lite_pipeline.py" in source
    assert "G11project-formal" in source

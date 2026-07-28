"""Unit tests for adaptive-demo validation and state orchestration."""

import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from scripts.run_adaptive_demo_pipeline import AdaptiveDemoPipeline, validation_score  # noqa: E402
from scripts.run_safety_finetune_pipeline import SafetyFineTunePipeline  # noqa: E402
from src.experiments.io import load_yaml  # noqa: E402
from src.experiments.scenario_matrix import (  # noqa: E402
    build_safety_scenario_matrix,
    build_scenario_matrix,
    make_single_event_matrix,
)
from src.experiments.presentation_gate import summarize_directional_incidents  # noqa: E402


def test_adaptive_demo_cli_can_build_its_argument_parser() -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(BACKEND_DIRECTORY / "scripts/run_adaptive_demo_pipeline.py"),
            "--help",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "--persistent-root" in result.stdout


def test_validation_score_prioritizes_safety_coverage() -> None:
    safe = {
        "affected_vehicle_coverage": 0.96,
        "affected_vehicle_selection_coverage": 0.98,
        "effective_delivery_rate": 0.9,
        "timely_event_rate": 0.9,
        "communication_overhead": 1.5,
        "p95_latency_ms": 40.0,
    }
    unsafe_but_cheap = {
        "affected_vehicle_coverage": 0.7,
        "affected_vehicle_selection_coverage": 0.7,
        "effective_delivery_rate": 1.0,
        "timely_event_rate": 1.0,
        "communication_overhead": 1.0,
        "p95_latency_ms": 20.0,
    }

    assert validation_score(safe) > validation_score(unsafe_but_cheap)


def test_highway_validation_explicitly_covers_all_safety_bands() -> None:
    base = {
        "vehicles": {},
        "events": {},
    }
    definitions = build_scenario_matrix(
        "highway", base, train_count=6, validation_count=3, test_count=6
    )
    severities = {
        split: {
            item.parameters["events"]["severity"] for item in definitions if item.split == split
        }
        for split in ("train", "validation", "test")
    }

    assert severities["validation"] == {0.45, 0.65, 0.85}
    assert any(value > 0.75 for value in severities["train"])
    assert any(value > 0.75 for value in severities["test"])


def test_directional_demo_matrix_forces_exactly_one_event() -> None:
    definitions = build_scenario_matrix(
        "highway",
        {"vehicles": {}, "events": {}},
        train_count=2,
        validation_count=1,
        test_count=2,
    )

    single_event = make_single_event_matrix(definitions)

    assert all(item.parameters["events"]["count_min"] == 1 for item in single_event)
    assert all(item.parameters["events"]["count_max"] == 1 for item in single_event)


def test_directional_v2_keeps_the_model_interface_and_uses_a_new_holdout() -> None:
    config = load_yaml("configs/adaptive_demo_training.yaml")
    legacy = load_yaml("configs/adaptive_demo_training_v1.yaml")

    assert config["protocol"] == "directional-v2"
    assert config["dataset"]["single_event"] is True
    assert config["action"]["mode"] == "directional_corridor"
    assert config["action"]["corridor_radii_m"] == [75, 150, 225, 300, 375]
    assert set(config["test_seeds"]).isdisjoint(legacy["test_seeds"])
    assert "fixed_directional_corridor" in config["methods"]


def test_directional_v2_notebook_uses_a_fresh_drive_root() -> None:
    notebook = json.loads(
        (BACKEND_DIRECTORY / "notebooks/colab_directional_corridor_v2.ipynb").read_text(
            encoding="utf-8"
        )
    )
    source = "".join(line for cell in notebook["cells"] for line in cell.get("source", []))

    assert "G11project-directional-corridor-v2" in source
    assert "G11project-directional-corridor-v1" not in source
    assert "configs/adaptive_demo_training.yaml" in source


def test_directional_v2_rejects_a_legacy_persistent_root(tmp_path: Path) -> None:
    state_path = tmp_path / "adaptive_demo_state.json"
    state_path.write_text(
        json.dumps({"stages": {"training": {"status": "completed"}}}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="choose a fresh persistent root"):
        AdaptiveDemoPipeline(
            tmp_path,
            tmp_path / "work",
            config_path="configs/adaptive_demo_training.yaml",
            time_budget_minutes=1,
            allow_cpu=True,
        )


def test_directional_gate_deduplicates_repeated_network_seeds() -> None:
    incidents = {
        ("scenario-a", "event-a"): {
            "signatures": {("vehicle-1",)},
            "forward_vehicle_ids": set(),
            "follower_opportunity": True,
            "follower_selected_on_all_seeds": True,
        },
        ("scenario-b", "event-b"): {
            "signatures": {("vehicle-2",)},
            "forward_vehicle_ids": set(),
            "follower_opportunity": True,
            "follower_selected_on_all_seeds": True,
        },
    }

    result = summarize_directional_incidents(incidents)

    assert result["event_count"] == 2
    assert result["receiver_signature_count"] == 2
    assert result["receiver_signature_unique_ratio"] == 1.0
    assert result["policy_seed_consistent"] is True
    assert result["passed"] is True


def test_directional_gate_rejects_seed_dependent_or_forward_behavior() -> None:
    incidents = {
        ("scenario-a", "event-a"): {
            "signatures": {("vehicle-1",), ("vehicle-2",)},
            "forward_vehicle_ids": {"vehicle-ahead"},
            "follower_opportunity": True,
            "follower_selected_on_all_seeds": False,
        }
    }

    result = summarize_directional_incidents(incidents)

    assert result["policy_seed_consistent"] is False
    assert result["forward_notifications"] == 1
    assert result["nearest_follower_coverage"] == 0.0
    assert result["passed"] is False


def test_safety_finetune_requires_a_genuinely_new_final_holdout() -> None:
    pipeline = object.__new__(SafetyFineTunePipeline)
    pipeline.config = {
        "source_test_seeds": [1701, 1801],
        "test_seeds": [2301, 2401],
        "fine_tuning": {"validation_seeds": [4101, 4201]},
    }
    pipeline._validate_protocol()

    pipeline.config["test_seeds"] = [1801, 2301]
    with pytest.raises(ValueError, match="must be new"):
        pipeline._validate_protocol()


def test_v6_safety_matrix_allocates_half_of_training_to_high_risk() -> None:
    definitions = build_safety_scenario_matrix(
        {"vehicles": {}, "events": {}},
        train_count=12,
        validation_count=9,
        test_count=6,
    )

    training = [item for item in definitions if item.split == "train"]
    validation = [item for item in definitions if item.split == "validation"]
    assert sum(item.parameters["events"]["severity"] > 0.75 for item in training) == 6
    assert sum(item.parameters["events"]["severity"] > 0.75 for item in validation) == 3


def test_comparison_config_and_training_quality_are_complete(tmp_path: Path) -> None:
    pipeline = object.__new__(AdaptiveDemoPipeline)
    pipeline.root = tmp_path
    pipeline.config = {
        "safety_window_ms": 100,
        "base_scenario_config": "configs/scenarios/highway_emergency.yaml",
        "dataset": {"test_configs": 6},
        "test_seeds": [1, 2],
        "environment": {"severity_aware_critical_radius": True},
        "network": {"mode": "3gpp", "minimum_capacity_fraction": 0.05},
        "reward_weights": {"coverage": 1.0},
        "action": {"mode": "adaptive_radius"},
        "acceptance": {
            "minimum_coverage": 0.95,
            "minimum_selection_coverage": 0.95,
            "minimum_reward_improvement": 0.02,
            "validation_consecutive_passes": 2,
        },
    }

    comparison = pipeline._comparison_config()
    assert comparison["run_mode"] == "demo_lite"
    assert comparison["network"]["highway_mode"] == "3gpp"
    assert comparison["environment"]["severity_aware_critical_radius"] is True

    (tmp_path / "champion").mkdir()
    (tmp_path / "champion/selection.json").write_text(json.dumps({"seed": 101}))
    candidate = tmp_path / "candidates/seed_101"
    candidate.mkdir(parents=True)
    with (candidate / "training_log.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("episode", "timesteps", "reward"))
        writer.writeheader()
        for episode, reward in enumerate((0.2, 0.3, 0.7, 0.8), start=1):
            writer.writerow({"episode": episode, "timesteps": episode * 10, "reward": reward})
    (candidate / "validation_history.json").write_text(
        json.dumps(
            [
                {
                    "affected_vehicle_coverage": 0.90,
                    "affected_vehicle_selection_coverage": 0.94,
                },
                {
                    "affected_vehicle_coverage": 0.96,
                    "affected_vehicle_selection_coverage": 0.97,
                },
                {
                    "affected_vehicle_coverage": 0.97,
                    "affected_vehicle_selection_coverage": 0.98,
                },
            ]
        )
    )

    assert pipeline._training_quality_checks() == {
        "training_improved": True,
        "validation_stable": True,
    }

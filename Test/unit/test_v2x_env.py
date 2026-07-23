"""Tests for the offline Gymnasium V2X environment."""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.environment.reward_calculator import calculate_reward  # noqa: E402
from src.environment.v2x_env import V2XEnv  # noqa: E402


@pytest.fixture
def scenario_directory(tmp_path: Path) -> Path:
    timesteps = []
    for step in range(10):
        vehicles = "".join(
            f'<vehicle id="vehicle_{index}" x="{1000 + index * 100 + step * 10}" '
            f'y="{-1.6 - index * 0.1}" speed="25" angle="90" />'
            for index in range(5)
        )
        timesteps.append(f'<timestep time="{step}">{vehicles}</timestep>')
    (tmp_path / "trajectory.xml").write_text(
        f"<fcd-export>{''.join(timesteps)}</fcd-export>", encoding="utf-8"
    )
    (tmp_path / "events.json").write_text(
        json.dumps(
            [
                {
                    "type": "emergency_braking",
                    "x": 1040,
                    "y": -1.6,
                    "timestamp": 4,
                    "severity": 0.9,
                }
            ]
        ),
        encoding="utf-8",
    )
    return tmp_path


def test_reset_returns_padded_observation(scenario_directory: Path) -> None:
    environment = V2XEnv(scenario_directory, seed=3)

    observation, info = environment.reset()

    assert environment.observation_space.contains(observation)
    assert observation["vehicles"].shape == (50, 5)
    assert observation["events"].shape == (2, 4)
    assert observation["vehicle_mask"].sum() == 5
    assert observation["event_mask"].sum() == 0
    assert info["timestamp"] == 0
    snapshot = environment.snapshot()
    assert snapshot.step_index == 0
    assert snapshot.timestamp == 0
    assert len(snapshot.vehicles) == 5
    assert snapshot.events == ()


def test_snapshot_exposes_stable_generated_event_id(scenario_directory: Path) -> None:
    environment = V2XEnv(scenario_directory, seed=3)
    environment.reset()
    action = np.asarray([0] * 50 + [0, 0], dtype=np.int64)

    for _ in range(4):
        environment.step(action)

    snapshot = environment.snapshot()
    assert snapshot.events[0].event_id == "event-0"


def test_step_processes_event_and_returns_reward_details(
    scenario_directory: Path,
) -> None:
    environment = V2XEnv(scenario_directory, seed=5)
    environment.reset()
    action = np.asarray([1] * 50 + [2, 9], dtype=np.int64)

    event_info = None
    for _ in range(5):
        _, reward, terminated, truncated, info = environment.step(action)
        assert -1 <= reward <= 1
        assert not truncated
        assert not terminated
        if info["critical_receiver_ids"]:
            event_info = info

    assert event_info is not None
    assert event_info["transmissions"]
    assert 0 <= event_info["delivery_success_rate"] <= 1
    assert 0 <= event_info["avg_delay_penalty"] <= 1


def test_environment_runs_exactly_ten_steps(scenario_directory: Path) -> None:
    environment = V2XEnv(scenario_directory, seed=11)
    environment.reset()
    action = np.asarray([0] * 50 + [0, 0], dtype=np.int64)

    for step in range(10):
        observation, reward, terminated, truncated, _ = environment.step(action)
        assert environment.observation_space.contains(observation)
        assert -1 <= reward <= 1
        assert terminated is (step == 9)
        assert not truncated

    assert "step=9" in environment.render()
    environment.close()
    with pytest.raises(RuntimeError, match="closed"):
        environment.step(action)


def test_environment_accepts_3gpp_network_configuration(
    scenario_directory: Path,
) -> None:
    environment = V2XEnv(
        scenario_directory,
        network_mode="3gpp",
        network_scenario="urban",
        network_options={"carrier_frequency_ghz": 5.9, "max_queue_delay_ms": 25},
        seed=13,
    )

    observation, _ = environment.reset()
    action = np.asarray([1] * 50 + [2, 9], dtype=np.int64)
    _, _, _, _, info = environment.step(action)

    assert environment.network_mode == "3gpp"
    assert environment.network_scenario == "urban"
    assert environment.observation_space.contains(observation)
    assert info["timestamp"] == 0


def test_reward_calculator_clips_delay_and_counts_only_critical_successes() -> None:
    breakdown = calculate_reward(
        critical_receiver_ids={"a", "b"},
        successful_receiver_ids={"a", "irrelevant"},
        latencies_ms=[25, 250],
    )

    assert breakdown.delivery_success_rate == 0.5
    assert breakdown.avg_delay_penalty == 1.0
    assert breakdown.reward == -0.5


def test_complete_reward_reports_all_five_normalized_components() -> None:
    breakdown = calculate_reward(
        critical_receiver_ids={"a", "b"},
        successful_receiver_ids={"a", "irrelevant"},
        timely_successful_receiver_ids={"a"},
        latencies_ms=[20, 80],
        selected_receiver_count=2,
        active_receiver_count=4,
        mode="full",
        weights={
            "effective_delivery": 0.2,
            "coverage": 0.35,
            "latency": 0.15,
            "overhead": 0.1,
            "missed": 0.2,
        },
    )

    assert breakdown.effective_delivery_rate == 0.5
    assert breakdown.coverage_rate == 0.5
    assert breakdown.avg_delay_penalty == 0.5
    assert breakdown.overhead_penalty == 0.5
    assert breakdown.miss_rate == 0.5
    assert breakdown.reward == pytest.approx(0.05)


def test_complete_reward_penalizes_unnecessary_no_event_transmissions() -> None:
    breakdown = calculate_reward(
        critical_receiver_ids=set(),
        successful_receiver_ids=set(),
        latencies_ms=[],
        selected_receiver_count=3,
        active_receiver_count=6,
        mode="full",
    )

    assert breakdown.reward < 0


def test_urban_coordinates_and_event_types_have_distinct_features(
    tmp_path: Path,
) -> None:
    timesteps = [
        (
            f'<timestep time="{step}">'
            '<vehicle id="urban_vehicle" x="2500" y="250" speed="10" angle="0" />'
            "</timestep>"
        )
        for step in range(10)
    ]
    (tmp_path / "trajectory.xml").write_text(
        f"<fcd-export>{''.join(timesteps)}</fcd-export>", encoding="utf-8"
    )
    (tmp_path / "events.json").write_text(
        json.dumps(
            [
                {
                    "type": "emergency_braking",
                    "x": 1000,
                    "y": 250,
                    "timestamp": 1,
                    "severity": 0.9,
                },
                {
                    "type": "obstacle",
                    "x": 2500,
                    "y": 0,
                    "timestamp": 2,
                    "severity": 0.6,
                },
                {
                    "type": "intersection_collision_warning",
                    "x": 4000,
                    "y": -250,
                    "timestamp": 3,
                    "severity": 0.8,
                },
            ]
        ),
        encoding="utf-8",
    )
    environment = V2XEnv(
        tmp_path,
        max_vehicles=100,
        max_events=3,
        lateral_extent_m=500,
    )

    observation, _ = environment.reset()
    assert observation["vehicles"][0, 1] == pytest.approx(0.5)
    action = np.asarray([0] * 100 + [0, 0], dtype=np.int64)
    event_codes = []
    for _ in range(3):
        observation, *_ = environment.step(action)
        active = observation["events"][observation["event_mask"].astype(bool)]
        event_codes.extend(active[:, 0].tolist())

    assert event_codes == [1.0, 0.5, -1.0]

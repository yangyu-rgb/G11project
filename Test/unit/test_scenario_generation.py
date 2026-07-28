"""Tests for the reproducible M1 SUMO highway scenario."""

import json
import random
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

import scripts.generate_highway_scenario as highway_generator  # noqa: E402
from scripts.generate_highway_scenario import (  # noqa: E402
    DEFAULT_CONFIG_PATH,
    MANAGED_OUTPUTS,
    build_event_schedule,
    build_vehicle_definitions,
    generate_highway_scenario,
    load_scenario_config,
    resolve_output_directory,
    sumo_runtime_available,
)


def test_default_config_and_seed_are_within_m1_bounds() -> None:
    config = load_scenario_config(DEFAULT_CONFIG_PATH)
    first_rng = random.Random(config.seed)
    second_rng = random.Random(config.seed)

    first_vehicles = build_vehicle_definitions(config, first_rng)
    second_vehicles = build_vehicle_definitions(config, second_rng)
    schedule = build_event_schedule(config, first_vehicles, first_rng)

    assert 30 <= len(first_vehicles) <= 50
    assert first_vehicles == second_vehicles
    assert all(0 <= vehicle.lane < 3 for vehicle in first_vehicles)
    assert all(80 / 3.6 <= vehicle.depart_speed_mps <= 120 / 3.6 for vehicle in first_vehicles)
    assert 1 <= len(schedule) <= 2
    assert all(10 <= event.timestamp <= 30 for event in schedule)


def test_relative_output_is_resolved_under_backend() -> None:
    assert (
        resolve_output_directory("experiments/test_scenario")
        == (BACKEND_DIRECTORY / "experiments" / "test_scenario").resolve()
    )


def test_generated_scenario_is_loadable_and_contains_required_outputs(tmp_path: Path) -> None:
    if not sumo_runtime_available():
        pytest.skip("SUMO executable is unavailable in this environment")

    raw_config = yaml.safe_load(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
    raw_config["vehicles"]["count_min"] = 30
    raw_config["vehicles"]["count_max"] = 30
    raw_config["events"]["count_min"] = 1
    raw_config["events"]["count_max"] = 1
    raw_config["events"]["time_min_s"] = 10
    raw_config["events"]["time_max_s"] = 10
    raw_config["simulation"]["duration_s"] = 13
    config_path = tmp_path / "scenario.yaml"
    config_path.write_text(yaml.safe_dump(raw_config), encoding="utf-8")

    artifacts = generate_highway_scenario(tmp_path / "output", config_path, seed_override=7)

    assert all((artifacts.output_directory / filename).is_file() for filename in MANAGED_OUTPUTS)
    route_root = ET.parse(artifacts.routes).getroot()
    assert len(route_root.findall("vehicle")) == 30
    trajectory_root = ET.parse(artifacts.trajectory).getroot()
    assert trajectory_root.tag == "fcd-export"

    events = json.loads(artifacts.events.read_text(encoding="utf-8"))
    assert len(events) == 1
    assert set(events[0]) == {
        "type",
        "x",
        "y",
        "timestamp",
        "severity",
        "source_vehicle_id",
        "pre_brake_speed_kmh",
        "post_brake_speed_kmh",
    }
    assert events[0]["source_vehicle_id"].startswith("vehicle_")
    assert events[0]["type"] == "emergency_braking"
    assert 10 <= events[0]["timestamp"] <= 10.1


def test_network_writer_falls_back_when_netconvert_crashes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = load_scenario_config(DEFAULT_CONFIG_PATH)
    artifacts = highway_generator._prepare_output_directory(tmp_path / "fallback")
    monkeypatch.setattr(
        highway_generator,
        "_find_binary",
        lambda name: Path(f"/usr/bin/{name}"),
    )

    def crash(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise highway_generator.subprocess.CalledProcessError(-11, ["netconvert"])

    monkeypatch.setattr(highway_generator.subprocess, "run", crash)
    highway_generator._write_network(config, artifacts)

    root = ET.parse(artifacts.network).getroot()
    assert root.attrib["version"] == "1.9"
    lanes = root.findall("./edge/lane")
    assert len(lanes) == 3
    assert all(float(lane.attrib["length"]) == 5000 for lane in lanes)

"""Tests for the reproducible M2 urban SUMO scenario."""

import json
import random
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from scripts.generate_urban_scenario import (  # noqa: E402
    DEFAULT_CONFIG_PATH,
    EVENT_TYPES,
    MANAGED_OUTPUTS,
    build_event_schedule,
    build_vehicle_definitions,
    generate_urban_scenario,
    load_urban_scenario_config,
    sumo_runtime_available,
)


def test_default_urban_config_builds_reproducible_100_vehicle_scenario() -> None:
    config = load_urban_scenario_config(DEFAULT_CONFIG_PATH)
    first_rng = random.Random(config.seed)
    second_rng = random.Random(config.seed)

    first_vehicles = build_vehicle_definitions(config, first_rng)
    second_vehicles = build_vehicle_definitions(config, second_rng)
    schedule = build_event_schedule(config, first_vehicles, first_rng)

    assert len(first_vehicles) == 100
    assert first_vehicles == second_vehicles
    assert all(0 <= vehicle.lane < 2 for vehicle in first_vehicles)
    assert all(30 / 3.6 <= vehicle.depart_speed_mps <= 60 / 3.6 for vehicle in first_vehicles)
    assert tuple(event.event_type for event in schedule) == EVENT_TYPES
    assert all(10 <= event.timestamp <= 30 for event in schedule)


def test_generated_urban_scenario_is_loadable_and_complete(tmp_path: Path) -> None:
    if not sumo_runtime_available():
        pytest.skip("SUMO executable is unavailable in this environment")

    artifacts = generate_urban_scenario(tmp_path / "urban", seed_override=17)

    assert all((artifacts.output_directory / filename).is_file() for filename in MANAGED_OUTPUTS)
    network_root = ET.parse(artifacts.network).getroot()
    traffic_lights = network_root.findall("tlLogic")
    assert len(traffic_lights) == 3

    route_root = ET.parse(artifacts.routes).getroot()
    assert len(route_root.findall("vehicle")) == 100
    trajectory_root = ET.parse(artifacts.trajectory).getroot()
    assert trajectory_root.tag == "fcd-export"

    events = json.loads(artifacts.events.read_text(encoding="utf-8"))
    assert len(events) == 3
    assert {event["type"] for event in events} == set(EVENT_TYPES)
    assert all(set(event) == {"type", "x", "y", "timestamp", "severity"} for event in events)


def test_urban_config_accepts_batch_variations(tmp_path: Path) -> None:
    raw = yaml.safe_load(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
    raw["vehicles"]["count"] = 80
    raw["events"] = {
        "types": ["obstacle"],
        "times_s": [18],
        "severities": [0.6],
    }
    raw["traffic_lights"] = {"type": "actuated", "green_time_s": 24}
    config_path = tmp_path / "urban.yaml"
    config_path.write_text(yaml.safe_dump(raw), encoding="utf-8")

    config = load_urban_scenario_config(config_path)

    assert config.vehicle_count == 80
    assert config.event_types == ("obstacle",)
    assert config.traffic_light_type == "actuated"

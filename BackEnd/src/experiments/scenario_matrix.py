"""Deterministic train/validation/test scenario matrix generation."""

from __future__ import annotations

import copy
from dataclasses import replace
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml

from scripts.generate_highway_scenario import generate_highway_scenario
from scripts.generate_urban_scenario import EVENT_TYPES, generate_urban_scenario
from src.experiments.io import atomic_write_json, sha256_file

ScenarioDomain = Literal["highway", "urban"]
ScenarioSplit = Literal["train", "validation", "test"]


@dataclass(frozen=True)
class ScenarioDefinition:
    scenario_id: str
    domain: ScenarioDomain
    split: ScenarioSplit
    parameters: dict[str, Any]


def build_scenario_matrix(
    domain: ScenarioDomain,
    base_config: dict[str, Any],
    *,
    train_count: int = 50,
    validation_count: int = 7,
    test_count: int = 10,
) -> list[ScenarioDefinition]:
    """Build stable parameter coverage without leaking configurations across splits."""
    definitions: list[ScenarioDefinition] = []
    offset = 0
    for split, count in (
        ("train", train_count),
        ("validation", validation_count),
        ("test", test_count),
    ):
        for local_index in range(count):
            index = offset + local_index
            raw = copy.deepcopy(base_config)
            if domain == "highway":
                severity_schedule = {
                    "train": (0.35, 0.60, 0.85),
                    "validation": (0.45, 0.65, 0.85),
                    "test": (0.40, 0.55, 0.70, 0.90, 0.50, 0.80),
                }
                vehicle_count = 30 + (index * 7) % 21
                speed_min = 80 + (index * 5) % 21
                event_start = 10 + (index * 3) % 15
                raw["vehicles"].update(
                    {
                        "count_min": vehicle_count,
                        "count_max": vehicle_count,
                        "speed_min_kmh": speed_min,
                        "speed_max_kmh": min(120, speed_min + 20),
                    }
                )
                raw["events"].update(
                    {
                        "count_min": 1 + index % 2,
                        "count_max": 1 + index % 2,
                        "time_min_s": event_start,
                        "time_max_s": min(30, event_start + 5),
                        "severity": severity_schedule[split][
                            local_index % len(severity_schedule[split])
                        ],
                    }
                )
            else:
                event_count = 1 + index % 3
                event_types = [
                    EVENT_TYPES[(index + item) % len(EVENT_TYPES)] for item in range(event_count)
                ]
                raw["vehicles"].update(
                    {
                        "count": 80 + (index * 7) % 21,
                        "speed_min_kmh": 30 + (index * 3) % 11,
                        "speed_max_kmh": 50 + (index * 5) % 11,
                    }
                )
                raw["events"] = {
                    "types": event_types,
                    "times_s": [12 + 7 * item + index % 3 for item in range(event_count)],
                    "severities": [
                        round(0.55 + 0.15 * ((index + item) % 3), 2) for item in range(event_count)
                    ],
                }
                raw["traffic_lights"] = {
                    "type": ("static", "actuated", "delay_based")[index % 3],
                    "green_time_s": (24, 30, 36)[index % 3],
                }
            raw["seed"] = 20260723 + index
            definitions.append(
                ScenarioDefinition(
                    scenario_id=f"config_{index + 1:03d}",
                    domain=domain,
                    split=split,  # type: ignore[arg-type]
                    parameters=raw,
                )
            )
        offset += count
    return definitions


def make_single_event_matrix(
    definitions: list[ScenarioDefinition],
) -> list[ScenarioDefinition]:
    """Return a course-demo matrix with exactly one emergency event per scenario."""
    result: list[ScenarioDefinition] = []
    for definition in definitions:
        parameters = copy.deepcopy(definition.parameters)
        if definition.domain != "highway":
            raise ValueError("the single-event course-demo protocol is highway-only")
        parameters["events"]["count_min"] = 1
        parameters["events"]["count_max"] = 1
        result.append(replace(definition, parameters=parameters))
    return result


def build_safety_scenario_matrix(
    base_config: dict[str, Any],
    *,
    train_count: int = 12,
    validation_count: int = 9,
    test_count: int = 6,
) -> list[ScenarioDefinition]:
    """Build the v6 curriculum with deliberate high-risk representation."""
    definitions = build_scenario_matrix(
        "highway",
        base_config,
        train_count=train_count,
        validation_count=validation_count,
        test_count=test_count,
    )
    schedules = {
        "train": (0.35, 0.60, 0.82, 0.92),
        "validation": (0.40, 0.60, 0.82, 0.45, 0.70, 0.87, 0.35, 0.55, 0.95),
    }
    split_indices = {"train": 0, "validation": 0, "test": 0}
    result: list[ScenarioDefinition] = []
    for definition in definitions:
        local_index = split_indices[definition.split]
        split_indices[definition.split] += 1
        if definition.split == "test":
            result.append(definition)
            continue
        parameters = copy.deepcopy(definition.parameters)
        schedule = schedules[definition.split]
        parameters["events"]["severity"] = schedule[local_index % len(schedule)]
        result.append(replace(definition, parameters=parameters))
    return result


def materialize_scenario(
    definition: ScenarioDefinition,
    output_directory: Path,
    *,
    seed: int,
) -> Path:
    """Generate one resolved SUMO scenario and a hash-addressed manifest."""
    output_directory.mkdir(parents=True, exist_ok=True)
    config_path = output_directory / "scenario_config.yaml"
    config_path.write_text(yaml.safe_dump(definition.parameters, sort_keys=False), encoding="utf-8")
    manifest_path = output_directory / "scenario_manifest.json"
    config_hash = sha256_file(config_path)
    if manifest_path.is_file() and (output_directory / "trajectory.xml").is_file():
        import json

        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if previous.get("config_sha256") == config_hash and previous.get("seed") == seed:
            return output_directory
    generator = (
        generate_highway_scenario if definition.domain == "highway" else generate_urban_scenario
    )
    generator(output_directory, config_path=config_path, seed_override=seed)
    atomic_write_json(
        manifest_path,
        {
            "scenario_id": definition.scenario_id,
            "domain": definition.domain,
            "split": definition.split,
            "seed": seed,
            "config_sha256": config_hash,
            "events_sha256": sha256_file(output_directory / "events.json"),
            "trajectory_sha256": sha256_file(output_directory / "trajectory.xml"),
        },
    )
    return output_directory

"""Generate and execute the M1 single-direction highway emergency scenario."""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = BACKEND_ROOT / "configs" / "scenarios" / "highway_emergency.yaml"
MANAGED_OUTPUTS = (
    "highway.net.xml",
    "vehicles.rou.xml",
    "scenario.sumocfg",
    "trajectory.xml",
    "events.json",
)


class ScenarioGenerationError(RuntimeError):
    """Raised when a scenario cannot be generated or simulated."""


@dataclass(frozen=True)
class ScenarioConfig:
    seed: int
    road_length_m: float
    lane_count: int
    speed_limit_kmh: float
    vehicle_count_min: int
    vehicle_count_max: int
    speed_min_kmh: float
    speed_max_kmh: float
    minimum_spacing_m: float
    event_count_min: int
    event_count_max: int
    event_time_min_s: float
    event_time_max_s: float
    braking_deceleration_mps2: float
    braking_duration_s: float
    event_severity: float
    simulation_duration_s: float
    step_length_s: float


@dataclass(frozen=True)
class VehicleDefinition:
    vehicle_id: str
    lane: int
    depart_position_m: float
    depart_speed_mps: float


@dataclass(frozen=True)
class ScheduledEvent:
    timestamp: float
    vehicle_id: str


@dataclass(frozen=True)
class ScenarioArtifacts:
    output_directory: Path
    network: Path
    routes: Path
    configuration: Path
    trajectory: Path
    events: Path


def _required_mapping(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        raise ScenarioGenerationError(f"Configuration section '{key}' must be a mapping.")
    return value


def load_scenario_config(path: Path) -> ScenarioConfig:
    """Load and validate a highway scenario YAML file."""
    try:
        raw_data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ScenarioGenerationError(f"Unable to read scenario config: {path}") from exc
    if not isinstance(raw_data, dict):
        raise ScenarioGenerationError("Scenario configuration must be a mapping.")

    road = _required_mapping(raw_data, "road")
    vehicles = _required_mapping(raw_data, "vehicles")
    events = _required_mapping(raw_data, "events")
    simulation = _required_mapping(raw_data, "simulation")

    try:
        config = ScenarioConfig(
            seed=int(raw_data.get("seed", 42)),
            road_length_m=float(road["length_m"]),
            lane_count=int(road["lanes"]),
            speed_limit_kmh=float(road["speed_limit_kmh"]),
            vehicle_count_min=int(vehicles["count_min"]),
            vehicle_count_max=int(vehicles["count_max"]),
            speed_min_kmh=float(vehicles["speed_min_kmh"]),
            speed_max_kmh=float(vehicles["speed_max_kmh"]),
            minimum_spacing_m=float(vehicles["minimum_spacing_m"]),
            event_count_min=int(events["count_min"]),
            event_count_max=int(events["count_max"]),
            event_time_min_s=float(events["time_min_s"]),
            event_time_max_s=float(events["time_max_s"]),
            braking_deceleration_mps2=float(events["braking_deceleration_mps2"]),
            braking_duration_s=float(events["braking_duration_s"]),
            event_severity=float(events["severity"]),
            simulation_duration_s=float(simulation["duration_s"]),
            step_length_s=float(simulation["step_length_s"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ScenarioGenerationError(f"Invalid scenario configuration value: {exc}") from exc

    _validate_config(config)
    return config


def _validate_config(config: ScenarioConfig) -> None:
    if config.road_length_m != 5000:
        raise ScenarioGenerationError("M1 highway length must be exactly 5000 metres.")
    if config.lane_count != 3:
        raise ScenarioGenerationError("M1 highway must contain exactly three lanes.")
    if not 30 <= config.vehicle_count_min <= config.vehicle_count_max <= 50:
        raise ScenarioGenerationError("Vehicle count range must stay within 30-50.")
    if not 80 <= config.speed_min_kmh <= config.speed_max_kmh <= 120:
        raise ScenarioGenerationError("Vehicle speeds must stay within 80-120 km/h.")
    if not 1 <= config.event_count_min <= config.event_count_max <= 2:
        raise ScenarioGenerationError("Emergency event count must stay within 1-2.")
    if not 10 <= config.event_time_min_s <= config.event_time_max_s <= 30:
        raise ScenarioGenerationError("Emergency event time must stay within 10-30 seconds.")
    if config.simulation_duration_s <= config.event_time_max_s + config.braking_duration_s:
        raise ScenarioGenerationError("Simulation must continue beyond the final braking event.")
    if config.minimum_spacing_m <= 0 or config.step_length_s <= 0:
        raise ScenarioGenerationError("Spacing and simulation step length must be positive.")
    if config.braking_deceleration_mps2 <= 0 or config.braking_duration_s <= 0:
        raise ScenarioGenerationError("Braking parameters must be positive.")
    if not 0 <= config.event_severity <= 1:
        raise ScenarioGenerationError("Event severity must be between 0 and 1.")


def resolve_output_directory(output: str | Path) -> Path:
    """Resolve relative experiment paths under BackEnd to preserve the root layout."""
    output_path = Path(output).expanduser()
    if not output_path.is_absolute():
        output_path = BACKEND_ROOT / output_path
    return output_path.resolve()


def _find_binary(name: str) -> Path | None:
    candidates: list[Path] = []
    sumo_home = os.environ.get("SUMO_HOME")
    if sumo_home:
        candidates.append(Path(sumo_home) / "bin" / name)
    if path_binary := shutil.which(name):
        candidates.append(Path(path_binary))
    candidates.append(Path(sys.prefix) / "bin" / name)
    if sys.platform == "win32":
        candidates.extend(candidate.with_suffix(".exe") for candidate in list(candidates))
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


def sumo_runtime_available() -> bool:
    if _find_binary("sumo") is None or _find_binary("netconvert") is None:
        return False
    try:
        import traci  # noqa: F401
    except ImportError:
        return False
    return True


def build_vehicle_definitions(
    config: ScenarioConfig, rng: random.Random
) -> list[VehicleDefinition]:
    """Create non-overlapping, reproducible initial vehicle states."""
    vehicle_count = rng.randint(config.vehicle_count_min, config.vehicle_count_max)
    speed_limit_mps = config.speed_limit_kmh / 3.6
    event_buffer_s = config.event_time_max_s + config.braking_duration_s + 5
    maximum_position = config.road_length_m - speed_limit_mps * event_buffer_s
    if maximum_position <= 0:
        raise ScenarioGenerationError("Road is too short to keep vehicles active for all events.")

    positions_per_lane = math.floor(maximum_position / config.minimum_spacing_m)
    slots = [
        (lane, position_index * config.minimum_spacing_m)
        for lane in range(config.lane_count)
        for position_index in range(positions_per_lane)
    ]
    if len(slots) < vehicle_count:
        raise ScenarioGenerationError("Not enough safe departure positions for the vehicle count.")
    rng.shuffle(slots)

    return [
        VehicleDefinition(
            vehicle_id=f"vehicle_{index:03d}",
            lane=lane,
            depart_position_m=position,
            depart_speed_mps=rng.uniform(config.speed_min_kmh, config.speed_max_kmh) / 3.6,
        )
        for index, (lane, position) in enumerate(slots[:vehicle_count])
    ]


def build_event_schedule(
    config: ScenarioConfig,
    vehicles: list[VehicleDefinition],
    rng: random.Random,
) -> list[ScheduledEvent]:
    """Select distinct vehicles and reproducible trigger times."""
    event_count = rng.randint(config.event_count_min, config.event_count_max)
    selected_vehicles = rng.sample(vehicles, event_count)
    timestamps = sorted(
        rng.uniform(config.event_time_min_s, config.event_time_max_s) for _ in range(event_count)
    )
    return [
        ScheduledEvent(timestamp=timestamp, vehicle_id=vehicle.vehicle_id)
        for timestamp, vehicle in zip(timestamps, selected_vehicles, strict=True)
    ]


def _prepare_output_directory(output_directory: Path) -> ScenarioArtifacts:
    output_directory.mkdir(parents=True, exist_ok=True)
    for filename in MANAGED_OUTPUTS:
        managed_path = output_directory / filename
        if managed_path.is_file():
            managed_path.unlink()
    return ScenarioArtifacts(
        output_directory=output_directory,
        network=output_directory / "highway.net.xml",
        routes=output_directory / "vehicles.rou.xml",
        configuration=output_directory / "scenario.sumocfg",
        trajectory=output_directory / "trajectory.xml",
        events=output_directory / "events.json",
    )


def _write_network(config: ScenarioConfig, artifacts: ScenarioArtifacts) -> None:
    # This scenario has fixed, validated geometry. Writing its network directly
    # avoids unstable netconvert builds (notably SUMO 1.12 on some Colab images).
    _write_compatible_network(config, artifacts)


def _write_compatible_network(config: ScenarioConfig, artifacts: ScenarioArtifacts) -> None:
    """Write the validated fixed three-lane road without invoking netconvert."""
    speed_mps = config.speed_limit_kmh / 3.6
    lane_width_m = 3.2
    root = ET.Element(
        "net",
        version="1.9",
        junctionCornerDetail="5",
        limitTurnSpeed="5.50",
    )
    ET.SubElement(
        root,
        "location",
        netOffset="0.00,0.00",
        convBoundary=f"0.00,0.00,{config.road_length_m:.2f},0.00",
        origBoundary=f"0.00,0.00,{config.road_length_m:.2f},0.00",
        projParameter="!",
    )
    edge = ET.SubElement(root, "edge", id="highway", **{"from": "start", "to": "end"}, priority="1")
    lane_ids = []
    for lane_index in range(config.lane_count):
        lane_id = f"highway_{lane_index}"
        lane_ids.append(lane_id)
        lateral_position = -(config.lane_count - lane_index - 0.5) * lane_width_m
        ET.SubElement(
            edge,
            "lane",
            id=lane_id,
            index=str(lane_index),
            speed=f"{speed_mps:.6f}",
            length=f"{config.road_length_m:.2f}",
            shape=(
                f"0.00,{lateral_position:.2f} {config.road_length_m:.2f},{lateral_position:.2f}"
            ),
        )
    road_width = config.lane_count * lane_width_m
    ET.SubElement(
        root,
        "junction",
        id="end",
        type="dead_end",
        x=f"{config.road_length_m:.2f}",
        y="0.00",
        incLanes=" ".join(lane_ids),
        intLanes="",
        shape=(f"{config.road_length_m:.2f},{-road_width:.2f} {config.road_length_m:.2f},0.00"),
    )
    ET.SubElement(
        root,
        "junction",
        id="start",
        type="dead_end",
        x="0.00",
        y="0.00",
        incLanes="",
        intLanes="",
        shape=f"0.00,0.00 0.00,{-road_width:.2f}",
    )
    ET.ElementTree(root).write(artifacts.network, encoding="utf-8", xml_declaration=True)


def _write_routes(vehicles: list[VehicleDefinition], artifacts: ScenarioArtifacts) -> None:
    routes_root = ET.Element("routes")
    ET.SubElement(
        routes_root,
        "vType",
        id="passenger",
        vClass="passenger",
        accel="2.6",
        decel="4.5",
        emergencyDecel="9.0",
        length="5.0",
        minGap="2.5",
        sigma="0",
    )
    ET.SubElement(routes_root, "route", id="highway_route", edges="highway")
    for vehicle in vehicles:
        ET.SubElement(
            routes_root,
            "vehicle",
            id=vehicle.vehicle_id,
            type="passenger",
            route="highway_route",
            depart="0",
            departLane=str(vehicle.lane),
            departPos=f"{vehicle.depart_position_m:.3f}",
            departSpeed=f"{vehicle.depart_speed_mps:.3f}",
        )
    ET.ElementTree(routes_root).write(artifacts.routes, encoding="utf-8", xml_declaration=True)


def _write_sumo_configuration(config: ScenarioConfig, artifacts: ScenarioArtifacts) -> None:
    root = ET.Element("configuration")
    input_element = ET.SubElement(root, "input")
    ET.SubElement(input_element, "net-file", value=artifacts.network.name)
    ET.SubElement(input_element, "route-files", value=artifacts.routes.name)
    time_element = ET.SubElement(root, "time")
    ET.SubElement(time_element, "begin", value="0")
    ET.SubElement(time_element, "end", value=str(config.simulation_duration_s))
    ET.SubElement(time_element, "step-length", value=str(config.step_length_s))
    output_element = ET.SubElement(root, "output")
    ET.SubElement(output_element, "fcd-output", value=artifacts.trajectory.name)
    ET.ElementTree(root).write(artifacts.configuration, encoding="utf-8", xml_declaration=True)


def _run_simulation(
    config: ScenarioConfig,
    schedule: list[ScheduledEvent],
    artifacts: ScenarioArtifacts,
    seed: int,
) -> list[dict[str, float | str]]:
    sumo = _find_binary("sumo")
    if sumo is None:
        raise ScenarioGenerationError("sumo was not found in PATH, SUMO_HOME, or the venv.")
    try:
        import traci
    except ImportError as exc:
        raise ScenarioGenerationError("The traci Python package is not installed.") from exc

    label = f"highway-{uuid.uuid4().hex}"
    started = False
    recorded_events: list[dict[str, float | str]] = []
    try:
        traci.start(
            [
                str(sumo),
                "-c",
                str(artifacts.configuration),
                "--fcd-output",
                str(artifacts.trajectory),
                "--seed",
                str(seed),
                "--no-step-log",
                "true",
                "--no-warnings",
                "true",
            ],
            label=label,
        )
        started = True
        connection = traci.getConnection(label)
        next_event_index = 0
        while connection.simulation.getTime() < config.simulation_duration_s:
            connection.simulationStep()
            simulation_time = connection.simulation.getTime()
            if next_event_index >= len(schedule):
                continue
            scheduled_event = schedule[next_event_index]
            if simulation_time + config.step_length_s / 2 < scheduled_event.timestamp:
                continue

            active_vehicle_ids = set(connection.vehicle.getIDList())
            vehicle_id = scheduled_event.vehicle_id
            if vehicle_id not in active_vehicle_ids:
                raise ScenarioGenerationError(
                    f"Scheduled vehicle '{vehicle_id}' is not active at {simulation_time:.2f}s."
                )
            x_position, y_position = connection.vehicle.getPosition(vehicle_id)
            current_speed = connection.vehicle.getSpeed(vehicle_id)
            target_speed = max(
                0.0,
                current_speed - config.braking_deceleration_mps2 * config.braking_duration_s,
            )
            connection.vehicle.slowDown(vehicle_id, target_speed, config.braking_duration_s)
            recorded_events.append(
                {
                    "type": "emergency_braking",
                    "x": round(float(x_position), 3),
                    "y": round(float(y_position), 3),
                    "timestamp": round(float(simulation_time), 3),
                    "severity": config.event_severity,
                }
            )
            next_event_index += 1
    finally:
        if started:
            traci.getConnection(label).close()

    if len(recorded_events) != len(schedule):
        raise ScenarioGenerationError("Not all scheduled emergency events were triggered.")
    return recorded_events


def generate_highway_scenario(
    output: str | Path,
    config_path: Path = DEFAULT_CONFIG_PATH,
    seed_override: int | None = None,
) -> ScenarioArtifacts:
    """Generate a complete SUMO package and run it to produce trajectory/event data."""
    config = load_scenario_config(config_path)
    seed = config.seed if seed_override is None else seed_override
    rng = random.Random(seed)
    vehicles = build_vehicle_definitions(config, rng)
    schedule = build_event_schedule(config, vehicles, rng)
    artifacts = _prepare_output_directory(resolve_output_directory(output))
    _write_network(config, artifacts)
    _write_routes(vehicles, artifacts)
    _write_sumo_configuration(config, artifacts)
    events = _run_simulation(config, schedule, artifacts, seed)
    artifacts.events.write_text(
        json.dumps(events, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return artifacts


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Output directory under BackEnd")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help="Scenario YAML configuration",
    )
    parser.add_argument("--seed", type=int, help="Override the configured random seed")
    return parser.parse_args()


def main() -> int:
    arguments = _parse_arguments()
    try:
        artifacts = generate_highway_scenario(
            output=arguments.output,
            config_path=arguments.config,
            seed_override=arguments.seed,
        )
    except (OSError, subprocess.CalledProcessError, ScenarioGenerationError) as exc:
        print(f"Scenario generation failed: {exc}", file=sys.stderr)
        return 1
    print(f"Highway scenario generated: {artifacts.output_directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

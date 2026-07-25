"""Generate and execute the M2 100-vehicle urban intersection scenario."""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = BACKEND_ROOT / "configs" / "scenarios" / "urban_intersection.yaml"
MANAGED_OUTPUTS = (
    "urban.net.xml",
    "vehicles.rou.xml",
    "scenario.sumocfg",
    "trajectory.xml",
    "events.json",
)
EVENT_TYPES = (
    "emergency_braking",
    "obstacle",
    "intersection_collision_warning",
)


class UrbanScenarioGenerationError(RuntimeError):
    """Raised when the urban scenario cannot be generated or simulated."""


@dataclass(frozen=True)
class UrbanScenarioConfig:
    seed: int
    road_length_m: float
    intersection_positions_m: tuple[float, ...]
    branch_length_m: float
    lanes_per_direction: int
    speed_limit_kmh: float
    vehicle_count: int
    speed_min_kmh: float
    speed_max_kmh: float
    minimum_spacing_m: float
    event_times_s: tuple[float, ...]
    event_types: tuple[str, ...]
    event_severities: tuple[float, ...]
    traffic_light_type: str
    traffic_light_green_time_s: float
    simulation_duration_s: float
    step_length_s: float


@dataclass(frozen=True)
class UrbanVehicleDefinition:
    vehicle_id: str
    route_id: str
    lane: int
    depart_position_m: float
    depart_speed_mps: float


@dataclass(frozen=True)
class UrbanScheduledEvent:
    event_type: str
    timestamp: float
    vehicle_id: str
    severity: float


@dataclass(frozen=True)
class UrbanScenarioArtifacts:
    output_directory: Path
    network: Path
    routes: Path
    configuration: Path
    trajectory: Path
    events: Path


def _required_mapping(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        raise UrbanScenarioGenerationError(f"Configuration section '{key}' must be a mapping.")
    return value


def load_urban_scenario_config(path: Path) -> UrbanScenarioConfig:
    """Load and validate an urban scenario YAML file."""
    try:
        raw_data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise UrbanScenarioGenerationError(f"Unable to read scenario config: {path}") from exc
    if not isinstance(raw_data, dict):
        raise UrbanScenarioGenerationError("Scenario configuration must be a mapping.")

    road = _required_mapping(raw_data, "road")
    vehicles = _required_mapping(raw_data, "vehicles")
    events = _required_mapping(raw_data, "events")
    simulation = _required_mapping(raw_data, "simulation")
    try:
        config = UrbanScenarioConfig(
            seed=int(raw_data.get("seed", 42)),
            road_length_m=float(road["length_m"]),
            intersection_positions_m=tuple(float(value) for value in road["intersections_m"]),
            branch_length_m=float(road["branch_length_m"]),
            lanes_per_direction=int(road["lanes_per_direction"]),
            speed_limit_kmh=float(road["speed_limit_kmh"]),
            vehicle_count=int(vehicles["count"]),
            speed_min_kmh=float(vehicles["speed_min_kmh"]),
            speed_max_kmh=float(vehicles["speed_max_kmh"]),
            minimum_spacing_m=float(vehicles["minimum_spacing_m"]),
            event_times_s=tuple(float(value) for value in events["times_s"]),
            event_types=tuple(str(value) for value in events.get("types", EVENT_TYPES)),
            event_severities=tuple(float(value) for value in events["severities"]),
            traffic_light_type=str(raw_data.get("traffic_lights", {}).get("type", "static")),
            traffic_light_green_time_s=float(
                raw_data.get("traffic_lights", {}).get("green_time_s", 30)
            ),
            simulation_duration_s=float(simulation["duration_s"]),
            step_length_s=float(simulation["step_length_s"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise UrbanScenarioGenerationError(f"Invalid scenario configuration value: {exc}") from exc
    _validate_config(config)
    return config


def _validate_config(config: UrbanScenarioConfig) -> None:
    if config.road_length_m != 5000:
        raise UrbanScenarioGenerationError("Urban corridor length must be exactly 5000 metres.")
    if len(config.intersection_positions_m) != 3:
        raise UrbanScenarioGenerationError(
            "Urban corridor must contain exactly three intersections."
        )
    if tuple(sorted(config.intersection_positions_m)) != config.intersection_positions_m:
        raise UrbanScenarioGenerationError("Intersection positions must be strictly ordered.")
    if not all(0 < value < config.road_length_m for value in config.intersection_positions_m):
        raise UrbanScenarioGenerationError("Intersections must lie inside the corridor.")
    if config.branch_length_m != 500 or config.lanes_per_direction != 2:
        raise UrbanScenarioGenerationError(
            "Urban roads require 500m branches and two lanes per direction."
        )
    if not 80 <= config.vehicle_count <= 100:
        raise UrbanScenarioGenerationError("M2 urban scenarios require 80-100 vehicles.")
    if not 30 <= config.speed_min_kmh <= config.speed_max_kmh <= 60:
        raise UrbanScenarioGenerationError("Vehicle speeds must stay within 30-60 km/h.")
    if not 1 <= len(config.event_times_s) <= 3:
        raise UrbanScenarioGenerationError("Urban scenarios require one to three events.")
    if not (len(config.event_times_s) == len(config.event_types) == len(config.event_severities)):
        raise UrbanScenarioGenerationError(
            "Event types, times and severities must have equal length."
        )
    if any(event_type not in EVENT_TYPES for event_type in config.event_types):
        raise UrbanScenarioGenerationError("Urban event type is unsupported.")
    if not all(10 <= timestamp <= 30 for timestamp in config.event_times_s):
        raise UrbanScenarioGenerationError("Event times must stay within 10-30 seconds.")
    if not all(0 <= severity <= 1 for severity in config.event_severities):
        raise UrbanScenarioGenerationError("Event severities must stay within 0-1.")
    if config.simulation_duration_s <= max(config.event_times_s):
        raise UrbanScenarioGenerationError("Simulation must continue beyond the final event.")
    if config.minimum_spacing_m <= 0 or config.step_length_s <= 0:
        raise UrbanScenarioGenerationError("Spacing and simulation step length must be positive.")
    if config.traffic_light_type not in {"static", "actuated", "delay_based"}:
        raise UrbanScenarioGenerationError("Unsupported traffic light type.")
    if config.traffic_light_green_time_s <= 0:
        raise UrbanScenarioGenerationError("Traffic light green time must be positive.")


def resolve_output_directory(output: str | Path) -> Path:
    output_path = Path(output).expanduser()
    if not output_path.is_absolute():
        output_path = BACKEND_ROOT / output_path
    return output_path.resolve()


def _find_binary(name: str) -> Path | None:
    candidates: list[Path] = []
    if sumo_home := os.environ.get("SUMO_HOME"):
        candidates.append(Path(sumo_home) / "bin" / name)
    if path_binary := shutil.which(name):
        candidates.append(Path(path_binary))
    candidates.append(Path(sys.prefix) / "bin" / name)
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
    config: UrbanScenarioConfig, rng: random.Random
) -> list[UrbanVehicleDefinition]:
    """Build exactly 100 reproducible vehicle definitions over all road directions."""
    route_lengths = {
        "west_to_east": config.intersection_positions_m[0],
        "east_to_west": config.road_length_m - config.intersection_positions_m[-1],
        **{f"south_to_north_{index}": config.branch_length_m for index in range(1, 4)},
        **{f"north_to_south_{index}": config.branch_length_m for index in range(1, 4)},
    }
    slots = [
        (route_id, lane, position)
        for route_id, length in route_lengths.items()
        for lane in range(config.lanes_per_direction)
        for position in range(
            0, int(length - config.minimum_spacing_m), int(config.minimum_spacing_m)
        )
    ]
    if len(slots) < config.vehicle_count:
        raise UrbanScenarioGenerationError("Not enough departure slots for 100 vehicles.")
    rng.shuffle(slots)
    selected = slots[: config.vehicle_count]
    speeds_by_index: dict[int, float] = {}
    groups: dict[tuple[str, int], list[tuple[int, float]]] = {}
    for index, (route_id, lane, position) in enumerate(selected):
        groups.setdefault((route_id, lane), []).append((index, position))
    for group in groups.values():
        ordered_positions = sorted(group, key=lambda item: item[1])
        ordered_speeds = sorted(
            rng.uniform(config.speed_min_kmh, config.speed_max_kmh) / 3.6 for _ in ordered_positions
        )
        for (index, _), speed in zip(ordered_positions, ordered_speeds, strict=True):
            speeds_by_index[index] = speed
    return [
        UrbanVehicleDefinition(
            vehicle_id=f"vehicle_{index:03d}",
            route_id=route_id,
            lane=lane,
            depart_position_m=float(position),
            depart_speed_mps=speeds_by_index[index],
        )
        for index, (route_id, lane, position) in enumerate(selected)
    ]


def build_event_schedule(
    config: UrbanScenarioConfig,
    vehicles: list[UrbanVehicleDefinition],
    rng: random.Random,
) -> list[UrbanScheduledEvent]:
    """Schedule one event of each required type on long-lived corridor vehicles."""
    latest_event_time = max(config.event_times_s, default=0.0)
    corridor_vehicles = [
        vehicle
        for vehicle in vehicles
        if vehicle.route_id in {"west_to_east", "east_to_west"}
        and config.road_length_m - vehicle.depart_position_m
        > vehicle.depart_speed_mps * (latest_event_time + 5.0)
    ]
    if len(corridor_vehicles) < len(config.event_types):
        raise UrbanScenarioGenerationError(
            "Not enough corridor vehicles are available for configured events."
        )
    selected = rng.sample(corridor_vehicles, len(config.event_types))
    return [
        UrbanScheduledEvent(event_type, timestamp, vehicle.vehicle_id, severity)
        for event_type, timestamp, vehicle, severity in zip(
            config.event_types,
            config.event_times_s,
            selected,
            config.event_severities,
            strict=True,
        )
    ]


def _prepare_output_directory(output_directory: Path) -> UrbanScenarioArtifacts:
    output_directory.mkdir(parents=True, exist_ok=True)
    for filename in MANAGED_OUTPUTS:
        path = output_directory / filename
        if path.is_file():
            path.unlink()
    return UrbanScenarioArtifacts(
        output_directory=output_directory,
        network=output_directory / "urban.net.xml",
        routes=output_directory / "vehicles.rou.xml",
        configuration=output_directory / "scenario.sumocfg",
        trajectory=output_directory / "trajectory.xml",
        events=output_directory / "events.json",
    )


def _write_network(config: UrbanScenarioConfig, artifacts: UrbanScenarioArtifacts) -> None:
    netconvert = _find_binary("netconvert")
    if netconvert is None:
        raise UrbanScenarioGenerationError("netconvert was not found in PATH, SUMO_HOME, or venv.")
    with tempfile.TemporaryDirectory(prefix="g11-urban-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        nodes_path = temporary_path / "urban.nod.xml"
        edges_path = temporary_path / "urban.edg.xml"
        nodes = ET.Element("nodes")
        ET.SubElement(nodes, "node", id="west", x="0", y="0", type="dead_end")
        ET.SubElement(nodes, "node", id="east", x=str(config.road_length_m), y="0", type="dead_end")
        for index, x_position in enumerate(config.intersection_positions_m, start=1):
            ET.SubElement(
                nodes,
                "node",
                id=f"junction_{index}",
                x=str(x_position),
                y="0",
                type="traffic_light",
            )
            ET.SubElement(
                nodes,
                "node",
                id=f"south_{index}",
                x=str(x_position),
                y=str(-config.branch_length_m),
                type="dead_end",
            )
            ET.SubElement(
                nodes,
                "node",
                id=f"north_{index}",
                x=str(x_position),
                y=str(config.branch_length_m),
                type="dead_end",
            )
        ET.ElementTree(nodes).write(nodes_path, encoding="utf-8", xml_declaration=True)

        edges = ET.Element("edges")
        chain = ("west", "junction_1", "junction_2", "junction_3", "east")
        speed = f"{config.speed_limit_kmh / 3.6:.6f}"
        for source, target in zip(chain, chain[1:]):
            for edge_id, edge_from, edge_to in (
                (f"{source}_{target}", source, target),
                (f"{target}_{source}", target, source),
            ):
                ET.SubElement(
                    edges,
                    "edge",
                    id=edge_id,
                    **{
                        "from": edge_from,
                        "to": edge_to,
                        "numLanes": str(config.lanes_per_direction),
                        "speed": speed,
                    },
                )
        for index in range(1, 4):
            for edge_id, source, target in (
                (f"south_{index}_junction_{index}", f"south_{index}", f"junction_{index}"),
                (f"junction_{index}_north_{index}", f"junction_{index}", f"north_{index}"),
                (f"north_{index}_junction_{index}", f"north_{index}", f"junction_{index}"),
                (f"junction_{index}_south_{index}", f"junction_{index}", f"south_{index}"),
            ):
                ET.SubElement(
                    edges,
                    "edge",
                    id=edge_id,
                    **{
                        "from": source,
                        "to": target,
                        "numLanes": str(config.lanes_per_direction),
                        "speed": speed,
                    },
                )
        ET.ElementTree(edges).write(edges_path, encoding="utf-8", xml_declaration=True)
        subprocess.run(
            [
                str(netconvert),
                "--node-files",
                str(nodes_path),
                "--edge-files",
                str(edges_path),
                "--output-file",
                str(artifacts.network),
                "--no-turnarounds",
                "true",
                "--tls.default-type",
                config.traffic_light_type,
                "--tls.green.time",
                f"{config.traffic_light_green_time_s:g}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )


def _write_routes(
    vehicles: list[UrbanVehicleDefinition], artifacts: UrbanScenarioArtifacts
) -> None:
    root = ET.Element("routes")
    ET.SubElement(
        root,
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
    eastbound = "west_junction_1 junction_1_junction_2 junction_2_junction_3 junction_3_east"
    westbound = "east_junction_3 junction_3_junction_2 junction_2_junction_1 junction_1_west"
    ET.SubElement(root, "route", id="west_to_east", edges=eastbound)
    ET.SubElement(root, "route", id="east_to_west", edges=westbound)
    for index in range(1, 4):
        ET.SubElement(
            root,
            "route",
            id=f"south_to_north_{index}",
            edges=f"south_{index}_junction_{index} junction_{index}_north_{index}",
        )
        ET.SubElement(
            root,
            "route",
            id=f"north_to_south_{index}",
            edges=f"north_{index}_junction_{index} junction_{index}_south_{index}",
        )
    for vehicle in vehicles:
        ET.SubElement(
            root,
            "vehicle",
            id=vehicle.vehicle_id,
            type="passenger",
            route=vehicle.route_id,
            depart="0",
            departLane=str(vehicle.lane),
            departPos=f"{vehicle.depart_position_m:.3f}",
            departSpeed=f"{vehicle.depart_speed_mps:.3f}",
        )
    ET.ElementTree(root).write(artifacts.routes, encoding="utf-8", xml_declaration=True)


def _write_sumo_configuration(
    config: UrbanScenarioConfig, artifacts: UrbanScenarioArtifacts
) -> None:
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
    config: UrbanScenarioConfig,
    schedule: list[UrbanScheduledEvent],
    artifacts: UrbanScenarioArtifacts,
    seed: int,
) -> list[dict[str, float | str]]:
    sumo = _find_binary("sumo")
    if sumo is None:
        raise UrbanScenarioGenerationError("sumo was not found in PATH, SUMO_HOME, or venv.")
    try:
        import traci
    except ImportError as exc:
        raise UrbanScenarioGenerationError("The traci Python package is not installed.") from exc

    label = f"urban-{uuid.uuid4().hex}"
    started = False
    recorded: list[dict[str, float | str]] = []
    used_vehicle_ids: set[str] = set()
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
        next_event = 0
        while connection.simulation.getTime() < config.simulation_duration_s:
            connection.simulationStep()
            simulation_time = connection.simulation.getTime()
            if next_event >= len(schedule):
                continue
            event = schedule[next_event]
            if simulation_time + config.step_length_s / 2 < event.timestamp:
                continue
            active_vehicle_ids = sorted(connection.vehicle.getIDList())
            vehicle_id = event.vehicle_id
            if vehicle_id not in active_vehicle_ids:
                replacements = [
                    candidate
                    for candidate in active_vehicle_ids
                    if candidate not in used_vehicle_ids
                ]
                if not replacements:
                    raise UrbanScenarioGenerationError(
                        f"No active vehicle is available at {simulation_time:.2f}s."
                    )
                vehicle_id = replacements[0]
            used_vehicle_ids.add(vehicle_id)
            x_position, y_position = connection.vehicle.getPosition(vehicle_id)
            if event.event_type == "emergency_braking":
                current_speed = connection.vehicle.getSpeed(vehicle_id)
                connection.vehicle.slowDown(vehicle_id, max(0.0, current_speed - 12.0), 2.0)
            elif event.event_type == "obstacle":
                connection.vehicle.slowDown(vehicle_id, 0.0, 3.0)
            recorded.append(
                {
                    "type": event.event_type,
                    "x": round(float(x_position), 3),
                    "y": round(float(y_position), 3),
                    "timestamp": round(float(simulation_time), 3),
                    "severity": event.severity,
                }
            )
            next_event += 1
    finally:
        if started:
            traci.getConnection(label).close()
    if len(recorded) != len(schedule):
        raise UrbanScenarioGenerationError("Not all scheduled urban events were triggered.")
    return recorded


def generate_urban_scenario(
    output: str | Path,
    config_path: Path = DEFAULT_CONFIG_PATH,
    seed_override: int | None = None,
) -> UrbanScenarioArtifacts:
    """Generate the complete SUMO urban package and its offline trajectory."""
    config = load_urban_scenario_config(config_path)
    seed = config.seed if seed_override is None else seed_override
    rng = random.Random(seed)
    vehicles = build_vehicle_definitions(config, rng)
    schedule = build_event_schedule(config, vehicles, rng)
    artifacts = _prepare_output_directory(resolve_output_directory(output))
    _write_network(config, artifacts)
    _write_routes(vehicles, artifacts)
    _write_sumo_configuration(config, artifacts)
    events = _run_simulation(config, schedule, artifacts, seed)
    artifacts.events.write_text(json.dumps(events, indent=2) + "\n", encoding="utf-8")
    return artifacts


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Output directory under BackEnd")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--seed", type=int)
    return parser.parse_args()


def main() -> int:
    arguments = _parse_arguments()
    try:
        artifacts = generate_urban_scenario(arguments.output, arguments.config, arguments.seed)
    except (OSError, subprocess.CalledProcessError, UrbanScenarioGenerationError) as exc:
        print(f"Urban scenario generation failed: {exc}", file=sys.stderr)
        return 1
    print(f"Urban scenario generated: {artifacts.output_directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

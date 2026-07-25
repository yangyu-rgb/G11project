"""Immutable scenario state shared by environments, services, and evaluators."""

from dataclasses import dataclass


@dataclass(frozen=True)
class VehicleSnapshot:
    vehicle_id: str
    x: float
    y: float
    speed: float
    angle: float
    lane_id: str = ""


@dataclass(frozen=True)
class TrajectoryFrame:
    timestamp: float
    vehicles: tuple[VehicleSnapshot, ...]


@dataclass(frozen=True)
class EmergencyEvent:
    event_id: str
    event_type: str
    x: float
    y: float
    timestamp: float
    severity: float


@dataclass(frozen=True)
class SimulationSnapshot:
    """Immutable view of the raw scenario state at one environment step."""

    step_index: int
    timestamp: float
    vehicles: tuple[VehicleSnapshot, ...]
    events: tuple[EmergencyEvent, ...]

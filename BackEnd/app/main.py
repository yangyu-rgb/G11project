import asyncio
import math
import time
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.api.router import api_router
from src.environment.v2x_env import SimulationSnapshot, V2XEnv
from src.models.ppo_agent import PPOAgent

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
MIN_SIMULATION_SPEED = 0.25
MAX_SIMULATION_SPEED = 4.0

app = FastAPI(
    title="G11project API",
    version="0.1.0",
    description="G11project 后端服务",
)
app.include_router(api_router, prefix="/api/v1")


@app.websocket("/ws/simulation")
async def simulation_websocket(websocket: WebSocket) -> None:
    """Send an M0 heartbeat until the browser disconnects."""
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(
                {
                    "type": "test",
                    "timestamp": time.time(),
                    "message": "Hello from backend",
                }
            )
            try:
                event = await asyncio.wait_for(websocket.receive(), timeout=1)
            except TimeoutError:
                continue
            if event["type"] == "websocket.disconnect":
                return
    except WebSocketDisconnect:
        return


def _resolve_simulation_path(raw_path: str, *, kind: str) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = BACKEND_DIRECTORY / path
    resolved = path.resolve()
    exists = resolved.is_dir() if kind == "scenario" else resolved.is_file()
    if not exists:
        raise FileNotFoundError(f"{kind} path does not exist: {resolved}")
    return resolved


def _create_environment(scenario_path: Path) -> V2XEnv:
    return V2XEnv(scenario_path)


def _load_agent(model_path: Path, environment: V2XEnv) -> PPOAgent:
    return PPOAgent.load(model_path, environment)


def _state_update(
    snapshot: SimulationSnapshot,
    action: np.ndarray,
    info: dict[str, Any],
) -> dict[str, Any]:
    selected_receivers = list(info["selected_receiver_ids"])
    transmissions = info["transmissions"]
    sender_ids = {
        transmission["sender_id"]
        for transmission in transmissions
        if transmission["sender_id"] is not None
    }
    selected_set = set(selected_receivers)
    vehicles = []
    for vehicle in snapshot.vehicles:
        angle_radians = math.radians(vehicle.angle)
        status = "normal"
        if vehicle.vehicle_id in selected_set:
            status = "receiving"
        if vehicle.vehicle_id in sender_ids:
            status = "sending"
        vehicles.append(
            {
                "id": vehicle.vehicle_id,
                "x": vehicle.x,
                "y": vehicle.y,
                "vx": vehicle.speed * math.sin(angle_radians),
                "vy": vehicle.speed * math.cos(angle_radians),
                "heading": vehicle.angle,
                "status": status,
            }
        )

    successful_count = sum(bool(item["delivered"]) for item in transmissions)
    transmission_count = len(transmissions)
    average_delay = (
        sum(float(item["latency_ms"]) for item in transmissions) / transmission_count
        if transmission_count
        else 0.0
    )
    delivery_rate = successful_count / transmission_count if transmission_count else 0.0
    communication_overhead = (
        transmission_count / successful_count if successful_count else float(transmission_count)
    )
    bandwidth_fraction = (int(action[-1]) + 1) / 10.0
    receiver_share = bandwidth_fraction / len(selected_receivers) if selected_receivers else 0.0
    priority_name = ("low", "medium", "high")[int(action[-2])]

    return {
        "type": "state_update",
        "timestamp": snapshot.timestamp,
        "vehicles": vehicles,
        "events": [
            {
                "id": event.event_id,
                "type": (
                    "emergency_brake"
                    if event.event_type == "emergency_braking"
                    else event.event_type
                ),
                "x": event.x,
                "y": event.y,
                "timestamp": event.timestamp,
                "severity": event.severity,
            }
            for event in snapshot.events
        ],
        "messages": [
            {
                "from": item["sender_id"],
                "to": item["receiver_id"],
                "status": "success" if item["delivered"] else "timeout",
                "delay_ms": float(item["latency_ms"]),
            }
            for item in transmissions
        ],
        "metrics": {
            "avg_delay_ms": average_delay,
            "delivery_rate": delivery_rate,
            "comm_overhead": communication_overhead,
        },
        "decision": {
            "selected_receivers": selected_receivers,
            "priority": priority_name,
            "bandwidth_allocation": [receiver_share] * len(selected_receivers),
        },
    }


async def _send_control_ack(
    websocket: WebSocket, action: str, *, playing: bool, speed: float
) -> None:
    await websocket.send_json(
        {
            "type": "control_ack",
            "action": action,
            "playing": playing,
            "speed": speed,
        }
    )


async def _send_simulation_error(websocket: WebSocket, code: str, message: str) -> None:
    await websocket.send_json({"type": "error", "code": code, "message": message})


@app.websocket("/ws/simulation/run")
async def run_simulation_websocket(websocket: WebSocket) -> None:
    """Run an isolated offline PPO episode and stream its complete state."""
    await websocket.accept()
    scenario_query = websocket.query_params.get("scenario")
    model_query = websocket.query_params.get("model")
    if not scenario_query or not model_query:
        await _send_simulation_error(
            websocket,
            "missing_parameters",
            "scenario and model query parameters are required",
        )
        await websocket.close(code=1008)
        return

    try:
        speed = float(websocket.query_params.get("speed", "1"))
        if not MIN_SIMULATION_SPEED <= speed <= MAX_SIMULATION_SPEED:
            raise ValueError
    except ValueError:
        await _send_simulation_error(
            websocket,
            "invalid_speed",
            f"speed must be between {MIN_SIMULATION_SPEED} and {MAX_SIMULATION_SPEED}",
        )
        await websocket.close(code=1008)
        return

    try:
        scenario_path = _resolve_simulation_path(scenario_query, kind="scenario")
        model_path = _resolve_simulation_path(model_query, kind="model")
        environment = _create_environment(scenario_path)
        agent = _load_agent(model_path, environment)
        observation, _ = environment.reset()
    except (FileNotFoundError, RuntimeError, ValueError, OSError) as exc:
        await _send_simulation_error(websocket, "resource_error", str(exc))
        await websocket.close(code=1008)
        return

    playing = True
    complete = False
    try:
        while True:
            if playing and not complete:
                snapshot = environment.snapshot()
                action = np.asarray(agent.predict_raw(observation), dtype=np.int64)
                observation, _, terminated, truncated, info = environment.step(action)
                await websocket.send_json(_state_update(snapshot, action, info))
                complete = terminated or truncated
                if complete:
                    playing = False
                    await websocket.send_json(
                        {"type": "simulation_complete", "timestamp": snapshot.timestamp}
                    )

            timeout = None if not playing else 1.0 / speed
            try:
                command = await asyncio.wait_for(websocket.receive_json(), timeout=timeout)
            except TimeoutError:
                continue

            if command.get("type") != "control":
                await _send_simulation_error(
                    websocket, "invalid_control", "control message type must be 'control'"
                )
                continue
            action_name = command.get("action")
            if action_name == "play":
                if complete:
                    await _send_simulation_error(
                        websocket,
                        "simulation_complete",
                        "reset the simulation before playing it again",
                    )
                    continue
                playing = True
            elif action_name == "pause":
                playing = False
            elif action_name == "reset":
                observation, _ = environment.reset()
                complete = False
                playing = False
            elif action_name == "set_speed":
                try:
                    requested_speed = float(command["speed"])
                    if not MIN_SIMULATION_SPEED <= requested_speed <= MAX_SIMULATION_SPEED:
                        raise ValueError
                    speed = requested_speed
                except (KeyError, TypeError, ValueError):
                    await _send_simulation_error(
                        websocket,
                        "invalid_speed",
                        f"speed must be between {MIN_SIMULATION_SPEED} and {MAX_SIMULATION_SPEED}",
                    )
                    continue
            else:
                await _send_simulation_error(
                    websocket, "invalid_control", f"unsupported control action: {action_name}"
                )
                continue
            await _send_control_ack(websocket, action_name, playing=playing, speed=speed)
    except WebSocketDisconnect:
        return
    finally:
        environment.close()

import asyncio
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.api.router import api_router
from app.comparison import build_baseline_action, validate_baseline
from app.simulation_service import build_state_update, summarize_attention
from src.environment.v2x_env import V2XEnv
from src.models.ppo_agent import PPOAgent

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
MIN_SIMULATION_SPEED = 0.25
MAX_SIMULATION_SPEED = 5.0

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


def _create_environment(scenario_path: Path, *, seed: int | None = None) -> V2XEnv:
    return V2XEnv(scenario_path, seed=seed)


def _load_agent(model_path: Path, environment: V2XEnv) -> PPOAgent:
    return PPOAgent.load(model_path, environment)


_state_update = build_state_update


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
                if hasattr(agent, "predict_raw_with_attention"):
                    decision_started = time.perf_counter()
                    raw_action, raw_attention = agent.predict_raw_with_attention(observation)
                    environment.record_decision_latency(
                        (time.perf_counter() - decision_started) * 1000
                    )
                else:
                    raw_action = agent.predict_raw(observation)
                    raw_attention = None
                action = np.asarray(raw_action, dtype=np.int64)
                attention_weights, attention_by_vehicle = summarize_attention(
                    raw_attention,
                    observation,
                    environment.vehicle_ids,
                    snapshot.events,
                )
                observation, _, terminated, truncated, info = environment.step(action)
                await websocket.send_json(
                    _state_update(
                        snapshot,
                        action,
                        info,
                        attention_weights=attention_weights,
                        attention_by_vehicle=attention_by_vehicle,
                    )
                )
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


@app.websocket("/ws/simulation/compare")
async def compare_simulation_websocket(websocket: WebSocket) -> None:
    """Stream timestamp-aligned AI and deterministic-baseline episodes."""
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
        baseline = validate_baseline(websocket.query_params.get("baseline", "distance"))
        speed = float(websocket.query_params.get("speed", "1"))
        if not MIN_SIMULATION_SPEED <= speed <= MAX_SIMULATION_SPEED:
            raise ValueError(
                f"speed must be between {MIN_SIMULATION_SPEED} and {MAX_SIMULATION_SPEED}"
            )
    except ValueError as exc:
        await _send_simulation_error(websocket, "invalid_parameters", str(exc))
        await websocket.close(code=1008)
        return

    ai_environment: V2XEnv | None = None
    baseline_environment: V2XEnv | None = None
    try:
        scenario_path = _resolve_simulation_path(scenario_query, kind="scenario")
        model_path = _resolve_simulation_path(model_query, kind="model")
        ai_environment = _create_environment(scenario_path, seed=42)
        baseline_environment = _create_environment(scenario_path, seed=42)
        agent = _load_agent(model_path, ai_environment)
        ai_observation, _ = ai_environment.reset(seed=42)
        baseline_environment.reset(seed=42)
    except (FileNotFoundError, RuntimeError, ValueError, OSError) as exc:
        if ai_environment is not None:
            ai_environment.close()
        if baseline_environment is not None:
            baseline_environment.close()
        await _send_simulation_error(websocket, "resource_error", str(exc))
        await websocket.close(code=1008)
        return

    playing = True
    complete = False
    try:
        while True:
            if playing and not complete:
                ai_snapshot = ai_environment.snapshot()
                baseline_snapshot = baseline_environment.snapshot()
                if ai_snapshot.timestamp != baseline_snapshot.timestamp:
                    raise RuntimeError("comparison environments are no longer synchronized")

                if hasattr(agent, "predict_raw_with_attention"):
                    decision_started = time.perf_counter()
                    raw_action, raw_attention = agent.predict_raw_with_attention(ai_observation)
                    ai_environment.record_decision_latency(
                        (time.perf_counter() - decision_started) * 1000
                    )
                else:
                    raw_action = agent.predict_raw(ai_observation)
                    raw_attention = None
                ai_action = np.asarray(raw_action, dtype=np.int64)
                attention_weights, attention_by_vehicle = summarize_attention(
                    raw_attention,
                    ai_observation,
                    ai_environment.vehicle_ids,
                    ai_snapshot.events,
                )
                ai_observation, _, ai_terminated, ai_truncated, ai_info = ai_environment.step(
                    ai_action
                )

                baseline_action, baseline_reasons = build_baseline_action(
                    baseline_environment,
                    baseline_snapshot,
                    baseline,
                )
                _, _, baseline_terminated, baseline_truncated, baseline_info = (
                    baseline_environment.step(baseline_action)
                )

                await websocket.send_json(
                    _state_update(
                        ai_snapshot,
                        ai_action,
                        ai_info,
                        attention_weights=attention_weights,
                        attention_by_vehicle=attention_by_vehicle,
                        method="ai",
                    )
                )
                await websocket.send_json(
                    _state_update(
                        baseline_snapshot,
                        baseline_action,
                        baseline_info,
                        method=baseline,
                        selection_reason_override=baseline_reasons,
                    )
                )

                complete = (ai_terminated or ai_truncated) and (
                    baseline_terminated or baseline_truncated
                )
                if complete:
                    playing = False
                    await websocket.send_json(
                        {"type": "simulation_complete", "timestamp": ai_snapshot.timestamp}
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
                ai_observation, _ = ai_environment.reset(seed=42)
                baseline_environment.reset(seed=42)
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
        ai_environment.close()
        baseline_environment.close()

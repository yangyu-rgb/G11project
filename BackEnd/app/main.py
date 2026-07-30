import asyncio
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.api.router import api_router
from app.api.routes.scenarios import resolve_editor_scenario
from app.api.routes.experiments import resolve_experiment
from app.model_registry import presentation_model_status
from app.comparison import build_baseline_action, validate_baseline
from app.simulation_service import build_state_update
from app.simulation_session import (
    PlaybackController,
    SessionControlError,
    step_ai,
)
from src.environment.adaptive_radius_wrapper import DirectionalCorridorActionWrapper
from src.environment.v2x_env import V2XEnv
from src.experiments.io import load_yaml
from src.models.ppo_agent import PPOAgent

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
PRESENTATION_CONFIG = load_yaml("configs/adaptive_demo_training.yaml")
app = FastAPI(
    title="G11project API",
    version="0.1.0",
    description="G11project backend service",
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
    if kind == "scenario" and raw_path.startswith("editor:"):
        return resolve_editor_scenario(raw_path)
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = BACKEND_DIRECTORY / path
    resolved = path.resolve()
    exists = resolved.is_dir() if kind == "scenario" else resolved.is_file()
    if not exists:
        raise FileNotFoundError(f"{kind} path does not exist: {resolved}")
    return resolved


def _create_environment(
    scenario_path: Path,
    *,
    seed: int | None = None,
    environment_kwargs: dict[str, object] | None = None,
) -> V2XEnv:
    return V2XEnv(scenario_path, seed=seed, **(environment_kwargs or {}))


def _presentation_environment_kwargs(
    overrides: dict[str, object] | None = None,
) -> dict[str, object]:
    """Recreate the accepted model's observation schema with optional network overrides."""
    environment = dict(PRESENTATION_CONFIG["environment"])
    network = dict(PRESENTATION_CONFIG["network"])
    network_options = {
        key: float(value) for key, value in network.items() if key not in {"mode", "scenario"}
    }
    resolved: dict[str, object] = {
        **environment,
        "reward_mode": "full",
        "reward_weights": PRESENTATION_CONFIG["reward_weights"],
        "safety_window_ms": float(PRESENTATION_CONFIG["safety_window_ms"]),
        "network_mode": str(network["mode"]),
        "network_scenario": str(network["scenario"]),
        "network_options": network_options,
    }
    if overrides:
        override_options = dict(overrides.get("network_options", {}))  # type: ignore[arg-type]
        resolved.update(
            {key: value for key, value in overrides.items() if key != "network_options"}
        )
        resolved["network_options"] = {**network_options, **override_options}
    return resolved


def _load_agent(model_path: Path, environment: object) -> PPOAgent:
    return PPOAgent.load(model_path, environment)


_state_update = build_state_update


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
        playback = PlaybackController.create(websocket.query_params.get("speed", "1"))
    except SessionControlError as exc:
        await _send_simulation_error(
            websocket,
            exc.code,
            exc.message,
        )
        await websocket.close(code=1008)
        return

    try:
        scenario_path = _resolve_simulation_path(scenario_query, kind="scenario")
        model_status = presentation_model_status()
        presentation_inference = model_query == model_status["model"]
        if presentation_inference and not model_status["eligible"]:
            raise RuntimeError(str(model_status["reason"]))
        model_path = _resolve_simulation_path(model_query, kind="model")
        base_environment = _create_environment(
            scenario_path,
            environment_kwargs=(
                _presentation_environment_kwargs() if presentation_inference else None
            ),
        )
        environment = (
            DirectionalCorridorActionWrapper(base_environment)
            if presentation_inference
            else base_environment
        )
        agent = _load_agent(model_path, environment)
        observation, _ = environment.reset()
    except (FileNotFoundError, RuntimeError, ValueError, OSError) as exc:
        await _send_simulation_error(websocket, "resource_error", str(exc))
        await websocket.close(code=1008)
        return

    try:
        while True:
            if playback.playing and not playback.complete:
                snapshot_environment = getattr(environment, "base_environment", environment)
                snapshot = snapshot_environment.snapshot()
                result = step_ai(agent, environment, observation, snapshot)
                observation = result.observation
                await websocket.send_json(
                    _state_update(
                        snapshot,
                        result.action,
                        result.info,
                        attention_weights=result.attention_weights,
                        attention_by_vehicle=result.attention_by_vehicle,
                    )
                )
                if result.terminated or result.truncated:
                    playback.mark_complete()
                    await websocket.send_json(
                        {"type": "simulation_complete", "timestamp": snapshot.timestamp}
                    )

            try:
                command = await asyncio.wait_for(websocket.receive_json(), timeout=playback.timeout)
            except TimeoutError:
                continue

            def reset() -> None:
                nonlocal observation
                observation, _ = environment.reset()

            try:
                acknowledgement = playback.apply(command, reset)
            except SessionControlError as exc:
                await _send_simulation_error(websocket, exc.code, exc.message)
                continue
            await websocket.send_json(acknowledgement)
    except WebSocketDisconnect:
        return
    finally:
        environment.close()


@app.websocket("/ws/simulation/compare")
async def compare_simulation_websocket(websocket: WebSocket) -> None:
    """Stream timestamp-aligned AI and deterministic-baseline episodes."""
    await websocket.accept()
    scenario_query = websocket.query_params.get("scenario")
    experiment_query = websocket.query_params.get("experiment_ref")
    model_query = websocket.query_params.get("model")
    if (not scenario_query and not experiment_query) or not model_query:
        await _send_simulation_error(
            websocket,
            "missing_parameters",
            "scenario or experiment_ref, and model query parameters are required",
        )
        await websocket.close(code=1008)
        return

    try:
        experiment = resolve_experiment(experiment_query) if experiment_query else None
        baseline = validate_baseline(
            experiment.baseline
            if experiment
            else websocket.query_params.get("baseline", "distance")
        )
        playback = PlaybackController.create(websocket.query_params.get("speed", "1"))
    except (FileNotFoundError, ValueError) as exc:
        await _send_simulation_error(websocket, "invalid_parameters", str(exc))
        await websocket.close(code=1008)
        return

    ai_environment: V2XEnv | None = None
    baseline_environment: V2XEnv | None = None
    try:
        scenario_path = (
            resolve_editor_scenario(experiment.scenario_ref)
            if experiment
            else _resolve_simulation_path(str(scenario_query), kind="scenario")
        )
        editor_scenario = bool(
            (scenario_query and str(scenario_query).startswith("editor:"))
            or (experiment and experiment.scenario_ref.startswith("editor:"))
        )
        model_status = presentation_model_status()
        presentation_inference = model_query == model_status["model"]
        if editor_scenario:
            if not model_status["eligible"]:
                raise RuntimeError(str(model_status["reason"]))
            if not presentation_inference:
                raise RuntimeError(
                    "Temporary highway incident scenarios require the eligible production model"
                )
        elif presentation_inference and not model_status["eligible"]:
            raise RuntimeError(str(model_status["reason"]))
        model_path = _resolve_simulation_path(model_query, kind="model")
        seed = experiment.seed if experiment else 42
        environment_kwargs = experiment.network.environment_kwargs() if experiment else None
        if presentation_inference:
            environment_kwargs = _presentation_environment_kwargs(environment_kwargs)
        ai_base_environment = _create_environment(
            scenario_path, seed=seed, environment_kwargs=environment_kwargs
        )
        baseline_environment = _create_environment(
            scenario_path, seed=seed, environment_kwargs=environment_kwargs
        )
        if presentation_inference:
            ai_environment = DirectionalCorridorActionWrapper(ai_base_environment)
            baseline_environment.receiver_relevance_mode = "directional_corridor"
        else:
            ai_environment = ai_base_environment
        agent = _load_agent(model_path, ai_environment)
        ai_observation, _ = ai_environment.reset(seed=seed)
        baseline_environment.reset(seed=seed)
    except (FileNotFoundError, RuntimeError, ValueError, OSError) as exc:
        if ai_environment is not None:
            ai_environment.close()
        if baseline_environment is not None:
            baseline_environment.close()
        await _send_simulation_error(websocket, "resource_error", str(exc))
        await websocket.close(code=1008)
        return

    try:
        while True:
            if playback.playing and not playback.complete:
                ai_base = getattr(ai_environment, "base_environment", ai_environment)
                ai_snapshot = ai_base.snapshot()
                baseline_snapshot = baseline_environment.snapshot()
                if ai_snapshot.timestamp != baseline_snapshot.timestamp:
                    raise RuntimeError("comparison environments are no longer synchronized")

                ai_result = step_ai(agent, ai_environment, ai_observation, ai_snapshot)
                ai_observation = ai_result.observation

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
                        ai_result.action,
                        ai_result.info,
                        attention_weights=ai_result.attention_weights,
                        attention_by_vehicle=ai_result.attention_by_vehicle,
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

                complete = (ai_result.terminated or ai_result.truncated) and (
                    baseline_terminated or baseline_truncated
                )
                if complete:
                    playback.mark_complete()
                    await websocket.send_json(
                        {"type": "simulation_complete", "timestamp": ai_snapshot.timestamp}
                    )

            try:
                command = await asyncio.wait_for(websocket.receive_json(), timeout=playback.timeout)
            except TimeoutError:
                continue

            def reset() -> None:
                nonlocal ai_observation
                ai_observation, _ = ai_environment.reset(seed=seed)
                baseline_environment.reset(seed=seed)

            try:
                acknowledgement = playback.apply(command, reset)
            except SessionControlError as exc:
                await _send_simulation_error(websocket, exc.code, exc.message)
                continue
            await websocket.send_json(acknowledgement)
    except WebSocketDisconnect:
        return
    finally:
        ai_environment.close()
        baseline_environment.close()

"""Validated, short-lived counterfactual experiment configurations."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.routes.scenarios import (
    EDITOR_SCENARIO_LIFETIME_SECONDS,
    EditorScenarioRequest,
    create_editor_scenario,
    resolve_editor_scenario,
)

router = APIRouter()


class NetworkOverrides(BaseModel):
    critical_radius_m: float = Field(default=300, ge=100, le=500)
    total_bandwidth_mbps: float = Field(default=100, ge=10, le=200)
    base_delay_ms: float = Field(default=20, ge=0, le=100)
    jitter_max_ms: float = Field(default=10, ge=0, le=30)
    far_packet_loss_rate: float = Field(default=0.1, ge=0, le=0.3)
    network_mode: Literal["simple", "3gpp"] = "simple"
    safety_window_ms: float = Field(default=100, ge=20, le=300)

    def environment_kwargs(self) -> dict[str, object]:
        return {
            "critical_radius_m": self.critical_radius_m,
            "safety_window_ms": self.safety_window_ms,
            "network_mode": self.network_mode,
            "network_options": {
                "total_bandwidth_mbps": self.total_bandwidth_mbps,
                "base_delay_ms": self.base_delay_ms,
                "jitter_max_ms": self.jitter_max_ms,
                "far_packet_loss_rate": self.far_packet_loss_rate,
            },
        }


class ExperimentPreviewRequest(BaseModel):
    scenario: EditorScenarioRequest
    network: NetworkOverrides = Field(default_factory=NetworkOverrides)
    seed: int = Field(default=42, ge=0, le=2_147_483_647)
    baseline: Literal["broadcast", "distance", "urgency"] = "broadcast"


class ExperimentPreviewResponse(BaseModel):
    experiment_ref: str
    scenario_ref: str
    normalized_network: NetworkOverrides
    seed: int
    baseline: str
    warnings: list[str]
    comparability: Literal["comparable"] = "comparable"
    expires_at: float


class ExperimentPreset(BaseModel):
    id: str
    title: str
    question: str
    network: NetworkOverrides
    source: Literal["configuration"] = "configuration"
    out_of_distribution: bool = False


EXPERIMENT_PRESETS = (
    ExperimentPreset(
        id="normal",
        title="正常网络",
        question="标准网络下，AI能否减少冗余通信？",
        network=NetworkOverrides(),
    ),
    ExperimentPreset(
        id="low-bandwidth",
        title="低带宽 30 Mbps",
        question="资源收紧后，选择性广播能否维持更低负载？",
        network=NetworkOverrides(total_bandwidth_mbps=30),
        out_of_distribution=True,
    ),
    ExperimentPreset(
        id="high-latency",
        title="高时延 80 ms",
        question="基础时延上升后，两种策略的响应差距如何变化？",
        network=NetworkOverrides(base_delay_ms=80),
        out_of_distribution=True,
    ),
    ExperimentPreset(
        id="high-loss",
        title="高丢包 20%",
        question="链路不稳定时，关键车辆的消息送达是否保持？",
        network=NetworkOverrides(far_packet_loss_rate=0.2),
        out_of_distribution=True,
    ),
)


@dataclass(frozen=True)
class ExperimentRecord:
    experiment_ref: str
    scenario_ref: str
    network: NetworkOverrides
    seed: int
    baseline: str
    expires_at: float


_EXPERIMENTS: dict[str, ExperimentRecord] = {}


@router.get("/experiments/presets", response_model=list[ExperimentPreset])
def list_experiment_presets() -> list[ExperimentPreset]:
    return list(EXPERIMENT_PRESETS)


@router.get("/experiments/presets/{preset_id}", response_model=ExperimentPreset)
def get_experiment_preset(preset_id: str) -> ExperimentPreset:
    preset = next((item for item in EXPERIMENT_PRESETS if item.id == preset_id), None)
    if preset is None:
        raise HTTPException(status_code=404, detail="unknown experiment preset")
    return preset


def _cleanup_expired(now: float | None = None) -> None:
    current = time.time() if now is None else now
    for key, record in list(_EXPERIMENTS.items()):
        if record.expires_at <= current:
            _EXPERIMENTS.pop(key, None)


def resolve_experiment(reference: str) -> ExperimentRecord:
    _cleanup_expired()
    try:
        uuid.UUID(reference)
    except ValueError as exc:
        raise FileNotFoundError("invalid experiment reference") from exc
    record = _EXPERIMENTS.get(reference)
    if record is None:
        raise FileNotFoundError("experiment reference does not exist or has expired")
    resolve_editor_scenario(record.scenario_ref)
    return record


def _warnings(network: NetworkOverrides) -> list[str]:
    warnings: list[str] = []
    if network.total_bandwidth_mbps < 40:
        warnings.append("低带宽设置可能超出正式演示模型的常见训练分布")
    if network.base_delay_ms > 60 or network.far_packet_loss_rate > 0.2:
        warnings.append("高时延或高丢包配置应标记为分布外压力测试")
    if network.critical_radius_m != 300:
        warnings.append("关键半径已变化，结论需同时报告该配置")
    return warnings


@router.post("/experiments/preview", response_model=ExperimentPreviewResponse)
def preview_experiment(payload: ExperimentPreviewRequest) -> ExperimentPreviewResponse:
    _cleanup_expired()
    scenario = create_editor_scenario(payload.scenario)
    if not scenario.ai_runnable:
        raise HTTPException(status_code=422, detail="；".join(scenario.limitations))
    reference = str(uuid.uuid4())
    expires_at = time.time() + EDITOR_SCENARIO_LIFETIME_SECONDS
    record = ExperimentRecord(
        experiment_ref=reference,
        scenario_ref=scenario.scenario_ref,
        network=payload.network,
        seed=payload.seed,
        baseline=payload.baseline,
        expires_at=expires_at,
    )
    _EXPERIMENTS[reference] = record
    return ExperimentPreviewResponse(
        experiment_ref=reference,
        scenario_ref=record.scenario_ref,
        normalized_network=record.network,
        seed=record.seed,
        baseline=record.baseline,
        warnings=_warnings(record.network),
        expires_at=record.expires_at,
    )


@router.get("/experiments/{experiment_ref}", response_model=ExperimentPreviewResponse)
def get_experiment(experiment_ref: str) -> ExperimentPreviewResponse:
    try:
        record = resolve_experiment(experiment_ref)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ExperimentPreviewResponse(
        experiment_ref=record.experiment_ref,
        scenario_ref=record.scenario_ref,
        normalized_network=record.network,
        seed=record.seed,
        baseline=record.baseline,
        warnings=_warnings(record.network),
        expires_at=record.expires_at,
    )

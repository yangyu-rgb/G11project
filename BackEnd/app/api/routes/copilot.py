"""Offline, evidence-grounded research copilot responses."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class CopilotRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    vehicle_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    evidence: dict[str, Any] = Field(default_factory=dict)


class EvidenceItem(BaseModel):
    label: str
    value: str
    source: str


class CopilotResponse(BaseModel):
    mode: str = "local"
    answer: str
    evidence: list[EvidenceItem]
    suggested_actions: list[str]


def _as_text(value: Any, fallback: str = "暂无") -> str:
    return fallback if value is None else str(value)


@router.post("/copilot/respond", response_model=CopilotResponse)
def copilot_respond(payload: CopilotRequest) -> CopilotResponse:
    data = payload.evidence
    vehicle = payload.vehicle_id or _as_text(data.get("vehicle_id"), "当前车辆")
    selected = bool(data.get("selected"))
    candidate = bool(data.get("candidate"))
    distance = data.get("distance_m")
    attention = data.get("attention")
    reason = _as_text(data.get("reason"), "未提供策略理由")
    timestamp = _as_text(data.get("timestamp"), "当前时刻")

    items = [
        EvidenceItem(label="车辆", value=vehicle, source="simulation.vehicle"),
        EvidenceItem(
            label="候选状态",
            value="是" if candidate else "否",
            source="decision.candidate_vehicles",
        ),
        EvidenceItem(
            label="最终通知", value="是" if selected else "否", source="decision.selected_receivers"
        ),
        EvidenceItem(label="策略理由", value=reason, source="decision.selection_reason"),
        EvidenceItem(label="仿真时间", value=timestamp, source="state_update.timestamp"),
    ]
    if distance is not None:
        items.append(
            EvidenceItem(
                label="事件距离", value=f"{float(distance):.1f} m", source="candidate.distance_m"
            )
        )
    if attention is not None:
        items.append(
            EvidenceItem(
                label="相对注意力",
                value=f"{float(attention) * 100:.1f}%",
                source="attention_weights",
            )
        )

    if selected:
        conclusion = f"{vehicle} 被纳入本次选择性广播。直接证据是它进入候选集合并被策略选中，记录理由为“{reason}”。"
    elif candidate:
        conclusion = f"{vehicle} 位于候选范围内，但没有进入最终接收集合。这说明候选半径只是第一层过滤，最终动作还会结合当前策略输出。"
    else:
        conclusion = f"{vehicle} 未进入当前事件的候选集合，因此没有被选择性策略通知。传统全量广播仍可能向它发送消息。"

    return CopilotResponse(
        answer=f"{conclusion} 注意力仅用于描述模型内部相对权重，不应单独解释为因果关系。",
        evidence=items,
        suggested_actions=[
            "在3D场景中定位该车辆",
            "仅显示与基线不同的消息",
            "创建低带宽反事实草稿",
        ],
    )

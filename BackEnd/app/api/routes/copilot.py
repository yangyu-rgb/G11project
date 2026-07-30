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


def _as_text(value: Any, fallback: str = "Unavailable") -> str:
    return fallback if value is None else str(value)


@router.post("/copilot/respond", response_model=CopilotResponse)
def copilot_respond(payload: CopilotRequest) -> CopilotResponse:
    data = payload.evidence
    vehicle = payload.vehicle_id or _as_text(data.get("vehicle_id"), "Current vehicle")
    selected = bool(data.get("selected"))
    candidate = bool(data.get("candidate"))
    distance = data.get("distance_m")
    attention = data.get("attention")
    reason = _as_text(data.get("reason"), "No policy reason provided")
    timestamp = _as_text(data.get("timestamp"), "Current timestamp")

    items = [
        EvidenceItem(label="Vehicle", value=vehicle, source="simulation.vehicle"),
        EvidenceItem(
            label="Candidate Status",
            value="Yes" if candidate else "No",
            source="decision.candidate_vehicles",
        ),
        EvidenceItem(
            label="Final Notification",
            value="Yes" if selected else "No",
            source="decision.selected_receivers",
        ),
        EvidenceItem(label="Policy Reason", value=reason, source="decision.selection_reason"),
        EvidenceItem(label="Simulation Time", value=timestamp, source="state_update.timestamp"),
    ]
    if distance is not None:
        items.append(
            EvidenceItem(
                label="Incident Distance",
                value=f"{float(distance):.1f} m",
                source="candidate.distance_m",
            )
        )
    if attention is not None:
        items.append(
            EvidenceItem(
                label="Relative Attention",
                value=f"{float(attention) * 100:.1f}%",
                source="attention_weights",
            )
        )

    if selected:
        conclusion = f"{vehicle} was included in this selective broadcast. Direct evidence shows that it entered the candidate set and was selected by the policy, with recorded reason: “{reason}”."
    elif candidate:
        conclusion = f"{vehicle} is within the candidate scope but did not enter the final receiver set. The candidate radius is only the first filter; the final action also depends on the current policy output."
    else:
        conclusion = f"{vehicle} did not enter the current incident's candidate set and was not notified by the selective policy. Conventional broadcast may still send a message to it."

    return CopilotResponse(
        answer=f"{conclusion} Attention describes relative internal model weight and must not be interpreted alone as a causal relationship.",
        evidence=items,
        suggested_actions=[
            "Locate this vehicle in the 3D scene",
            "Show only messages that differ from the baseline",
            "Create a low-bandwidth counterfactual draft",
        ],
    )

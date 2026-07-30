import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.routes import demo
from app.main import app


def _metric(mean: float) -> dict[str, object]:
    return {"mean": mean, "std": 0.2, "ci95": [mean - 0.1, mean + 0.1], "count": 12}


def _write_artifacts(root: Path) -> None:
    summary = {
        "run_mode": "demo_lite",
        "protocol": "directional-v2",
        "metric_schema_version": 2,
        "expected_case_count": 12,
        "expected_result_rows": 48,
        "completed_result_rows": 48,
        "failures": [],
        "acceptance": {"passed": True, "checks": {"coverage": True}},
        "methods": {
            name: {
                "p95_latency_ms": _metric(30 + index),
                "communication_overhead": _metric(1 + index),
                "affected_vehicle_coverage": _metric(0.9),
                "effective_delivery_rate": _metric(0.8),
                "normalized_channel_cost": _metric(0.5 + index),
            }
            for index, name in enumerate(("ai", "broadcast", "distance", "urgency"))
        },
        "paired_wilcoxon_holm": {
            "ai_vs_broadcast:p95_latency_ms": {
                "holm_adjusted_p": 0.01,
                "significant": True,
                "ai_better": True,
            }
        },
        "behavioral_gate": {"passed": True, "forward_notifications": 0},
    }
    presentation = {
        "protocol": "directional-v2",
        "metric_schema_version": 2,
        "scope": "highway-only preliminary course demo",
        "completed_result_rows": 48,
        "git": {"commit": "abc123", "dirty": False},
    }
    model = {
        "metric_schema_version": 2,
        "model_sha256": hashlib.sha256(b"model").hexdigest(),
        "training_run": {"commit": "abc123", "dirty": False},
    }
    for relative, value in (
        (demo.RESULTS_SUMMARY, summary),
        (demo.RESULTS_MANIFEST, presentation),
        (demo.MODEL_MANIFEST, model),
    ):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")


def test_results_summary_returns_only_validated_allowlisted_results(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_artifacts(tmp_path)
    monkeypatch.setattr(demo, "BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(demo, "presentation_model_status", lambda: {"eligible": True})

    response = TestClient(app).get("/api/v1/demo/results-summary")

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "ready"
    assert result["case_count"] == 12
    assert set(result["methods"]) == {"ai", "broadcast", "distance", "urgency"}
    assert result["methods"]["ai"]["p95_latency_ms"]["ci95"] == [29.9, 30.1]
    assert result["methods"]["urgency"]["normalized_channel_cost"]["mean"] == 3.5
    assert result["provenance"]["commit"] == "abc123"


def test_results_summary_fails_closed_on_protocol_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_artifacts(tmp_path)
    summary_path = tmp_path / demo.RESULTS_SUMMARY
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["protocol"] = "legacy-v1"
    summary_path.write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr(demo, "BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(demo, "presentation_model_status", lambda: {"eligible": True})

    result = TestClient(app).get("/api/v1/demo/results-summary").json()

    assert result["status"] == "invalid"
    assert result["ready"] is False
    assert result["methods"] == {}
    assert result["provenance"] is None


def test_results_summary_waits_when_model_is_not_eligible(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_artifacts(tmp_path)
    monkeypatch.setattr(demo, "BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(
        demo,
        "presentation_model_status",
        lambda: {"eligible": False, "reason": "模型哈希不一致"},
    )

    result = TestClient(app).get("/api/v1/demo/results-summary").json()

    assert result["status"] == "pending"
    assert result["reason"] == "模型哈希不一致"
    assert result["methods"] == {}


def test_results_summary_fails_closed_on_malformed_acceptance(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_artifacts(tmp_path)
    summary_path = tmp_path / demo.RESULTS_SUMMARY
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["acceptance"] = "passed"
    summary_path.write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr(demo, "BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(demo, "presentation_model_status", lambda: {"eligible": True})

    response = TestClient(app).get("/api/v1/demo/results-summary")

    assert response.status_code == 200
    assert response.json()["status"] == "invalid"
    assert response.json()["methods"] == {}

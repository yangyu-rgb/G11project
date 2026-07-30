"""Research experiment and deterministic copilot API coverage."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.model_registry as model_registry
from app.main import app


def _scenario() -> dict[str, object]:
    return {
        "schema_version": 1,
        "name": "research-api-test",
        "vehicles": [
            {"id": "vehicle_001", "x": 100, "y": -4.8, "speed_kmh": 96, "heading": 90},
            {"id": "vehicle_002", "x": 130, "y": -4.8, "speed_kmh": 92, "heading": 90},
        ],
        "events": [
            {
                "id": "event_001",
                "type": "emergency_braking",
                "x": 100,
                "y": -4.8,
                "timestamp": 2,
                "severity": 0.9,
                "source_vehicle_id": "vehicle_001",
                "pre_brake_speed_kmh": 96,
                "post_brake_speed_kmh": 18,
            }
        ],
    }


def test_experiment_preview_is_retrievable_and_normalized() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/experiments/preview",
        json={
            "scenario": _scenario(),
            "network": {
                "critical_radius_m": 250,
                "total_bandwidth_mbps": 30,
                "base_delay_ms": 40,
                "jitter_max_ms": 12,
                "far_packet_loss_rate": 0.12,
                "network_mode": "3gpp",
                "safety_window_ms": 120,
            },
            "seed": 42,
            "baseline": "broadcast",
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["comparability"] == "comparable"
    assert result["normalized_network"]["total_bandwidth_mbps"] == 30
    assert result["warnings"]

    loaded = client.get(f"/api/v1/experiments/{result['experiment_ref']}")
    assert loaded.status_code == 200
    assert loaded.json()["scenario_ref"] == result["scenario_ref"]


def test_experiment_preview_rejects_out_of_bounds_network_values() -> None:
    response = TestClient(app).post(
        "/api/v1/experiments/preview",
        json={
            "scenario": _scenario(),
            "network": {"total_bandwidth_mbps": 1},
        },
    )
    assert response.status_code == 422


def test_local_copilot_cites_structured_evidence() -> None:
    response = TestClient(app).post(
        "/api/v1/copilot/respond",
        json={
            "query": "Why was this vehicle selected?",
            "vehicle_id": "vehicle_002",
            "evidence": {
                "candidate": True,
                "selected": True,
                "distance_m": 30,
                "attention": 0.72,
                "reason": "high_attention",
                "timestamp": 2,
            },
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["mode"] == "local"
    assert "vehicle_002" in result["answer"]
    assert any(item["source"] == "decision.selected_receivers" for item in result["evidence"])


def test_pressure_presets_are_allowlisted_and_describe_ood_status() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/experiments/presets")
    assert response.status_code == 200
    presets = response.json()
    assert [item["id"] for item in presets] == [
        "normal",
        "low-bandwidth",
        "high-latency",
        "high-loss",
    ]
    low_bandwidth = client.get("/api/v1/experiments/presets/low-bandwidth")
    assert low_bandwidth.status_code == 200
    assert low_bandwidth.json()["network"]["total_bandwidth_mbps"] == 30
    assert low_bandwidth.json()["out_of_distribution"] is True
    assert client.get("/api/v1/experiments/presets/unknown").status_code == 404


def test_presentation_model_registry_fails_closed_for_rejected_legacy_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_path = tmp_path / model_registry.PRESENTATION_MODEL
    manifest_path = tmp_path / model_registry.PRESENTATION_MANIFEST
    model_path.parent.mkdir(parents=True)
    model_path.write_bytes(b"legacy-model")
    manifest_path.write_text(
        json.dumps(
            {
                "eligible": True,
                "acceptance": {"passed": True},
                "action_mode": "individual",
                "observation_schema_version": 1,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(model_registry, "BACKEND_ROOT", tmp_path)
    model_registry._validated_status.cache_clear()

    result = TestClient(app).get("/api/v1/demo/model-status")

    assert result.status_code == 200
    assert result.json()["eligible"] is False
    assert result.json()["model"] == "experiments/highway_corridor/champion/model_best.zip"
    assert result.json()["reason"]
    model_registry._validated_status.cache_clear()

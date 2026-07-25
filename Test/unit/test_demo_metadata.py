import json

from app.api.routes.demo import _scenario_events


def test_demo_event_metadata_uses_real_scenario_values(tmp_path) -> None:
    (tmp_path / "events.json").write_text(
        json.dumps(
            [
                {
                    "type": "emergency_braking",
                    "x": 120.0,
                    "y": -3.2,
                    "timestamp": 14.8,
                    "severity": 0.9,
                }
            ]
        ),
        encoding="utf-8",
    )

    assert _scenario_events(tmp_path) == [
        {
            "id": "event-0",
            "type": "emergency_braking",
            "x": 120.0,
            "y": -3.2,
            "timestamp": 14.8,
            "severity": 0.9,
        }
    ]


def test_demo_event_metadata_fails_closed_for_missing_file(tmp_path) -> None:
    assert _scenario_events(tmp_path) == []

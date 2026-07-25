"""Unit coverage for shared WebSocket playback state."""

from pathlib import Path

import pytest

from app.simulation_session import PlaybackController, SessionControlError


def test_playback_controller_applies_controls_and_reset_callback() -> None:
    reset_calls: list[bool] = []
    playback = PlaybackController.create(1)

    assert playback.apply({"type": "control", "action": "pause"}, lambda: None) == {
        "type": "control_ack",
        "action": "pause",
        "playing": False,
        "speed": 1.0,
    }
    playback.apply({"type": "control", "action": "set_speed", "speed": 4}, lambda: None)
    assert playback.speed == 4.0
    assert playback.timeout is None
    playback.apply({"type": "control", "action": "play"}, lambda: None)
    assert playback.timeout == pytest.approx(0.25)
    playback.apply({"type": "control", "action": "reset"}, lambda: reset_calls.append(True))
    assert reset_calls == [True]
    assert playback.playing is False
    assert playback.complete is False


@pytest.mark.parametrize("speed", [0, 0.24, 5.01, "fast", None])
def test_playback_controller_rejects_invalid_speed(speed: object) -> None:
    with pytest.raises(SessionControlError, match="speed must be between"):
        PlaybackController.create(speed)


def test_playback_controller_requires_reset_after_completion() -> None:
    playback = PlaybackController.create(1)
    playback.mark_complete()

    with pytest.raises(SessionControlError) as error:
        playback.apply({"type": "control", "action": "play"}, lambda: None)
    assert error.value.code == "simulation_complete"


def test_backend_core_does_not_import_fastapi_application_layer() -> None:
    backend_src = Path(__file__).resolve().parents[2] / "BackEnd" / "src"
    offenders: list[str] = []
    for path in backend_src.rglob("*.py"):
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("from app") or stripped.startswith("import app"):
                offenders.append(str(path.relative_to(backend_src)))

    assert offenders == []

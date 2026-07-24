"""Tests for enhanced vehicle, event and history features."""

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.models.utils import (  # noqa: E402
    padded_history,
    relative_event_features,
    relative_vehicle_features,
    time_to_collision_seconds,
    wrapped_angle_difference_degrees,
)


def test_relative_vehicle_geometry_and_lane() -> None:
    result = relative_vehicle_features(
        x=0,
        y=0,
        speed=10,
        angle=350,
        lane_id="edge_1",
        other_x=300,
        other_y=400,
        other_speed=20,
        other_angle=10,
        other_lane_id="edge_1",
    )
    assert result == pytest.approx((1.0, 0.25, 20 / 180, 1.0))
    assert wrapped_angle_difference_degrees(10, 350) == 20


def test_event_features_and_ttc_handle_zero_or_away_speed() -> None:
    assert relative_event_features(x=0, y=0, angle=90, event_x=100, event_y=0) == pytest.approx(
        (0.2, 0, 1)
    )
    assert time_to_collision_seconds(
        x=0, y=0, speed=10, angle=90, event_x=100, event_y=0
    ) == pytest.approx(10)
    assert time_to_collision_seconds(x=0, y=0, speed=0, angle=90, event_x=100, event_y=0) == 30


def test_history_left_padding_is_deterministic() -> None:
    assert padded_history([(1, 2, 3), (4, 5, 6)]) == (
        (1, 2, 3),
        (1, 2, 3),
        (1, 2, 3),
        (1, 2, 3),
        (4, 5, 6),
    )

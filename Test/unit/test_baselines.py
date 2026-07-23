"""Tests for M1 receiver-selection baselines."""

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.evaluation.baselines import select_receivers  # noqa: E402


VEHICLES = [
    {"id": "sender", "x": 0, "y": 0},
    {"id": "inside", "x": 299, "y": 0},
    {"id": "boundary", "x": 300, "y": 0},
    {"id": "outside", "x": 301, "y": 0},
]
EVENT = {"x": 0, "y": 0, "sender_id": "sender"}


def test_broadcast_selects_every_candidate_vehicle() -> None:
    assert select_receivers(VEHICLES, EVENT, "broadcast") == [
        "inside",
        "boundary",
        "outside",
    ]


def test_distance_selects_vehicles_at_or_inside_300_metres() -> None:
    assert select_receivers(VEHICLES, EVENT, "distance") == ["inside", "boundary"]


def test_unknown_baseline_is_rejected() -> None:
    with pytest.raises(ValueError, match="method"):
        select_receivers(VEHICLES, EVENT, "unknown")  # type: ignore[arg-type]

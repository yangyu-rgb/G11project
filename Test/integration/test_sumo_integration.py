"""Integration coverage for the local SUMO installation."""

import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from scripts.verify_sumo import sumo_is_available, verify_sumo_installation  # noqa: E402


def test_minimal_sumo_simulation() -> None:
    if not sumo_is_available():
        pytest.skip("SUMO binaries or Python bindings are unavailable in this environment")

    verify_sumo_installation()

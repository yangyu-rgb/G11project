"""Unit tests for the simplified M1 network abstraction."""

import random
import sys
from pathlib import Path

import pytest

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.environment.network_model import (  # noqa: E402
    Priority,
    SimpleNetworkModel,
    TransmissionResult,
)


def test_latency_and_distance_based_packet_loss() -> None:
    model = SimpleNetworkModel(random_source=random.Random(7))

    near_result = model.calculate_transmission((0, 0), (500, 0), 512, Priority.MEDIUM, 0)
    far_result = model.calculate_transmission((0, 0), (501, 0), 512, Priority.MEDIUM, 0)

    assert isinstance(near_result, TransmissionResult)
    assert 10 <= near_result.latency_ms <= 100
    assert 10 <= far_result.latency_ms <= 100
    assert near_result.packet_loss_rate == 0
    assert far_result.packet_loss_rate == pytest.approx(0.10)


def test_priority_allocations_never_exceed_total_bandwidth() -> None:
    model = SimpleNetworkModel(random_source=random.Random(1))
    current_load = 0.0
    total_allocated = 0.0

    for priority in (Priority.LOW, Priority.MEDIUM, Priority.HIGH):
        result = model.calculate_transmission((0, 0), (100, 0), 512, priority, current_load)
        total_allocated += result.allocated_bandwidth_mbps
        current_load += result.allocated_bandwidth_mbps / model.total_bandwidth_mbps

    assert total_allocated == pytest.approx(100.0)
    assert current_load == pytest.approx(1.0)


def test_full_load_allocates_no_additional_bandwidth() -> None:
    model = SimpleNetworkModel(random_source=random.Random(1))

    result = model.calculate_transmission((0, 0), (100, 0), 512, Priority.HIGH, 1.0)

    assert result.allocated_bandwidth_mbps == 0


@pytest.mark.parametrize(
    ("message_size", "priority", "current_load", "error"),
    [
        (0, Priority.LOW, 0.0, "message_size"),
        (128, 3, 0.0, "priority"),
        (128, Priority.LOW, 1.1, "current_load"),
    ],
)
def test_invalid_transmission_inputs_are_rejected(
    message_size: int, priority: int, current_load: float, error: str
) -> None:
    model = SimpleNetworkModel()

    with pytest.raises(ValueError, match=error):
        model.calculate_transmission((0, 0), (1, 1), message_size, priority, current_load)

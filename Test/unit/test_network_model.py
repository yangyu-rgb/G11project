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
    ("scenario", "distance_m", "expected_path_loss_db"),
    [
        ("urban", 100.0, 28.0 + 22 * 2 + 20 * 0.7708520116421442),
        ("highway", 100.0, 32.4 + 20 * 2 + 20 * 0.7708520116421442),
    ],
)
def test_3gpp_path_loss_matches_configured_formula(
    scenario: str, distance_m: float, expected_path_loss_db: float
) -> None:
    model = SimpleNetworkModel(mode="3gpp", scenario=scenario)

    assert model.calculate_path_loss_db(distance_m) == pytest.approx(expected_path_loss_db)


def test_3gpp_path_loss_clamps_distances_below_one_metre() -> None:
    model = SimpleNetworkModel(mode="3gpp", scenario="highway")

    assert model.calculate_path_loss_db(0) == model.calculate_path_loss_db(1)
    assert model.calculate_path_loss_db(0.5) == model.calculate_path_loss_db(1)


def test_3gpp_sinr_and_loss_are_distance_dependent() -> None:
    model = SimpleNetworkModel(mode="3gpp", scenario="urban")

    near_sinr = model.calculate_sinr_db(10)
    far_sinr = model.calculate_sinr_db(1_000)

    assert near_sinr > far_sinr
    assert model.calculate_packet_loss_rate(near_sinr) < model.calculate_packet_loss_rate(far_sinr)
    assert model.calculate_packet_loss_rate(5) == pytest.approx(0.5)


@pytest.mark.parametrize(
    ("priority", "expected_delay_ms"),
    [
        (Priority.LOW, 40.0),
        (Priority.MEDIUM, 24.0),
        (Priority.HIGH, 12.0),
    ],
)
def test_3gpp_queue_delay_accounts_for_load_and_priority(
    priority: Priority, expected_delay_ms: float
) -> None:
    model = SimpleNetworkModel(mode="3gpp", max_queue_delay_ms=50)

    assert model.calculate_queue_delay_ms(0.8, priority) == pytest.approx(expected_delay_ms)


def test_3gpp_transmission_combines_latency_loss_and_existing_bandwidth() -> None:
    model = SimpleNetworkModel(
        mode="3gpp",
        scenario="highway",
        base_delay_ms=20,
        jitter_min_ms=0,
        jitter_max_ms=0,
        max_queue_delay_ms=50,
    )

    result = model.calculate_transmission((0, 0), (100, 0), 512, Priority.HIGH, 0.8)

    expected_propagation_ms = 100 / 299_792_458.0 * 1_000
    assert result.latency_ms == pytest.approx(32 + expected_propagation_ms)
    assert 0 <= result.packet_loss_rate <= 1
    assert result.allocated_bandwidth_mbps == pytest.approx(20)


def test_simple_mode_retains_original_behavior() -> None:
    model = SimpleNetworkModel(
        mode="simple",
        base_delay_ms=20,
        jitter_min_ms=0,
        jitter_max_ms=0,
        max_queue_delay_ms=1_000,
    )

    result = model.calculate_transmission((0, 0), (501, 0), 512, Priority.HIGH, 0.8)

    expected_propagation_ms = 501 / 299_792_458.0 * 1_000
    assert result.latency_ms == pytest.approx(20 + expected_propagation_ms)
    assert result.packet_loss_rate == pytest.approx(0.1)
    assert result.allocated_bandwidth_mbps == pytest.approx(20)


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

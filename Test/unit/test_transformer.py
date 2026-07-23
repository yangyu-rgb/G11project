"""Unit tests for the M1 Transformer environment encoder."""

import sys
from pathlib import Path

import pytest
import torch

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.models.transformer import EnvironmentTransformer  # noqa: E402


def test_transformer_forward_shapes_and_attention() -> None:
    model = EnvironmentTransformer(dropout=0)
    vehicles = torch.randn(2, 10, 5)
    events = torch.randn(2, 1, 4)

    output = model(vehicles, events)

    assert output.global_embedding.shape == (2, 256)
    assert output.vehicle_embeddings.shape == (2, 10, 256)
    assert output.attention_weights.shape == (2, 4, 8, 11, 11)
    assert torch.isfinite(output.global_embedding).all()
    assert torch.isfinite(output.attention_weights).all()


def test_transformer_supports_padding_and_gradients() -> None:
    model = EnvironmentTransformer(dropout=0)
    vehicles = torch.randn(2, 10, 5, requires_grad=True)
    events = torch.randn(2, 2, 4, requires_grad=True)
    vehicle_mask = torch.tensor([[False] * 10, [False] * 8 + [True, True]], dtype=torch.bool)
    event_mask = torch.tensor([[False, True], [False, False]], dtype=torch.bool)

    output = model(vehicles, events, vehicle_mask, event_mask)
    output.global_embedding.sum().backward()

    assert vehicles.grad is not None
    assert events.grad is not None
    assert output.attention_weights.shape == (2, 4, 8, 12, 12)


def test_transformer_rejects_wrong_feature_shape() -> None:
    model = EnvironmentTransformer(dropout=0)

    with pytest.raises(ValueError, match="vehicle_features"):
        model(torch.randn(2, 10, 4), torch.randn(2, 1, 4))

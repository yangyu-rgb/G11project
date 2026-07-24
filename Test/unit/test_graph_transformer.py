"""Smoke coverage for standard search shapes and graph attention."""

import sys
from pathlib import Path

import torch

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.models.graph_transformer import GraphEnvironmentTransformer  # noqa: E402
from src.models.transformer import EnvironmentTransformer  # noqa: E402


def test_non_divisible_twelve_head_configuration_runs() -> None:
    model = EnvironmentTransformer(d_model=128, num_heads=12, num_layers=2, feedforward_dim=256)
    output = model(torch.randn(1, 5, 5), torch.randn(1, 1, 4))
    assert output.global_embedding.shape == (1, 128)
    assert output.attention_weights.shape[:3] == (1, 2, 12)


def test_graph_transformer_preserves_output_contract() -> None:
    model = GraphEnvironmentTransformer(d_model=128, num_heads=4, num_layers=2, feedforward_dim=256)
    output = model(torch.randn(1, 5, 5), torch.randn(1, 1, 4))
    assert output.vehicle_embeddings.shape == (1, 5, 128)

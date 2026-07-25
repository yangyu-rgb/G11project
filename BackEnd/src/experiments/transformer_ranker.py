"""Supervised Transformer receiver ranker used by the Transformer-only ablation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

from src.environment.network_model import Priority
from src.environment.v2x_env import V2XEnv
from src.models.graph_transformer import GraphEnvironmentTransformer
from src.models.transformer import EnvironmentTransformer


class TransformerReceiverRanker(nn.Module):
    """Score vehicle tokens without an RL policy or handcrafted scheduling rule."""

    def __init__(
        self,
        vehicle_feature_dim: int = 5,
        transformer_config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__()
        options = dict(transformer_config or {})
        variant = str(options.pop("variant", "standard"))
        encoder_class = (
            GraphEnvironmentTransformer if variant == "graph" else EnvironmentTransformer
        )
        self.encoder = encoder_class(vehicle_feature_dim=vehicle_feature_dim, **options)
        self.receiver_score = nn.Linear(self.encoder.d_model, 1)

    def forward(self, observation: dict[str, torch.Tensor]) -> torch.Tensor:
        vehicle_valid = observation["vehicle_mask"].bool()
        event_valid = observation["event_mask"].bool()
        output = self.encoder(
            observation["vehicles"].float(),
            observation["events"].float(),
            vehicle_padding_mask=~vehicle_valid,
            event_padding_mask=~event_valid,
        )
        return (
            self.receiver_score(output.vehicle_embeddings)
            .squeeze(-1)
            .masked_fill(~vehicle_valid, float("-inf"))
        )


def tensor_observation(observation: dict[str, np.ndarray]) -> dict[str, torch.Tensor]:
    return {key: torch.as_tensor(value).unsqueeze(0) for key, value in observation.items()}


def ranking_action(
    model: TransformerReceiverRanker,
    environment: V2XEnv,
    observation: dict[str, np.ndarray],
    top_k: int,
) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        scores = model(tensor_observation(observation))[0]
    active = np.flatnonzero(observation["vehicle_mask"])
    selected = sorted(active, key=lambda index: float(scores[index]), reverse=True)[:top_k]
    action = np.zeros(environment.max_vehicles + 2, dtype=np.int64)
    action[selected] = 1
    action[-2] = int(Priority.HIGH)
    action[-1] = 9
    return action


def save_ranker(model: TransformerReceiverRanker, path: Path, metadata: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "metadata": metadata}, path)


def load_ranker(path: Path) -> tuple[TransformerReceiverRanker, dict[str, Any]]:
    payload = torch.load(path, map_location="cpu", weights_only=True)
    metadata = dict(payload.get("metadata", {}))
    model = TransformerReceiverRanker(
        vehicle_feature_dim=int(metadata.get("vehicle_feature_dim", 5)),
        transformer_config=metadata.get("transformer_config"),
    )
    model.load_state_dict(payload["state_dict"])
    return model, metadata

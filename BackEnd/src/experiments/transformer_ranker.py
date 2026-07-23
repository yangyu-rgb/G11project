"""Supervised Transformer receiver ranker used by the Transformer-only ablation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

from src.environment.network_model import Priority
from src.environment.v2x_env import V2XEnv
from src.models.transformer import EnvironmentTransformer


class TransformerReceiverRanker(nn.Module):
    """Score vehicle tokens without an RL policy or handcrafted scheduling rule."""

    def __init__(self) -> None:
        super().__init__()
        self.encoder = EnvironmentTransformer()
        self.receiver_score = nn.Linear(256, 1)

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
    model = TransformerReceiverRanker()
    model.load_state_dict(payload["state_dict"])
    return model, dict(payload.get("metadata", {}))

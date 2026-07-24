"""Distance-aware Graph Transformer with the standard encoder output contract."""

from __future__ import annotations

import torch
from torch import nn

from src.models.transformer import EnvironmentTransformer, TransformerOutput


class GraphEnvironmentTransformer(EnvironmentTransformer):
    """Augment vehicle tokens with a learned summary of nearby vehicle features."""

    def __init__(self, *args: object, distance_temperature: float = 0.2, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        if distance_temperature <= 0:
            raise ValueError("distance_temperature must be positive")
        self.distance_temperature = distance_temperature
        self.graph_projection = nn.Linear(self.vehicle_feature_dim, self.vehicle_feature_dim)

    def forward(
        self,
        vehicle_features: torch.Tensor,
        event_features: torch.Tensor,
        vehicle_padding_mask: torch.Tensor | None = None,
        event_padding_mask: torch.Tensor | None = None,
    ) -> TransformerOutput:
        positions = vehicle_features[..., :2]
        distances = torch.cdist(positions, positions)
        adjacency = torch.softmax(-distances / self.distance_temperature, dim=-1)
        if vehicle_padding_mask is not None:
            adjacency = adjacency.masked_fill(vehicle_padding_mask[:, None, :], 0.0)
            adjacency = adjacency / adjacency.sum(dim=-1, keepdim=True).clamp_min(1e-6)
        neighbour_summary = adjacency @ vehicle_features
        graph_features = vehicle_features + self.graph_projection(neighbour_summary)
        return super().forward(
            graph_features,
            event_features,
            vehicle_padding_mask,
            event_padding_mask,
        )

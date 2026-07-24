"""Transformer environment encoder for vehicle and emergency-event tokens."""

from __future__ import annotations

import math
from typing import NamedTuple

import torch
from torch import nn

from src.models.utils import SinusoidalPositionalEncoding


class TransformerOutput(NamedTuple):
    """Batch-aware embeddings and per-layer attention for downstream consumers."""

    global_embedding: torch.Tensor
    vehicle_embeddings: torch.Tensor
    attention_weights: torch.Tensor


class _AttentionEncoderLayer(nn.Module):
    def __init__(
        self,
        d_model: int,
        num_heads: int,
        feedforward_dim: int,
        dropout: float,
    ) -> None:
        super().__init__()
        attention_dim = math.ceil(d_model / num_heads) * num_heads
        self.input_projection = (
            nn.Identity() if attention_dim == d_model else nn.Linear(d_model, attention_dim)
        )
        self.self_attention = nn.MultiheadAttention(
            embed_dim=attention_dim,
            num_heads=num_heads,
            dropout=dropout,
            batch_first=True,
        )
        self.output_projection = (
            nn.Identity() if attention_dim == d_model else nn.Linear(attention_dim, d_model)
        )
        self.linear1 = nn.Linear(d_model, feedforward_dim)
        self.linear2 = nn.Linear(feedforward_dim, d_model)
        self.dropout = nn.Dropout(dropout)
        self.attention_dropout = nn.Dropout(dropout)
        self.feedforward_dropout = nn.Dropout(dropout)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.activation = nn.GELU()

    def forward(
        self, tokens: torch.Tensor, padding_mask: torch.Tensor | None
    ) -> tuple[torch.Tensor, torch.Tensor]:
        attention_tokens = self.input_projection(tokens)
        attention_output, attention_weights = self.self_attention(
            attention_tokens,
            attention_tokens,
            attention_tokens,
            key_padding_mask=padding_mask,
            need_weights=True,
            average_attn_weights=False,
        )
        attention_output = self.output_projection(attention_output)
        tokens = self.norm1(tokens + self.attention_dropout(attention_output))
        feedforward_output = self.linear2(
            self.feedforward_dropout(self.activation(self.linear1(tokens)))
        )
        tokens = self.norm2(tokens + self.dropout(feedforward_output))
        return tokens, attention_weights


class EnvironmentTransformer(nn.Module):
    """Encode separate vehicle/event features into global and local representations."""

    def __init__(
        self,
        vehicle_feature_dim: int = 5,
        event_feature_dim: int = 4,
        d_model: int = 256,
        num_heads: int = 8,
        num_layers: int = 4,
        feedforward_dim: int = 1024,
        dropout: float = 0.1,
        max_tokens: int = 512,
    ) -> None:
        super().__init__()
        if vehicle_feature_dim <= 0 or event_feature_dim <= 0:
            raise ValueError("feature dimensions must be positive")
        if d_model <= 0 or d_model % 2 != 0 or num_heads <= 0 or num_layers <= 0:
            raise ValueError("d_model must be positive and even; heads/layers must be positive")
        if feedforward_dim <= 0:
            raise ValueError("feedforward_dim must be positive")
        if not 0 <= dropout < 1:
            raise ValueError("dropout must be in [0, 1)")

        self.vehicle_feature_dim = vehicle_feature_dim
        self.event_feature_dim = event_feature_dim
        self.d_model = d_model
        self.num_heads = num_heads
        self.num_layers = num_layers
        self.vehicle_projection = nn.Linear(vehicle_feature_dim, d_model)
        self.event_projection = nn.Linear(event_feature_dim, d_model)
        self.token_type_embedding = nn.Embedding(2, d_model)
        self.position_encoding = SinusoidalPositionalEncoding(d_model, max_tokens)
        self.layers = nn.ModuleList(
            _AttentionEncoderLayer(d_model, num_heads, feedforward_dim, dropout)
            for _ in range(num_layers)
        )
        self.global_pool = nn.Linear(d_model, 1)

    @staticmethod
    def _validate_mask(
        mask: torch.Tensor | None,
        batch_size: int,
        token_count: int,
        name: str,
        device: torch.device,
    ) -> torch.Tensor:
        if mask is None:
            return torch.zeros(batch_size, token_count, dtype=torch.bool, device=device)
        if mask.shape != (batch_size, token_count):
            raise ValueError(f"{name} must have shape [{batch_size}, {token_count}]")
        return mask.to(device=device, dtype=torch.bool)

    def forward(
        self,
        vehicle_features: torch.Tensor,
        event_features: torch.Tensor,
        vehicle_padding_mask: torch.Tensor | None = None,
        event_padding_mask: torch.Tensor | None = None,
    ) -> TransformerOutput:
        if vehicle_features.ndim != 3 or vehicle_features.shape[-1] != self.vehicle_feature_dim:
            raise ValueError(
                "vehicle_features must have shape [batch, vehicles, vehicle_feature_dim]"
            )
        if event_features.ndim != 3 or event_features.shape[-1] != self.event_feature_dim:
            raise ValueError("event_features must have shape [batch, events, event_feature_dim]")
        if vehicle_features.shape[0] != event_features.shape[0]:
            raise ValueError("vehicle and event batches must have the same size")

        batch_size, vehicle_count, _ = vehicle_features.shape
        event_count = event_features.shape[1]
        if vehicle_count == 0:
            raise ValueError("at least one vehicle token is required")

        device = vehicle_features.device
        event_features = event_features.to(device=device, dtype=vehicle_features.dtype)
        vehicle_mask = self._validate_mask(
            vehicle_padding_mask,
            batch_size,
            vehicle_count,
            "vehicle_padding_mask",
            device,
        )
        event_mask = self._validate_mask(
            event_padding_mask,
            batch_size,
            event_count,
            "event_padding_mask",
            device,
        )
        padding_mask = torch.cat((vehicle_mask, event_mask), dim=1)
        if padding_mask.all(dim=1).any():
            raise ValueError("each sample must contain at least one unmasked token")

        vehicle_tokens = self.vehicle_projection(vehicle_features)
        event_tokens = self.event_projection(event_features)
        vehicle_type = self.token_type_embedding(
            torch.zeros(vehicle_count, dtype=torch.long, device=device)
        )
        event_type = self.token_type_embedding(
            torch.ones(event_count, dtype=torch.long, device=device)
        )
        vehicle_tokens = vehicle_tokens + vehicle_type.unsqueeze(0)
        event_tokens = event_tokens + event_type.unsqueeze(0)
        tokens = self.position_encoding(torch.cat((vehicle_tokens, event_tokens), dim=1))

        layer_attention: list[torch.Tensor] = []
        for layer in self.layers:
            tokens, attention_weights = layer(tokens, padding_mask)
            layer_attention.append(attention_weights)

        pooling_logits = self.global_pool(tokens).squeeze(-1)
        pooling_logits = pooling_logits.masked_fill(padding_mask, float("-inf"))
        pooling_weights = torch.softmax(pooling_logits, dim=1)
        global_embedding = torch.sum(tokens * pooling_weights.unsqueeze(-1), dim=1)
        vehicle_embeddings = tokens[:, :vehicle_count]
        attention_weights = torch.stack(layer_attention, dim=1)
        return TransformerOutput(global_embedding, vehicle_embeddings, attention_weights)

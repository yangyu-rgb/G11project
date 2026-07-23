"""Reusable neural-network utilities for environment encoders."""

from __future__ import annotations

import math

import torch
from torch import nn


class SinusoidalPositionalEncoding(nn.Module):
    """Add deterministic sinusoidal positions to batch-first token embeddings."""

    def __init__(self, d_model: int, max_length: int = 512) -> None:
        super().__init__()
        if d_model <= 0 or d_model % 2 != 0:
            raise ValueError("d_model must be a positive even integer")
        if max_length <= 0:
            raise ValueError("max_length must be positive")

        positions = torch.arange(max_length, dtype=torch.float32).unsqueeze(1)
        frequencies = torch.exp(
            torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10_000.0) / d_model)
        )
        encoding = torch.zeros(max_length, d_model, dtype=torch.float32)
        encoding[:, 0::2] = torch.sin(positions * frequencies)
        encoding[:, 1::2] = torch.cos(positions * frequencies)
        self.register_buffer("encoding", encoding.unsqueeze(0), persistent=False)

    def forward(self, tokens: torch.Tensor) -> torch.Tensor:
        if tokens.ndim != 3:
            raise ValueError("tokens must have shape [batch, token_count, d_model]")
        token_count = tokens.shape[1]
        if token_count > self.encoding.shape[1]:
            raise ValueError(f"token_count {token_count} exceeds maximum {self.encoding.shape[1]}")
        return tokens + self.encoding[:, :token_count].to(device=tokens.device, dtype=tokens.dtype)

"""Deterministic confidence intervals and paired significance tests."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import product
from math import erfc, sqrt
from typing import Any

import numpy as np

try:
    from scipy.stats import wilcoxon as scipy_wilcoxon
except ImportError:  # pragma: no cover - exercised only by minimal runtime images
    scipy_wilcoxon = None


def bootstrap_mean_ci(
    values: Sequence[float], *, seed: int = 20260723, samples: int = 10_000
) -> tuple[float, float]:
    array = np.asarray(values, dtype=np.float64)
    if not len(array):
        raise ValueError("bootstrap values cannot be empty")
    rng = np.random.default_rng(seed)
    indices = rng.integers(0, len(array), size=(samples, len(array)))
    means = array[indices].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def paired_wilcoxon(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("paired samples must be non-empty and have equal length")
    differences = np.asarray(left, dtype=np.float64) - np.asarray(right, dtype=np.float64)
    if np.allclose(differences, 0):
        return 1.0
    if scipy_wilcoxon is not None:
        return float(scipy_wilcoxon(differences, alternative="two-sided").pvalue)
    differences = differences[~np.isclose(differences, 0)]
    absolute = np.abs(differences)
    order = np.argsort(absolute)
    ranks = np.empty(len(absolute), dtype=np.float64)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and np.isclose(absolute[order[end]], absolute[order[start]]):
            end += 1
        ranks[order[start:end]] = (start + 1 + end) / 2
        start = end
    observed = min(ranks[differences > 0].sum(), ranks[differences < 0].sum())
    if len(ranks) <= 20:
        statistics = []
        total = ranks.sum()
        for signs in product((False, True), repeat=len(ranks)):
            positive = ranks[np.asarray(signs)].sum()
            statistics.append(min(positive, total - positive))
        return sum(value <= observed + 1e-12 for value in statistics) / len(statistics)
    mean = len(ranks) * (len(ranks) + 1) / 4
    variance = len(ranks) * (len(ranks) + 1) * (2 * len(ranks) + 1) / 24
    z_score = (observed - mean + 0.5) / sqrt(variance)
    return erfc(abs(z_score) / sqrt(2))


def holm_adjust(p_values: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(p_values.items(), key=lambda item: item[1])
    total = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (name, value) in enumerate(ordered):
        running = max(running, min(1.0, value * (total - rank)))
        adjusted[name] = running
    return adjusted


def summarize_values(values: Sequence[float]) -> dict[str, Any]:
    array = np.asarray(values, dtype=np.float64)
    low, high = bootstrap_mean_ci(array)
    return {
        "mean": float(array.mean()),
        "std": float(array.std(ddof=1)) if len(array) > 1 else 0.0,
        "ci95": [low, high],
        "count": len(array),
    }

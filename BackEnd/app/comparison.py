"""Compatibility exports for live comparison helpers.

Core evaluation code lives under ``src`` so experiments never depend on the
FastAPI application layer.
"""

from src.evaluation.baselines import (
    COMPARISON_BASELINES,
    BaselineMethod as ComparisonBaseline,
    build_baseline_action,
    validate_baseline,
)

__all__ = [
    "COMPARISON_BASELINES",
    "ComparisonBaseline",
    "build_baseline_action",
    "validate_baseline",
]

"""Generate presentation-ready artifacts for the highway-only demo-lite experiment."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.experiments.io import atomic_write_json, backend_path, git_metadata  # noqa: E402

METHODS = ("ai", "broadcast", "distance", "urgency")
COLORS = {
    "ai": "#2563EB",
    "broadcast": "#DC2626",
    "distance": "#F59E0B",
    "urgency": "#16A34A",
}
TABLE_METRICS = (
    "affected_vehicle_coverage",
    "effective_delivery_rate",
    "p95_latency_ms",
    "communication_overhead",
    "timely_event_rate",
)
CHART_METRICS = (
    ("affected_vehicle_coverage", "Affected-vehicle coverage", "Rate"),
    ("p95_latency_ms", "P95 latency", "Milliseconds"),
    ("communication_overhead", "Communication overhead", "Messages / effective delivery"),
)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"missing or invalid demo-lite result: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"demo-lite result must be an object: {path}")
    return value


def _mean(summary: dict[str, Any], metric: str) -> float | None:
    value = summary.get(metric, {}).get("mean")
    return float(value) if value is not None else None


def _write_table(summary: dict[str, Any], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("method", *TABLE_METRICS))
        for method in METHODS:
            metrics = summary["methods"][method]
            writer.writerow(
                (
                    method,
                    *(
                        "" if (value := _mean(metrics, metric)) is None else f"{value:.6f}"
                        for metric in TABLE_METRICS
                    ),
                )
            )


def _comparison_figure(summary: dict[str, Any], path: Path) -> None:
    figure, axes = plt.subplots(1, 3, figsize=(13.2, 4.2), constrained_layout=True)
    for axis, (metric, title, ylabel) in zip(axes, CHART_METRICS, strict=True):
        values = [_mean(summary["methods"][method], metric) for method in METHODS]
        plotted = [0.0 if value is None else value for value in values]
        bars = axis.bar(
            [method.title() for method in METHODS],
            plotted,
            color=[COLORS[method] for method in METHODS],
        )
        axis.set(title=title, ylabel=ylabel)
        axis.tick_params(axis="x", rotation=20)
        if metric in {"affected_vehicle_coverage"}:
            axis.set_ylim(0, 1)
        for bar, value in zip(bars, values, strict=True):
            if value is not None:
                axis.text(
                    bar.get_x() + bar.get_width() / 2,
                    bar.get_height(),
                    f"{value:.3f}",
                    ha="center",
                    va="bottom",
                    fontsize=8,
                )
    figure.suptitle("Preliminary highway demo-lite comparison")
    figure.savefig(path, dpi=300)
    plt.close(figure)


def _training_figure(training_root: Path, path: Path) -> None:
    curves = []
    for log_path in training_root.glob("config_*/seed_*/training_log.csv"):
        with log_path.open(encoding="utf-8") as stream:
            values = [float(row["reward"]) for row in csv.DictReader(stream)]
        if values:
            curves.append(values)
    figure, axis = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
    if curves:
        width = min(map(len, curves))
        values = np.asarray([curve[:width] for curve in curves])
        episodes = np.arange(1, width + 1)
        axis.plot(episodes, values.mean(axis=0), color=COLORS["ai"], label="Mean reward")
        axis.fill_between(
            episodes,
            values.mean(axis=0) - values.std(axis=0),
            values.mean(axis=0) + values.std(axis=0),
            color=COLORS["ai"],
            alpha=0.18,
            label="±1 standard deviation",
        )
        axis.legend(frameon=False)
    else:
        axis.text(0.5, 0.5, "No completed training logs", ha="center", va="center")
    axis.set(
        xlabel="Episode",
        ylabel="Reward",
        title="Demo-lite PPO training convergence",
    )
    figure.savefig(path, dpi=300)
    plt.close(figure)


def generate_demo_lite_results(
    output: str | Path, *, experiments_root: str | Path
) -> dict[str, Any]:
    root = backend_path(experiments_root)
    output_directory = backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    comparison = _load_json(root / "comparison_results/summary.json")
    if comparison.get("run_mode") != "demo_lite":
        raise ValueError("demo-lite result generation requires run_mode=demo_lite")
    if comparison.get("completed_result_rows") != comparison.get(
        "expected_result_rows"
    ) or comparison.get("failures"):
        raise ValueError("demo-lite comparison matrix is incomplete")
    if set(comparison.get("methods", {})) != set(METHODS):
        raise ValueError("demo-lite comparison must contain AI and all three baselines")

    _write_table(comparison, output_directory / "table_comparison.csv")
    _comparison_figure(comparison, output_directory / "fig_metric_comparison.png")
    _training_figure(root / "highway_batch", output_directory / "fig_training_curve.png")

    report = [
        "# Course-demo preliminary results",
        "",
        "This output is generated from the reduced highway-only `demo_lite` protocol.",
        "It is suitable for preliminary course-demo evidence, not a paper-scale claim.",
        "",
        f"Completed comparison rows: {comparison['completed_result_rows']}.",
        "Methods: Transformer-PPO, broadcast, fixed-distance, and urgency-based scheduling.",
        "",
        "Use `table_comparison.csv` and `fig_metric_comparison.png` in the presentation,",
        "and report the reduced training matrix and highway-only scope explicitly.",
    ]
    (root / "DEMO_LITE_RESULTS_SUMMARY.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    manifest = {
        "run_mode": "demo_lite",
        "scope": "highway-only preliminary course demo",
        "completed_result_rows": comparison["completed_result_rows"],
        "figures": sorted(path.name for path in output_directory.iterdir()),
        "git": git_metadata(),
    }
    atomic_write_json(output_directory / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--experiments-root", required=True)
    arguments = parser.parse_args()
    result = generate_demo_lite_results(
        arguments.output, experiments_root=arguments.experiments_root
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

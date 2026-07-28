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
OPTIONAL_METHODS = ("fixed_directional_corridor",)
COLORS = {
    "ai": "#2563EB",
    "broadcast": "#DC2626",
    "distance": "#F59E0B",
    "urgency": "#16A34A",
    "fixed_directional_corridor": "#7C3AED",
}
DISPLAY_NAMES = {
    "ai": "AI",
    "broadcast": "Broadcast",
    "distance": "Distance",
    "urgency": "Urgency",
    "fixed_directional_corridor": "Fixed Corridor",
}
TABLE_METRICS = (
    "affected_vehicle_coverage",
    "affected_vehicle_selection_coverage",
    "effective_delivery_rate",
    "p95_latency_ms",
    "communication_overhead",
    "normalized_channel_cost",
    "timely_event_rate",
    "safety_override_rate",
    "mean_raw_radius_m",
    "mean_executed_radius_m",
)
CHART_METRICS = (
    ("affected_vehicle_coverage", "Affected-Vehicle Coverage ↑", "Rate"),
    ("p95_latency_ms", "P95 End-to-End Latency ↓", "Milliseconds"),
    ("communication_overhead", "Communication Overhead ↓", "Messages / effective delivery"),
    (
        "normalized_channel_cost",
        "Normalized Channel Cost ↓",
        "Bandwidth units / effective delivery",
    ),
)
SEVERITY_GROUPS = ("low", "medium", "high")


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


def _write_table(summary: dict[str, Any], path: Path, methods: tuple[str, ...]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("method", "metric", "mean", "std", "ci95_low", "ci95_high", "n"))
        for method in methods:
            metrics = summary["methods"][method]
            for metric in TABLE_METRICS:
                value = metrics.get(metric, {})
                ci = value.get("ci95", (None, None))
                writer.writerow(
                    (
                        method,
                        metric,
                        value.get("mean", ""),
                        value.get("std", ""),
                        ci[0],
                        ci[1],
                        value.get("count", ""),
                    )
                )


def _write_severity_table(summary: dict[str, Any], path: Path, methods: tuple[str, ...]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("severity_group", "method", "coverage_mean", "ci95_low", "ci95_high", "n"))
        for group in SEVERITY_GROUPS:
            for method in methods:
                metric = summary["severity_groups"][group][method]["affected_vehicle_coverage"]
                writer.writerow((group, method, metric["mean"], *metric["ci95"], metric["count"]))


def _value_claims(summary: dict[str, Any]) -> list[dict[str, float | str]]:
    methods = summary["methods"]
    ai = methods["ai"]
    claims = []
    for metric, baseline, label in (
        ("p95_latency_ms", "broadcast", "P95 latency reduction vs broadcast"),
        (
            "communication_overhead",
            "broadcast",
            "communication-overhead reduction vs broadcast",
        ),
        (
            "normalized_channel_cost",
            "urgency",
            "normalized-channel-cost reduction vs urgency",
        ),
    ):
        ai_mean = float(ai[metric]["mean"])
        baseline_mean = float(methods[baseline][metric]["mean"])
        claims.append(
            {
                "claim": label,
                "metric": metric,
                "baseline": baseline,
                "ai_mean": ai_mean,
                "baseline_mean": baseline_mean,
                "relative_improvement": 1.0 - ai_mean / baseline_mean,
            }
        )
    baseline_methods = [method for method in methods if method != "ai"]
    best_coverage = max(
        float(methods[method]["affected_vehicle_coverage"]["mean"]) for method in baseline_methods
    )
    claims.append(
        {
            "claim": "coverage gap vs best baseline",
            "metric": "affected_vehicle_coverage",
            "baseline": "best baseline",
            "ai_mean": float(ai["affected_vehicle_coverage"]["mean"]),
            "baseline_mean": best_coverage,
            "relative_improvement": float(ai["affected_vehicle_coverage"]["mean"]) - best_coverage,
        }
    )
    return claims


def _write_value_table(summary: dict[str, Any], path: Path) -> None:
    claims = _value_claims(summary)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=claims[0].keys())
        writer.writeheader()
        writer.writerows(claims)


def _write_action_audit(summary: dict[str, Any], path: Path) -> None:
    incidents = summary.get("behavioral_gate", {}).get("incidents", [])
    fieldnames = (
        "scenario",
        "event_id",
        "severity",
        "affected_radius_m",
        "structured_actions",
        "corridor_radii_m",
        "lane_scopes",
        "priorities",
        "bandwidth_fractions",
        "receiver_signatures",
        "forward_vehicle_ids",
        "missed_nearest_follower_ids",
    )
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        for incident in incidents:
            writer.writerow(
                {
                    field: (
                        json.dumps(incident.get(field), ensure_ascii=False)
                        if isinstance(incident.get(field), (list, dict))
                        else incident.get(field)
                    )
                    for field in fieldnames
                }
            )


def _comparison_figure(summary: dict[str, Any], path: Path, methods: tuple[str, ...]) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(12.8, 8.0), constrained_layout=True)
    axes = axes.ravel()
    for axis, (metric, title, ylabel) in zip(axes, CHART_METRICS, strict=True):
        values = [_mean(summary["methods"][method], metric) for method in methods]
        plotted = [0.0 if value is None else value for value in values]
        intervals = [summary["methods"][method].get(metric, {}).get("ci95") for method in methods]
        errors = np.asarray(
            [
                [0.0, 0.0]
                if value is None or interval is None
                else [value - float(interval[0]), float(interval[1]) - value]
                for value, interval in zip(values, intervals, strict=True)
            ]
        ).T
        bars = axis.bar(
            [DISPLAY_NAMES[method] for method in methods],
            plotted,
            color=[COLORS[method] for method in methods],
            yerr=errors,
            capsize=4,
            edgecolor="white",
            linewidth=0.8,
        )
        axis.set(title=title, ylabel=ylabel)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
        if metric in {"affected_vehicle_coverage"}:
            axis.set_ylim(0, 1.08)
        offset = max(plotted, default=1.0) * 0.015
        for index, (bar, value) in enumerate(zip(bars, values, strict=True)):
            if value is not None:
                axis.text(
                    bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + errors[1, index] + offset,
                    f"{value:.3f}",
                    ha="center",
                    va="bottom",
                    fontsize=8,
                )
    count = summary["methods"]["ai"]["affected_vehicle_coverage"].get("count", "?")
    figure.suptitle(
        f"Adaptive Highway V2X Scheduling — Held-Out Test Comparison (n={count})",
        fontsize=15,
        fontweight="bold",
    )
    figure.savefig(path, dpi=300)
    plt.close(figure)


def _tradeoff_figure(summary: dict[str, Any], path: Path, methods: tuple[str, ...]) -> None:
    figure, axis = plt.subplots(figsize=(7.2, 5.0), constrained_layout=True)
    for method in methods:
        metrics = summary["methods"][method]
        x_value = _mean(metrics, "communication_overhead")
        y_value = _mean(metrics, "affected_vehicle_coverage")
        if x_value is None or y_value is None:
            continue
        x_ci = metrics["communication_overhead"].get("ci95", (x_value, x_value))
        y_ci = metrics["affected_vehicle_coverage"].get("ci95", (y_value, y_value))
        axis.errorbar(
            x_value,
            y_value,
            xerr=[[x_value - x_ci[0]], [x_ci[1] - x_value]],
            yerr=[[y_value - y_ci[0]], [y_ci[1] - y_value]],
            fmt="o",
            markersize=10,
            capsize=4,
            color=COLORS[method],
            label=DISPLAY_NAMES[method],
        )
    axis.set(
        xlabel="Communication Overhead ↓",
        ylabel="Affected-Vehicle Coverage ↑",
        title="Safety–Efficiency Trade-off",
    )
    axis.set_ylim(0, 1.05)
    axis.grid(alpha=0.2)
    axis.legend(frameon=False)
    figure.savefig(path, dpi=300)
    plt.close(figure)


def _severity_figure(summary: dict[str, Any], path: Path, methods: tuple[str, ...]) -> None:
    figure, axis = plt.subplots(figsize=(9.6, 5.4), constrained_layout=True)
    x_positions = np.arange(len(SEVERITY_GROUPS))
    width = min(0.19, 0.8 / len(methods))
    center = (len(methods) - 1) / 2
    for index, method in enumerate(methods):
        values = []
        errors = []
        for group in SEVERITY_GROUPS:
            metric = summary["severity_groups"][group][method]["affected_vehicle_coverage"]
            mean = float(metric["mean"])
            interval = metric.get("ci95", (mean, mean))
            values.append(mean)
            errors.append((mean - float(interval[0]), float(interval[1]) - mean))
        error_array = np.asarray(errors).T
        positions = x_positions + (index - center) * width
        bars = axis.bar(
            positions,
            values,
            width,
            yerr=error_array,
            capsize=3,
            color=COLORS[method],
            label=DISPLAY_NAMES[method],
        )
        for bar, value, upper_error in zip(bars, values, error_array[1], strict=True):
            axis.text(
                bar.get_x() + bar.get_width() / 2,
                value + upper_error + 0.012,
                f"{value:.3f}",
                ha="center",
                va="bottom",
                fontsize=7,
            )
    axis.axhline(0.95, color="#111827", linestyle="--", linewidth=1.2, label="95% target")
    axis.set(
        xticks=x_positions,
        xticklabels=("Low", "Medium", "High"),
        ylim=(0, 1.08),
        xlabel="Emergency Severity",
        ylabel="Affected-Vehicle Coverage",
        title="Affected-Vehicle Coverage by Emergency Severity",
    )
    axis.grid(axis="y", alpha=0.2)
    axis.set_axisbelow(True)
    axis.legend(frameon=False, ncol=5, loc="lower center")
    figure.savefig(path, dpi=300)
    plt.close(figure)


def _training_figure(training_root: Path, path: Path, *, protocol: str) -> None:
    curves: list[tuple[np.ndarray, np.ndarray]] = []
    for log_path in training_root.rglob("training_log.csv"):
        with log_path.open(encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        if rows:
            rewards = np.asarray([float(row["reward"]) for row in rows])
            timesteps = np.asarray([float(row.get("timesteps") or row["episode"]) for row in rows])
            window = min(100, len(rewards))
            kernel = np.ones(window) / window
            smoothed = np.convolve(rewards, kernel, mode="valid")
            curves.append((timesteps[window - 1 :], smoothed))
    figure, (reward_axis, validation_axis) = plt.subplots(
        1, 2, figsize=(12.8, 4.8), constrained_layout=True
    )
    if curves:
        start = max(curve[0][0] for curve in curves)
        stop = min(curve[0][-1] for curve in curves)
        grid = np.linspace(start, stop, min(300, max(2, int(stop - start) + 1)))
        aligned = np.asarray([np.interp(grid, x, y) for x, y in curves])
        mean = aligned.mean(axis=0)
        ci = 1.96 * aligned.std(axis=0) / np.sqrt(len(aligned))
        reward_axis.plot(grid, mean, color=COLORS["ai"], linewidth=2.2, label="Rolling mean")
        reward_axis.fill_between(
            grid,
            mean - ci,
            mean + ci,
            color=COLORS["ai"],
            alpha=0.18,
            label="95% confidence interval",
        )
        reward_axis.legend(frameon=False)
    else:
        reward_axis.text(0.5, 0.5, "No completed training logs", ha="center", va="center")
    reward_axis.set(
        xlabel="Training Timesteps",
        ylabel="Reward",
        title="PPO Training Reward (100-Episode Rolling Mean)",
    )
    reward_axis.grid(alpha=0.2)

    validation_histories = []
    for history_path in training_root.rglob("validation_history.json"):
        try:
            history = json.loads(history_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(history, list) and history:
            validation_histories.append(history)
    score_axis = validation_axis.twinx()
    candidate_colors = (COLORS["ai"], COLORS["distance"], COLORS["urgency"])
    for index, history in enumerate(validation_histories):
        color = candidate_colors[index % len(candidate_colors)]
        validation_axis.plot(
            [item["timesteps"] for item in history],
            [item["affected_vehicle_coverage"] for item in history],
            marker="o",
            alpha=0.65,
            color=color,
            label=f"Candidate {index + 1} coverage",
        )
        if all("high_severity_coverage" in item for item in history):
            validation_axis.plot(
                [item["timesteps"] for item in history],
                [item["high_severity_coverage"] for item in history],
                linestyle=":",
                linewidth=2,
                alpha=0.8,
                color=color,
                label=f"Candidate {index + 1} high-severity coverage",
            )
        if all("score" in item for item in history):
            score_axis.plot(
                [item["timesteps"] for item in history],
                [item["score"] for item in history],
                linestyle="--",
                alpha=0.55,
                color=color,
                label=f"Candidate {index + 1} score",
            )
    revalidation_path = training_root.parent / "champion/revalidation.json"
    revalidation = (
        _load_json(revalidation_path)
        if protocol == "directional-v2" and revalidation_path.is_file()
        else None
    )
    if revalidation is not None:
        validation_axis.clear()
        score_axis.clear()
        score_axis.set_visible(False)
        labels = ("Coverage", "Selection", "Timely events")
        metrics = revalidation["metrics"]
        values = (
            float(metrics["affected_vehicle_coverage"]),
            float(metrics["affected_vehicle_selection_coverage"]),
            float(metrics["timely_event_rate"]),
        )
        bars = validation_axis.bar(labels, values, color=("#2563EB", "#0EA5E9", "#16A34A"))
        for bar, value in zip(bars, values, strict=True):
            validation_axis.text(
                bar.get_x() + bar.get_width() / 2,
                value + 0.015,
                f"{value:.3f}",
                ha="center",
                va="bottom",
            )
        validation_axis.axhline(0.95, color="#6B7280", linestyle="--", label="95% gate")
        validation_axis.set(
            ylabel="Rate",
            ylim=(0, 1.08),
            title="Champion Revalidation — Metric Schema v2",
        )
        validation_axis.grid(axis="y", alpha=0.2)
        validation_axis.legend(frameon=False)
    else:
        target = 0.97 if protocol in {"adaptive-v5", "constrained-v6"} else 0.95
        validation_axis.axhline(
            target,
            color="#6B7280",
            linestyle="--",
            label=f"{target:.0%} validation gate",
        )
        validation_axis.set(
            xlabel="Training Timesteps",
            ylabel="Validation Coverage",
            ylim=(0, 1.05),
            title="Held-Out Validation Metrics",
        )
        score_axis.set_ylabel("Validation Score")
        validation_axis.grid(alpha=0.2)
        handles, labels = validation_axis.get_legend_handles_labels()
        score_handles, score_labels = score_axis.get_legend_handles_labels()
        validation_axis.legend(handles + score_handles, labels + score_labels, frameon=False)
    title = (
        "Safety-Constrained PPO Fine-Tuning and Validation"
        if protocol in {"adaptive-v5", "constrained-v6"}
        else "Transformer-PPO Training and Validation"
    )
    figure.suptitle(title, fontsize=15, fontweight="bold")
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
    methods = tuple(comparison.get("methods", {}))
    required = set(METHODS)
    supported = required | set(OPTIONAL_METHODS)
    if not required <= set(methods) or not set(methods) <= supported:
        raise ValueError("demo-lite comparison must contain AI and all required baselines")

    _write_table(comparison, output_directory / "table_comparison.csv", methods)
    _write_value_table(comparison, output_directory / "table_value_claims.csv")
    _write_action_audit(comparison, output_directory / "table_action_audit.csv")
    _comparison_figure(comparison, output_directory / "fig_metric_comparison.png", methods)
    _tradeoff_figure(
        comparison,
        output_directory / "fig_safety_efficiency_tradeoff.png",
        methods,
    )
    severity_groups = comparison.get("severity_groups", {})
    if all(group in severity_groups for group in SEVERITY_GROUPS):
        _write_severity_table(
            comparison,
            output_directory / "table_coverage_by_severity.csv",
            methods,
        )
        _severity_figure(
            comparison,
            output_directory / "fig_coverage_by_severity.png",
            methods,
        )
    training_root = (
        root / "candidates" if (root / "candidates").is_dir() else root / "highway_batch"
    )
    protocol = str(comparison.get("protocol") or "adaptive-v4")
    claims = _value_claims(comparison)
    eligibility = comparison.get("coverage_eligibility", {})
    behavior = comparison.get("behavioral_gate", {})
    _training_figure(
        training_root,
        output_directory / "fig_training_curve.png",
        protocol=protocol,
    )

    atomic_write_json(
        output_directory / "acceptance_report.json",
        comparison.get("acceptance", {"passed": False, "checks": {}}),
    )

    report = [
        "# Professional highway course-demo results",
        "",
        f"This output is generated from the highway-only `{protocol}` course-demo protocol.",
        "It is suitable for preliminary course-demo evidence, not a paper-scale claim.",
        "",
        f"Completed comparison rows: {comparison['completed_result_rows']}.",
        f"Held-out paired cases: {comparison.get('expected_case_count', 'unknown')}.",
        (
            "Coverage-eligible cases: "
            f"{eligibility.get('eligible_cases', 'unknown')}; zero-affected cases excluded: "
            f"{eligibility.get('zero_affected_cases', 'unknown')}."
        ),
        "Methods: " + ", ".join(DISPLAY_NAMES[method] for method in methods) + ".",
        "Event severity maps to 225 m, 300 m, or 375 m affected-vehicle safety radii.",
        "Error bars report deterministic 95% bootstrap confidence intervals.",
        f"Acceptance: {comparison.get('acceptance', {}).get('passed', 'not evaluated')}.",
        (
            "Distinct learned structured actions: "
            f"{behavior.get('action_signature_count', 'not audited')}."
        ),
        "",
        "Measured value on the paired final holdout:",
        *[f"- {item['claim']}: {float(item['relative_improvement']):+.1%}." for item in claims],
        "",
        "Use `table_comparison.csv` and `fig_metric_comparison.png` in the presentation,",
        "and report the reduced training matrix and highway-only scope explicitly.",
    ]
    report_text = "\n".join(report) + "\n"
    (root / "DEMO_LITE_RESULTS_SUMMARY.md").write_text(report_text, encoding="utf-8")
    (output_directory / "RESULTS_README.md").write_text(report_text, encoding="utf-8")
    manifest = {
        "run_mode": "demo_lite",
        "protocol": protocol,
        "metric_schema_version": comparison.get("metric_schema_version"),
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

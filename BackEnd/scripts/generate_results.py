"""Generate publication-ready tables, figures, and a guarded experiment report."""

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

COLORS = {
    "ai": "#2563EB",
    "broadcast": "#DC2626",
    "distance": "#F59E0B",
    "urgency": "#16A34A",
    "transformer_only": "#8B5CF6",
    "rl_only": "#06B6D4",
}
METRICS = (
    "mean_latency_ms",
    "effective_delivery_rate",
    "affected_vehicle_coverage",
    "communication_overhead",
    "timely_event_rate",
)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"missing or invalid experiment result: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"experiment result must be an object: {path}")
    return value


def _mean(summary: dict[str, Any], metric: str) -> float | None:
    value = summary.get(metric, {}).get("mean")
    return float(value) if value is not None else None


def _comparison_table(comparison: dict[str, Any], path: Path) -> None:
    labels = {
        "mean_latency_ms": "Latency (ms)",
        "effective_delivery_rate": "Effective delivery",
        "affected_vehicle_coverage": "Coverage",
        "communication_overhead": "Overhead",
        "timely_event_rate": "Timely response",
    }
    lines = [
        r"\begin{tabular}{lrrrrr}",
        r"\toprule",
        "Method & " + " & ".join(labels[item] for item in METRICS) + r" \\",
        r"\midrule",
    ]
    significance = comparison.get("paired_wilcoxon_holm", {})
    for method, metrics in comparison["methods"].items():
        values = []
        for metric in METRICS:
            stats = metrics.get(metric, {})
            marker = ""
            if method == "ai":
                comparisons = [
                    significance.get(f"ai_vs_{baseline}:{metric}", {})
                    for baseline in ("broadcast", "distance", "urgency")
                ]
                if comparisons and all(
                    item.get("significant") and item.get("ai_better") for item in comparisons
                ):
                    marker = r"$^{*}$"
            values.append(
                f"{float(stats['mean']):.3f} $\\pm$ {float(stats['std']):.3f}{marker}"
                if stats
                else "--"
            )
        lines.append(method.replace("_", r"\_") + " & " + " & ".join(values) + r" \\")
    lines.extend([r"\bottomrule", r"\end{tabular}"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _training_curves(training_roots: dict[str, Path], path: Path) -> None:
    fig, axis = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
    plotted = False
    for domain, root in training_roots.items():
        curves = []
        for log_path in root.glob("config_*/seed_*/training_log.csv"):
            with log_path.open(encoding="utf-8") as stream:
                curves.append([float(row["reward"]) for row in csv.DictReader(stream)])
        if curves:
            width = min(map(len, curves))
            values = np.asarray([curve[:width] for curve in curves])
            axis.plot(np.arange(1, width + 1), values.mean(axis=0), label=domain.title())
            axis.fill_between(
                np.arange(1, width + 1),
                values.mean(axis=0) - values.std(axis=0),
                values.mean(axis=0) + values.std(axis=0),
                alpha=0.18,
            )
            plotted = True
    if not plotted:
        axis.text(0.5, 0.5, "No completed training logs", ha="center", va="center")
    axis.set(xlabel="Episode", ylabel="Reward", title="Training convergence")
    if plotted:
        axis.legend(frameon=False)
    fig.savefig(path, dpi=300)
    plt.close(fig)


def _ablation_figure(ablation: dict[str, Any], path: Path) -> None:
    methods = [name for name in ("full", "transformer_only", "rl_only") if name in ablation]
    metrics = ("effective_delivery_rate", "affected_vehicle_coverage", "timely_event_rate")
    x = np.arange(len(metrics))
    width = 0.24
    fig, axis = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
    for index, method in enumerate(methods):
        values = [_mean(ablation[method], metric) or 0.0 for metric in metrics]
        axis.bar(
            x + (index - (len(methods) - 1) / 2) * width,
            values,
            width,
            label=method.replace("_", " ").title(),
            color=COLORS.get(method, COLORS["ai"]),
        )
    axis.set_xticks(x, ["Delivery", "Coverage", "Timely"])
    axis.set(ylabel="Rate", ylim=(0, 1), title="Component ablation")
    axis.legend(frameon=False)
    fig.savefig(path, dpi=300)
    plt.close(fig)


def _generalization_figure(generalization: dict[str, Any], path: Path) -> None:
    drops = generalization["relative_performance_drop"]
    names = list(drops)
    values = [100 * float(drops[name].get("effective_delivery_rate") or 0) for name in names]
    fig, axis = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
    axis.bar(names, values, color=["#2563EB", "#16A34A"][: len(names)])
    axis.axhline(20, color="#DC2626", linestyle="--", label="20% target")
    axis.set(ylabel="Effective-delivery drop (%)", title="Cross-domain generalization")
    axis.legend(frameon=False)
    fig.savefig(path, dpi=300)
    plt.close(fig)


def _case_figure(comparison: dict[str, Any], detailed_path: Path, path: Path) -> None:
    case_label = "aggregate fallback"
    case_values: dict[str, float] = {}
    if detailed_path.is_file():
        with detailed_path.open(encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        by_case: dict[str, dict[str, float]] = {}
        for row in rows:
            if row.get("timely_event_rate"):
                by_case.setdefault(row["case_id"], {})[row["method"]] = float(
                    row["timely_event_rate"]
                )
        eligible = {
            case_id: values
            for case_id, values in by_case.items()
            if "ai" in values
            and all(method in values for method in ("broadcast", "distance", "urgency"))
        }
        if eligible:
            case_label, case_values = max(
                eligible.items(),
                key=lambda item: (
                    item[1]["ai"]
                    - max(item[1][method] for method in ("broadcast", "distance", "urgency"))
                ),
            )
    if not case_values:
        case_values = {
            method: _mean(metrics, "timely_event_rate") or 0
            for method, metrics in comparison["methods"].items()
        }
    methods = list(case_values)
    values = [case_values[method] for method in methods]
    fig, axis = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
    axis.bar(methods, values, color=[COLORS.get(method, "#64748B") for method in methods])
    axis.set(
        ylabel="Timely response rate",
        ylim=(0, 1),
        title=f"Representative case: {case_label}",
    )
    fig.savefig(path, dpi=300)
    plt.close(fig)


def generate_results(
    output: str | Path,
    *,
    experiments_root: str | Path = "experiments",
    allow_smoke: bool = False,
) -> dict[str, Any]:
    root = backend_path(experiments_root)
    output_directory = backend_path(output)
    output_directory.mkdir(parents=True, exist_ok=True)
    comparison = _load_json(root / "comparison_results/summary.json")
    transformer = _load_json(root / "ablation_transformer/summary.json")
    rl_only = _load_json(root / "ablation_rl/summary.json")
    generalization = _load_json(root / "generalization_results/summary.json")
    inputs = [comparison, transformer, rl_only, generalization]
    if not allow_smoke and any(item.get("run_mode") != "formal" for item in inputs):
        raise ValueError(
            "paper outputs require formal runs; pass --allow-smoke only for pipeline QA"
        )
    if not allow_smoke and (
        comparison.get("completed_result_rows") != comparison.get("expected_result_rows")
        or comparison.get("failures")
        or generalization.get("failures")
    ):
        raise ValueError("formal experiment matrix is incomplete; refusing to publish conclusions")

    ablation = {
        "full": comparison["methods"]["ai"],
        "transformer_only": transformer["metrics"],
        "rl_only": rl_only["metrics"],
    }
    atomic_write_json(root / "ablation_summary.json", ablation)
    _comparison_table(comparison, output_directory / "table_comparison.tex")
    _training_curves(
        {"highway": root / "highway_batch", "urban": root / "urban_batch"},
        output_directory / "fig_training_curves.png",
    )
    _ablation_figure(ablation, output_directory / "fig_ablation.png")
    _generalization_figure(generalization, output_directory / "fig_generalization.png")
    _case_figure(
        comparison,
        root / "comparison_results/detailed_results.csv",
        output_directory / "fig_case_study.png",
    )

    report = [
        "# M2 实验结果摘要",
        "",
        f"运行模式：`{comparison.get('run_mode')}`。性能对比完成 {comparison.get('completed_result_rows')} 行结果。",
        "",
        "## 性能对比",
        "",
        "完整方法与三种基线的均值、标准差、95% bootstrap 置信区间及配对显著性检验见生成的 LaTeX 表格。",
        "",
        "## 消融与泛化",
        "",
        "Transformer-only 使用监督接收者排序并在验证集选择 Top-K；RL-only 使用手工特征 PPO。泛化下降按同域测试表现为基准计算。",
        "",
        "> 仅当输入均为 formal 且实验矩阵完整时，本报告才可作为论文结论；smoke 输出只验证流水线。",
    ]
    (root / "RESULTS_SUMMARY.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    manifest = {
        "run_mode": comparison.get("run_mode"),
        "allow_smoke": allow_smoke,
        "figures": sorted(path.name for path in output_directory.iterdir()),
        "git": git_metadata(),
    }
    atomic_write_json(output_directory / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--experiments-root", default="experiments")
    parser.add_argument("--allow-smoke", action="store_true")
    arguments = parser.parse_args()
    result = generate_results(
        arguments.output,
        experiments_root=arguments.experiments_root,
        allow_smoke=arguments.allow_smoke,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

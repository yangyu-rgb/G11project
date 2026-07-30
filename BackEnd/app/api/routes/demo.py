"""Allowlisted presentation scenarios and their local resource availability."""

import json
import math

from pathlib import Path

from fastapi import APIRouter

from app.model_registry import presentation_model_status

router = APIRouter()
BACKEND_ROOT = Path(__file__).resolve().parents[3]

PRESETS = (
    {
        "id": "highway-braking",
        "title": "高速急刹",
        "description": "比较AI调度与全量广播的通信过程。",
        "scenario": "experiments/test_scenario",
        "model": "experiments/highway_corridor/champion/model_best.zip",
        "mode": "comparison",
        "baseline": "broadcast",
    },
    {
        "id": "urban-occlusion",
        "title": "城市交叉口遮挡",
        "description": "比较AI调度与距离筛选策略。",
        "scenario": "experiments/test_urban",
        "model": "experiments/urban_training/champion/model.zip",
        "mode": "comparison",
        "baseline": "distance",
    },
    {
        "id": "multi-event",
        "title": "复杂多事件",
        "description": "展示模型面对连续事件的泛化流程。",
        "scenario": "experiments/generalization/multi_event",
        "model": "experiments/generalization/champion/model.zip",
        "mode": "single",
        "baseline": "distance",
    },
)

RESULTS_SUMMARY = Path("experiments/highway_corridor/comparison_results/summary.json")
RESULTS_MANIFEST = Path("experiments/highway_corridor/presentation_results/manifest.json")
MODEL_MANIFEST = Path("experiments/highway_corridor/champion/model_manifest.json")
EXPECTED_RESULTS_PROTOCOL = "directional-v2"
EXPECTED_METRIC_SCHEMA = 2
REQUIRED_RESULT_METHODS = ("ai", "broadcast", "distance", "urgency")


def _read_json(path: Path) -> dict[str, object] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _metric_block(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    try:
        mean = float(value["mean"])
        std = float(value["std"])
        ci95 = value["ci95"]
        count = int(value["count"])
        if not isinstance(ci95, list) or len(ci95) != 2:
            return None
        low, high = float(ci95[0]), float(ci95[1])
        if not all(math.isfinite(number) for number in (mean, std, low, high)) or count <= 0:
            return None
        return {"mean": mean, "std": std, "ci95": [low, high], "count": count}
    except (KeyError, TypeError, ValueError):
        return None


def _pending_results(reason: str, status: str = "pending") -> dict[str, object]:
    return {
        "status": status,
        "ready": False,
        "reason": reason,
        "protocol": EXPECTED_RESULTS_PROTOCOL,
        "metric_schema_version": EXPECTED_METRIC_SCHEMA,
        "methods": {},
        "provenance": None,
    }


def _validated_results_summary() -> dict[str, object]:
    """Return only allowlisted, mutually consistent and accepted result artifacts."""
    model_status = presentation_model_status()
    if not model_status.get("eligible"):
        return _pending_results(str(model_status.get("reason") or "正式模型尚未通过资格门禁"))

    summary = _read_json(BACKEND_ROOT / RESULTS_SUMMARY)
    presentation = _read_json(BACKEND_ROOT / RESULTS_MANIFEST)
    model = _read_json(BACKEND_ROOT / MODEL_MANIFEST)
    if summary is None or presentation is None or model is None:
        return _pending_results("留出集结果仍在生成，暂不展示统计结论")

    manifests = (summary, presentation)
    if any(item.get("protocol") != EXPECTED_RESULTS_PROTOCOL for item in manifests):
        return _pending_results("实验协议与当前演示不一致", "invalid")
    if any(
        item.get("metric_schema_version") != EXPECTED_METRIC_SCHEMA for item in (*manifests, model)
    ):
        return _pending_results("指标结构版本不一致", "invalid")
    acceptance = summary.get("acceptance")
    if (
        not isinstance(acceptance, dict)
        or not bool(acceptance.get("passed"))
        or summary.get("failures")
    ):
        return _pending_results("留出集实验没有通过验收门禁", "invalid")
    if summary.get("completed_result_rows") != summary.get("expected_result_rows"):
        return _pending_results("留出集实验结果不完整", "invalid")
    if presentation.get("completed_result_rows") != summary.get("completed_result_rows"):
        return _pending_results("展示清单与统计汇总行数不一致", "invalid")

    raw_methods = summary.get("methods")
    if not isinstance(raw_methods, dict) or any(
        name not in raw_methods for name in REQUIRED_RESULT_METHODS
    ):
        return _pending_results("实验方法集合不完整", "invalid")
    methods: dict[str, object] = {}
    for method_name, raw_metrics in raw_methods.items():
        if not isinstance(method_name, str) or not isinstance(raw_metrics, dict):
            continue
        metrics = {
            metric_name: parsed
            for metric_name, raw_value in raw_metrics.items()
            if isinstance(metric_name, str) and (parsed := _metric_block(raw_value)) is not None
        }
        if metrics:
            methods[method_name] = metrics
    if any(name not in methods for name in REQUIRED_RESULT_METHODS):
        return _pending_results("实验指标包含无效数值", "invalid")

    training_run = model.get("training_run") if isinstance(model.get("training_run"), dict) else {}
    presentation_git = presentation.get("git") if isinstance(presentation.get("git"), dict) else {}
    commit = training_run.get("commit") or presentation_git.get("commit")
    if training_run.get("commit") and presentation_git.get("commit") != training_run.get("commit"):
        return _pending_results("模型与展示结果的代码版本不一致", "invalid")

    significance = summary.get("paired_wilcoxon_holm")
    return {
        "status": "ready",
        "ready": True,
        "reason": None,
        "protocol": EXPECTED_RESULTS_PROTOCOL,
        "metric_schema_version": EXPECTED_METRIC_SCHEMA,
        "scope": presentation.get("scope"),
        "case_count": summary.get("expected_case_count"),
        "result_rows": summary.get("completed_result_rows"),
        "methods": methods,
        "significance": significance if isinstance(significance, dict) else {},
        "acceptance": acceptance,
        "behavioral_gate": summary.get("behavioral_gate"),
        "provenance": {
            "model_sha256": model.get("model_sha256"),
            "commit": commit,
            "run_mode": summary.get("run_mode"),
            "dirty": bool(presentation_git.get("dirty", False)),
            "artifacts": [str(RESULTS_SUMMARY), str(RESULTS_MANIFEST), str(MODEL_MANIFEST)],
        },
    }


@router.get("/demo/model-status")
def demo_model_status() -> dict[str, object]:
    return presentation_model_status()


@router.get("/demo/results-summary")
def demo_results_summary() -> dict[str, object]:
    return _validated_results_summary()


def _scenario_events(scenario_path: Path) -> list[dict[str, object]]:
    try:
        raw_events = json.loads((scenario_path / "events.json").read_text(encoding="utf-8"))
        return [
            {
                "id": str(event.get("id", f"event-{index}")),
                "type": str(event["type"]),
                "x": float(event["x"]),
                "y": float(event["y"]),
                "timestamp": float(event["timestamp"]),
                "severity": float(event["severity"]),
            }
            for index, event in enumerate(raw_events)
        ]
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return []


@router.get("/demo/scenarios")
def demo_scenarios() -> dict[str, object]:
    scenarios = []
    presentation_status = presentation_model_status()
    for preset in PRESETS:
        scenario_path = BACKEND_ROOT / preset["scenario"]
        scenario_ready = scenario_path.is_dir()
        model_ready = (
            bool(presentation_status["eligible"])
            if preset["id"] == "highway-braking"
            else (BACKEND_ROOT / preset["model"]).is_file()
        )
        scenarios.append(
            {
                **preset,
                "events": _scenario_events(scenario_path) if scenario_ready else [],
                "available": scenario_ready and model_ready,
                "missing": [
                    name
                    for name, ready in (("scenario", scenario_ready), ("model", model_ready))
                    if not ready
                ],
                **(
                    {"model_reason": presentation_status["reason"]}
                    if preset["id"] == "highway-braking" and not model_ready
                    else {}
                ),
            }
        )
    return {"scenarios": scenarios}

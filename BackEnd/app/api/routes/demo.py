"""Allowlisted presentation scenarios and their local resource availability."""

from pathlib import Path

from fastapi import APIRouter

router = APIRouter()
BACKEND_ROOT = Path(__file__).resolve().parents[3]

PRESETS = (
    {
        "id": "highway-braking",
        "title": "高速急刹",
        "description": "比较AI调度与全量广播的通信过程。",
        "scenario": "experiments/test_scenario",
        "model": "experiments/test_ppo/model.zip",
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


@router.get("/demo/scenarios")
def demo_scenarios() -> dict[str, object]:
    scenarios = []
    for preset in PRESETS:
        scenario_ready = (BACKEND_ROOT / preset["scenario"]).is_dir()
        model_ready = (BACKEND_ROOT / preset["model"]).is_file()
        scenarios.append(
            {
                **preset,
                "available": scenario_ready and model_ready,
                "missing": [
                    name
                    for name, ready in (("scenario", scenario_ready), ("model", model_ready))
                    if not ready
                ],
            }
        )
    return {"scenarios": scenarios}

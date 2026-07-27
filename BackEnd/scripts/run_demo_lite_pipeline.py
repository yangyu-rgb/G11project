"""Run the independent, resumable highway-only course-demo experiment pipeline."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

import torch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts.batch_train import run_batch  # noqa: E402
from scripts.generate_demo_lite_results import generate_demo_lite_results  # noqa: E402
from scripts.run_comparison import run_comparison  # noqa: E402
from src.experiments.io import atomic_write_json, git_metadata, load_yaml  # noqa: E402

STAGES = ("training", "comparison", "results")


class DemoLitePaused(RuntimeError):
    """Signal a normal pause after persisting all available progress."""


class DemoLitePipeline:
    def __init__(
        self,
        persistent_root: Path,
        work_root: Path,
        *,
        time_budget_minutes: float,
        allow_cpu: bool = False,
    ) -> None:
        self.persistent_root = persistent_root.expanduser().resolve()
        self.work_root = work_root.expanduser().resolve()
        self.persistent_root.mkdir(parents=True, exist_ok=True)
        self.work_root.mkdir(parents=True, exist_ok=True)
        self.time_budget_minutes = time_budget_minutes
        self.allow_cpu = allow_cpu
        self.state_path = self.persistent_root / "demo_lite_state.json"
        self.state = (
            json.loads(self.state_path.read_text(encoding="utf-8"))
            if self.state_path.is_file()
            else {"stages": {}}
        )
        self._initialize_state()

    def _initialize_state(self) -> None:
        current_git = git_metadata()
        previous_mode = self.state.get("run_mode")
        if previous_mode and previous_mode != "demo_lite":
            raise RuntimeError("persistent root belongs to a different experiment mode")
        previous_commit = self.state.get("git", {}).get("commit")
        current_commit = current_git.get("commit")
        if previous_commit and current_commit and previous_commit != current_commit:
            raise RuntimeError(
                "demo-lite progress belongs to a different git commit; use a new Drive root"
            )
        self.state.update(
            {
                "run_mode": "demo_lite",
                "scope": "highway-only preliminary course demo",
                "git": current_git,
                "runtime": {
                    "python": sys.version.split()[0],
                    "torch": torch.__version__,
                    "cuda_available": torch.cuda.is_available(),
                    "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                },
            }
        )
        self._save()

    def _save(self) -> None:
        atomic_write_json(self.state_path, self.state)

    def status(self) -> dict[str, Any]:
        stages = self.state.setdefault("stages", {})
        return {
            "run_mode": self.state["run_mode"],
            "scope": self.state["scope"],
            "git": self.state["git"],
            "runtime": self.state["runtime"],
            "stages": {name: stages.get(name, {"status": "pending"}) for name in STAGES},
            "next_stage": next(
                (name for name in STAGES if stages.get(name, {}).get("status") != "completed"),
                None,
            ),
        }

    def run(self, requested_stage: str) -> dict[str, Any]:
        stage = self.status()["next_stage"] if requested_stage == "next" else requested_stage
        if stage is None:
            return self.status()
        if stage not in STAGES:
            raise ValueError(f"unknown demo-lite stage: {stage}")
        if stage == "training" and not torch.cuda.is_available() and not self.allow_cpu:
            raise RuntimeError("demo-lite training requires a CUDA runtime")
        self.state["stages"][stage] = {"status": "running"}
        self._save()
        try:
            result = getattr(self, f"_run_{stage}")()
        except DemoLitePaused:
            self.state["stages"][stage] = {"status": "paused"}
            self._save()
            raise
        self.state["stages"][stage] = {
            "status": "completed",
            "result": self._summary(stage, result),
        }
        self._save()
        return self.status()

    @staticmethod
    def _summary(stage: str, result: dict[str, Any]) -> dict[str, Any]:
        fields = {
            "training": (
                "expected_runs",
                "completed_runs",
                "convergence_rate",
                "champion",
            ),
            "comparison": (
                "expected_result_rows",
                "completed_result_rows",
                "failures",
            ),
            "results": ("scope", "completed_result_rows", "figures"),
        }[stage]
        return {key: result.get(key) for key in fields}

    def _run_training(self) -> dict[str, Any]:
        config = load_yaml("configs/batch_training_demo_lite.yaml")
        result = run_batch(
            config,
            self.persistent_root / "highway_batch",
            resume=True,
            retry_failed=True,
            work_output=self.work_root / "highway_batch",
            time_budget_minutes=self.time_budget_minutes,
            retain_per_config_best=True,
        )
        if result.get("paused"):
            raise DemoLitePaused
        if result["failed_runs"]:
            raise RuntimeError(f"demo-lite training contains failures: {result['failed_runs']}")
        if result["completed_runs"] != result["expected_runs"] or not result["champion"]:
            raise RuntimeError("demo-lite training did not produce a complete champion")
        return result

    def _comparison_config(self) -> dict[str, Any]:
        config = copy.deepcopy(load_yaml("configs/comparison_demo_lite.yaml"))
        config["models"]["highway"] = str(
            self.persistent_root / "highway_batch/champion/model_best.zip"
        )
        return config

    def _run_comparison(self) -> dict[str, Any]:
        result = run_comparison(
            self._comparison_config(),
            self.persistent_root / "comparison_results",
            resume=True,
        )
        if result["failures"]:
            raise RuntimeError(f"demo-lite comparison contains failures: {result['failures']}")
        if result["completed_result_rows"] != result["expected_result_rows"]:
            raise RuntimeError("demo-lite comparison matrix is incomplete")
        return result

    def _run_results(self) -> dict[str, Any]:
        return generate_demo_lite_results(
            self.persistent_root / "presentation_results",
            experiments_root=self.persistent_root,
        )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("next", *STAGES), default="next")
    parser.add_argument("--persistent-root", required=True, type=Path)
    parser.add_argument("--work-root", required=True, type=Path)
    parser.add_argument("--time-budget-minutes", type=float, default=360)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--allow-cpu", action="store_true", help="only for local tests")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if arguments.time_budget_minutes <= 30:
        print("time budget must be greater than 30 minutes", file=sys.stderr)
        return 2
    pipeline = DemoLitePipeline(
        arguments.persistent_root,
        arguments.work_root,
        time_budget_minutes=arguments.time_budget_minutes,
        allow_cpu=arguments.allow_cpu,
    )
    if arguments.status:
        print(json.dumps(pipeline.status(), indent=2, ensure_ascii=False))
        return 0
    try:
        result = pipeline.run(arguments.stage)
    except DemoLitePaused:
        print(json.dumps(pipeline.status(), indent=2, ensure_ascii=False))
        return 75
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

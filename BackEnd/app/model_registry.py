"""Fail-closed registry for models allowed in the academic presentation."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PRESENTATION_MODEL = Path("experiments/highway_corridor/champion/model_best.zip")
PRESENTATION_MANIFEST = Path("experiments/highway_corridor/champion/model_manifest.json")
EXPECTED_ACTION_MODE = "directional_corridor"
EXPECTED_SCHEMA_VERSION = 2


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@lru_cache(maxsize=4)
def _validated_status(model_mtime_ns: int, manifest_mtime_ns: int) -> dict[str, Any]:
    model_path = BACKEND_ROOT / PRESENTATION_MODEL
    manifest_path = BACKEND_ROOT / PRESENTATION_MANIFEST
    base = {
        "model": str(PRESENTATION_MODEL),
        "manifest": str(PRESENTATION_MANIFEST),
        "available": False,
        "eligible": False,
        "action_mode": None,
        "reason": "新的方向风险走廊模型尚未完成训练和验收",
    }
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {**base, "reason": "模型清单无法读取"}
    action_mode = manifest.get("action_mode")
    schema_version = manifest.get("observation_schema_version")
    acceptance = manifest.get("acceptance", {})
    eligible = bool(manifest.get("eligible")) and bool(acceptance.get("passed"))
    if action_mode != EXPECTED_ACTION_MODE or schema_version != EXPECTED_SCHEMA_VERSION:
        return {
            **base,
            "available": True,
            "action_mode": action_mode,
            "reason": "模型动作空间或观察结构与当前演示不兼容",
        }
    if not eligible:
        return {
            **base,
            "available": True,
            "action_mode": action_mode,
            "reason": "模型没有通过独立留出集资格门禁",
        }
    if manifest.get("model_sha256") != _sha256(model_path):
        return {
            **base,
            "available": True,
            "action_mode": action_mode,
            "reason": "模型文件哈希与资格清单不一致",
        }
    return {
        **base,
        "available": True,
        "eligible": True,
        "action_mode": action_mode,
        "reason": None,
        "training_run": manifest.get("training_run"),
        "metrics": manifest.get("metrics", {}),
    }


def presentation_model_status() -> dict[str, Any]:
    model_path = BACKEND_ROOT / PRESENTATION_MODEL
    manifest_path = BACKEND_ROOT / PRESENTATION_MANIFEST
    if not model_path.is_file() or not manifest_path.is_file():
        return {
            "model": str(PRESENTATION_MODEL),
            "manifest": str(PRESENTATION_MANIFEST),
            "available": False,
            "eligible": False,
            "action_mode": None,
            "reason": "新的方向风险走廊模型尚未完成训练和验收",
        }
    return _validated_status(model_path.stat().st_mtime_ns, manifest_path.stat().st_mtime_ns)

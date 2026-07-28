"""Promote an eligible Colab champion into the fail-closed presentation registry."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.model_registry import (  # noqa: E402
    EXPECTED_ACTION_MODE,
    EXPECTED_SCHEMA_VERSION,
    PRESENTATION_MANIFEST,
    PRESENTATION_MODEL,
)
from src.experiments.io import sha256_file  # noqa: E402


def promote(source: Path) -> dict[str, str]:
    source = source.expanduser().resolve()
    model = source / "model_best.zip"
    manifest_path = source / "model_manifest.json"
    if not model.is_file() or not manifest_path.is_file():
        raise FileNotFoundError("champion must contain model_best.zip and model_manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest.get("eligible") or not manifest.get("acceptance", {}).get("passed"):
        raise ValueError("champion did not pass acceptance")
    if manifest.get("action_mode") != EXPECTED_ACTION_MODE:
        raise ValueError("champion action mode is incompatible with the presentation")
    if manifest.get("observation_schema_version") != EXPECTED_SCHEMA_VERSION:
        raise ValueError("champion observation schema is incompatible with the presentation")
    digest = sha256_file(model)
    if manifest.get("model_sha256") != digest:
        raise ValueError("champion model hash does not match its manifest")

    target_model = BACKEND_ROOT / PRESENTATION_MODEL
    target_manifest = BACKEND_ROOT / PRESENTATION_MANIFEST
    target_model.parent.mkdir(parents=True, exist_ok=True)
    temporary_model = target_model.with_suffix(".zip.tmp")
    temporary_manifest = target_manifest.with_suffix(".json.tmp")
    shutil.copy2(model, temporary_model)
    shutil.copy2(manifest_path, temporary_manifest)
    os.replace(temporary_model, target_model)
    os.replace(temporary_manifest, target_manifest)
    return {"model": str(target_model), "manifest": str(target_manifest), "sha256": digest}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Colab champion directory")
    arguments = parser.parse_args()
    print(json.dumps(promote(arguments.source), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

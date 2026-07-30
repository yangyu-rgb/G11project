"""Regression checks for the English-only runtime interface."""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HAN_TEXT = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
RUNTIME_ROOTS = (
    PROJECT_ROOT / "FrontEnd" / "src",
    PROJECT_ROOT / "BackEnd" / "app",
)


def test_runtime_interface_sources_are_english_only() -> None:
    files = [PROJECT_ROOT / "FrontEnd" / "index.html"]
    for root in RUNTIME_ROOTS:
        files.extend(
            path for path in root.rglob("*") if path.suffix in {".html", ".py", ".ts", ".tsx"}
        )

    violations = []
    for path in files:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if HAN_TEXT.search(line):
                violations.append(f"{path.relative_to(PROJECT_ROOT)}:{line_number}")

    assert not violations, "Non-English runtime copy found in: " + ", ".join(violations)


def test_document_language_is_english() -> None:
    index = (PROJECT_ROOT / "FrontEnd" / "index.html").read_text(encoding="utf-8")
    assert '<html lang="en">' in index

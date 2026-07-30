"""Consistency checks for public research documentation and curated evidence."""

from __future__ import annotations

import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DOCUMENTS = (
    PROJECT_ROOT / "README.md",
    PROJECT_ROOT / "ARCHITECTURE.md",
    PROJECT_ROOT / "CONTRIBUTING.md",
    PROJECT_ROOT / "Docs" / "README.md",
    PROJECT_ROOT / "Docs" / "TECHNICAL_SPECIFICATION.md",
    PROJECT_ROOT / "Docs" / "EXPERIMENTS.md",
    PROJECT_ROOT / "Docs" / "REPRODUCIBILITY.md",
    PROJECT_ROOT / "Docs" / "DEMO_GUIDE.md",
    PROJECT_ROOT / "Docs" / "IMPLEMENTATION_ROADMAP.md",
    PROJECT_ROOT / "Docs" / "WORKFLOW.md",
)
REQUIRED_ASSETS = (
    "Docs/assets/architecture/system-overview.svg",
    "Docs/assets/demo/entry-configuration.webp",
    "Docs/assets/demo/synchronized-comparison.webp",
    "Docs/assets/demo/results-summary.webp",
    "Docs/assets/demo/validation-lab.webp",
    "Docs/assets/results/directional-v2-summary.json",
    "Docs/assets/results/heldout-metrics.svg",
    "Docs/assets/results/safety-efficiency-tradeoff.png",
    "FrontEnd/public/assets/environment/ASSET_PROVENANCE.md",
)
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")


def _relative_targets(document: Path) -> list[Path]:
    targets: list[Path] = []
    for raw_target in MARKDOWN_LINK.findall(document.read_text(encoding="utf-8")):
        target = raw_target.strip().split(maxsplit=1)[0].strip("<>")
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        path_text = target.split("#", maxsplit=1)[0]
        if path_text:
            targets.append((document.parent / path_text).resolve())
    return targets


def test_public_document_links_and_assets_exist() -> None:
    for document in PUBLIC_DOCUMENTS:
        assert document.is_file(), f"Missing public document: {document.relative_to(PROJECT_ROOT)}"
        for target in _relative_targets(document):
            assert target.exists(), (
                f"Broken relative link in {document.relative_to(PROJECT_ROOT)}: "
                f"{target.relative_to(PROJECT_ROOT)}"
            )

    for relative_path in REQUIRED_ASSETS:
        assert (PROJECT_ROOT / relative_path).is_file(), (
            f"Missing documentation asset: {relative_path}"
        )


def test_readme_matches_curated_directional_v2_summary() -> None:
    summary_path = PROJECT_ROOT / "Docs/assets/results/directional-v2-summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    readme = (PROJECT_ROOT / "README.md").read_text(encoding="utf-8")
    normalized_readme = " ".join(readme.split())

    assert summary["artifact_status"] in readme
    assert summary["protocol"] in readme
    assert f"{summary['incident_configurations']} independent" in readme
    assert f"{summary['result_rows']} result rows" in readme
    assert "zero notifications to vehicles ahead" in normalized_readme

    expected_table_values = {
        "ai": ("1.000", "35.52 ms", "1.161", "0.321"),
        "broadcast": ("0.833", "52.70 ms", "25.552", "25.552"),
        "distance": ("0.770", "33.66 ms", "3.226", "3.226"),
        "urgency": ("0.770", "37.42 ms", "3.226", "1.173"),
        "fixed_directional_corridor": ("0.929", "30.94 ms", "1.017", "0.508"),
    }
    for method, values in expected_table_values.items():
        assert method in summary["methods"]
        for value in values:
            assert value in readme

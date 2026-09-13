"""Acceptance tests for semantic labels and stable source-evidence anchors."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def comparison_rows() -> list[str]:
    text = (ROOT / "docs/dsh-vs-iota.md").read_text(encoding="utf-8")
    return [line for line in text.splitlines() if re.match(r"\| \*\*M\d{2}", line)]


def test_every_module_readme_has_semantic_relationship() -> None:
    readmes = sorted(ROOT.glob("M[0-9][0-9]-*/README.md"))
    assert len(readmes) == 12
    for readme in readmes:
        text = readme.read_text(encoding="utf-8")
        assert "**对照关系：" in text, readme
        assert re.search(r"类 [A-C]", text) is None, readme


def test_comparison_has_twelve_evidenced_rows() -> None:
    rows = comparison_rows()
    assert len(rows) == 12
    for row in rows:
        anchors = re.findall(r"`(?:iota-core|iota-example|dsh-example)/[^`]+::[^`]+`", row)
        assert len(anchors) >= 3, row


def test_every_structural_boundary_cites_architecture_decision() -> None:
    boundary_rows = [row for row in comparison_rows() if "结构性边界" in row]
    assert len(boundary_rows) == 9
    for row in boundary_rows:
        assert "iota-core/docs/architecture/" in row, row


def test_every_evidence_file_and_anchor_exist() -> None:
    text = (ROOT / "docs/dsh-vs-iota.md").read_text(encoding="utf-8")
    locations = re.findall(
        r"`(iota-core|iota-example|dsh-example)/([^`:]+)::([^`]+)`",
        text,
    )
    assert locations
    roots = {
        "iota-core": ROOT.parents[2] / "codingx/petite/sources/iota-core",
        "iota-example": ROOT,
        "dsh-example": ROOT.parent / "dsh-example",
    }
    for project, relative, anchor in locations:
        path = roots[project] / relative
        assert path.is_file(), path
        source = path.read_text(encoding="utf-8")
        assert anchor in source, (path, anchor)

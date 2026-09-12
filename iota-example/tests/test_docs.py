"""G4' alignment badges and source-evidence acceptance tests."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_every_module_readme_has_alignment_badge() -> None:
    readmes = sorted(ROOT.glob("M[0-9][0-9]-*/README.md"))
    assert len(readmes) == 12
    for readme in readmes:
        text = readme.read_text(encoding="utf-8")
        assert "**对齐：" in text, readme


def test_comparison_has_twelve_evidenced_rows() -> None:
    text = (ROOT / "docs/dsh-vs-iota.md").read_text(encoding="utf-8")
    rows = [line for line in text.splitlines() if re.match(r"\| \*\*M\d{2}", line)]
    assert len(rows) == 12
    for row in rows:
        assert len(re.findall(r"[A-Za-z0-9_.\-/]+:\d+(?:-\d+)?", row)) >= 3, row


def test_every_class_c_row_cites_existing_iota_decision() -> None:
    text = (ROOT / "docs/dsh-vs-iota.md").read_text(encoding="utf-8")
    rows = [line for line in text.splitlines() if re.match(r"\| \*\*M\d{2}", line)]
    class_c_rows = [
        row
        for row in rows
        if "**C**" in row or "**A + C**" in row or "**B + C**" in row
    ]
    assert len(class_c_rows) == 9
    for row in class_c_rows:
        assert "iota-core/docs/architecture/" in row, row


def test_every_evidence_location_exists_and_has_that_line() -> None:
    text = (ROOT / "docs/dsh-vs-iota.md").read_text(encoding="utf-8")
    locations = re.findall(
        r"(iota-core|iota-example|dsh-example|dsh-workshop)/([A-Za-z0-9_.\-/]+):(\d+)(?:-(\d+))?",
        text,
    )
    assert locations
    iota_core = ROOT.parents[2] / "codingx/petite/sources/iota-core"
    roots = {
        "iota-core": iota_core,
        "iota-example": ROOT,
        "dsh-example": ROOT.parent / "dsh-example",
        "dsh-workshop": ROOT.parent / "dsh-workshop",
    }
    for project, relative, start, end in locations:
        path = roots[project] / relative
        assert path.is_file(), path
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        assert 1 <= int(start) <= line_count, (path, start, line_count)
        assert not end or int(start) <= int(end) <= line_count, (path, end, line_count)

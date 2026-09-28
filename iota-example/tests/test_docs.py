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
        assert "iota-core/docs/develop/" in row, row


def test_every_evidence_file_and_anchor_exist() -> None:
    text = (ROOT / "docs/dsh-vs-iota.md").read_text(encoding="utf-8")
    locations = re.findall(
        r"`(iota-core|iota-example|dsh-example)/([^`:]+)::([^`]+)`",
        text,
    )
    assert locations
    roots = {
        "iota-core": ROOT.parents[1] / "petite/sources/iota-core",
        "iota-example": ROOT,
        "dsh-example": ROOT.parent / "dsh-example",
    }
    for project, relative, anchor in locations:
        path = roots[project] / relative
        assert path.is_file(), path
        source = path.read_text(encoding="utf-8")
        assert anchor in source, (path, anchor)


def test_capability_index_stage_counts_match_run_files() -> None:
    """根 README 的阶段数必须来自各模块 run.py，避免文档与清单漂移。"""
    from runtime.runner import load_stages

    rows = re.findall(
        r"\| \[(M\d{2})\]\([^)]+\) \| [^|]+\| (\d+) \|",
        (ROOT / "README.md").read_text(encoding="utf-8"),
    )
    assert len(rows) == 12
    documented = {module: int(count) for module, count in rows}
    actual = {
        path.name[:3]: len(load_stages(path))
        for path in sorted(ROOT.glob("M[0-9][0-9]-*"))
        if path.is_dir()
    }
    assert documented == actual
    assert sum(actual.values()) == 60


def test_every_module_readme_lists_its_stage_ids() -> None:
    """模块 README 的阶段表必须覆盖 run.py 里的每个编号。"""
    from runtime.runner import load_stages

    for module in sorted(path for path in ROOT.glob("M[0-9][0-9]-*") if path.is_dir()):
        text = (module / "README.md").read_text(encoding="utf-8")
        for stage in load_stages(module):
            assert stage.id in text, (module.name, stage.id)
            assert f"scenes/{stage.scene}.py" in text, (module.name, stage.scene)


def test_capability_surface_coverage_holds() -> None:
    """能力面覆盖不得缩水：对位 dsh 的 coverage:surfaces 门槛。"""
    from runtime.surface_coverage import REQUIRED, collect

    covered = sum(len(names) for names in collect().values())
    assert covered >= REQUIRED, covered


# ── 课件自学文档（lessons/）：对位 dsh-example 的 13 课教材 ──────────────────
LESSON_NAMES = (
    "00-getting-started.md",
    "01-tool-pipeline.md",
    "02-context-assembly.md",
    "03-inference-service-access.md",
    "04-agent-loop-intervention.md",
    "05-session-surface.md",
    "06-human-in-the-loop.md",
    "07-execution-backends.md",
    "08-delegation-presets.md",
    "09-long-running-orchestration.md",
    "10-external-capabilities.md",
    "11-config-data-infrastructure.md",
    "12-framework-mechanisms.md",
)

LESSONS = ROOT / "lessons"


def test_lessons_directory_is_complete() -> None:
    """13 课一课不能少：文件名与 dsh-example/lessons 同名对齐。"""
    assert LESSONS.is_dir(), LESSONS
    actual = sorted(path.name for path in LESSONS.glob("*.md"))
    assert actual == sorted(LESSON_NAMES), actual


def test_lesson_numbers_are_contiguous_from_zero() -> None:
    """课件编号必须从 00 起连续：`00` 是环境课，`01`–`12` 每模块一课，中间不许跳号。

    跳号会让"下一课"这句话失去唯一答案——读者拿着 `02` 找不到 `03` 时，无法判断
    是自己漏读了还是工程没写完。`dsh-example/lessons/` 用的是同一套编号。
    """
    numbers = sorted(int(name[:2]) for name in LESSON_NAMES)
    assert numbers == list(range(13)), numbers
    actual = sorted(int(path.name[:2]) for path in LESSONS.glob("*.md"))
    assert actual == list(range(13)), f"lessons/ 实际编号：{actual}"


def test_every_lesson_quotes_its_module_conclusion() -> None:
    """每课"真实输出"必须带着本模块的 REAL_MODULE_OK 行，且阶段数与 run.py 一致。

    课件里的阶段数一旦与阶段清单漂移，这行测试就会点名；`00` 环境课用 M12 示例，同样核验。
    """
    from runtime.runner import load_stages

    for index, name in enumerate(LESSON_NAMES):
        text = (LESSONS / name).read_text(encoding="utf-8")
        if index == 0:
            module_id, module_dir = "M12", ROOT / "M12-framework-mechanisms"
        else:
            module_id = f"M{index:02d}"
            module_dir = next(ROOT.glob(f"{module_id}-*"))
        stages = len(load_stages(module_dir))
        expected = f"REAL_MODULE_OK {module_id} stages={stages}"
        assert expected in text, (name, expected)


def test_every_lesson_links_resolve() -> None:
    """课件里的每个相对链接都必须指向真实存在的文件（外链跳过，锚点不做强校验）。"""
    pattern = re.compile(r"\]\(([^)#\s]+)(?:#[^)\s]*)?\)")
    for name in LESSON_NAMES:
        text = (LESSONS / name).read_text(encoding="utf-8")
        for target in pattern.findall(text):
            if target.startswith(("http://", "https://")):
                continue
            path = (LESSONS / target).resolve()
            assert path.is_file(), (name, target)

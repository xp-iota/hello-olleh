"""阶段清单门禁：编号空间必须与 `dsh-example` 严格一致。

这套检查是"对比有意义"的前提：同一个编号在两边指向同一个控制面，日志才可以逐行对读。
它们不调用模型，只核对清单、文件与编号三者对得上。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from runtime.harness import MODULE_TITLES
from runtime.runner import ROOT, load_stages

DSH_ROOT = ROOT.parent / "dsh-example"
MODULES = sorted(path for path in ROOT.glob("M[0-9][0-9]-*") if path.is_dir())

#: dsh 的阶段声明形如 `{ id: 'M01.1', title: '…', kind: 'mechanism', … }`。
DSH_STAGE = re.compile(r"id: '(?P<id>M\d{2}\.[0-9a-z]+)'.*?kind: '(?P<kind>model|mechanism)'")


def dsh_stages(module: str) -> list[tuple[str, str]]:
    text = (DSH_ROOT / module / "run.ts").read_text(encoding="utf-8")
    return [(match["id"], match["kind"]) for match in DSH_STAGE.finditer(text)]


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
def test_stage_ids_match_dsh(module: Path) -> None:
    ours = [stage.id for stage in load_stages(module)]
    theirs = [stage_id for stage_id, _ in dsh_stages(module.name)]
    assert ours == theirs, f"{module.name}: iota={ours} dsh={theirs}"


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
def test_stage_kinds_are_declared(module: Path) -> None:
    for stage in load_stages(module):
        assert stage.kind in {"model", "mechanism"}, stage
        assert stage.title, stage
        assert (module / "scenes" / f"{stage.scene}.py").is_file(), stage


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
def test_stages_and_scene_files_match_one_to_one(module: Path) -> None:
    stages = load_stages(module)
    scenes = sorted(
        path.stem for path in (module / "scenes").glob("*.py") if path.stem != "__init__"
    )
    assert sorted(stage.scene for stage in stages) == scenes


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
def test_module_has_one_entry(module: Path) -> None:
    assert (module / "run.py").is_file()
    assert (module / "README.md").is_file()
    assert list(module.glob("lesson_m*.py")) == []


def test_module_directories_and_titles_mirror_dsh() -> None:
    dsh_names = sorted(path.name for path in DSH_ROOT.glob("M[0-9][0-9]-*") if path.is_dir())
    assert [path.name for path in MODULES] == dsh_names
    assert sorted(MODULE_TITLES) == dsh_names


def test_total_stage_count_matches_dsh() -> None:
    ours = sum(len(load_stages(module)) for module in MODULES)
    theirs = sum(len(dsh_stages(module.name)) for module in MODULES)
    assert ours == theirs == 60


def test_shell_stages_are_declared_explicitly() -> None:
    """只有执行侧演示可以打开内核 shell —— 其余阶段一律关闭内核工具。"""
    shell = {
        stage.id for module in MODULES for stage in load_stages(module) if stage.shell
    }
    assert shell == {"M01.d", "M07.1", "M07.2"}

"""Skill 同步：文件系统上的 SKILL.md 被投影进内核 home，按名字报告结果。"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from impl.skill_source import SKILL_NAME, write_skill
from iota_core.skill_sync import sync_skills

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    with TemporaryDirectory(prefix="iota-m10-") as temp:
        root = Path(temp)
        report = sync_skills(write_skill(root), hermes_home=root / "kernel-home", quiet=True)
    require(report["copied"] == [SKILL_NAME], "同步一个文件系统 Skill", report)
    return {"copied": report["copied"], "asset": "SKILL.md"}

"""Skill 资产：一份最小的 `SKILL.md`，以及它被同步进内核 home 的路径。

Skill 是**数据**：写进文件系统就能被发现、被投影给内核，内容变化不需要改任何机制代码。
"""

from __future__ import annotations

from pathlib import Path

SKILL_NAME = "demo-greeter"
SKILL_BODY = f"---\nname: {SKILL_NAME}\n---\n# Demo greeter\n"


def write_skill(root: Path) -> Path:
    """在 `root/source/greeter/SKILL.md` 写一份 Skill，返回可同步的源目录。"""
    source = root / "source" / "greeter"
    source.mkdir(parents=True)
    (source / "SKILL.md").write_text(SKILL_BODY, encoding="utf-8")
    return root / "source"

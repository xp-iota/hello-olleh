"""配置投影素材：一份来源 settings.json，以及两种 profile 请求。

profile 的价值在于**投影是真实文件**：内核进程读的是投影出来的那份配置，而不是一段内存里的
假设。不支持 iota-managed 布局的内核会被明确拒绝，而不是拿到一份被忽略的配置。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def settings_source(root: Path) -> Path:
    source = root / "settings.json"
    source.write_text(json.dumps({"model": "demo"}), encoding="utf-8")
    return source


def claude_spec(root: Path, source: Path) -> dict[str, Any]:
    return {"source": str(source), "target_dir": str(root / "projected")}


def dsh_spec(source: Path) -> dict[str, Any]:
    return {"source": str(source)}

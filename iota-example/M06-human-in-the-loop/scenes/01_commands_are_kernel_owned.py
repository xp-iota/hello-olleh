"""命令归属：Claude 内核自己解析斜杠命令，所以 iota 不做命令注册面。"""

from __future__ import annotations

from typing import Any

from iota_core.capabilities import GOAL_COMMANDS
from iota_core.registry import Registry

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    provides = sorted(harness.adapter.provides)
    command_surface = sorted(name for name in vars(Registry()) if "command" in name)
    require(GOAL_COMMANDS in provides, "内核声明自己解析 goal 命令", provides)
    require(command_surface == [], "编排层没有命令注册面", command_surface)
    return {
        "kernel_provides": provides,
        "command_surface": command_surface,
        "slash_commands": "kernel-owned",
    }

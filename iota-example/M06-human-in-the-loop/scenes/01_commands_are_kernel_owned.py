"""命令归属：内核自己解析目标命令，所以 iota 不做命令注册面。

两种内核用**不同机制**回答同一个问题——`NATIVE_GOAL_MANAGER`（Hermes 的原生目标管理）
或 `GOAL_COMMANDS`（Claude 的命令解析）。iota-core 的 ``goals/manager.py`` 正是按这两者
之一判定的，所以这里也按同一口径断言，而不是写死其中一支。
"""

from __future__ import annotations

from typing import Any

from iota_core.capabilities import GOAL_COMMANDS, NATIVE_GOAL_MANAGER
from iota_core.registry import Registry

from runtime.harness import WorkshopHarness, require

#: 内核声明"我负责解析目标命令"的两种等价方式。
GOAL_OWNERSHIP = (NATIVE_GOAL_MANAGER, GOAL_COMMANDS)


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    provides = sorted(harness.adapter.provides)
    command_surface = sorted(name for name in vars(Registry()) if "command" in name)
    owner = next((item for item in GOAL_OWNERSHIP if item in provides), None)
    require(owner is not None, "内核声明自己解析目标命令", provides)
    require(command_surface == [], "编排层没有命令注册面", command_surface)
    return {
        "kernel_provides": provides,
        "goal_ownership": owner,
        "command_surface": command_surface,
        "slash_commands": "kernel-owned",
    }

"""todo 归属：待办工具集是一条要声明的能力，当前内核没有声明它。"""

from __future__ import annotations

from typing import Any

from iota_core.capabilities import NATIVE_KANBAN_TOOLSET
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    config = AgentConfig(name="m06-kanban", kernel=harness.kernel)
    declared = NATIVE_KANBAN_TOOLSET in harness.adapter.provides
    require("auto_kanban" in AgentConfig.model_fields, "配置里有 kanban 开关")
    require(declared is False, "当前内核没有声明原生 kanban 工具集", declared)
    return {
        "auto_kanban_default": config.auto_kanban,
        "kernel_declares_kanban": declared,
        "todo_owner": "kernel/host",
    }

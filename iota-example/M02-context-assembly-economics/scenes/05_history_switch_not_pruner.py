"""历史控制：iota 有"这轮不带历史"的开关，但没有确定性裁剪 seam。"""

from __future__ import annotations

from typing import Any

from iota_core.registry import Registry
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    default = AgentConfig(name="m02-history", kernel=harness.kernel)
    without = AgentConfig(
        name="m02-history", kernel=harness.kernel, disable_conversation_history=True
    )
    require(default.disable_conversation_history is False, "默认带上会话历史")
    require(without.disable_conversation_history is True, "可以显式关掉历史")
    pruner_surface = sorted(name for name in vars(Registry()) if "prun" in name or "spill" in name)
    require(pruner_surface == [], "编排层没有裁剪/溢出注册面", pruner_surface)
    return {
        "history_default": default.disable_conversation_history,
        "history_switchable": without.disable_conversation_history,
        "pruner_surface": pruner_surface,
        "truncation_owner": "kernel",
    }

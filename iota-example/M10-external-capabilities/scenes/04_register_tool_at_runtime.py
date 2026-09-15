"""运行时装配：工具可以在进程里注册进来，disposer 交给 effect 栈按 LIFO 回收。"""

from __future__ import annotations

from typing import Any

from iota_core.effects import EffectStack
from iota_core.types import ToolDef

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    tool = ToolDef(
        name="m10-echo",
        description="Echo a value back",
        input_schema={"type": "object", "properties": {"value": {"type": "string"}}},
    )
    with EffectStack("m10-runtime-tool") as effects:
        effects.push(harness.registry.tools.register(tool.name, tool), f"tool:{tool.name}")
        listed = harness.registry.tools.list()
        require(listed == [tool.name], "运行时注册的工具在册", listed)
    require(harness.registry.tools.list() == [], "effect 退出后工具被回收")
    return {"registered": listed, "after_dispose": harness.registry.tools.list()}

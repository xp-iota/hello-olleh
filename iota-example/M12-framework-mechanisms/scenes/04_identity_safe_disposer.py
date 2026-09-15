"""身份安全：旧 disposer 只删自己注册的那个值，不会误删别人的覆盖结果。"""

from __future__ import annotations

from typing import Any

from iota_core.registry import Registry

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    registry = Registry()

    def original() -> str:
        return "original"

    dispose_original = registry.code_handlers.register("owned", original)
    registry.code_handlers.register("owned", lambda: "replacement", overwrite=True)
    dispose_original()
    current = registry.code_handlers.get("owned")
    require(current is not original, "旧 disposer 不删除覆盖后的新值")
    require(current() == "replacement", "覆盖后的值保留", current())
    return {"value": current(), "old_disposer_removed_new_value": False}

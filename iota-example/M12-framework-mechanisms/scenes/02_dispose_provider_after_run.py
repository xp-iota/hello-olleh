"""可逆替换：Provider 登记后跑一轮真实内核，回收之后它立刻不再在册。"""

from __future__ import annotations

from typing import Any

from iota_core.providers import ENTRY_POINT_GROUP, is_adapter_registered, register_adapter

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    disposer = register_adapter("m12-provider", lambda _build: harness.adapter)
    registered = is_adapter_registered("m12-provider")
    result = await harness.run("请只回复：替换单元已登记。", name="m12-provider")
    disposer()
    require(registered, "Provider 注册后在册")
    require(bool((result.final_text or "").strip()), "登记期间内核照常作答", result.final_text)
    require(not is_adapter_registered("m12-provider"), "回收后 Provider 不再在册")
    require(
        ENTRY_POINT_GROUP == "iota_core.providers",
        "使用标准 Provider entry-point group",
        ENTRY_POINT_GROUP,
    )
    return {
        "entry_point_group": ENTRY_POINT_GROUP,
        "registered_then_removed": True,
        "architecture_not_imported": ["event-bus", "hmr", "intercept"],
    }

"""计划模式边界：AgentConfig 不伪造 plan_mode，它由具体内核或宿主管理。"""

from __future__ import annotations

from typing import Any

from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    faked = sorted(name for name in AgentConfig.model_fields if "plan" in name)
    require(faked == [], "AgentConfig 不伪造 plan_mode 字段", faked)
    return {"faked_plan_fields": faked, "plan_mode": "kernel/host-owned"}

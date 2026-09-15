"""装配改写归内核：编排层没有 Prompt 装配面，注入开关默认关闭。"""

from __future__ import annotations

from typing import Any

from iota_core.registry import Registry
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    config = AgentConfig(name="m02", kernel=harness.kernel)
    surface = sorted(
        name for name in vars(Registry()) if "prompt" in name or "assembly" in name
    )
    require(surface == [], "编排层没有 Prompt 装配/改写注册面", surface)
    require(
        config.enable_memory_prompt is False,
        "记忆 Prompt 默认关闭：要注入必须显式打开",
        config.enable_memory_prompt,
    )
    require("system_prompt" in AgentConfig.model_fields, "系统提示只是一个配置字段")
    return {
        "assembly_surface": surface,
        "enable_memory_prompt": config.enable_memory_prompt,
        "system_prompt_field": "plain config value",
        "assembly_owner": "kernel",
    }

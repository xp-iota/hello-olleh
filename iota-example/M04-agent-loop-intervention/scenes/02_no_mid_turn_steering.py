"""mid-turn 边界：真实跑完一轮，编排层始终没有"往进行中的一轮里插消息"的入口。"""

from __future__ import annotations

from typing import Any

from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require

#: DSH 的 inbox/steering 语汇；编排层若真提供该能力，会以这些词出现在公开面上。
MID_TURN_WORDS = ("inbox", "splice", "steer", "followup", "interject")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    result = await harness.run("请只回复：一轮已完成。", name="m04-steering")
    require(bool((result.final_text or "").strip()), "真实运行完成一轮", result.final_text)
    config_fields = sorted(
        name for name in AgentConfig.model_fields if any(word in name for word in MID_TURN_WORDS)
    )
    runtime_api = sorted(
        name
        for name in dir(harness.runtime)
        if not name.startswith("_") and any(word in name for word in MID_TURN_WORDS)
    )
    injected = sorted(
        {
            event.type
            for event in result.events
            if any(word in event.type for word in MID_TURN_WORDS)
        }
    )
    require(config_fields == [], "AgentConfig 不声明 mid-turn 注入字段", config_fields)
    require(runtime_api == [], "运行时公开面没有 mid-turn 注入入口", runtime_api)
    require(injected == [], "事件流里也没有注入类事件", injected)
    return {
        "agent_config_fields": config_fields,
        "runtime_api": runtime_api,
        "injection_events": injected,
        "mid_turn_injection": "kernel-owned",
    }

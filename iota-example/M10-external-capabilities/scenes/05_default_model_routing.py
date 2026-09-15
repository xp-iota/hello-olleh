"""默认路由：每个 agent 都带着显式模型出场，装配不留"由内核随便挑"的空档。"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    default_agent = harness.agent(name="m10-default")
    pinned = harness.agent(name="m10-pinned", model="explicit-model")
    require(
        default_agent.config.model == harness.model,
        "默认模型来自当前装配",
        default_agent.config,
    )
    require(pinned.config.model == "explicit-model", "显式模型覆盖默认", pinned.config)
    return {
        "assembly_model": harness.model,
        "default_agent_model": default_agent.config.model,
        "explicit_agent_model": pinned.config.model,
    }

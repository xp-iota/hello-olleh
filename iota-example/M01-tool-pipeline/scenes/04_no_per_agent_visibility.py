"""可见性归属：编排层的工具注册面是进程级的，模型看见什么由内核裁定。"""

from __future__ import annotations

from typing import Any

from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    requested = ["lookup"]
    config = AgentConfig(name="m01-visibility", kernel=harness.kernel, tools=requested)
    require(config.tools == requested, "AgentConfig 只记录请求的工具清单", config.tools)
    require(harness.registry.tools.list() == [], "编排层注册面为空", harness.registry.tools.list())
    # 没有 per-agent 可见集合这一层：注册面按名字全局登记，收紧披露发生在内核内部。
    per_agent_surface = sorted(
        name for name in dir(harness.registry.tools) if "agent" in name or "scope" in name
    )
    require(per_agent_surface == [], "工具注册面没有 per-agent 视图", per_agent_surface)
    return {
        "requested_tools": config.tools,
        "orchestrator_tools": harness.registry.tools.list(),
        "per_agent_surface": per_agent_surface,
        "visibility_owner": "kernel",
    }

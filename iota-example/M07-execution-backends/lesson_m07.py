"""M07: the execution-side shell event is emitted by the kernel adapter."""

from __future__ import annotations

from typing import Any

from iota_core.types import ToolCallResultEvent, ToolCallStartEvent

from runtime.harness import WorkshopHarness
from runtime.teaching import require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    events = await harness.stream("shell: printf offline")
    starts = [event for event in events if isinstance(event, ToolCallStartEvent)]
    results = [event for event in events if isinstance(event, ToolCallResultEvent)]
    require(
        len(starts) == 1 and starts[0].name == "kernel.shell",
        "内核发出一次 kernel.shell start",
        starts,
    )
    require(len(results) == 1 and results[0].ok, "内核发出一次成功 result", results)
    require(
        harness.registry.tools.list() == [],
        "编排层不注册 shell 工具",
        harness.registry.tools.list(),
    )
    return {
        "module": "M07",
        "status": "ok",
        "relationship": "结构性边界",
        "route": "prompt -> KernelAdapter -> kernel.shell event",
        "orchestrator_shell_registry": harness.registry.tools.list(),
    }

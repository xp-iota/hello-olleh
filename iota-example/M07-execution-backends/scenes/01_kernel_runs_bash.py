"""内核执行命令：工具调用事件来自内核进程内部，不是编排层注册的东西。"""

from __future__ import annotations

from typing import Any

from impl.kernel_shell_task import run_shell_task
from iota_core.types import ToolCallStartEvent

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    _, events = await run_shell_task(harness)
    starts = [event for event in events if isinstance(event, ToolCallStartEvent)]
    require(len(starts) >= 1, "内核发出至少一次工具调用 start（执行归内核）", starts)
    return {
        "kernel": harness.kernel,
        "kernel_tool_calls": [event.name for event in starts],
        "route": "prompt -> KernelAdapter -> kernel tool events",
    }

"""工具结果：内核回传成功的工具结果，并且真的读到了本次生成的 token。"""

from __future__ import annotations

from typing import Any

from impl.kernel_shell_task import run_shell_task
from iota_core.types import ToolCallResultEvent

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    token, events = await run_shell_task(harness)
    results = [event for event in events if isinstance(event, ToolCallResultEvent)]
    require(
        any(result.ok for result in results),
        "内核发出至少一次成功的工具结果",
        [(result.id, result.ok) for result in results],
    )
    seen = "\n".join(str(getattr(event, "output", "")) for event in results)
    answered = token in seen or token in "".join(
        str(getattr(event, "text", "")) for event in events
    )
    require(answered, "内核真的读到了本次生成的 token（凭猜测答不出来）", token)
    return {
        "tool_results": [result.ok for result in results],
        "execution_proof": "token read by kernel",
    }

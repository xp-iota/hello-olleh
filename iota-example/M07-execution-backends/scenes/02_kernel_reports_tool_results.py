"""工具结果：内核执行了工具，并且真的读到了本次生成的 token。

断言不绑定事件类型：`ToolCallResultEvent` 只有 Claude 适配器产出，Hermes 只发
`ToolCallStartEvent`（见两个适配器的 `stream()`）。**证据要用内核无关的方式取**——
"模型答出了本次运行才生成的 token"本身就证明工具被执行过、结果回传给了模型，
这比依赖某个适配器特有的事件类型更贴近论点。
"""

from __future__ import annotations

from typing import Any

from impl.kernel_shell_task import run_shell_task
from iota_core.types import ToolCallResultEvent, ToolCallStartEvent

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    token, events = await run_shell_task(harness)
    starts = [event for event in events if isinstance(event, ToolCallStartEvent)]
    results = [event for event in events if isinstance(event, ToolCallResultEvent)]
    require(len(starts) >= 1, "内核发出至少一次工具调用", [event.name for event in starts])

    # 结果证据：能报出 token 就说明工具真的跑过、输出真的回到了模型。
    seen = "\n".join(str(getattr(event, "output", "")) for event in results)
    final = "".join(str(getattr(event, "text", "")) for event in events)
    require(
        token in seen or token in final,
        "内核真的读到了本次生成的 token（凭猜测答不出来）",
        token,
    )
    return {
        "kernel_tool_calls": [event.name for event in starts],
        "tool_result_events": [result.ok for result in results],
        "execution_proof": "token read by kernel",
    }

"""专项真实演示：内核自主决定用工具算出答案（对位 DSH 的模型自主调用 word_count）。

任务被设计成不能凭猜测完成：让内核用 Bash 去数词数与字符数，而不是自己数。工具属于内核，
编排层既没有注册这个工具，也没有干预它的选择。
"""

from __future__ import annotations

from typing import Any

from iota_core.types import ToolCallStartEvent

from runtime.harness import WorkshopHarness, require

SENTENCE = "DeepSeek Harness makes every tool call observable"
PROMPT = (
    f'请用 Bash 工具（例如 wc）统计这句话的词数和字符数，不要自己数："{SENTENCE}"。'
    "最后只回复一行：N 词 / M 字符。"
)


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    events = await harness.stream(PROMPT, name="m01-kernel-tool")
    calls = [event.name for event in events if isinstance(event, ToolCallStartEvent)]
    # final 是内核裁定的答案；text_delta 是过程叙述，两者不能拼在一起（会重复一遍）。
    final = next(event for event in events if event.type == "final")
    answer = str(getattr(final, "text", ""))
    require(len(calls) >= 1, "内核自己发起了工具调用", calls)
    require("7" in answer, "答案里有 Bash 数出来的词数 7", answer)
    require(harness.registry.tools.list() == [], "编排层没有注册这个工具")
    return {
        "kernel_tool_calls": calls,
        "answer": answer.strip(),
        "orchestrator_tools": harness.registry.tools.list(),
    }

"""专项真实演示：用同一个事件消费循环接真实内核，核对事件协议不变量。

对位 DSH 的"同一 StreamChunk 消费循环接真实 SSE"：消费循环不认供应商，只认事件协议。
iota 这边的协议是"编排层的 step 包裹内核事件"——`step_start` 开头、`step_end` 收尾，
中间按子序列出现 `text_delta → final`，而且 `final` 只出现一次。

注意这里**不要求 `system_init`**：它是 Claude 适配器特有的启动握手快照
（见 `iota_core.types.SystemInitEvent` 的说明），Hermes 不产出。把适配器特有事件写进
"标准子序列"，示例就会只在某一个内核下成立 —— 那正是本工程要避免的假象。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from iota_core.types import TokenUsage

from runtime.harness import WorkshopHarness, require, require_event_order, sample

#: 内核无关的标准事件：任何适配器都必须产出"有文本增量、有终态"。
STANDARD = ("text_delta", "final")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    # 提问故意是确定性的：这一阶段要核对的是事件协议，不是模型的创造力。
    events = await harness.stream(
        "请把下面这句话原样复述一遍，不要加别的内容：事件协议已核对。", name="m03-stream"
    )
    kinds = [event.type for event in events]
    counts = Counter(kinds)
    text = "".join(
        str(getattr(event, "text", "")) for event in events if event.type == "text_delta"
    )
    final = next(event for event in events if event.type == "final")
    usage = final.usage
    reported = usage.to_dict() if isinstance(usage, TokenUsage) else dict(usage or {})

    require(kinds[0] == "step_start", "编排层的 step 包在最外侧", kinds)
    require(kinds[-1] == "step_end", "step_end 收尾", kinds)
    require(counts["final"] == 1, "终止事件只出现一次", counts)
    require_event_order(kinds, STANDARD)
    require(bool((final.text or text).strip()), "真实事件流里有非空文本")
    return {
        "event_counts": dict(counts),
        "standard_subsequence": list(STANDARD),
        "text_sample": sample(final.text or text, 60),
        "finish": "error" if final.is_error else (final.subtype or "stop"),
        "usage": {key: reported.get(key, 0) for key in ("input_tokens", "output_tokens")},
    }

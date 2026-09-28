"""事件顺序：标准事件按子序列出现，内核可以在其间插入自己的事件。

标准事件只取**内核无关**的那些：任何适配器都要产出"文本增量 → 终态"。刻意不含
`system_init`——那是 Claude 适配器特有的启动握手快照（见 `iota_core.types.SystemInitEvent`），
Hermes 不产出；把它算进标准会让断言只在某一个内核下成立。
"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require_event_order

STANDARD = ("text_delta", "final")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    events = [event.type for event in await harness.stream("请只回复：事件顺序已观察。")]
    require_event_order(events, STANDARD)
    return {"events": events, "standard_subsequence": list(STANDARD)}

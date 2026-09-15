"""事件顺序：标准事件按子序列出现，内核可以在其间插入自己的事件。"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require_event_order

STANDARD = ("system_init", "text_delta", "final")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    events = [event.type for event in await harness.stream("请只回复：事件顺序已观察。")]
    require_event_order(events, STANDARD)
    return {"events": events, "standard_subsequence": list(STANDARD)}

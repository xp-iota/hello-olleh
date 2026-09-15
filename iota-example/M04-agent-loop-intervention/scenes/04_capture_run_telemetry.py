"""遥测账本：运行状态与事件按 run_id 落在 RunStore 里，可被另一个消费者读回。"""

from __future__ import annotations

from typing import Any

from iota_core.storage.run_store import InMemoryRunStore
from iota_core.types import TextDeltaEvent

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    store = InMemoryRunStore()
    # 账本按 Agent 开户：run_id 由存储分配，调用方不自己编。
    run_id = await store.create_run(harness.agent(name="m04-telemetry"))
    await store.append_event(run_id, TextDeltaEvent(text="观察到一段输出"))
    await store.update_run(run_id, status="succeeded")
    record = require_not_none(await store.get_run(run_id), "账本里有这次运行")
    events = await store.get_events(run_id)
    require(record["status"] == "succeeded", "状态更新被记账", record)
    require([event.type for event in events] == ["text_delta"], "事件按序记账", events)
    return {
        "run_id_assigned_by": "RunStore",
        "run_status": record["status"],
        "recorded_events": [event.type for event in events],
    }

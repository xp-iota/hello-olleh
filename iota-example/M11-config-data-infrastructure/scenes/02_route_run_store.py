"""运行存储：RunStore 是另一条协议，运行事实与会话消息分开治理。"""

from __future__ import annotations

from typing import Any

from iota_core.storage.run_store import InMemoryRunStore
from iota_core.types import FinalEvent

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    store = InMemoryRunStore()
    run_id = await store.create_run(harness.agent(name="m11-run"))
    await store.append_event(run_id, FinalEvent(text="done"))
    await store.update_run(run_id, status="succeeded")
    record = require_not_none(await store.get_run(run_id), "运行记录可读回")
    protocol = sorted(name for name in dir(store) if not name.startswith("_"))
    require(record["status"] == "succeeded", "状态按协议更新", record)
    require("create_run" in protocol and "append_event" in protocol, "协议方法齐全", protocol)
    return {"run_status": record["status"], "protocol": protocol, "storage": "memory"}

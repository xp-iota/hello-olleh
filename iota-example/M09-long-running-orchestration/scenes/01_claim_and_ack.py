"""租约：worker 认领任务、确认结果，队列保存最终状态。"""

from __future__ import annotations

from typing import Any

from impl.durable_task import graph_task
from iota_core.graph.task_queue import InMemoryGraphTaskQueue

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    queue = InMemoryGraphTaskQueue()
    await queue.enqueue(graph_task())
    claimed = require_not_none(
        await queue.claim(owner="worker-a", lease_seconds=30), "worker 取得队列租约"
    )
    await queue.ack(claimed.task_id, owner="worker-a", result_status="succeeded")
    finished = require_not_none(await queue.get(claimed.task_id), "队列保存完成状态")
    require(finished.status == "succeeded", "ack 后任务状态成功", finished.status)
    return {"owner": "worker-a", "queue_status": finished.status}

"""幂等入队：同一条任务提交两次，仍然只是同一个 task_id。"""

from __future__ import annotations

from typing import Any

from impl.durable_task import graph_task
from iota_core.graph.task_queue import InMemoryGraphTaskQueue

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    queue = InMemoryGraphTaskQueue()
    request = graph_task()
    first = await queue.enqueue(request)
    duplicate = await queue.enqueue(request)
    require(first.task_id == duplicate.task_id, "重复入队保持 task id 幂等", duplicate.task_id)
    return {"task_id": duplicate.task_id, "enqueued_twice": True}

"""worker 归属：队列只发租约，不自带执行进程；没人来 claim，任务就一直排着。"""

from __future__ import annotations

from typing import Any

from impl.durable_task import graph_task
from iota_core.graph.task_queue import InMemoryGraphTaskQueue

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    queue = InMemoryGraphTaskQueue()
    enqueued = await queue.enqueue(graph_task("m09-waiting"))
    pending = require_not_none(await queue.get(enqueued.task_id), "任务在队列里")
    require(pending.status == "pending", "没有 worker 认领时任务保持等待", pending.status)

    api = sorted(name for name in dir(queue) if not name.startswith("_"))
    spawns = [name for name in api if "worker" in name or "spawn" in name or "start" in name]
    require(spawns == [], "队列不提供拉起 worker 的入口", spawns)

    claimed = require_not_none(
        await queue.claim(owner="worker-b", lease_seconds=30), "调用方来 claim 才开始执行"
    )
    require(claimed.task_id == enqueued.task_id, "claim 到的是同一条任务", claimed.task_id)
    return {
        "status_without_worker": pending.status,
        "queue_api": api,
        "worker_entrypoints": spawns,
        "execution_driver": "caller",
    }

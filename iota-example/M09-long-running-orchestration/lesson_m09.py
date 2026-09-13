"""M09: durable task semantics and graph checkpoints exceed simple jobs."""

from __future__ import annotations

from typing import Any

from iota_core.graph import GraphRef
from iota_core.graph.checkpoint import InMemoryCheckpointStore, build_checkpoint
from iota_core.graph.task_queue import GraphTask, InMemoryGraphTaskQueue

from runtime.harness import WorkshopHarness
from runtime.teaching import require, require_not_none


async def run(_harness: WorkshopHarness) -> dict[str, Any]:
    queue = InMemoryGraphTaskQueue()
    requested = GraphTask(
        task_id="m09-task",
        agent_spec_ref="agent@1.0.0",
        graph_ref=GraphRef(name="long-task", version="1.0.0"),
        inputs={"work": "offline"},
        run_id="m09-run",
        max_attempts=2,
    )
    first = await queue.enqueue(requested)
    duplicate = await queue.enqueue(requested)
    claimed = require_not_none(
        await queue.claim(owner="worker-a", lease_seconds=30), "worker 取得队列租约"
    )
    await queue.ack(claimed.task_id, owner="worker-a", result_status="succeeded")
    finished = require_not_none(await queue.get(claimed.task_id), "队列保存完成状态")

    checkpoints = InMemoryCheckpointStore()
    checkpoint = build_checkpoint(
        run_id="m09-run",
        plan_fingerprint="offline-plan",
        node_statuses={"prepare": "succeeded"},
        node_attempts={"prepare": 1},
        sequence=1,
    )
    await checkpoints.save(checkpoint)
    latest = require_not_none(await checkpoints.latest("m09-run"), "读取最新 checkpoint")
    require(first.task_id == duplicate.task_id, "重复入队保持 task id 幂等", duplicate.task_id)
    require(finished.status == "succeeded", "ack 后任务状态成功", finished.status)
    require(latest.sequence == 1, "checkpoint sequence 为 1", latest.sequence)
    return {
        "module": "M09",
        "status": "ok",
        "relationship": "语义等价（iota 提供更多耐久语义）",
        "queue": finished.status,
        "checkpoint_sequence": latest.sequence,
        "idempotent_task_id": duplicate.task_id,
    }

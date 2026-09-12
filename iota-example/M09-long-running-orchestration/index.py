"""M09: durable task semantics and graph checkpoints exceed simple jobs."""

from __future__ import annotations

from typing import Any

from iota_core.graph import GraphRef
from iota_core.graph.checkpoint import InMemoryCheckpointStore, build_checkpoint
from iota_core.graph.task_queue import GraphTask, InMemoryGraphTaskQueue


async def run(_harness) -> dict[str, Any]:
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
    claimed = await queue.claim(owner="worker-a", lease_seconds=30)
    assert claimed is not None
    await queue.ack(claimed.task_id, owner="worker-a", result_status="succeeded")
    finished = await queue.get(claimed.task_id)

    checkpoints = InMemoryCheckpointStore()
    checkpoint = build_checkpoint(
        run_id="m09-run",
        plan_fingerprint="offline-plan",
        node_statuses={"prepare": "succeeded"},
        node_attempts={"prepare": 1},
        sequence=1,
    )
    await checkpoints.save(checkpoint)
    latest = await checkpoints.latest("m09-run")
    assert first.task_id == duplicate.task_id
    assert finished is not None and finished.status == "succeeded"
    assert latest is not None and latest.sequence == 1
    return {
        "module": "M09",
        "status": "ok",
        "alignment": "A-reverse",
        "queue": finished.status,
        "checkpoint_sequence": latest.sequence,
        "idempotent_task_id": duplicate.task_id,
    }

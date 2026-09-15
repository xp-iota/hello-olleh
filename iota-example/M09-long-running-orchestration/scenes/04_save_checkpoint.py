"""checkpoint：节点状态与序号被显式保存，长任务因此可以从中间恢复。"""

from __future__ import annotations

from typing import Any

from impl.durable_task import RUN_ID
from iota_core.graph.checkpoint import InMemoryCheckpointStore, build_checkpoint

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    store = InMemoryCheckpointStore()
    await store.save(
        build_checkpoint(
            run_id=RUN_ID,
            plan_fingerprint="m09-plan",
            node_statuses={"prepare": "succeeded"},
            node_attempts={"prepare": 1},
            sequence=1,
        )
    )
    latest = require_not_none(await store.latest(RUN_ID), "读取最新 checkpoint")
    require(latest.sequence == 1, "checkpoint sequence 为 1", latest.sequence)
    return {
        "checkpoint_sequence": latest.sequence,
        "node_statuses": dict(latest.node_statuses),
    }

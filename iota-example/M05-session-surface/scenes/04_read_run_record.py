"""运行记录：RunStore 保存这轮的状态，事件按标准顺序读回。"""

from __future__ import annotations

from typing import Any

from impl.session_probe import run_one_turn

from runtime.harness import WorkshopHarness, require, require_event_order


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    turn = await run_one_turn(harness, namespace="m05-run")
    events = [event.type for event in turn.events]
    require(turn.run_record["status"] == "succeeded", "运行记录状态成功", turn.run_record)
    require_event_order(events, ("system_init", "text_delta", "final"))
    return {"run_status": turn.run_record["status"], "events": events}

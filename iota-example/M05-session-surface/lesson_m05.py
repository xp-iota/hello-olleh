"""M05: conversation and run stores preserve their existing data shapes."""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require, require_event_order, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    agent = harness.agent(name="m05", memory_namespace="m05-session")
    result = await harness.runtime.run(agent, "persist me")
    run_id = require_not_none(result.run_id, "运行生成 run_id")
    messages = await harness.conversation_store.get_messages(agent.memory_namespace)
    run_record = await harness.run_store.get_run(run_id)
    events = await harness.run_store.get_events(run_id)
    event_fields = events[0].model_dump().keys()
    require(
        [message.role for message in messages] == ["user", "assistant"],
        "会话按 user/assistant 顺序持久化",
        [message.role for message in messages],
    )
    run_record = require_not_none(run_record, "RunStore 返回运行记录")
    require(run_record["status"] == "succeeded", "运行记录状态成功", run_record)
    require_event_order(
        [event.type for event in events], ("system_init", "text_delta", "final")
    )
    require(
        "sequence" not in event_fields, "事件 schema 不承诺 DSH sequence 字段", list(event_fields)
    )
    return {
        "module": "M05",
        "status": "ok",
        "relationship": "语义等价 + 结构性边界",
        "messages": len(messages),
        "run_status": run_record["status"],
        "sequence_contract": "not part of the iota event schema",
    }

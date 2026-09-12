"""M05: conversation and run stores preserve their existing data shapes."""

from __future__ import annotations

from typing import Any


async def run(harness) -> dict[str, Any]:
    agent = harness.agent(name="m05", memory_namespace="m05-session")
    result = await harness.runtime.run(agent, "persist me")
    assert result.run_id is not None
    messages = await harness.conversation_store.get_messages(agent.memory_namespace)
    run_record = await harness.run_store.get_run(result.run_id)
    events = await harness.run_store.get_events(result.run_id)
    event_fields = events[0].model_dump().keys()
    assert [message.role for message in messages] == ["user", "assistant"]
    assert run_record is not None and run_record["status"] == "succeeded"
    assert [event.type for event in events] == ["system_init", "text_delta", "final"]
    assert "sequence" not in event_fields
    return {
        "module": "M05",
        "status": "ok",
        "alignment": "A+C",
        "messages": len(messages),
        "run_status": run_record["status"],
        "sequence_contract": "not added under D7",
    }

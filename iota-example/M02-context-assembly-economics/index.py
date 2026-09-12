"""M02: scoped memory injection, while prompt compression stays kernel-owned."""

from __future__ import annotations

from typing import Any

from iota_core.memory.context import MemoryContextService
from iota_core.memory.gateway import MemoryRecallItem, MemoryRecallQuery, MemoryRecallResult
from iota_core.types import AgentConfig


class Gateway:
    def __init__(self) -> None:
        self.queries: list[MemoryRecallQuery] = []

    async def recall_memories(self, query: MemoryRecallQuery) -> MemoryRecallResult:
        self.queries.append(query)
        return MemoryRecallResult(
            records=[
                MemoryRecallItem(
                    id="preference-1",
                    type="semantic",
                    facet="preference",
                    scope="user",
                    scope_id=query.user_scope_id,
                    content="回答保持简洁",
                    source="m02",
                    metadata={"status": "active"},
                    confidence=1.0,
                )
            ]
        )

    async def write_memories(self, requests: Any) -> list[Any]:
        return list(requests)

    async def search_memories(self, query: Any) -> list[Any]:
        del query
        return []


async def run(_harness) -> dict[str, Any]:
    gateway = Gateway()
    context = await MemoryContextService(memory_gateway=gateway).build_prompt_prefix(
        user_scope_id="user-a",
        project_scope_id="project-a",
        session_scope_id="session-a",
    )
    default_policy = AgentConfig(name="m02", kernel="echo")
    assert context.included_count == 1
    assert "回答保持简洁" in context.text
    assert gateway.queries[0].session_scope_id == "session-a"
    assert default_policy.enable_memory_prompt is False
    assert "compression" not in AgentConfig.model_fields
    return {
        "module": "M02",
        "status": "ok",
        "alignment": "A+C",
        "scope": gateway.queries[0].session_scope_id,
        "default_injection": default_policy.enable_memory_prompt,
        "compression_seam": "kernel-owned",
    }

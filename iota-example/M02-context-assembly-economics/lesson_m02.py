"""M02: scoped memory injection, while prompt compression stays kernel-owned."""

from __future__ import annotations

from typing import Any

from iota_core.memory.context import MemoryContextService
from iota_core.memory.gateway import MemoryRecallItem, MemoryRecallQuery, MemoryRecallResult
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness
from runtime.teaching import require, require_not_none


class Gateway:
    def __init__(self) -> None:
        self.queries: list[MemoryRecallQuery] = []

    async def recall_memories(self, query: MemoryRecallQuery) -> MemoryRecallResult:
        self.queries.append(query)
        user_scope_id = require_not_none(query.user_scope_id, "记忆查询包含 user scope")
        return MemoryRecallResult(
            records=[
                MemoryRecallItem(
                    id="preference-1",
                    type="semantic",
                    facet="preference",
                    scope="user",
                    scope_id=user_scope_id,
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


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    gateway = Gateway()
    context = await MemoryContextService(memory_gateway=gateway).build_prompt_prefix(
        user_scope_id="user-a",
        project_scope_id="project-a",
        session_scope_id="session-a",
    )
    # kernel 名取自当前装配（echo 或真实内核），示例不硬编码某一个内核。
    default_policy = AgentConfig(name="m02", kernel=harness.kernel)
    require(context.included_count == 1, "只注入一条匹配记忆", context.included_count)
    require("回答保持简洁" in context.text, "渲染召回的记忆正文", context.text)
    require(
        gateway.queries[0].session_scope_id == "session-a", "保留 session scope", gateway.queries[0]
    )
    require(
        default_policy.enable_memory_prompt is False,
        "记忆 Prompt 默认关闭",
        default_policy.enable_memory_prompt,
    )
    require("compression" not in AgentConfig.model_fields, "AgentConfig 不伪造压缩 seam")
    return {
        "module": "M02",
        "status": "ok",
        "relationship": "语义等价 + 结构性边界",
        "scope": gateway.queries[0].session_scope_id,
        "default_injection": default_policy.enable_memory_prompt,
        "compression_seam": "kernel-owned",
    }

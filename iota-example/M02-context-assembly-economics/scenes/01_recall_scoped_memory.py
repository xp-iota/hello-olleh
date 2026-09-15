"""召回作用域记忆：user/project/session 三个作用域一路传到网关，命中的记忆进入 Prompt 前缀。"""

from __future__ import annotations

from typing import Any

from impl.memory_gateway import PREFERENCE, Gateway
from iota_core.memory.context import MemoryContextService

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    gateway = Gateway()
    context = await MemoryContextService(memory_gateway=gateway).build_prompt_prefix(
        user_scope_id="user-a",
        project_scope_id="project-a",
        session_scope_id="session-a",
    )
    query = gateway.queries[0]
    require(context.included_count == 1, "只注入一条匹配记忆", context.included_count)
    require(PREFERENCE in context.text, "渲染召回的记忆正文", context.text)
    require(query.user_scope_id == "user-a", "保留 user scope", query.user_scope_id)
    require(query.project_scope_id == "project-a", "保留 project scope", query.project_scope_id)
    require(query.session_scope_id == "session-a", "保留 session scope", query.session_scope_id)
    return {
        "included_count": context.included_count,
        "scopes": [query.user_scope_id, query.project_scope_id, query.session_scope_id],
        "prefix_contains": PREFERENCE,
    }

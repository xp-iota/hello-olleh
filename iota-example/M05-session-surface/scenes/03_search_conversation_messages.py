"""查询语料：按会话列出与检索消息，这是 iota 提供的会话查询面。"""

from __future__ import annotations

from typing import Any

from iota_core.storage.in_memory import InMemoryConversationStore
from iota_core.types import Message

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    store = InMemoryConversationStore()
    for namespace, content in (("m05-a", "订单已创建"), ("m05-b", "库存已扣减")):
        await store.ensure_session(namespace, source="example")
        await store.append_message(namespace, Message(role="user", content=content))
    sessions = sorted(meta.session_id for meta in await store.list_sessions())
    hits = await store.search_messages("库存")
    require(sessions == ["m05-a", "m05-b"], "两个会话都在册", sessions)
    require(len(hits) == 1, "检索命中一条消息", hits)
    return {
        "sessions": sessions,
        "search_hits": len(hits),
        "query": "库存",
    }

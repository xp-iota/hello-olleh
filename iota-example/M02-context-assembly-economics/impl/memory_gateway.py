"""记忆网关的教学实现：记录每次召回查询，返回一条固定的偏好记忆。

`MemoryContextService` 只依赖 `MemoryGateway` 协议，所以示例可以用一个可观察的实现替换
真实存储：查询被留在 `queries` 里，读者能直接看到作用域是怎么传下去的。
"""

from __future__ import annotations

from typing import Any

from iota_core.memory.gateway import MemoryRecallItem, MemoryRecallQuery, MemoryRecallResult

from runtime.harness import require_not_none

#: 这条记忆会被渲染进 Prompt 前缀，场景据此判断"注入真的发生了"。
PREFERENCE = "回答保持简洁"


class Gateway:
    """记录查询的召回网关。"""

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
                    content=PREFERENCE,
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

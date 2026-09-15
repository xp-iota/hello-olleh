"""写回代替 spill：放不进这一轮上下文的事实写进作用域记忆，下轮按 scope 召回。"""

from __future__ import annotations

from typing import Any

from impl.memory_gateway import Gateway
from iota_core.memory.gateway import MemoryWriteRequest
from iota_core.memory.scope import MemoryScopeResolver
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    config = AgentConfig(
        name="m02-writeback",
        kernel=harness.kernel,
        memory_namespace="m02-session",
        extra={"memory_scope": {"user_scope_id": "user-a", "project_scope_id": "project-a"}},
    )
    scopes = MemoryScopeResolver().resolve(
        memory_namespace=config.memory_namespace or "m02-session",
        cwd="/workspace",
        agent_config=config,
    )
    gateway = Gateway()
    written = await gateway.write_memories(
        [
            MemoryWriteRequest(
                scope_id=scopes.session_scope_id,
                scope="session",
                # episodic 记忆按协议不带 facet：写回的是"发生过什么"，不是一条画像。
                type="episodic",
                content="上一轮的长输出已写回记忆",
                source="m02",
            )
        ]
    )
    require(len(written) == 1, "写回请求被网关接收", written)
    require(scopes.session_scope_id == "m02-session", "session scope 来自 namespace", scopes)
    require(scopes.user_scope_id == "user-a", "user scope 来自 AgentConfig.extra", scopes)
    return {
        "scopes": [scopes.user_scope_id, scopes.project_scope_id, scopes.session_scope_id],
        "written": len(written),
        "spill_equivalent": "scoped memory write-back",
    }

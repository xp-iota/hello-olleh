"""宿主边界：凭证与附件不塞进 AgentConfig，它们属于宿主。"""

from __future__ import annotations

from typing import Any

from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require

HOST_WORDS = ("credential", "attachment", "secret", "token")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    faked = sorted(
        name for name in AgentConfig.model_fields if any(word in name for word in HOST_WORDS)
    )
    require(faked == [], "AgentConfig 不伪造凭证/附件字段", faked)
    return {"faked_host_fields": faked, "credentials_attachments": "host-owned"}

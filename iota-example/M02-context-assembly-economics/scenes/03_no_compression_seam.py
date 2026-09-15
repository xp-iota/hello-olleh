"""不伪造压缩 seam：AgentConfig 里没有压缩开关，历史压缩仍归内核。"""

from __future__ import annotations

from typing import Any

from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    fields = set(AgentConfig.model_fields)
    faked = sorted(name for name in fields if "compress" in name or "compact" in name)
    require(faked == [], "AgentConfig 不伪造压缩 seam", faked)
    return {"faked_compression_fields": faked, "compression_seam": "kernel-owned"}

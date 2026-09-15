"""定义期拒绝：拼错的 capability 名在类定义时就报错，而不是运行时没人兑现。"""

from __future__ import annotations

from typing import Any

from impl.capability_probe import define_bad_capability
from iota_core.errors import ConfigError

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    try:
        define_bad_capability()
    except ConfigError as exc:
        refusal = str(exc)
    else:  # pragma: no cover
        fail("未知 capability 在类定义期被拒绝")
    require(bool(refusal), "拒绝信息非空", refusal)
    return {"capability_refusal": refusal, "rejected_at": "class-definition"}

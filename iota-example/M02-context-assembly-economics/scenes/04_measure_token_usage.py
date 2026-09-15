"""token 用量：数字来自内核报告，编排层不自己数 token。"""

from __future__ import annotations

from typing import Any

from iota_core.registry import Registry
from iota_core.types import TokenUsage

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    result = await harness.run("请只回复：用量已计量。", name="m02-usage")
    require(bool((result.final_text or "").strip()), "真实运行返回非空文本", result.final_text)
    usage = result.usage
    reported = usage.to_dict() if isinstance(usage, TokenUsage) else dict(usage or {})
    meter_surface = sorted(name for name in vars(Registry()) if "token" in name or "meter" in name)
    require(meter_surface == [], "编排层没有 token 计量注册面", meter_surface)
    return {
        "input_tokens": int(reported.get("input_tokens", 0)),
        "output_tokens": int(reported.get("output_tokens", 0)),
        "usage_reported_by": "kernel",
        "meter_surface": meter_surface,
    }

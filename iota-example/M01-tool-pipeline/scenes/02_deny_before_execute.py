"""执行前拒绝：包装可以在调用到达 handler 之前拒绝，但编排层没有 allow/deny/ask 协议。"""

from __future__ import annotations

from typing import Any

from impl.tool_pipeline import Backend, blocking
from iota_core.effects import EffectStack
from iota_core.registry import Registry
from iota_core.tool_pipeline import ToolPipeline

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    backend = Backend()
    with EffectStack("m01-gate") as effects:
        pipeline = ToolPipeline(backend, effects, stages=("guard",))
        pipeline.install("guard", blocking("m01 禁止 lookup"), tools=["lookup"])
        try:
            backend.tools["lookup"].handler("x")
        except PermissionError as exc:
            refusal = str(exc)
        else:  # pragma: no cover
            fail("执行前包装拒绝调用")
    require(backend.tools["lookup"].handler("x") == "raw:x", "回收后调用恢复正常")
    # 编排层没有审批注册面：allow/deny/ask 这一层协议属于内核。
    approval_surface = sorted(
        name for name in vars(Registry()) if "approv" in name or "permission" in name
    )
    require(approval_surface == [], "编排层没有审批注册面", approval_surface)
    return {
        "refusal": refusal,
        "approval_surface": approval_surface,
        "three_state_protocol": "kernel-owned",
    }

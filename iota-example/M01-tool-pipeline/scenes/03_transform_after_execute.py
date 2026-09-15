"""执行后变换：包装改写返回值；后装的 stage 在外层，声明顺序不自动重排。"""

from __future__ import annotations

from typing import Any

from impl.tool_pipeline import Backend, tagged
from iota_core.effects import EffectStack
from iota_core.tool_pipeline import ToolPipeline

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    observed: list[str] = []
    for order in (("guard", "audit"), ("audit", "guard")):
        backend = Backend()
        with EffectStack("m01-order") as effects:
            pipeline = ToolPipeline(backend, effects, stages=("audit", "guard"))
            for stage in order:
                pipeline.install(stage, tagged(stage), tools=["lookup"])
            observed.append(backend.tools["lookup"].handler("x"))
    require(
        observed == ["audit(guard(raw:x))", "guard(audit(raw:x))"],
        "后安装的 stage 位于外层，声明顺序不自动重排",
        observed,
    )
    return {
        "guard_then_audit": observed[0],
        "audit_then_guard": observed[1],
        # DSH 的 post 变换分开返回 canonical 值与模型可见 content；这里只有一个返回值。
        "canonical_content_split": False,
    }

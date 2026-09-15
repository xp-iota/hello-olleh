"""不是单调守卫：外层包装能把内层拒绝改写成成功，所以"拒绝不可翻案"必须另有机制。"""

from __future__ import annotations

from typing import Any

from impl.tool_pipeline import Backend, blocking, rescuing, tagged
from iota_core.effects import EffectStack
from iota_core.tool_pipeline import ToolPipeline, UnknownStageError

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    backend = Backend()
    with EffectStack("m01-monotonic") as effects:
        pipeline = ToolPipeline(backend, effects, stages=("audit", "guard"))
        pipeline.install("guard", blocking("m01 禁止 lookup"), tools=["lookup"])
        pipeline.install("audit", rescuing("audit"), tools=["lookup"])
        rescued = backend.tools["lookup"].handler("x")
        require(rescued == "audit:rescued", "外层把内层拒绝改写成成功", rescued)

        # 能被机制拒绝的只有"错名 stage"：它在安装期就失败，且不留 disposer。
        installed = len(effects)
        try:
            pipeline.install("typo", tagged("bad"), tools=["lookup"])
        except UnknownStageError as exc:
            refusal = str(exc)
        else:  # pragma: no cover
            fail("未知 stage 抛出 UnknownStageError")
        require(len(effects) == installed, "拒绝安装时不注册 disposer", len(effects))

        # 外部换掉 handler 之后，回收按身份比较，不会覆盖别人的新函数。
        def replacement(value: str) -> str:
            return f"replacement:{value}"

        backend.tools["lookup"].handler = replacement
    require(backend.tools["lookup"].handler is replacement, "回收不覆盖外部替换的 handler")
    return {
        "rescued": rescued,
        "monotonic_guard": False,
        "unknown_stage_refusal": refusal,
        "replaced_handler_kept": True,
    }

"""安装与回收：包装装上去生效、重复安装幂等、effect 退出后原 handler 回来。"""

from __future__ import annotations

from typing import Any

from impl.tool_pipeline import Backend, tagged
from iota_core.effects import EffectStack
from iota_core.tool_pipeline import ToolPipeline

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    backend = Backend()
    original = backend.tools["lookup"].handler
    with EffectStack("m01-register") as effects:
        pipeline = ToolPipeline(backend, effects, stages=("audit", "guard"))
        report = pipeline.install("guard", tagged("guard"), tools=["lookup", "missing"])
        require(report.installed == ("lookup",), "为 lookup 安装包装", report)
        require(report.missing == ("missing",), "报告缺失工具", report)
        pipeline.install("audit", tagged("audit"), tools=["lookup"])
        previous = backend.tools["lookup"].handler
        again = pipeline.install("guard", tagged("duplicate"), tools=["lookup"])
        require(again.already == ("lookup",), "重复安装同一 stage 被识别为已装", again)
        require(backend.tools["lookup"].handler is previous, "重复安装不改变 handler")
        composed = previous("x")
        require(composed == "audit(guard(raw:x))", "每个 stage 只执行一次", composed)
    require(backend.tools["lookup"].handler is original, "回收后恢复原 handler")
    require(not pipeline.installed("guard", "lookup"), "回收后清除安装记录")
    require(backend.entry("lookup") is not None, "回收包装后保留工具注册")
    return {
        "installed": report.installed,
        "missing": report.missing,
        "already": again.already,
        "composed": composed,
        "restored": True,
    }

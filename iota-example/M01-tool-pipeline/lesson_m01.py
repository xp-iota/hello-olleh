"""M01: named, reversible stages around an iota-owned tool channel."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from iota_core.tool_pipeline import (
    ToolEntry,
    ToolPipeline,
    UnknownStageError,
    WrapFn,
)

from runtime.harness import WorkshopHarness
from runtime.teaching import fail, require


@dataclass
class Entry(ToolEntry):
    name: str
    handler: Callable[..., Any]
    is_async: bool = False


class Backend:
    def __init__(self) -> None:
        self.tools = {"lookup": Entry("lookup", lambda value: f"raw:{value}")}

    def entry(self, name: str) -> ToolEntry | None:
        return self.tools.get(name)

    def entries(self) -> Iterable[ToolEntry]:
        return self.tools.values()


def tagged(label: str) -> WrapFn:
    def wrap(_name: str, previous: Callable[..., Any], *, is_async: bool) -> Callable[..., Any]:
        require(not is_async, "示例 handler 保持同步", is_async)

        def handler(value: str) -> str:
            return f"{label}({previous(value)})"

        return handler

    return wrap


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    backend = Backend()
    effects = harness.effects
    pipeline = ToolPipeline(backend, effects, stages=("audit", "guard"), label="iota-tools")
    pristine = backend.tools["lookup"].handler
    first = pipeline.install("guard", tagged("guard"), tools=["lookup", "missing"])
    second = pipeline.install("guard", tagged("guard"), tools=["lookup"])
    pipeline.install("audit", tagged("audit"), tools=["lookup"])
    wrapped = backend.tools["lookup"].handler("x")
    try:
        pipeline.install("typo", tagged("bad"), tools=["lookup"])
    except UnknownStageError as exc:
        refusal = str(exc)
    else:  # pragma: no cover
        fail("未知 stage 明确抛出 UnknownStageError")
    effects.dispose()
    require(
        first.installed == ("lookup",) and first.missing == ("missing",),
        "报告已安装与缺失工具",
        first,
    )
    require(second.already == ("lookup",), "重复安装保持幂等", second)
    require(wrapped == "audit(guard(raw:x))", "stage 按 audit(guard(raw)) 嵌套", wrapped)
    require(backend.tools["lookup"].handler is pristine, "effect 回收后恢复原 handler")
    return {
        "module": "M01",
        "status": "ok",
        "relationship": "教学补齐 + 结构性边界",
        "pipeline": wrapped,
        "refusal": refusal,
    }

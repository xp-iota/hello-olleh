"""M01: named, reversible stages around an iota-owned tool channel."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from iota_core.effects import EffectStack
from iota_core.tool_pipeline import ToolPipeline, UnknownStageError


@dataclass
class Entry:
    name: str
    handler: Callable[..., Any]
    is_async: bool = False


class Backend:
    def __init__(self) -> None:
        self.tools = {"lookup": Entry("lookup", lambda value: f"raw:{value}")}

    def entry(self, name: str) -> Entry | None:
        return self.tools.get(name)

    def entries(self) -> Iterable[Entry]:
        return self.tools.values()


def tagged(label: str):
    def wrap(_name: str, previous: Callable[..., Any], *, is_async: bool):
        assert not is_async

        def handler(value: str) -> str:
            return f"{label}({previous(value)})"

        return handler

    return wrap


async def run(_harness) -> dict[str, Any]:
    backend = Backend()
    effects = EffectStack("m01")
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
        raise AssertionError("unknown stage must fail loudly")
    effects.dispose()
    assert first.installed == ("lookup",) and first.missing == ("missing",)
    assert second.already == ("lookup",)
    assert wrapped == "audit(guard(raw:x))"
    assert backend.tools["lookup"].handler is pristine
    return {
        "module": "M01",
        "status": "ok",
        "alignment": "B+C",
        "pipeline": wrapped,
        "refusal": refusal,
    }

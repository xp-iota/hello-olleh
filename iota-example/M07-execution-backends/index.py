"""M07: the execution-side shell event is emitted by the kernel adapter."""

from __future__ import annotations

from typing import Any

from iota_core.types import ToolCallResultEvent, ToolCallStartEvent


async def run(harness) -> dict[str, Any]:
    events = await harness.stream("shell: printf offline")
    starts = [event for event in events if isinstance(event, ToolCallStartEvent)]
    results = [event for event in events if isinstance(event, ToolCallResultEvent)]
    assert len(starts) == 1 and starts[0].name == "kernel.shell"
    assert len(results) == 1 and results[0].ok
    assert harness.registry.tools.list() == []
    return {
        "module": "M07",
        "status": "ok",
        "alignment": "C",
        "route": "prompt -> KernelAdapter -> kernel.shell event",
        "orchestrator_shell_registry": harness.registry.tools.list(),
    }

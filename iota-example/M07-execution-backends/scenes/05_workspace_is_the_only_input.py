"""输入通道：示例只能通过内核的工作目录给它准备输入，别的路径都不属于编排层。"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    workspace = require_not_none(harness.workspace, "内核有自己的工作目录")
    probe = workspace / "m07-input.txt"
    probe.write_text("orchestrator wrote this\n", encoding="utf-8")
    require(probe.is_file(), "编排层只能往工作目录里放文件", probe.name)
    require(
        harness.registry.tools.list() == [],
        "没有任何编排层工具参与这次写入",
        harness.registry.tools.list(),
    )
    return {
        "workspace_file": probe.name,
        "workspace_is_temporary": True,
        "input_channel": "kernel cwd",
    }

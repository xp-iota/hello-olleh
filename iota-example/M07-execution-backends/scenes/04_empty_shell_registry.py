"""空注册表：编排层一个 shell 工具都不注册 —— 这不是遗漏，而是可运行的边界证据。"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    tools = harness.registry.tools.list()
    require(tools == [], "编排层不注册 shell 工具", tools)
    return {"orchestrator_shell_registry": tools, "execution_stack": "kernel-owned"}

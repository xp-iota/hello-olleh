"""拓扑顺序：依赖在编译期就决定了执行顺序，运行前即可检查。"""

from __future__ import annotations

from typing import Any

from impl.delegation_graph import delegation_graph, install_handlers

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    install_handlers(harness.registry)
    ref = harness.runtime.register_graph(delegation_graph("m08-order"), overwrite=True)
    plan = await harness.runtime.compile_graph(ref, agent=harness.agent(name="m08-order"))
    require(
        plan.topological_order == ("research", "review"),
        "拓扑顺序为 research→review",
        plan.topological_order,
    )
    return {"topological_order": list(plan.topological_order)}

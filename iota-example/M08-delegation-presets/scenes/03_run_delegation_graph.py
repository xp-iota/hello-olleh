"""运行与绑定：整图跑完，review 通过绑定拿到 research 的输出，而不是重新提问。"""

from __future__ import annotations

from typing import Any

from impl.delegation_graph import delegation_graph, install_handlers

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    install_handlers(harness.registry)
    ref = harness.runtime.register_graph(delegation_graph("m08-delegation"), overwrite=True)
    result = await harness.runtime.run_graph(
        harness.agent(name="m08-delegation"), ref, {"topic": "iota"}
    )
    require(result.status == "succeeded", "委派图运行成功", result.status)
    require(
        result.outputs["review"]["approved"] == "research:iota",
        "review 消费 research 的输出",
        result.outputs,
    )
    return {
        "graph_status": result.status,
        "review_output": result.outputs["review"],
        "binding": "$nodes.research.output",
    }

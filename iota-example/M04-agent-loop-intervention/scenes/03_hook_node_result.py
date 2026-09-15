"""节点结果 hook：after_node_result 在节点边界上拿到真实运行结果。"""

from __future__ import annotations

from typing import Any

from impl.node_hooks import audited_graph, install_audit

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    seen: list[tuple[str, str]] = []
    install_audit(harness.registry, seen)
    graph = harness.runtime.register_graph(audited_graph())
    result = await harness.runtime.run_graph(harness.agent(name="m04-graph"), graph, {"v": 7})
    require(result.status == "succeeded", "图运行成功", result.status)
    require(seen == [("observe", "succeeded")], "after_node_result 观察成功结果", seen)
    return {"graph_status": result.status, "node_hook": [list(item) for item in seen]}

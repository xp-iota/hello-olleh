"""M04: agent events and graph node hooks; no mid-turn inbox contract."""

from __future__ import annotations

from typing import Any

from iota_core.graph import GraphSpec, NodeSpec


async def run(harness) -> dict[str, Any]:
    events = await harness.stream("observe")
    seen: list[tuple[str, str]] = []

    def audit(scope: Any, payload: dict[str, Any]) -> None:
        seen.append((scope.node_id, payload["result"]["status"]))

    harness.registry.node_hooks.register("m04-audit", audit)
    harness.registry.code_handlers.register("m04-code", lambda ctx: {"input": ctx.inputs["v"]})
    graph = GraphSpec(
        name="m04-hooks",
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="observe",
                executor_type="code",
                code_handler_ref="m04-code",
                input_bindings={"v": "$input.v"},
                hook_refs=["after_node_result:m04-audit"],
            )
        ],
        outputs={"value": "$nodes.observe.output"},
    )
    result = await harness.runtime.run_graph(
        harness.agent(name="m04-graph"), harness.runtime.register_graph(graph), {"v": 7}
    )
    assert result.status == "succeeded"
    assert [event.type for event in events] == ["system_init", "text_delta", "final"]
    assert seen == [("observe", "succeeded")]
    return {
        "module": "M04",
        "status": "ok",
        "alignment": "A+C",
        "events": [event.type for event in events],
        "node_hook": seen,
        "mid_turn_injection": "not an orchestrator contract",
    }

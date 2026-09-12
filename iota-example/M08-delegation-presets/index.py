"""M08: GraphSpec dependencies are iota's delegation shape."""

from __future__ import annotations

from typing import Any

from iota_core.graph import GraphSpec, NodeSpec


async def run(harness) -> dict[str, Any]:
    harness.registry.code_handlers.register(
        "m08-research", lambda ctx: {"draft": f"research:{ctx.inputs['topic']}"}
    )
    harness.registry.code_handlers.register(
        "m08-review", lambda ctx: {"approved": ctx.inputs["draft"]["draft"]}
    )
    graph = GraphSpec(
        name="m08-delegation",
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="research",
                executor_type="code",
                code_handler_ref="m08-research",
                input_bindings={"topic": "$input.topic"},
            ),
            NodeSpec(
                node_id="review",
                executor_type="code",
                code_handler_ref="m08-review",
                depends_on=["research"],
                input_bindings={"draft": "$nodes.research.output"},
            ),
        ],
        outputs={"review": "$nodes.review.output"},
    )
    ref = harness.runtime.register_graph(graph)
    agent = harness.agent(name="m08")
    plan = await harness.runtime.compile_graph(ref, agent=agent)
    result = await harness.runtime.run_graph(agent, ref, {"topic": "iota"})
    assert plan.topological_order == ("research", "review")
    assert result.status == "succeeded"
    assert result.outputs["review"]["approved"] == "research:iota"
    return {
        "module": "M08",
        "status": "ok",
        "alignment": "A",
        "order": list(plan.topological_order),
        "output": result.outputs["review"],
    }

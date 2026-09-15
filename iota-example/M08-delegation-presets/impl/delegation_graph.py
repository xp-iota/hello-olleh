"""委派图的教学实现：research → review 两个 code 节点。

委派在 iota 里是**显式 DAG**：依赖决定顺序，绑定决定数据流，两者都写在 GraphSpec 里，
所以顺序和数据流可以在运行前编译出来，而不是靠模型自由发挥。

handler 用 `overwrite=True` 注册：每个场景都能独立运行，重复安装同名 handler 不该拦住它。
"""

from __future__ import annotations

from iota_core.graph import GraphSpec, NodeSpec
from iota_core.registry import Registry

RESEARCH = "m08-research"
REVIEW = "m08-review"


def install_handlers(registry: Registry) -> None:
    registry.code_handlers.register(
        RESEARCH, lambda ctx: {"draft": f"research:{ctx.inputs['topic']}"}, overwrite=True
    )
    registry.code_handlers.register(
        REVIEW, lambda ctx: {"approved": ctx.inputs["draft"]["draft"]}, overwrite=True
    )


def delegation_graph(name: str) -> GraphSpec:
    return GraphSpec(
        name=name,
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="research",
                executor_type="code",
                code_handler_ref=RESEARCH,
                input_bindings={"topic": "$input.topic"},
            ),
            NodeSpec(
                node_id="review",
                executor_type="code",
                code_handler_ref=REVIEW,
                depends_on=["research"],
                input_bindings={"draft": "$nodes.research.output"},
            ),
        ],
        outputs={"review": "$nodes.review.output"},
    )

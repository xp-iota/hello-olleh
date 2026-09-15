"""节点 hook 的教学实现：一个只做记录的 after_node_result hook，和它观察的那张图。

hook 与 code handler 都按名字注册进 `Registry`，图只引用名字 —— 这是编排层的干预面：
节点边界上可观察、可扩展，而节点内部的过程属于内核。
"""

from __future__ import annotations

from typing import Any

from iota_core.graph import GraphSpec, NodeSpec
from iota_core.registry import Registry

CODE_HANDLER = "m04-code"
AUDIT_HOOK = "m04-audit"


def install_audit(registry: Registry, seen: list[tuple[str, str]]) -> None:
    """注册记录型 hook 和被它观察的 code handler。"""

    def audit(scope: Any, payload: dict[str, Any]) -> None:
        seen.append((scope.node_id, payload["result"]["status"]))

    registry.node_hooks.register(AUDIT_HOOK, audit)
    registry.code_handlers.register(CODE_HANDLER, lambda ctx: {"input": ctx.inputs["v"]})


def audited_graph() -> GraphSpec:
    return GraphSpec(
        name="m04-hooks",
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="observe",
                executor_type="code",
                code_handler_ref=CODE_HANDLER,
                input_bindings={"v": "$input.v"},
                hook_refs=[f"after_node_result:{AUDIT_HOOK}"],
            )
        ],
        outputs={"value": "$nodes.observe.output"},
    )

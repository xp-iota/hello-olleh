"""ACP 边界的教学素材：一个不启动进程的 ACP 适配器，和一张声明模型 middleware 的图。

适配器用 `command=["true"]` 构造：`capabilities()` 读的是适配器自己的声明，不需要真的拉起
子进程 —— 这正是"跨进程内核只声明验证过的能力"这件事可以离线观察的原因。
"""

from __future__ import annotations

from iota_core.adapters.hermes_acp import HermesAcpAdapter
from iota_core.graph import GraphSpec, NodeSpec
from iota_core.registry import Registry

#: 图里引用的 middleware 名字；ACP 内核不声明 per-session middleware，所以它必须被拒绝。
MIDDLEWARE = "trace"


def acp_adapter() -> HermesAcpAdapter:
    return HermesAcpAdapter(command=["true"])


def registry_with_middleware() -> Registry:
    registry = Registry()
    registry.node_middlewares.register(MIDDLEWARE, lambda _scope, _payload: None)
    return registry


def middleware_graph() -> GraphSpec:
    return GraphSpec(
        name="m03-acp-boundary",
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="infer",
                executor_type="react",
                prompt_template="m03-inference",
                middleware_refs=[f"llm_execution:{MIDDLEWARE}"],
            )
        ],
        outputs={"answer": "$nodes.infer.output"},
    )

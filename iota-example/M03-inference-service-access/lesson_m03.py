"""M03: replace a kernel provider; reject model middleware on ACP."""

from __future__ import annotations

from typing import Any

from iota_core.adapters.hermes_acp import HermesAcpAdapter
from iota_core.graph import GraphSpec, GraphValidationError, KernelCapabilities, NodeSpec
from iota_core.graph.compiler import GraphCompiler
from iota_core.providers import register_adapter
from iota_core.registry import Registry

from runtime.harness import WorkshopHarness
from runtime.kernel_echo import EchoKernelAdapter
from runtime.teaching import fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    disposer = register_adapter("m03-echo", lambda _build: EchoKernelAdapter())
    harness.effects.push(disposer, "provider:m03-echo")

    acp = HermesAcpAdapter(command=["true"])
    capabilities = KernelCapabilities.from_adapter_payload(await acp.capabilities())
    registry = Registry()
    registry.node_middlewares.register("trace", lambda _scope, _payload: None)
    spec = GraphSpec(
        name="m03-acp-boundary",
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="infer",
                executor_type="react",
                prompt_template="offline",
                middleware_refs=["llm_execution:trace"],
            )
        ],
        outputs={"answer": "$nodes.infer.output"},
    )
    try:
        GraphCompiler(registry, capabilities={"acp": capabilities}).compile(
            spec,
            default_kernel="acp",
            default_model="offline",
        )
    except GraphValidationError as exc:
        refusal = "; ".join(exc.problems)
    else:  # pragma: no cover
        fail("ACP 模型 middleware 在编译期被拒绝")
    require("middleware/hooks" in refusal, "拒绝信息指出 middleware/hooks 边界", refusal)
    return {
        "module": "M03",
        "status": "ok",
        "relationship": "结构性边界",
        "replaceable_unit": "KernelAdapter",
        "acp_refusal": refusal,
    }

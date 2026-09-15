"""编译期不变量：图引用了没注册的 handler，编译当场失败，而不是运行到一半才发现。"""

from __future__ import annotations

from typing import Any

from iota_core.graph import GraphSpec, GraphValidationError, KernelCapabilities, NodeSpec
from iota_core.graph.compiler import GraphCompiler
from iota_core.registry import Registry

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    spec = GraphSpec(
        name="m04-unknown-reference",
        version="1.0.0",
        nodes=[
            NodeSpec(
                node_id="work",
                executor_type="code",
                code_handler_ref="m04-not-registered",
                input_bindings={"v": "$input.v"},
            )
        ],
        outputs={"value": "$nodes.work.output"},
    )
    compiler = GraphCompiler(
        Registry(), capabilities={"code": KernelCapabilities.code_executor()}
    )
    try:
        compiler.compile(spec, default_kernel="code", default_model="m04-model")
    except GraphValidationError as exc:
        refusal = "; ".join(exc.problems)
    else:  # pragma: no cover
        fail("未注册的 code handler 引用在编译期被拒绝")
    require("m04-not-registered" in refusal, "拒绝信息点名缺失的引用", refusal)
    return {"refusal": refusal, "rejected_at": "compile-time"}

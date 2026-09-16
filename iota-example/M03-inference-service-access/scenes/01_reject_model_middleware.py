"""替换粒度与拒绝：Provider 的单位是整个 KernelAdapter，包装单次模型调用编译期就被拒。"""

from __future__ import annotations

from typing import Any

from impl.acp_boundary import acp_adapter, middleware_graph, registry_with_middleware
from iota_core.graph import GraphValidationError, KernelCapabilities
from iota_core.graph.compiler import GraphCompiler
from iota_core.providers import available_adapters, is_adapter_registered, register_adapter

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    # ① 替换单元：换名字登记同一个适配器，粒度是整个内核，不是某次调用。
    harness.effects.push(
        register_adapter("m03-kernel", lambda _build: harness.adapter),
        "provider:m03-kernel",
    )
    require(is_adapter_registered("m03-kernel"), "新名字登记的仍是同一个 KernelAdapter")

    # ② 能力声明：ACP 内核不声明按会话生效的模型 middleware。
    capabilities = KernelCapabilities.from_adapter_payload(await acp_adapter().capabilities())
    require(
        capabilities.per_session_middleware is False,
        "ACP 不声明按会话生效的模型 middleware",
        capabilities.per_session_middleware,
    )

    # ③ 因此，引用了模型 middleware 的图在运行之前就被拒绝。
    compiler = GraphCompiler(registry_with_middleware(), capabilities={"acp": capabilities})
    try:
        compiler.compile(middleware_graph(), default_kernel="acp", default_model="m03-model")
    except GraphValidationError as exc:
        refusal = "; ".join(exc.problems)
    else:  # pragma: no cover
        fail("ACP 模型 middleware 在编译期被拒绝")
    require("middleware/hooks" in refusal, "拒绝信息指出 middleware/hooks 边界", refusal)
    return {
        "replaceable_unit": "KernelAdapter",
        "registered_adapters": sorted(available_adapters()),
        "per_session_middleware": capabilities.per_session_middleware,
        "acp_refusal": refusal,
        "rejected_at": "compile-time",
    }

"""M12: reversible framework mechanics without importing cordis architecture."""

from __future__ import annotations

from typing import Any

from iota_core.adapters.base import KernelAdapter
from iota_core.effects import EffectStack, EffectStackDisposedError
from iota_core.errors import ConfigError
from iota_core.providers import ENTRY_POINT_GROUP, register_adapter
from iota_core.registry import Registry

from runtime.harness import EchoKernelAdapter, WorkshopHarness, fail, require


async def run(_harness: WorkshopHarness) -> dict[str, Any]:
    order: list[str] = []
    effects = EffectStack("m12")
    effects.push(lambda: order.append("inner"), "inner")
    effects.push(lambda: order.append("outer"), "outer")
    effects.dispose()
    effects.dispose()
    try:
        effects.push(lambda: None, "late")
    except EffectStackDisposedError as exc:
        inactive_refusal = str(exc)
    else:  # pragma: no cover
        fail("已释放 EffectStack 拒绝新 effect")

    registry = Registry()

    def value() -> str:
        return "original"

    dispose_registry = registry.code_handlers.register("owned", value)
    registry.code_handlers.register("owned", lambda: "replacement", overwrite=True)
    dispose_registry()
    require(registry.code_handlers.get("owned") is not value, "旧 disposer 不删除覆盖后的新值")

    provider_disposer = register_adapter("m12-provider", lambda _build: EchoKernelAdapter())
    provider_disposer()

    try:

        class BadCapability(KernelAdapter):
            name = "bad"
            provides = frozenset({"typo-capability"})

            async def start(self) -> None: ...
            async def capabilities(self) -> dict[str, Any]:
                return {}

            async def create_session(self, cfg: Any, tools: Any, mcps: Any) -> Any: ...
            def stream(self, session: Any, prompt: str, memory: Any) -> Any: ...
            async def close(self, session: Any = None) -> None: ...
    except ConfigError as exc:
        capability_refusal = str(exc)
    else:  # pragma: no cover
        fail("未知 capability 在类定义期被拒绝")

    require(order == ["outer", "inner"], "EffectStack 按 LIFO 回收", order)
    require(
        ENTRY_POINT_GROUP == "iota_core.providers",
        "使用标准 Provider entry-point group",
        ENTRY_POINT_GROUP,
    )
    return {
        "module": "M12",
        "status": "ok",
        "relationship": "语义等价 + 结构性边界",
        "lifo": order,
        "inactive_refusal": inactive_refusal,
        "capability_refusal": capability_refusal,
        "entry_points": ENTRY_POINT_GROUP,
        "architecture_not_imported": ["event-bus", "hmr", "intercept"],
    }

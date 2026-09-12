"""M12: reversible framework mechanics without importing cordis architecture."""

from __future__ import annotations

from typing import Any

from iota_core.adapters.base import KernelAdapter
from iota_core.effects import EffectStack, EffectStackDisposedError
from iota_core.errors import ConfigError
from iota_core.providers import ENTRY_POINT_GROUP, register_adapter
from iota_core.registry import Registry

from runtime.kernel_echo import EchoKernelAdapter


async def run(_harness) -> dict[str, Any]:
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
        raise AssertionError("disposed stack must refuse new effects")

    registry = Registry()
    value = object()
    dispose_registry = registry.code_handlers.register("owned", value)
    registry.code_handlers.register("owned", lambda: "replacement", overwrite=True)
    dispose_registry()
    assert registry.code_handlers.get("owned") is not value

    provider_disposer = register_adapter("m12-provider", lambda _build: EchoKernelAdapter())
    provider_disposer()

    try:
        class BadCapability(KernelAdapter):
            name = "bad"
            provides = frozenset({"typo-capability"})

            async def start(self) -> None: ...
            async def capabilities(self) -> dict[str, Any]: return {}
            async def create_session(self, cfg: Any, tools: Any, mcps: Any) -> Any: ...
            def stream(self, session: Any, prompt: str, memory: Any) -> Any: ...
            async def close(self, session: Any = None) -> None: ...
    except ConfigError as exc:
        capability_refusal = str(exc)
    else:  # pragma: no cover
        raise AssertionError("unknown capability must fail at class definition")

    assert order == ["outer", "inner"]
    assert ENTRY_POINT_GROUP == "iota_core.providers"
    return {
        "module": "M12",
        "status": "ok",
        "alignment": "A+C",
        "lifo": order,
        "inactive_refusal": inactive_refusal,
        "capability_refusal": capability_refusal,
        "entry_points": ENTRY_POINT_GROUP,
        "architecture_not_imported": ["event-bus", "hmr", "intercept"],
    }

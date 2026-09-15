"""沙箱归属：允许哪些工具、用什么许可模式，是内核适配器的构造参数，不是编排层的 seam。"""

from __future__ import annotations

import inspect
from typing import Any

from iota_core.registry import Registry

from runtime.harness import WorkshopHarness, build_adapter, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    signature = inspect.signature(build_adapter)
    kernel_knobs = sorted(signature.parameters)
    sandbox_surface = sorted(
        name for name in vars(Registry()) if "sandbox" in name or "policy" in name
    )
    require("allow_shell" in kernel_knobs, "装配层只有一个开关：要不要给内核 shell", kernel_knobs)
    require(sandbox_surface == [], "编排层没有沙箱/策略注册面", sandbox_surface)
    return {
        "assembly_knobs": kernel_knobs,
        "sandbox_surface": sandbox_surface,
        "policy_owner": "kernel adapter configuration",
    }

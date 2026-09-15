"""配置叠加：装配给默认值，调用点覆盖，extra 里放各层自己的键，互不覆写。"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    base = harness.agent(name="m12-base")
    layered = harness.agent(
        name="m12-layered",
        model="layer-model",
        memory_namespace="m12-layer",
        extra={"memory_scope": {"user_scope_id": "user-a"}},
    )
    require(base.config.model == harness.model, "默认层来自装配", base.config.model)
    require(layered.config.model == "layer-model", "调用点覆盖默认层", layered.config.model)
    require(
        layered.config.extra["memory_scope"]["user_scope_id"] == "user-a",
        "extra 保留调用点自己的键",
        layered.config.extra,
    )
    require(base.config.extra == {}, "默认层不被上层污染", base.config.extra)
    return {
        "assembly_model": harness.model,
        "layered_model": layered.config.model,
        "layered_extra": layered.config.extra,
    }

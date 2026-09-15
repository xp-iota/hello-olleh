"""模型路由：路由单位是具名 ModelProfile，节点按名字引用，而不是各处硬写模型名。"""

from __future__ import annotations

from typing import Any

from iota_core.types import ModelProfile

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    profile = ModelProfile(
        name="m08-reviewer-model",
        version="1.0.0",
        model=harness.model or "unknown",
        request_overrides={"temperature": 0},
    )
    disposer = harness.registry.model_profiles.register(profile.name, profile)
    resolved = harness.registry.model_profiles.get(profile.name)
    agent = harness.agent(name="m08-routed", model_profile=profile.name)
    disposer()
    require(resolved.model == profile.model, "按名字解析回同一个 profile", resolved)
    require(agent.config.model_profile == profile.name, "节点按名字引用 profile", agent.config)
    require(harness.registry.model_profiles.list() == [], "回收后 profile 不再在册")
    return {
        "profile": profile.name,
        "model": resolved.model,
        "request_overrides": dict(resolved.request_overrides),
    }

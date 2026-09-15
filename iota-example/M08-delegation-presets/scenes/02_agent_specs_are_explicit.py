"""空 roster：委派对象必须显式注册，装配不去扫描用户目录。"""

from __future__ import annotations

from typing import Any

from iota_core.agent_spec import AgentSpec
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    require(harness.registry.agent_specs.list() == [], "装配后 roster 为空")
    spec = AgentSpec(
        name="m08-reviewer",
        version="1.0.0",
        config=AgentConfig(name="m08-reviewer", kernel=harness.kernel),
    )
    disposer = harness.registry.agent_specs.register(spec.name, spec)
    listed = harness.registry.agent_specs.list()
    disposer()
    require(listed == ["m08-reviewer"], "显式注册后才在册", listed)
    require(harness.registry.agent_specs.list() == [], "回收后回到空 roster")
    return {
        "roster_after_assembly": [],
        "roster_after_register": listed,
        "discovery": "explicit registration only",
    }

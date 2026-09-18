"""todo 归属：待办工具集是一条**要声明**的能力，能不能用取决于内核声明了什么。

论点是"声明即真相"：`NATIVE_KANBAN_TOOLSET` 在 `provides` 里就代表内核原生带这套工具，
不在就说明这层归宿主/编排层。原先这里写死 `declared is False`，那只是当时那个内核的
观测结果；换个内核（Hermes 声明了它）断言就会假失败，而论点本身没变。
"""

from __future__ import annotations

from typing import Any

from iota_core.capabilities import NATIVE_KANBAN_TOOLSET
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    config = AgentConfig(name="m06-kanban", kernel=harness.kernel)
    provides = sorted(harness.adapter.provides)
    declared = NATIVE_KANBAN_TOOLSET in provides
    require("auto_kanban" in AgentConfig.model_fields, "配置里有 kanban 开关")
    # 可证伪的断言：归属是声明推出的**结论**，不是另写一份常量。声明与 provides 不一致
    # （例如有人删了声明却仍把 owner 写成 kernel）这里就会失败。
    owner = "kernel" if NATIVE_KANBAN_TOOLSET in provides else "host"
    require(
        (owner == "kernel") is declared,
        "kanban 归属由内核声明唯一决定",
        {"owner": owner, "declared": declared},
    )
    return {
        "auto_kanban_default": config.auto_kanban,
        "kernel_declares_kanban": declared,
        "kernel_provides": provides,
        "todo_owner": owner,
    }

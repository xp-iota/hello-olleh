"""M06: ACP permission policy always answers and fails closed."""

from __future__ import annotations

from typing import Any

from iota_core.adapters.dsh_acp import DshAcpAdapter
from iota_core.types import AgentConfig

from runtime.harness import WorkshopHarness, require


async def run(_harness: WorkshopHarness) -> dict[str, Any]:
    adapter = DshAcpAdapter(command=["true"])
    decision = await adapter._handle_request(
        "session/request_permission",
        {
            "sessionId": "offline",
            "toolCall": {"toolCallId": "call-1"},
            "options": [
                {"optionId": "yes", "kind": "allow_once"},
                {"optionId": "no", "kind": "reject_once"},
            ],
        },
    )
    option = decision["outcome"]["optionId"]
    require(option == "no", "无匹配策略时选择拒绝", option)
    require("plan_mode" not in AgentConfig.model_fields, "AgentConfig 不伪造 plan_mode 字段")
    return {
        "module": "M06",
        "status": "ok",
        "relationship": "语义等价 + 结构性边界",
        "permission": option,
        "hang_prevention": "request answered",
        "plan_mode": "kernel/harness-owned",
    }

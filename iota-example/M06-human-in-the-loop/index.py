"""M06: ACP permission policy always answers and fails closed."""

from __future__ import annotations

from typing import Any

from iota_core.adapters.dsh_acp import DshAcpAdapter
from iota_core.types import AgentConfig


async def run(_harness) -> dict[str, Any]:
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
    assert option == "no"
    assert "plan_mode" not in AgentConfig.model_fields
    return {
        "module": "M06",
        "status": "ok",
        "alignment": "A+C",
        "permission": option,
        "hang_prevention": "request answered",
        "plan_mode": "kernel/harness-owned",
    }

"""必定答复：同一个请求在 reject 与 allow 两种策略下都得到明确选项，不会挂住整轮。"""

from __future__ import annotations

from typing import Any

from impl.acp_permission import PERMISSION_METHOD, dsh_adapter, permission_request

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    request = permission_request("allow_once", "reject_once")
    answers: dict[str, str] = {}
    for policy in ("reject", "allow"):
        decision = await dsh_adapter(policy)._handle_request(PERMISSION_METHOD, request)
        require(decision["outcome"]["outcome"] == "selected", "答复是一次明确选择", decision)
        answers[policy] = decision["outcome"]["optionId"]
    require(answers["reject"] == "reject_once-option", "默认策略选择拒绝", answers)
    require(answers["allow"] == "allow_once-option", "allow 策略选择放行", answers)
    return {"default_policy": "reject", "answers": answers, "outcome": "selected"}

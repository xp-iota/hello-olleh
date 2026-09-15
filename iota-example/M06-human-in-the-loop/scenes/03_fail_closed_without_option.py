"""fail closed：请求里没有符合策略的选项时报错，而不是随便挑一个。"""

from __future__ import annotations

from typing import Any

from impl.acp_permission import PERMISSION_METHOD, dsh_adapter, permission_request
from iota_core.errors import KernelError

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    # 只提供放行选项，而策略是拒绝：随便挑一个就会变成"授予"，所以这里必须失败。
    request = permission_request("allow_once")
    try:
        await dsh_adapter("reject")._handle_request(PERMISSION_METHOD, request)
    except KernelError as exc:
        refusal = str(exc)
    else:  # pragma: no cover
        fail("无匹配选项时拒绝作答")
    require("reject" in refusal, "拒绝信息说明想要的策略", refusal)
    return {"refusal": refusal, "direction": "fail-closed"}

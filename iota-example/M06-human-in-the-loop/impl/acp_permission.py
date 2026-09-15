"""ACP 权限的教学素材：按策略构造适配器，按 kind 构造一次权限请求。

策略在部署时声明（默认 `reject`），选项按 `kind` 匹配而不是按 `optionId`：各内核的 id 是
自己的标签，用 id 匹配会在"授予"这个方向上悄悄失效。适配器用 `command=["true"]` 构造，
权限决策不需要真的拉起内核进程。
"""

from __future__ import annotations

from typing import Any

from iota_core.adapters.dsh_acp import DshAcpAdapter

PERMISSION_METHOD = "session/request_permission"


def dsh_adapter(policy: str = "reject") -> DshAcpAdapter:
    return DshAcpAdapter(command=["true"], permission_policy=policy)


def permission_request(*kinds: str) -> dict[str, Any]:
    """一次权限请求：为每个 kind 提供一个可选项。"""
    return {
        "sessionId": "demo",
        "toolCall": {"toolCallId": "call-1"},
        "options": [{"optionId": f"{kind}-option", "kind": kind} for kind in kinds],
    }

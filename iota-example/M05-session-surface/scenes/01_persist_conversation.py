"""会话持久化：一轮真实对话按 user/assistant 顺序落在 ConversationStore 里。"""

from __future__ import annotations

from typing import Any

from impl.session_probe import run_one_turn

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    turn = await run_one_turn(harness, namespace="m05-conversation")
    roles = [message.role for message in turn.messages]
    require(roles == ["user", "assistant"], "会话按 user/assistant 顺序持久化", roles)
    return {"roles": roles, "messages": len(turn.messages)}

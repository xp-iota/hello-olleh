"""会话面的教学实现：用固定命名空间跑一轮，再从存储里把事实读回来。

每个场景都自己跑一轮真实对话：日志与运行记录只有在真的发生过一轮之后才存在，
共享一次运行会让"读回来的东西是这轮写进去的"这件事不再可验证。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from iota_core.types import Message

from runtime.harness import WorkshopHarness, require_not_none

PROMPT = "请只回复：会话已记录。"


@dataclass(frozen=True, slots=True)
class Turn:
    """一轮真实对话在会话面上留下的全部事实。"""

    run_id: str
    messages: list[Message]
    run_record: dict[str, Any]
    events: list[Any]


async def run_one_turn(harness: WorkshopHarness, *, namespace: str) -> Turn:
    agent = harness.agent(name=namespace, memory_namespace=namespace)
    result = await harness.runtime.run(agent, PROMPT)
    run_id = require_not_none(result.run_id, "运行生成 run_id")
    record = require_not_none(await harness.run_store.get_run(run_id), "RunStore 返回运行记录")
    return Turn(
        run_id=run_id,
        messages=list(await harness.conversation_store.get_messages(agent.memory_namespace)),
        run_record=record,
        events=list(await harness.run_store.get_events(run_id)),
    )

"""可换存储：ConversationStore 是协议，换一个实现照样读回写入的消息。"""

from __future__ import annotations

from typing import Any

from iota_core.storage.in_memory import InMemoryConversationStore
from iota_core.types import Message

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    protocol = sorted(
        name for name in dir(harness.conversation_store) if not name.startswith("_")
    )
    store = InMemoryConversationStore()
    await store.ensure_session("m05-swap", source="example")
    await store.append_message("m05-swap", Message(role="user", content="demo"))
    messages = await store.get_messages("m05-swap")
    require(messages[0].content == "demo", "换一个实现照样读回消息", messages)
    require("append_message" in protocol and "get_messages" in protocol, "协议方法一致", protocol)
    return {
        "protocol": protocol,
        "swapped_store": type(store).__name__,
        "messages": [message.content for message in messages],
    }

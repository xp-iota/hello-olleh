"""反馈边界：编排层没有消息反馈面，消息本身也不带反馈字段。"""

from __future__ import annotations

from typing import Any

from iota_core.registry import Registry
from iota_core.types import Message

from runtime.harness import WorkshopHarness, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    feedback_surface = sorted(name for name in vars(Registry()) if "feedback" in name)
    message_fields = sorted(Message.model_fields)
    faked = [name for name in message_fields if "feedback" in name or "rating" in name]
    require(feedback_surface == [], "编排层没有反馈注册面", feedback_surface)
    require(faked == [], "Message 不伪造反馈字段", faked)
    return {
        "feedback_surface": feedback_surface,
        "message_fields": message_fields,
        "feedback_owner": "host",
    }

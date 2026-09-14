"""M11: profile projection and swappable data protocols, not credentials."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from iota_core.config_profiles import ConfigProfileManager
from iota_core.errors import ConfigError
from iota_core.storage.in_memory import InMemoryConversationStore
from iota_core.types import AgentConfig, Message

from runtime.harness import WorkshopHarness, fail, require, require_not_none


async def run(_harness: WorkshopHarness) -> dict[str, Any]:
    with TemporaryDirectory(prefix="iota-m11-") as temp:
        root = Path(temp)
        source = root / "settings.json"
        source.write_text(json.dumps({"model": "offline"}), encoding="utf-8")
        profile = ConfigProfileManager(root / "profiles").prepare(
            adapter="claude",
            spec={"source": str(source), "target_dir": str(root / "projected")},
            kernel_name="claude-kernel",
            agent_name="m11",
        )
        config_file = require_not_none(profile.config_file, "profile 返回配置文件路径")
        require(Path(config_file).is_file(), "profile 配置文件真实存在", config_file)
        try:
            ConfigProfileManager(root / "profiles").prepare(
                adapter="dsh",
                spec={"source": str(source)},
                kernel_name="dsh-kernel",
            )
        except ConfigError as exc:
            refusal = str(exc)
        else:  # pragma: no cover
            fail("不支持 iota-managed layout 的 DSH profile 明确拒绝")

        store = InMemoryConversationStore()
        await store.ensure_session("m11", source="example")
        await store.append_message("m11", Message(role="user", content="offline"))
        messages = await store.get_messages("m11")
        require(messages[0].content == "offline", "可换存储返回已写消息", messages)
        require("attachment" not in AgentConfig.model_fields, "AgentConfig 不伪造 attachment 字段")
    return {
        "module": "M11",
        "status": "ok",
        "relationship": "语义等价 + 结构性边界",
        "profile": "projected",
        "storage": "memory",
        "dsh_profile_refusal": refusal,
        "credentials_attachments": "host-owned",
    }

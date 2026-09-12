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


async def run(_harness) -> dict[str, Any]:
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
        assert profile.config_file is not None and Path(profile.config_file).is_file()
        try:
            ConfigProfileManager(root / "profiles").prepare(
                adapter="dsh",
                spec={"source": str(source)},
                kernel_name="dsh-kernel",
            )
        except ConfigError as exc:
            refusal = str(exc)
        else:  # pragma: no cover
            raise AssertionError("dsh profile projection must fail loudly")

        store = InMemoryConversationStore()
        await store.ensure_session("m11", source="example")
        await store.append_message("m11", Message(role="user", content="offline"))
        messages = await store.get_messages("m11")
        assert messages[0].content == "offline"
        assert "attachment" not in AgentConfig.model_fields
    return {
        "module": "M11",
        "status": "ok",
        "alignment": "A+C",
        "profile": "projected",
        "storage": "memory",
        "dsh_profile_refusal": refusal,
        "credentials_attachments": "host-owned",
    }

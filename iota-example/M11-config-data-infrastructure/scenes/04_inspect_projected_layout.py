"""投影布局：profile 生成的是可检查的真实目录，内核进程读的就是它。"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from impl.profile_fixture import claude_spec, settings_source
from iota_core.config_profiles import ConfigProfileManager

from runtime.harness import WorkshopHarness, require, require_not_none


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    with TemporaryDirectory(prefix="iota-m11-") as temp:
        root = Path(temp)
        profile = ConfigProfileManager(root / "profiles").prepare(
            adapter="claude",
            spec=claude_spec(root, settings_source(root)),
            kernel_name="claude-kernel",
            agent_name="m11-layout",
        )
        config_file = Path(require_not_none(profile.config_file, "profile 返回配置文件路径"))
        projected = sorted(item.name for item in config_file.parent.iterdir())
        env_keys = sorted(profile.env) if getattr(profile, "env", None) else []
        require(config_file.is_file(), "配置文件真实存在", config_file.name)
        require(projected != [], "投影目录里有内容", projected)
    return {
        "config_file": config_file.name,
        "projected_entries": projected,
        "profile_env_keys": env_keys,
    }

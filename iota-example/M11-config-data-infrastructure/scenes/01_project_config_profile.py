"""配置投影：profile 生成一份真实存在的配置文件，供内核进程读取。"""

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
            agent_name="m11",
        )
        config_file = require_not_none(profile.config_file, "profile 返回配置文件路径")
        require(Path(config_file).is_file(), "profile 配置文件真实存在", config_file)
        name = Path(config_file).name
    return {"config_file": name, "projection": "real file"}

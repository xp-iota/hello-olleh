"""明确拒绝：不支持 iota-managed 布局的内核拿不到"被忽略的配置"，而是当场报错。"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from impl.profile_fixture import dsh_spec, settings_source
from iota_core.config_profiles import ConfigProfileManager
from iota_core.errors import ConfigError

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    with TemporaryDirectory(prefix="iota-m11-") as temp:
        root = Path(temp)
        try:
            ConfigProfileManager(root / "profiles").prepare(
                adapter="dsh",
                spec=dsh_spec(settings_source(root)),
                kernel_name="dsh-kernel",
            )
        except ConfigError as exc:
            refusal = str(exc)
        else:  # pragma: no cover
            fail("不支持 iota-managed layout 的 DSH profile 明确拒绝")
    require(bool(refusal), "拒绝信息非空", refusal)
    return {"dsh_profile_refusal": refusal}

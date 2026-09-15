"""事件 schema 边界：iota 的事件不承诺 DSH 的 seq/surface 不变量。"""

from __future__ import annotations

from typing import Any

from iota_core.types import FinalEvent, TextDeltaEvent

from runtime.harness import WorkshopHarness, require

#: DSH 会话日志的不变量字段；iota 的事件 schema 里不应出现同名承诺。
DSH_FIELDS = frozenset({"seq", "sequence", "surface"})


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    schemas = {
        "text_delta": set(TextDeltaEvent.model_fields),
        "final": set(FinalEvent.model_fields),
    }
    promised = sorted(
        f"{name}.{field}" for name, fields in schemas.items() for field in fields & DSH_FIELDS
    )
    require(promised == [], "事件 schema 不承诺 DSH sequence/surface 字段", promised)
    return {
        "checked_schemas": sorted(schemas),
        "dsh_fields_present": promised,
        "sequence_contract": "not part of the iota event schema",
    }

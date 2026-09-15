"""LIFO 与终局：后装的先拆，重复 dispose 不重复执行，已释放的栈拒绝新 effect。"""

from __future__ import annotations

from typing import Any

from iota_core.effects import EffectStack, EffectStackDisposedError

from runtime.harness import WorkshopHarness, fail, require


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    order: list[str] = []
    effects = EffectStack("m12-lifo")
    effects.push(lambda: order.append("inner"), "inner")
    effects.push(lambda: order.append("outer"), "outer")
    effects.dispose()
    effects.dispose()
    require(order == ["outer", "inner"], "EffectStack 按 LIFO 回收", order)
    try:
        effects.push(lambda: None, "late")
    except EffectStackDisposedError as exc:
        refusal = str(exc)
    else:  # pragma: no cover
        fail("已释放 EffectStack 拒绝新 effect")
    return {"lifo": order, "idempotent_dispose": effects.disposed, "inactive_refusal": refusal}

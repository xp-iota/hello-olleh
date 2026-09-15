"""专项真实演示：同一请求，注入格式约定前后的真实作答对照。

对位 DSH 的"注入 SKILL.md 前后对照"：DSH 那边是把 Skill 正文塞进下一步上下文；iota 这边
能控制的是系统提示这一份数据 —— 换的是数据，不是主循环，也不是模型。
"""

from __future__ import annotations

from typing import Any

from runtime.harness import WorkshopHarness, require, sample

#: 问题刻意与外部信息无关：两组唯一的差别是那份被注入的数据，而不是模型要不要去查资料。
QUESTION = "3 加 4 等于多少？"
VERDICT = "结论："
CONVENTION = f"回答必须以 {VERDICT} 开头，然后只写一句话。"


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    plain = await harness.runtime.run(harness.agent(name="m10-plain"), QUESTION)
    guided = await harness.runtime.run(
        harness.agent(name="m10-guided", system_prompt=CONVENTION), QUESTION
    )
    plain_text = (plain.final_text or "").strip()
    guided_text = (guided.final_text or "").strip()
    require(bool(plain_text), "A 组拿到真实回答", plain_text)
    require(bool(guided_text), "B 组拿到真实回答", guided_text)
    require(guided_text.startswith(VERDICT), "注入的数据改变了作答格式", guided_text)
    return {
        "without_convention": sample(plain_text, 60),
        "with_convention": sample(guided_text, 60),
        "changed_by": "data (system prompt), not the loop",
    }

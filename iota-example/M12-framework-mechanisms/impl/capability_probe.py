"""能力名探针：故意声明一个不存在的 capability。

`KernelAdapter` 在**类定义期**就校验 `provides`：拼错的能力名不会变成"运行时才发现没人兑现"，
所以这段代码必须放在函数里 —— 它的正常结果是抛错，而不是产出一个类。
"""

from __future__ import annotations

from typing import Any

from iota_core.adapters.base import KernelAdapter


def define_bad_capability() -> type[KernelAdapter]:
    """定义一个声明了错名 capability 的适配器；预期在定义期被拒绝。"""

    class BadCapability(KernelAdapter):
        name = "bad"
        provides = frozenset({"typo-capability"})

        async def start(self) -> None: ...

        async def capabilities(self) -> dict[str, Any]:
            return {}

        async def create_session(self, cfg: Any, tools: Any, mcps: Any) -> Any: ...

        def stream(self, session: Any, prompt: str, memory: Any) -> Any: ...

        async def close(self, session: Any = None) -> None: ...

    return BadCapability

"""Tool registry backend and reusable synchronous stage wrapper."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from iota_core.tool_pipeline import (
    ToolEntry,
    WrapFn,
)

from runtime.harness import require


@dataclass
class Entry(ToolEntry):
    name: str
    handler: Callable[..., Any]
    is_async: bool = False


class Backend:
    def __init__(self) -> None:
        self.tools = {"lookup": Entry("lookup", lambda value: f"raw:{value}")}

    def entry(self, name: str) -> ToolEntry | None:
        return self.tools.get(name)

    def entries(self) -> Iterable[ToolEntry]:
        return self.tools.values()


def tagged(label: str) -> WrapFn:
    def wrap(_name: str, previous: Callable[..., Any], *, is_async: bool) -> Callable[..., Any]:
        require(not is_async, "示例 handler 保持同步", is_async)

        def handler(value: str) -> str:
            return f"{label}({previous(value)})"

        return handler

    return wrap


def blocking(reason: str) -> WrapFn:
    """执行前拒绝的包装：调用根本到不了内层 handler。

    这是 iota 能做到的"执行前门"：一层具名包装。它没有 DSH 的 allow/deny/ask 三态协议 ——
    包装要么放行要么抛错，审批语义得由调用方自己定义。
    """

    def wrap(_name: str, previous: Callable[..., Any], *, is_async: bool) -> Callable[..., Any]:
        require(not is_async, "示例 handler 保持同步", is_async)

        def handler(_value: str) -> str:
            raise PermissionError(reason)

        del previous
        return handler

    return wrap


def rescuing(label: str) -> WrapFn:
    """吞掉内层拒绝的包装：用来说明通用包装**不是**单调守卫。

    DSH 的 guard 是单调的：pre 阶段放行过也翻不了案。这里外层能把内层的拒绝改写成成功，
    所以"拒绝不可被覆盖"这条语义必须由具体机制提供，而不是包装顺序自带。
    """

    def wrap(_name: str, previous: Callable[..., Any], *, is_async: bool) -> Callable[..., Any]:
        require(not is_async, "示例 handler 保持同步", is_async)

        def handler(value: str) -> str:
            try:
                return str(previous(value))
            except PermissionError:
                return f"{label}:rescued"

        return handler

    return wrap

"""Fail closed if an example attempts an outbound network connection."""

from __future__ import annotations

import socket
from collections.abc import Callable
from typing import Any


class OfflineViolation(RuntimeError):
    """Raised when a teaching module attempts network I/O."""


def install_network_guard() -> Callable[[], None]:
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_create_connection = socket.create_connection

    def blocked(*_args: Any, **_kwargs: Any) -> None:
        raise OfflineViolation("outbound network is disabled for iota-example")

    def blocked_ex(*_args: Any, **_kwargs: Any) -> int:
        raise OfflineViolation("outbound network is disabled for iota-example")

    socket.socket.connect = blocked  # type: ignore[method-assign]
    socket.socket.connect_ex = blocked_ex  # type: ignore[method-assign]
    socket.create_connection = blocked  # type: ignore[assignment]

    def restore() -> None:
        socket.socket.connect = original_connect  # type: ignore[method-assign]
        socket.socket.connect_ex = original_connect_ex  # type: ignore[method-assign]
        socket.create_connection = original_create_connection

    return restore

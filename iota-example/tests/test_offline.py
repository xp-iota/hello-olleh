"""The process-level network guard must fail before any connection is sent."""

from __future__ import annotations

import socket

import pytest

from runtime.network_guard import OfflineViolation, install_network_guard


def test_network_connect_is_blocked() -> None:
    restore = install_network_guard()
    try:
        sock = socket.socket()
        with pytest.raises(OfflineViolation, match="outbound network is disabled"):
            sock.connect(("192.0.2.1", 9))
        sock.close()
    finally:
        restore()

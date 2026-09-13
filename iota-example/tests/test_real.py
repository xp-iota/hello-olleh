"""Real-kernel assembly tests that never touch the network.

They pin the three properties that make ``--real`` trustworthy:
its configuration fails loud, it never falls back to echo, and its evidence carries no secret.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import pytest

from runtime.env import load_project_env
from runtime.harness import PROVIDERS, create_harness, selected_provider
from runtime.kernel_minimax import (
    FORWARDED,
    KernelUnavailable,
    MinimaxSettings,
    minimax_settings,
)


@contextmanager
def without_credentials() -> Iterator[None]:
    load_project_env()  # make sure the loader will not re-populate what we remove
    saved = {name: os.environ.pop(name, None) for name in FORWARDED}
    try:
        yield
    finally:
        for name, value in saved.items():
            if value is not None:
                os.environ[name] = value


def test_provider_selection_is_explicit() -> None:
    assert PROVIDERS == ("echo", "minimax")
    assert selected_provider("echo") == "echo"
    assert selected_provider("minimax") == "minimax"
    with pytest.raises(KernelUnavailable, match="未知 IOTA_PROVIDER"):
        selected_provider("gpt-please")


def test_missing_credentials_fail_loud_with_config_source() -> None:
    with without_credentials(), pytest.raises(KernelUnavailable) as excinfo:
        minimax_settings()
    message = str(excinfo.value)
    assert "ANTHROPIC_AUTH_TOKEN" in message
    assert ".env" in message
    assert "不会退回 EchoKernelAdapter" in message


async def test_real_provider_never_falls_back_to_echo() -> None:
    with without_credentials(), pytest.raises(KernelUnavailable):
        await create_harness("minimax")


def test_only_three_variables_reach_the_kernel() -> None:
    settings = MinimaxSettings(
        token="sk-secret-token", base_url="https://example.invalid", model="M"
    )
    env = settings.kernel_env()
    assert env["ANTHROPIC_AUTH_TOKEN"] == "sk-secret-token"
    assert env["ANTHROPIC_BASE_URL"] == "https://example.invalid"
    assert env["ANTHROPIC_MODEL"] == "M"
    # Every tier is pinned so the kernel cannot silently pick a bundled default model.
    assert {value for key, value in env.items() if key.startswith("ANTHROPIC_DEFAULT")} == {"M"}
    assert "sk-secret-token" not in settings.redacted()
    assert "example.invalid" not in settings.redacted()


def test_offline_harness_needs_no_credentials() -> None:
    async def run() -> str:
        with without_credentials():
            harness = await create_harness("echo")
            try:
                return harness.kernel
            finally:
                await harness.close()

    import asyncio

    assert asyncio.run(run()) == "echo"

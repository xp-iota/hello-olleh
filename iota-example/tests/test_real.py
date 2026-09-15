"""Real-kernel assembly tests that never touch the network.

They pin the properties that make a run trustworthy: its configuration fails loud, the kernel
is always the Anthropic-compatible one, and its evidence carries no secret.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from runtime.harness import (
    CONFIG_VARIABLES,
    PROVIDERS,
    AnthropicCompatSettings,
    KernelUnavailable,
    anthropic_compat_settings,
    create_harness,
    load_project_env,
    resolve_anthropic_compat_vendor,
    selected_provider,
)


@contextmanager
def without_credentials() -> Iterator[None]:
    load_project_env()  # make sure the loader will not re-populate what we remove
    saved = {name: os.environ.pop(name, None) for name in CONFIG_VARIABLES}
    try:
        yield
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def test_provider_selection_is_explicit() -> None:
    assert PROVIDERS == ("anthropic-compat",)
    assert selected_provider("anthropic-compat") == "anthropic-compat"
    assert selected_provider() == "anthropic-compat"
    with pytest.raises(KernelUnavailable, match="未知 IOTA_PROVIDER"):
        selected_provider("gpt-please")


def test_missing_credentials_fail_loud_with_config_source() -> None:
    with without_credentials(), pytest.raises(KernelUnavailable) as excinfo:
        anthropic_compat_settings()
    message = str(excinfo.value)
    assert "LLM_API_KEY" in message
    assert ".env" in message
    assert "没有任何替代" in message or "没有配置就没有内核" in message


async def test_assembly_without_a_kernel_raises() -> None:
    with without_credentials(), pytest.raises(KernelUnavailable):
        await create_harness()


def test_expected_anthropic_variables_reach_the_kernel() -> None:
    settings = AnthropicCompatSettings(
        token="sk-secret-token",
        base_url="https://example.invalid",
        model="M",
        vendor="minimax",
    )
    env = settings.kernel_env()
    assert env["ANTHROPIC_AUTH_TOKEN"] == "sk-secret-token"
    assert env["ANTHROPIC_BASE_URL"] == "https://example.invalid"
    assert env["ANTHROPIC_MODEL"] == "M"
    # Every tier is pinned so the kernel cannot silently pick a bundled default model.
    assert {value for key, value in env.items() if key.startswith("ANTHROPIC_DEFAULT")} == {"M"}
    assert "sk-secret-token" not in settings.redacted()
    assert "example.invalid" not in settings.redacted()


def test_vendor_resolution_is_explicit_or_inferred() -> None:
    assert resolve_anthropic_compat_vendor("minimax") == "minimax"
    assert resolve_anthropic_compat_vendor("FUYAO") == "fuyao"
    assert resolve_anthropic_compat_vendor(None, model="fuyao-coding") == "fuyao"
    assert (
        resolve_anthropic_compat_vendor(
            None, base_url="http://fuyao-ai-gateway.xiaopeng.link"
        )
        == "fuyao"
    )
    assert resolve_anthropic_compat_vendor(None, model="MiniMax-M3") == "minimax"
    with pytest.raises(KernelUnavailable, match="只支持 minimax / fuyao"):
        resolve_anthropic_compat_vendor("unknown")


def test_canonical_llm_configuration_supports_fuyao(monkeypatch: pytest.MonkeyPatch) -> None:
    with without_credentials():
        monkeypatch.setenv("LLM_API_KEY", "redacted")
        monkeypatch.setenv("LLM_BASE_URL", "http://fuyao-ai-gateway.xiaopeng.link")
        monkeypatch.setenv("LLM_MODEL", "fuyao-coding")
        settings = anthropic_compat_settings()
    assert settings.vendor == "fuyao"
    assert settings.model == "fuyao-coding"


def test_fuyao_disables_unsigned_thinking_but_minimax_keeps_default() -> None:
    fuyao = AnthropicCompatSettings(
        token="redacted",
        base_url="https://fixture.invalid",
        model="fuyao-coding",
        vendor="fuyao",
    ).kernel_env()
    assert fuyao["CLAUDE_CODE_DISABLE_THINKING"] == "1"
    assert fuyao["CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING"] == "1"
    assert fuyao["DISABLE_INTERLEAVED_THINKING"] == "1"

    minimax = AnthropicCompatSettings(
        token="redacted",
        base_url="https://fixture.invalid",
        model="MiniMax-M3",
        vendor="minimax",
    ).kernel_env()
    assert "CLAUDE_CODE_DISABLE_THINKING" not in minimax


def test_build_adapter_passes_fuyao_thinking_guards(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import iota_core.adapters.claude as claude_module

    import runtime.harness as harness_module

    settings = AnthropicCompatSettings(
        token="redacted",
        base_url="https://fixture.invalid",
        model="fuyao-coding",
        vendor="fuyao",
    )
    captured: dict[str, object] = {}

    class FakeClaudeAdapter:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(harness_module, "anthropic_compat_settings", lambda: settings)
    monkeypatch.setattr(harness_module, "preflight", lambda: {})
    monkeypatch.setattr(harness_module, "resolve_cli", lambda: "claude")
    monkeypatch.setattr(claude_module, "ClaudeAdapter", FakeClaudeAdapter)

    adapter = harness_module.build_adapter(workspace=tmp_path)
    assert isinstance(adapter, FakeClaudeAdapter)
    assert captured["thinking"] is False
    env = captured["env"]
    assert isinstance(env, dict)
    assert env["CLAUDE_CODE_DISABLE_THINKING"] == "1"
    assert env["CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING"] == "1"
    assert env["DISABLE_INTERLEAVED_THINKING"] == "1"


def test_unknown_provider_is_rejected_before_assembly() -> None:
    with pytest.raises(KernelUnavailable, match="没有可切换的本地替代实现"):
        selected_provider("echo")

"""Assemble a real MiniMax-backed kernel out of the existing ClaudeAdapter.

iota replaces *whole kernels*, not model calls, so "run on MiniMax" means: keep
``iota_core.adapters.claude.ClaudeAdapter`` as the kernel and point the Claude Code CLI it
drives at MiniMax's Anthropic-compatible endpoint. Nothing about the orchestration layer is
model-specific; only three environment variables travel into the kernel subprocess.

Everything here fails loud. A missing token, a missing ``claude-agent-sdk`` or a missing CLI
binary raises :class:`KernelUnavailable` with the exact remedy, because the one failure mode a
teaching project must never have is a "real" run that quietly degrades to the echo kernel.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from runtime.env import load_project_env

#: Only these variables are forwarded to the kernel subprocess.
FORWARDED = ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL")

CONFIG_SOURCE = "iota-example/.env（已被 .gitignore 忽略；键名见下方提示）"


class KernelUnavailable(RuntimeError):
    """Raised when the real kernel cannot be assembled, with the fix in the message."""


@dataclass(frozen=True, slots=True)
class MinimaxSettings:
    """The three values that turn a Claude kernel into a MiniMax-backed kernel."""

    token: str
    base_url: str
    model: str

    def kernel_env(self) -> dict[str, str]:
        return {
            "ANTHROPIC_BASE_URL": self.base_url,
            "ANTHROPIC_AUTH_TOKEN": self.token,
            "ANTHROPIC_MODEL": self.model,
            # The kernel must not fall back to a bundled default model on any tier.
            "ANTHROPIC_DEFAULT_SONNET_MODEL": self.model,
            "ANTHROPIC_DEFAULT_OPUS_MODEL": self.model,
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": self.model,
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }

    def redacted(self) -> str:
        return f"model={self.model} endpoint=<anthropic-compatible> token=<redacted>"


def minimax_settings() -> MinimaxSettings:
    """Read and validate the real-kernel configuration."""
    load_project_env()
    token = os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip()
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip()
    model = os.environ.get("ANTHROPIC_MODEL", "").strip()
    missing = [
        name
        for name, value in (
            ("ANTHROPIC_AUTH_TOKEN", token),
            ("ANTHROPIC_BASE_URL", base_url),
            ("ANTHROPIC_MODEL", model),
        )
        if not value
    ]
    if missing:
        raise KernelUnavailable(
            "真实模式缺少配置：" + ", ".join(missing) + "。\n"
            f"  配置来源：{CONFIG_SOURCE}\n"
            "  需要三项：ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL\n"
            "  真实模式不会退回 EchoKernelAdapter —— 离线机制演示请显式用 IOTA_PROVIDER=echo。"
        )
    return MinimaxSettings(token=token, base_url=base_url, model=model)


def resolve_cli() -> str | None:
    """Locate the Claude Code CLI the SDK will drive (``None`` = let the SDK resolve it)."""
    explicit = os.environ.get("CLAUDE_CLI_PATH", "").strip()
    if explicit:
        if not Path(explicit).is_file():
            raise KernelUnavailable(f"CLAUDE_CLI_PATH 指向的文件不存在：{explicit}")
        return explicit
    return shutil.which("claude")


def preflight() -> dict[str, str]:
    """Check every prerequisite **before** a module starts, and report what was found."""
    settings = minimax_settings()
    if importlib.util.find_spec("claude_agent_sdk") is None:
        raise KernelUnavailable(
            "缺少 claude-agent-sdk（真实内核的运行依赖）。\n"
            "  安装：iota-example/.venv/bin/python -m pip install 'claude-agent-sdk>=0.2,<1'\n"
            "  或声明式安装：uv sync --extra real"
        )
    cli = resolve_cli()
    if cli is None:
        raise KernelUnavailable(
            "找不到 Claude Code CLI。claude-agent-sdk 靠它驱动内核进程。\n"
            "  安装后确保 `claude` 在 PATH 上，或设置 CLAUDE_CLI_PATH=<binary>。"
        )
    return {
        "kernel": "claude",
        "model": settings.model,
        "sdk": "claude-agent-sdk",
        "cli": Path(cli).name,
    }


def create_workspace() -> Path:
    """A throwaway directory for the kernel process; nothing outside it is reachable."""
    return Path(tempfile.mkdtemp(prefix="iota-real-"))


def build_adapter(
    *, allow_shell: bool = False, timeout: float = 180.0, workspace: Path | None = None
) -> Any:
    """Build the MiniMax-backed ClaudeAdapter.

    ``allow_shell`` is off by default: most modules only need text, so the kernel starts with
    an empty tool list and cannot touch the filesystem. M07 turns it on because its whole
    point is that the *kernel* owns shell execution.
    """
    from iota_core.adapters.claude import ClaudeAdapter

    settings = minimax_settings()
    preflight()
    root = workspace or create_workspace()
    return ClaudeAdapter(
        model=settings.model,
        env=settings.kernel_env(),
        cwd=str(root),
        cli_path=resolve_cli(),
        allowed_tools=["Bash"] if allow_shell else [],
        disallowed_tools=[] if allow_shell else ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permission_mode="bypassPermissions" if allow_shell else "default",
        max_turns=4,
        timeout=timeout,
        setting_sources=[],
    )

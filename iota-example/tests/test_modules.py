"""Every module must be independently executable against the real kernel.

There is no offline mode to fall back on, so the module gate asserts the *assembly discipline*
instead: with the kernel unavailable, a module must fail loudly (non-zero, naming what is
missing) rather than produce a green run out of something local. The cheapest way to make the
kernel genuinely unavailable is to strip ``PATH`` — the Claude Code CLI the SDK drives cannot
be resolved, and no credential in ``.env`` can substitute for it.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULES = sorted(path for path in ROOT.glob("M[0-9][0-9]-*") if path.is_dir())


def _env_without_a_kernel() -> dict[str, str]:
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env.pop("CLAUDE_CLI_PATH", None)
    env["PATH"] = ""
    env["IOTA_PROVIDER"] = "anthropic-compat"
    return env


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
def test_module_fails_loud_without_a_kernel(module: Path) -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "runtime.runner", module.name],
        cwd=ROOT,
        env=_env_without_a_kernel(),
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert completed.returncode != 0, completed.stdout
    assert "找不到 Claude Code CLI" in completed.stderr
    assert "IOTA_REAL_MODULE_OK" not in completed.stdout


def test_unknown_provider_fails_before_any_module_runs() -> None:
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["IOTA_PROVIDER"] = "echo"
    completed = subprocess.run(
        [sys.executable, "-m", "runtime.runner", "M01"],
        cwd=ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert completed.returncode != 0
    assert "未知 IOTA_PROVIDER" in completed.stderr


def test_exactly_twelve_modules_match_dsh_names() -> None:
    dsh_root = ROOT.parent / "dsh-example"
    dsh_names = sorted(path.name for path in dsh_root.glob("M[0-9][0-9]-*") if path.is_dir())
    assert len(MODULES) == 12
    assert [path.name for path in MODULES] == dsh_names

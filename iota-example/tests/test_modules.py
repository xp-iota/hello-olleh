"""Every module must be independently executable against the real kernel.

There is no offline mode to fall back on, so the module gate asserts the *assembly discipline*
instead: with the kernel unavailable, a module must fail loudly (non-zero, naming what is
missing) rather than produce a green run out of something local.

"Unavailable" is kernel-specific, because the two adapters fail for different reasons:
``claude`` drives an external CLI, so stripping ``PATH`` makes it unresolvable; ``hermes_direct``
runs in-process and reads its endpoint from the environment, so the equivalent is withholding
the credential. Asserting only the claude recipe would let a Hermes run quietly reach a real
endpoint in CI — the opposite of what this gate is for.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULES = sorted(path for path in ROOT.glob("M[0-9][0-9]-*") if path.is_dir())

#: 每个内核"不可用"的制造方式与对应报错文案。
KERNEL_OUTAGES = {
    "claude": "找不到 Claude Code CLI",
    "hermes_direct": "运行缺少配置",
}


def _env_without_a_kernel(kernel: str) -> dict[str, str]:
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env.pop("CLAUDE_CLI_PATH", None)
    env["IOTA_KERNEL"] = kernel
    env["IOTA_PROVIDER"] = "anthropic-compat"
    if kernel == "claude":
        # CLI 由 PATH 解析；空 PATH 让它无法解析，凭证无法替代。
        env["PATH"] = ""
    else:
        # Hermes 在进程内调用，只认环境里的端点与凭证 —— 两个都清掉。
        for name in ("LLM_API_KEY", "HERMES_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
            env.pop(name, None)
        env["LLM_API_KEY"] = ""
        env["HERMES_API_KEY"] = ""
    return env


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
@pytest.mark.parametrize("kernel", sorted(KERNEL_OUTAGES))
def test_module_fails_loud_without_a_kernel(module: Path, kernel: str) -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "runtime.runner", module.name],
        cwd=ROOT,
        env=_env_without_a_kernel(kernel),
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert completed.returncode != 0, completed.stdout
    assert KERNEL_OUTAGES[kernel] in completed.stderr, completed.stderr
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

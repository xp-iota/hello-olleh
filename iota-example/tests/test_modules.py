"""Every teaching module must be independently executable and offline."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULES = sorted(path for path in ROOT.glob("M[0-9][0-9]-*") if path.is_dir())


@pytest.mark.parametrize("module", MODULES, ids=lambda path: path.name)
def test_module_exits_zero(module: Path) -> None:
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    completed = subprocess.run(
        [sys.executable, "-m", "runtime.runner", module.name],
        cwd=ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert completed.returncode == 0, completed.stderr
    assert f"IOTA_MODULE_OK {module.name}" in completed.stdout
    assert '"status": "ok"' in completed.stdout
    assert "学习目标：" in completed.stdout
    assert "运行时观察：" in completed.stdout
    assert "结论：" in completed.stdout


def test_exactly_twelve_modules_match_dsh_names() -> None:
    dsh_root = ROOT.parent / "dsh-example"
    dsh_names = sorted(path.name for path in dsh_root.glob("M[0-9][0-9]-*") if path.is_dir())
    assert len(MODULES) == 12
    assert [path.name for path in MODULES] == dsh_names

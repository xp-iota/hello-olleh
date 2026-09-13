"""Run M01-M12 as twelve isolated offline Python processes."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    modules = sorted(root.glob("M[0-9][0-9]-*"))
    if len(modules) != 12:
        raise RuntimeError(f"expected 12 modules, found {len(modules)}")
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    for module in modules:
        completed = subprocess.run(
            [sys.executable, "-m", "runtime.runner", module.name],
            cwd=root,
            env=env,
            check=False,
            text=True,
        )
        if completed.returncode != 0:
            return completed.returncode
    print("IOTA_ALL_OK modules=12 network=blocked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

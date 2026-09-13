"""Run M01-M12 as twelve isolated processes, offline by default.

``--real`` switches every module to the MiniMax-backed kernel. Either way each module runs in
its own process, so one module cannot leak registrations or event-loop state into the next,
and any non-zero exit stops the whole run.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="依次运行 12 个 iota 教学模块")
    parser.add_argument(
        "--real",
        action="store_true",
        help="全部改用 MiniMax-backed kernel（等价于 IOTA_PROVIDER=minimax）",
    )
    args = parser.parse_args()

    from runtime.harness import REAL_PROVIDER, selected_provider

    # 与 runner 用同一条解析规则：--real 或 IOTA_PROVIDER=minimax；拼错的值当场失败。
    real = args.real or selected_provider() == REAL_PROVIDER
    root = Path(__file__).resolve().parents[1]
    modules = sorted(root.glob("M[0-9][0-9]-*"))
    if len(modules) != 12:
        raise RuntimeError(f"expected 12 modules, found {len(modules)}")
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    if real:
        env["IOTA_PROVIDER"] = REAL_PROVIDER

    if real:
        # Fail before spending time on twelve subprocesses.
        from runtime.kernel_minimax import preflight

        report = preflight()
        print(
            "IOTA_REAL_PREFLIGHT_OK "
            f"kernel={report['kernel']} model={report['model']}"
            f" sdk={report['sdk']} cli={report['cli']}"
        )

    for module in modules:
        command = [sys.executable, "-m", "runtime.runner", module.name]
        if real:
            command.append("--real")
        completed = subprocess.run(command, cwd=root, env=env, check=False, text=True)
        if completed.returncode != 0:
            return completed.returncode

    if real:
        print("IOTA_REAL_ALL_OK modules=12 kernel=claude provider=minimax")
    else:
        print("IOTA_ALL_OK modules=12 network=blocked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

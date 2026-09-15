"""M07 的运行入口：阶段清单。

编号与 `dsh-example/M07-execution-backends/run.ts` 对位：DSH 有 fs/subprocess/shell/sandbox
四层可换后端；iota 这边一层都不拥有，执行归内核，编排层只转发并观察事件。

    python -m runtime.runner M07
    python M07-execution-backends/run.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# 三种入口都要能找到工程根的 runtime/：按路径直接运行（`python <模块>/run.py`）时
# sys.path[0] 是模块目录，工程根不在里面；`python -m ...` 的两种形式则已经有了。
_ROOT = str(Path(__file__).resolve().parents[1])
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from runtime.runner import Stage, module_main

STAGES = (
    Stage("M07.1", "内核执行副作用", "model", "01_kernel_runs_bash", shell=True),
    Stage("M07.2", "消费工具结果与执行证据", "model", "02_kernel_reports_tool_results", shell=True),
    Stage("M07.3", "沙箱策略是内核侧配置", "mechanism", "03_sandbox_is_kernel_owned"),
    Stage("M07.4", "编排层不注册 shell 工具", "mechanism", "04_empty_shell_registry"),
    Stage("M07.5", "工作目录是唯一输入通道", "mechanism", "05_workspace_is_the_only_input"),
)


if __name__ == "__main__":
    module_main(__file__)

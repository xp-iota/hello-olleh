"""M06 的运行入口：阶段清单。

编号与 `dsh-example/M06-human-in-the-loop/run.ts` 对位：DSH 把命令、审批、问题、计划模式、
todo 与反馈都做成显式协议；iota 这边只拥有权限决策，其余归内核或宿主。

    python -m runtime.runner M06
    python M06-human-in-the-loop/run.py
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
    Stage("M06.1", "斜杠命令由内核自己解析", "mechanism", "01_commands_are_kernel_owned"),
    Stage("M06.2", "权限请求必定得到答复", "mechanism", "02_answer_with_configured_policy"),
    Stage("M06.3", "无匹配选项时 fail closed", "mechanism", "03_fail_closed_without_option"),
    Stage("M06.4", "计划模式归内核或宿主", "mechanism", "04_plan_mode_is_host_owned"),
    Stage("M06.5", "todo/kanban 按能力声明归属", "mechanism", "05_kanban_is_declared_capability"),
    Stage("M06.6", "消息反馈不在编排层", "mechanism", "06_no_message_feedback_seam"),
)


if __name__ == "__main__":
    module_main(__file__)

"""M04 的运行入口：阶段清单。

编号与 `dsh-example/M04-agent-loop-intervention/run.ts` 对位：DSH 的干预面是事件、
steering 与 inbox；iota 这边能干预的是节点边界，进行中的一轮属于内核。

    python -m runtime.runner M04
    python M04-agent-loop-intervention/run.py
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
    Stage("M04.1", "观察一轮的标准事件顺序", "model", "01_observe_event_order"),
    Stage("M04.2", "生命周期边界上没有 steering 入口", "model", "02_no_mid_turn_steering"),
    Stage("M04.3", "节点 hook 是唯一干预通道", "mechanism", "03_hook_node_result"),
    Stage("M04.4", "捕获运行遥测账本", "mechanism", "04_capture_run_telemetry"),
    Stage("M04.5", "未注册引用在编译期被拒", "mechanism", "05_compile_rejects_unknown_reference"),
)


if __name__ == "__main__":
    module_main(__file__)

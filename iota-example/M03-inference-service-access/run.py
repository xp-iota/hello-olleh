"""M03 的运行入口：阶段清单。

编号与 `dsh-example/M03-inference-service-access/run.ts` 逐一对齐：那边把流中间件演示
记为 M03.1、专项真实演示记为 M03.d（离线 Adapter 阶段已删除），这里同一编号指向同一个
控制面 —— iota 侧用"引用内核不支持的模型 middleware 在编译期被拒绝"来对位。

    python -m runtime.runner M03
    python M03-inference-service-access/run.py
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
    Stage("M03.1", "包装单次模型调用被编译期拒绝", "mechanism", "01_reject_model_middleware"),
    Stage("M03.d", "专项真实演示：同一事件消费循环接真实内核", "model", "02_consume_kernel_stream"),
)


if __name__ == "__main__":
    module_main(__file__)

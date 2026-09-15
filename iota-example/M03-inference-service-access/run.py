"""M03 的运行入口：阶段清单。

编号刻意与 `dsh-example/M03-inference-service-access/run.ts` 一致 —— 那边删掉了离线
Adapter 阶段，只剩 M03.2 与专项演示，所以这里也没有 M03.1。

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
    Stage("M03.2", "包装单次模型调用被编译期拒绝", "mechanism", "02_reject_model_middleware"),
    Stage("M03.d", "专项真实演示：同一事件消费循环接真实内核", "model", "03_consume_kernel_stream"),
)


if __name__ == "__main__":
    module_main(__file__)

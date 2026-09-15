"""M09 的运行入口：阶段清单。

编号与 `dsh-example/M09-long-running-orchestration/run.ts` 对位：DSH 用 Job/Goal/workflow/
schedule 表达长任务；iota 用带租约与 checkpoint 的任务队列，worker 由调用方驱动。

    python -m runtime.runner M09
    python M09-long-running-orchestration/run.py
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
    Stage("M09.1", "入队、认领与确认", "mechanism", "01_claim_and_ack"),
    Stage("M09.2", "幂等键推进任务生命周期", "mechanism", "02_enqueue_idempotently"),
    Stage("M09.3", "worker 由调用方驱动", "mechanism", "03_worker_is_caller_driven"),
    Stage("M09.4", "checkpoint 记录恢复序列", "mechanism", "04_save_checkpoint"),
)


if __name__ == "__main__":
    module_main(__file__)

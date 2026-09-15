"""M02 的运行入口：阶段清单。

阶段编号与 `dsh-example/M02-context-assembly-economics/run.ts` 对位：DSH 把 Prompt 装配、
压缩、计量、裁剪与 spill 连成一条治理链；iota 这边能组织作用域记忆，其余环节归内核。

    python -m runtime.runner M02
    python M02-context-assembly-economics/run.py
    python -m M02-context-assembly-economics.run --scene 01_recall_scoped_memory
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
    Stage("M02.1", "按作用域贡献 Prompt 前缀", "mechanism", "01_recall_scoped_memory"),
    Stage("M02.2", "装配改写属于内核", "mechanism", "02_no_prompt_assembly_seam"),
    Stage("M02.3", "压缩历史属于内核", "mechanism", "03_no_compression_seam"),
    Stage("M02.4", "从真实运行读 token 用量", "model", "04_measure_token_usage"),
    Stage("M02.5", "历史开关而不是结果裁剪", "mechanism", "05_history_switch_not_pruner"),
    Stage("M02.6", "作用域记忆写回代替 spill", "mechanism", "06_persist_memory_writeback"),
)


if __name__ == "__main__":
    module_main(__file__)

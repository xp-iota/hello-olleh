"""M05 的运行入口：阶段清单。

编号与 `dsh-example/M05-session-surface/run.ts` 对位：DSH 分事实日志与模型 surface；
iota 这边是 ConversationStore + RunStore，两者都可换，但不承诺 DSH 的 seq/surface 语义。

    python -m runtime.runner M05
    python M05-session-surface/run.py
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
    Stage("M05.1", "一轮真实对话按序持久化", "model", "01_persist_conversation"),
    Stage("M05.2", "装载可换的消息存储", "mechanism", "02_swap_conversation_store"),
    Stage("M05.3", "查询会话语料", "mechanism", "03_search_conversation_messages"),
    Stage("M05.4", "运行记录可读回", "model", "04_read_run_record"),
    Stage("M05.5", "事件 schema 不承诺 seq/surface", "mechanism", "05_no_sequence_contract"),
)


if __name__ == "__main__":
    module_main(__file__)

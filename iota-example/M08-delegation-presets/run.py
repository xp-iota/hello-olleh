"""M08 的运行入口：阶段清单。

编号与 `dsh-example/M08-delegation-presets/run.ts` 对位：DSH 用 subagent Provider 与
preset 表达委派；iota 用显式 DAG，roster 与模型路由都必须写出来。

    python -m runtime.runner M08
    python M08-delegation-presets/run.py
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
    Stage("M08.1", "注册委派节点并编译顺序", "mechanism", "01_compile_topological_order"),
    Stage("M08.2", "不扫描用户目录的空 roster", "mechanism", "02_agent_specs_are_explicit"),
    Stage("M08.3", "委派图运行与上游绑定", "mechanism", "03_run_delegation_graph"),
    Stage("M08.4", "具名模型路由", "mechanism", "04_route_node_model"),
)


if __name__ == "__main__":
    module_main(__file__)

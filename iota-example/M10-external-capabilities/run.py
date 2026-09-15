"""M10 的运行入口：阶段清单。

编号与 `dsh-example/M10-external-capabilities/run.ts` 对位：DSH 有 Skill、MCP、Webhook 与
动态 Cordis 扩展；iota 这边 Skill 是文件投影、MCP 是协议、Host plane 归宿主。

    python -m runtime.runner M10
    python M10-external-capabilities/run.py
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
    Stage("M10.1", "同步文件系统 Skill", "mechanism", "01_sync_filesystem_skill"),
    Stage("M10.2", "进程内 MCP 往返", "mechanism", "02_mcp_round_trip"),
    Stage("M10.3", "Host plane 不在编排层", "mechanism", "03_host_plane_is_not_orchestrated"),
    Stage("M10.4", "运行时装配工具并回收", "mechanism", "04_register_tool_at_runtime"),
    Stage("M10.5", "默认模型路由", "mechanism", "05_default_model_routing"),
    Stage(
        "M10.d",
        "专项真实演示：同一请求在注入格式约定前后的真实作答",
        "model",
        "06_prompt_changes_answer",
    ),
)


if __name__ == "__main__":
    module_main(__file__)

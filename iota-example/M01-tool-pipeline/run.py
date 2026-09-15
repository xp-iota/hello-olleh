"""M01 的运行入口：阶段清单。

阶段编号与 `dsh-example/M01-tool-pipeline/run.ts` 一一对位：同一个控制面，看 iota 这边
是"有等价机制"还是"能力归内核"。编排、证据与输出由 `runtime/runner.py` 驱动。

    python -m runtime.runner M01
    python M01-tool-pipeline/run.py
    python -m M01-tool-pipeline.run --scene 03_transform_after_execute
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
    Stage("M01.1", "注册包装与 effect 回收", "mechanism", "01_register_and_dispose"),
    Stage("M01.2", "pre-execute 权限门", "mechanism", "02_deny_before_execute"),
    Stage("M01.3", "post-execute 结果变换", "mechanism", "03_transform_after_execute"),
    Stage("M01.4", "按 Agent 收紧可见工具", "mechanism", "04_no_per_agent_visibility"),
    Stage("M01.5", "单调守卫：只能拒绝，不能放行", "mechanism", "05_stages_are_not_monotonic"),
    Stage(
        "M01.d",
        "专项真实演示：内核自主决定调用工具",
        "model",
        "06_kernel_chooses_tool",
        shell=True,
    ),
)


if __name__ == "__main__":
    module_main(__file__)

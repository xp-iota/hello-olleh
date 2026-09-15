"""M12 的运行入口：阶段清单。

编号与 `dsh-example/M12-framework-mechanisms/run.ts` 对位：DSH 展示 Cordis 的派发模式、
Fiber 状态机与 realm 隔离；iota 只借可逆 effect 与注册表，不搬那套架构。

    python -m runtime.runner M12
    python M12-framework-mechanisms/run.py
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
    Stage("M12.1", "effect 按 LIFO 拆除且拒绝复活", "mechanism", "01_dispose_lifo"),
    Stage("M12.2", "跨真实运行的 Provider 注册与回收", "model", "02_dispose_provider_after_run"),
    Stage("M12.3", "错名 capability 定义期拒绝", "mechanism", "03_reject_unknown_capability"),
    Stage("M12.4", "同名注册的身份隔离", "mechanism", "04_identity_safe_disposer"),
    Stage("M12.5", "配置按层叠加", "mechanism", "05_layer_agent_config"),
)


if __name__ == "__main__":
    module_main(__file__)

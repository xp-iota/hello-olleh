"""M11 的运行入口：阶段清单。

编号与 `dsh-example/M11-config-data-infrastructure/run.ts` 对位：DSH 有 settings、storage、
attachment、file-reference、credential、workspace 六层；iota 这边只治理配置投影与存储协议。

    python -m runtime.runner M11
    python M11-config-data-infrastructure/run.py
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
    Stage("M11.1", "配置投影成真实文件", "mechanism", "01_project_config_profile"),
    Stage("M11.2", "运行存储按协议读写", "mechanism", "02_route_run_store"),
    Stage("M11.3", "凭证与附件归宿主", "mechanism", "03_credentials_are_host_owned"),
    Stage("M11.4", "投影目录布局可检查", "mechanism", "04_inspect_projected_layout"),
    Stage("M11.5", "凭证只来自环境配置", "mechanism", "05_credentials_come_from_env"),
    Stage("M11.6", "不支持的布局明确拒绝", "mechanism", "06_reject_unsupported_layout"),
)


if __name__ == "__main__":
    module_main(__file__)

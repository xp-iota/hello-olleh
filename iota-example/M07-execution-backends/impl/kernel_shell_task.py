"""让内核真的执行一次命令的任务素材。

边界本身就是这节课：iota 只转发提示词，副作用由**内核**完成并以工具事件回传。任务被设计成
无法凭猜测完成 —— token 是本次运行才生成的，只有真的执行过一次命令才读得到，所以"执行归内核"
不是一句断言，而是一条证据。
"""

from __future__ import annotations

import uuid
from pathlib import Path

from iota_core.types import AgentEvent

from runtime.harness import WorkshopHarness, require_not_none

PROOF_FILE = "kernel-proof.txt"


def task_prompt() -> str:
    return (
        f"当前目录下有一个 {PROOF_FILE}。请用 Bash 工具读出它的内容，"
        "然后只回复文件里那一行，不要解释、不要加引号。"
    )


def plant_token(workspace: Path) -> str:
    """在内核工作目录里放一个本次运行独有的 token。"""
    token = f"kernel-shell-{uuid.uuid4().hex[:10]}"
    (workspace / PROOF_FILE).write_text(f"{token}\n", encoding="utf-8")
    return token


async def run_shell_task(harness: WorkshopHarness) -> tuple[str, list[AgentEvent]]:
    """放 token → 让内核去读 → 返回 token 与这轮的事件。"""
    workspace = require_not_none(harness.workspace, "内核有自己的工作目录")
    token = plant_token(workspace)
    return token, await harness.stream(task_prompt())

"""长任务素材：同一条 GraphTask 请求，可以被重复提交。

耐久语义靠**数据形状**表达：task_id 是幂等键，`max_attempts` 是重试预算，租约由队列发放 ——
这些都不在单次运行内部，所以它们不属于内核。
"""

from __future__ import annotations

from iota_core.graph import GraphRef
from iota_core.graph.task_queue import GraphTask

RUN_ID = "m09-run"


def graph_task(task_id: str = "m09-task") -> GraphTask:
    return GraphTask(
        task_id=task_id,
        agent_spec_ref="agent@1.0.0",
        graph_ref=GraphRef(name="long-task", version="1.0.0"),
        inputs={"work": "m09"},
        run_id=RUN_ID,
        max_attempts=2,
    )

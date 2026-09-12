# M04 Agent 循环与干预面

> **对齐：部分等价（类 A 事件/hook；类 C 运行中注入）**

类 A 路径跑出真实 `AgentEvent` 流和对所有内核适用的 `after_node_result` hook；adapter 的标准 `run()` 同时经过 `SpanHook`。D7 未批准 steer/followup/inbox/inject，因此运行中注入降为类 C：编排层不伪装拥有内核的进行中循环。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M04-agent-loop-intervention/run.py
```

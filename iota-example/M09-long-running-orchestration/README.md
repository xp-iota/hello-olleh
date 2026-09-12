# M09 长任务与编排

> **对齐：反向等价（类 A，iota 能力更强）**

本例使用真实 `InMemoryGraphTaskQueue` 跑出 task-id 幂等、lease claim 与 ack，再用 `InMemoryCheckpointStore` 保存可恢复调度状态。DSH jobs 负责长命令生命周期；iota 还拥有 graph scheduler/task queue/checkpoint/recovery。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M09-long-running-orchestration/run.py
```

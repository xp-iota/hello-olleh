# M09 · 长任务与编排

> **对照关系：语义等价（iota 提供更多耐久语义）**

观察队列租约、幂等入队与 checkpoint 恢复语义。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M09
```

## 观察点

1. 重复 task id 是否幂等
2. claim/ack 后状态
3. checkpoint sequence

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

`GraphTaskQueue` 与 checkpoint 将租约、尝试次数和恢复状态显式化。

**结论：**iota 的耐久队列语义覆盖普通后台 Job，并进一步支持恢复。

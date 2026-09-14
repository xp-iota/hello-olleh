# M05 · 会话面

> **对照关系：语义等价 + 结构性边界**

读取真实 ConversationStore 与 RunStore，并对比 DSH 的日志投影契约。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M05
```

## 观察点

1. user/assistant 消息顺序
2. run 状态与事件顺序
3. 事件 schema 是否包含 `sequence`

运行器会先打印目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

iota 保存有序消息与运行事件，但事件 schema 不承诺 DSH 的 seq/surface 语义。

**结论：**存储能力可以语义对位；不同日志模型的额外不变量必须如实保留差异。

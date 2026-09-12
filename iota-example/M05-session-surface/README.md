# M05 会话面

> **对齐：部分等价（类 A stores；类 C 日志不变量）**

本例让 `IotaRuntime` 真正写入 `InMemoryConversationStore` 与 `InMemoryRunStore`，再读取 user/assistant transcript、run 状态和确定性事件流。D7 只批准 ToolPipeline，因此 seq 连续、深冻结、surface 投影不变量没有补入 core；示例如实显示现有事件没有 `sequence` 字段。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M05-session-surface/run.py
```

# M04 · Agent 循环与干预面

> **对照关系：语义等价 + 结构性边界**

区分标准事件流、节点 hook 与内核运行中的消息注入。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M04
```

## 观察点

1. `system_init/text_delta/final` 的顺序
2. `after_node_result` 是否执行
3. mid-turn 注入是否属于编排契约

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

事件和节点 hook 位于编排层稳定边界；进行中的 Agent 循环由内核拥有。

**结论：**iota 可观察和扩展节点边界，但不声称能干预任意内核的 mid-turn 状态。

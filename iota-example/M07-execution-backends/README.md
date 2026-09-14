# M07 · 执行侧后端

> **对照关系：结构性边界**

确认 shell 副作用由 `KernelAdapter` 执行，而非编排层工具注册表。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M07
```

## 观察点

1. `kernel.shell` start/result 事件
2. 结果是否成功
3. 编排层 tools registry 是否为空

运行器会先打印目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

执行工具位于内核一侧，iota 编排层只消费标准事件。

**结论：**iota 不重写具体内核的 fs/shell/sandbox 执行栈。

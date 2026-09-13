# M02 · 上下文装配与经济学

> **对照关系：语义等价 + 结构性边界**

观察作用域记忆如何进入 Prompt，并识别仍由内核拥有的压缩边界。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M02
```

## 观察点

1. user/project/session scope 是否传递
2. 记忆 Prompt 默认是否关闭
3. AgentConfig 是否声明 compression seam

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

`MemoryContextService` 负责作用域召回；模型请求的完整装配和压缩属于内核执行栈。

**结论：**iota 能组织作用域记忆，但不在编排层伪造内核内部的 Prompt compressor。

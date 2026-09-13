# M01 · 工具管线

> **对照关系：教学补齐 + 结构性边界**

理解 iota 自有工具槽如何获得具名、可逆的处理阶段。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M01
```

## 观察点

1. `guard` 与 `audit` 的嵌套顺序
2. 重复安装如何保持幂等
3. 错名 stage 和 effect 回收的结果

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

iota 的 `ToolPipeline` 治理编排层自有工具槽；内核内部工具可见性仍由具体内核负责。

**结论：**ToolPipeline 提供真实、可逆的教学补齐，但不冒充 DSH 的 per-Agent restrict。

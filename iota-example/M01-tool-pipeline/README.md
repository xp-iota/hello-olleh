# M01 工具管线

> **对齐：补齐后部分等价（类 B ToolPipeline；类 C restrict）**

本例把真实 `ToolPipeline` 装在一个 iota 自有工具槽上，跑出具名 stage、重复安装幂等、缺失工具报告、错名 fail-loud 与 `EffectStack` 逆序拆除。它不包装内核内部工具，也不实现 DSH 的工具可见性收紧；PLAN D7 只批准了 ToolPipeline。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M01-tool-pipeline/run.py
```

# M02 上下文装配与经济学

> **对齐：部分等价（类 A 记忆上下文；类 C 提示压缩）**

类 A 路径用真实 `MemoryContextService`/`MemoryGateway` 按 user/project/session 三重 scope 召回并渲染记忆，同时验证 `enable_memory_prompt` 默认关闭。类 C 边界是提示装配和压缩：iota 把配置及记忆前缀交给整个内核，不在编排层增加 LLM prompt compressor。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M02-context-assembly-economics/run.py
```

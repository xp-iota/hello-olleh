# M07 执行侧后端

> **对齐：结构性差异（类 C）**

本例向真实离线 `KernelAdapter` 发送 shell 意图，事件路径明确显示 `prompt → KernelAdapter → kernel.shell`；iota 的工具 registry 保持为空。DSH harness 拥有 `ctx.fs/ctx.shell/sandbox`，iota orchestrator 则把执行栈留给内核。依据 `docs/architecture/kernel-replacement.md` 对 ACP/Direct 边界及“自建 harness”否决结论。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M07-execution-backends/run.py
```

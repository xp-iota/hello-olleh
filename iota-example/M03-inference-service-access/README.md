# M03 推理服务接入

> **对齐：结构性差异（类 C）**

DSH 在 harness 内替换 LLM adapter；iota 的 provider seam 替换整个 `KernelAdapter`。本例真实注册第二个 adapter provider，并用真实 `HermesAcpAdapter.capabilities()` 驱动 `GraphCompiler`，跑出 ACP 对 `llm_execution` middleware 的编译期拒绝。边界依据 `docs/architecture/kernel-replacement.md` 与 `docs/architecture/node-hooks.md`，不是本工程新造。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M03-inference-service-access/run.py
```

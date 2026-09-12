# M12 框架机制本体

> **对齐：部分等价（类 A 机制；类 C 架构边界）**

本例逐项跑出：EffectStack 逆序拆除、重复 dispose 幂等、失效后注册抛错、Registry disposer 的身份保护、adapter provider disposer、capability 错名在类定义期拒绝，以及标准 entry-point group。iota 借用可逆 effect 等机制，但明确不搬事件总线、HMR、intercept；依据 `docs/architecture/pluggability-cordis-alignment.md` §原则一/二与§五。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M12-framework-mechanisms/run.py
```

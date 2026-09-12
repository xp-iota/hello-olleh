# M08 委派与预设

> **对齐：等价（类 A）**

形状不同但目的等价：DSH 的 `SubagentProvider` 以子代理为单位，iota 的 `GraphSpec` 以显式 DAG 节点为单位。本例编译并执行 research → review 两节点图，验证依赖拓扑、输入绑定与最终输出。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M08-delegation-presets/run.py
```

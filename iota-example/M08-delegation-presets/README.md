# M08 · 委派与预设

> **对照关系：语义等价**

DSH 用 subagent Provider、agent/permission preset 与模型路由表达委派。iota 用显式 DAG：roster 与模型路由都必须写出来。

对位的 DSH 模块：[M08 委派与预设](../../dsh-example/M08-delegation-presets/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

看清委派的确定性：顺序来自 `depends_on`，数据来自绑定，委派对象与模型都按名字显式注册。

## 运行

```bash
uv run python -m runtime.runner M08
uv run python M08-delegation-presets/run.py
uv run python -m M08-delegation-presets.run --scene 01_compile_topological_order
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M08.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M08.1 注册委派节点并编译顺序 | `mechanism` | [01_compile_topological_order.py](scenes/01_compile_topological_order.py) | 编译计划的 `topological_order` 为 research → review |
| M08.2 不扫描用户目录的空 roster | `mechanism` | [02_agent_specs_are_explicit.py](scenes/02_agent_specs_are_explicit.py) | 装配后 roster 为空，显式注册才在册，回收后回到空 |
| M08.3 委派图运行与上游绑定 | `mechanism` | [03_run_delegation_graph.py](scenes/03_run_delegation_graph.py) | 整图 succeeded，review 通过 `$nodes.research.output` 拿到上游草稿 |
| M08.4 具名模型路由 | `mechanism` | [04_route_node_model.py](scenes/04_route_node_model.py) | 按名字解析回同一个 ModelProfile，节点引用的是名字 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核按节点提示词分别作答，委派顺序由图决定而不是模型自由发挥。 |
| iota 编排层本地断言 | 拓扑顺序、空 roster、上游绑定与具名模型路由都在本地断言。 |
| 明确不属于 iota | 内核内部的子代理实现细节不属于 iota。 |

## 完整链路

1. handler 与 agent_spec 按名字注册进 `Registry`，图只引用名字。
2. `compile_graph()` 冻结执行计划，拓扑顺序在运行前就能检查。
3. `run_graph()` 按计划执行，节点输出通过绑定进入下游。
4. 模型路由的单位是具名 `ModelProfile`，回收后立刻不再在册。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

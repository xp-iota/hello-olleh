# M02 · 上下文装配与经济学

> **对照关系：语义等价 + 结构性边界**

DSH 把 Prompt section、变量装配、压缩、token 计量、结果裁剪与 spill 连成一条治理链。iota 这边能组织作用域记忆，其余环节归内核。

对位的 DSH 模块：[M02 上下文装配与经济学](../../dsh-example/M02-context-assembly-economics/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

分清 iota 治理的是「哪些内容进入下一轮」，而不是「请求怎么被拼出来」：作用域记忆可召回、可写回，装配与压缩仍在内核。

## 运行

```bash
uv run python -m runtime.runner M02
uv run python M02-context-assembly-economics/run.py
uv run python -m M02-context-assembly-economics.run --scene 01_recall_scoped_memory
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M02.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M02.1 按作用域贡献 Prompt 前缀 | `mechanism` | [01_recall_scoped_memory.py](scenes/01_recall_scoped_memory.py) | user/project/session 三个作用域进入查询；命中的记忆正文出现在前缀里，`included_count` 为 1 |
| M02.2 装配改写属于内核 | `mechanism` | [02_no_prompt_assembly_seam.py](scenes/02_no_prompt_assembly_seam.py) | 编排层没有 Prompt 装配/改写注册面；记忆注入默认关闭 |
| M02.3 压缩历史属于内核 | `mechanism` | [03_no_compression_seam.py](scenes/03_no_compression_seam.py) | `AgentConfig` 里没有任何压缩字段 |
| M02.4 从真实运行读 token 用量 | `model` | [04_measure_token_usage.py](scenes/04_measure_token_usage.py) | token 数字来自内核报告（`FinalEvent.usage`），编排层没有计量注册面 |
| M02.5 历史开关而不是结果裁剪 | `mechanism` | [05_history_switch_not_pruner.py](scenes/05_history_switch_not_pruner.py) | `disable_conversation_history` 是真实开关；但没有裁剪/溢出注册面 |
| M02.6 作用域记忆写回代替 spill | `mechanism` | [06_persist_memory_writeback.py](scenes/06_persist_memory_writeback.py) | 写回请求带上解析出的 session scope；作用域记忆是 iota 版的 spill |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核自己装配完整 Prompt、决定历史怎么进上下文，并报告 token 用量。 |
| iota 编排层本地断言 | 作用域召回与前缀渲染、默认关闭开关、历史开关、写回请求的作用域解析都在本地断言。 |
| 明确不属于 iota | Prompt 装配改写、历史压缩、确定性裁剪与 spill 都不在编排层，`AgentConfig` 也不伪造这些字段。 |

## 完整链路

1. `MemoryScopeResolver` 从 namespace / cwd / `AgentConfig.extra` 解析出三个作用域。
2. `MemoryContextService.build_prompt_prefix()` 按作用域召回并渲染成带计数的前缀。
3. 注入默认关闭：要用前缀必须显式打开，装配不替读者决定。
4. 放不进这一轮的事实按作用域写回记忆，下一轮再召回 —— 这是 iota 版的 spill。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

# M05 · 会话面

> **对照关系：语义等价 + 结构性边界**

DSH 分事实日志与模型可见 surface，并有 JSONL persistence、query、projection checkpoint 与 title 五层。iota 这边是 ConversationStore + RunStore，两者都可换。

对位的 DSH 模块：[M05 会话面](../../dsh-example/M05-session-surface/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。
本模块课件：[第 05 课 · 会话面](../lessons/05-session-surface.md)。

## 学习目标

明确 iota 保存了什么、没承诺什么：消息与运行事实按顺序落盘、可查询、可换实现；但事件 schema 不承诺 DSH 的 seq/surface 不变量。

## 运行

```bash
uv run python -m runtime.runner M05
uv run python M05-session-surface/run.py
uv run python -m M05-session-surface.run --scene 01_persist_conversation
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M05.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M05.1 一轮真实对话按序持久化 | `model` | [01_persist_conversation.py](scenes/01_persist_conversation.py) | 一轮真实对话按 user/assistant 顺序持久化 |
| M05.2 装载可换的消息存储 | `mechanism` | [02_swap_conversation_store.py](scenes/02_swap_conversation_store.py) | 换一个 ConversationStore 实现，协议方法与读回结果不变 |
| M05.3 查询会话语料 | `mechanism` | [03_search_conversation_messages.py](scenes/03_search_conversation_messages.py) | 两个会话都在册，按关键词检索命中一条消息 |
| M05.4 运行记录可读回 | `model` | [04_read_run_record.py](scenes/04_read_run_record.py) | RunStore 的运行状态为 succeeded，事件按标准子序列读回 |
| M05.5 事件 schema 不承诺 seq/surface | `mechanism` | [05_no_sequence_contract.py](scenes/05_no_sequence_contract.py) | `TextDeltaEvent` / `FinalEvent` 都没有 seq/sequence/surface 字段 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核回答被真实写入 ConversationStore 与 RunStore，可读回。 |
| iota 编排层本地断言 | 消息顺序、存储协议、检索、运行记录与事件 schema 边界都在本地断言。 |
| 明确不属于 iota | DSH 的 seq/surface 不变量与 latest-wins 标题事件不属于 iota 的事件 schema。 |

## 完整链路

1. 一轮真实对话把 user/assistant 两条消息写进 ConversationStore。
2. 存储是协议：换一个实现，`append_message`/`get_messages` 照样成立。
3. `list_sessions()` 与 `search_messages()` 提供会话语料的查询面。
4. `RunStore` 保存运行状态与事件；事件模型里没有 seq/sequence/surface 字段。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

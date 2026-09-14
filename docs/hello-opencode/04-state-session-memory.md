---
title: "状态、会话与记忆：durable 事件日志、projection 与 compaction"
---
# 状态、会话与记忆：durable 事件日志、projection 与 compaction

> 基于 `sources/opencode/specs/v2/session.md` 与 `sources/opencode/packages/core/src/session/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 状态模型总览](#1-状态模型总览)
- [2. durable 事件日志与 projection](#2-durable-事件日志与-projection)
- [3. inbox：待投递输入的持久化](#3-inbox待投递输入的持久化)
- [4. instruction 是值增量](#4-instruction-是值增量)
- [5. compaction 重建活跃历史](#5-compaction-重建活跃历史)
- [6. revert、move 与 fork](#6-revertmove-与-fork)

---

## 1. 状态模型总览

OpenCode v2 没有“内存里的会话对象树”。会话状态分三层：**durable 事件日志**记录 Session 作用域事实；**projection** 提供权威的消息、pending 输入、上下文、重试状态等读模型；**实例级 live 事件流**承载实时增量（text/reasoning/tool-input delta），schema 不同且不提供回放保证。持久化落在 SQLite（`packages/effect-drizzle-sqlite`），会话侧读写集中在 `session/store.ts`、`session/sql.ts`、`session/projector.ts`。

## 2. durable 事件日志与 projection

- 事件 schema 由 `packages/schema/src/event.ts`、`event-manifest.ts`、`durable-event-manifest.ts` 定义，发布、持久化、回放、projection 都归 Core。
- `sessions.log({ sessionID, after?, follow? })` 校验 Session 后按聚合序号做排他读取；`follow: true` 时**先订阅再回放**，并在捕获的水位线处发出一个同步标记，然后继续推送 live durable 事件——保证调用方不错过回放与直播之间的事件。
- live-only 的 text、reasoning、tool-input、compaction delta 故意不进回放；没有独立的“有限 Session 历史 endpoint”，请求/响应消费者用权威 projection（messages、pending input、context），回放消费者用 durable 日志。
- Bus 与 projector 的边界用 defect 中止非法 projection；inbox 只翻译生命周期冲突，不吞无关 defect。

## 3. inbox：待投递输入的持久化

inbox 是“输入先于执行”的载体（与 [03-agent-loop.md](./03-agent-loop.md) 的准入语义配套）：

- `SessionInbox.Service` 是 **Host 作用域**服务，依赖 Database 与 Bus，命令自带身份与类型检查，返回类型化 `SessionInbox.LifecycleConflict` 错误，由 Session 操作翻译成各自的公共错误并决定是否 wake。
- inbox 身份使 prompt 与 synthetic 准入幂等；手动 compaction 与 move 是同一 inbox 里的**控制项**，构成显式投递边界。
- pending 输入的修改本身不调度执行：steer 成功修改后会 wake，queue 与 cancel 不会。
- `list` 提供常规 pending 输入读取，不把 Database 暴露给 Session；共享 inbox 串行化锁仍由命令保留。

## 4. instruction 是值增量

v2 把“系统提示词来源”抽象为内容寻址的指令增量（`session/instructions.ts`、`instruction-state.ts`、`instruction-entry.ts`）：

- `session.instructions.updated { delta, text? }` 把每个变更的 source key 映射到 SHA-256 内容哈希，观察到的缺失记为字面量 `"removed"`；规范 JSON 正文只存一份在本机 `instruction_blob` 存储。
- 指令来源谱系：内建、环境发现（ambient discovery）、所选 agent 的 skill 指引、reference、MCP 指引、API 托管条目——**没有可变的指令注册表**。
- 每次到达模型执行的 Physical Attempt 前，runner 对每个来源并发读取恰好一次、哈希编码值、把 delta 与新 blob 原子准入；初始 delta 必须完整且不携带更新文本。
- instruction epoch 跨越已完成的 compaction：`session.compaction.ended` 把 epoch 起点移到其精确序号、使当前值成为初始值，不读取来源也不补写指令事件。
- 请求装配从存储值渲染 epoch 基线；后续变更在准入时渲染一次，把可选 `text` 冻结进 durable 事件，并投影为按时间序的 System 消息——客户端展示变更的 key，而不是特权散文。

## 5. compaction 重建活跃历史

- 每个 Step 前，runner 按所选模型的上下文窗口与预留输出余量估算完整模型可见请求；启用 compaction、模型上限已知且可压缩历史足够时，存储**结构化滚动摘要 + 有界近期上下文**，而不是发出超预算请求。
- 完整 transcript 保持 durable 不变；compaction 边界之后的活跃模型历史只含摘要与保留的近期上下文，**provider 原生 continuation 状态不跨越该边界**。
- 自动 compaction 开启时，若 provider 在 durable assistant 输出或工具执行前报告上下文溢出，runner 可做一次溢出触发 compaction 并重建同一逻辑 Step；第二次溢出、durable 输出后的溢出、或未开启自动 compaction 时的溢出都是终态失败。

## 6. revert、move 与 fork

| 操作 | 状态语义 |
| --- | --- |
| revert 提交 | 清除 instruction 状态，下一边界建立全新基线；`SessionRevert.make` 捕获 Database、Bus、PluginSupervisor、Snapshot |
| move | 保留 instruction 状态，目的地侧的变化成为时间序更新；会话身份不变，只改变服务解析位置（见 [01-architecture.md](./01-architecture.md) §4） |
| fork | 只按所选边界复制消息，并认领父会话最新的 instruction 值作为基线 |

每个实例通过 `SessionRevert.make` 构造自己的 `SessionRevert.Service`；Session 方法按操作选择当前实例，因此 ID 绑定的 Session 在移动后不会持有旧实例的快照。

## 源码锚点

- [`sources/opencode/packages/core/src/session/history.ts`](../../sources/opencode/packages/core/src/session/history.ts)：历史 projection
- [`sources/opencode/packages/core/src/session/instructions.ts`](../../sources/opencode/packages/core/src/session/instructions.ts) 与 [`instruction-state.ts`](../../sources/opencode/packages/core/src/session/instruction-state.ts)：指令增量
- [`sources/opencode/packages/core/src/session/compaction.ts`](../../sources/opencode/packages/core/src/session/compaction.ts)：compaction
- [`sources/opencode/packages/core/src/session/projector.ts`](../../sources/opencode/packages/core/src/session/projector.ts)、[`store.ts`](../../sources/opencode/packages/core/src/session/store.ts)、[`sql.ts`](../../sources/opencode/packages/core/src/session/sql.ts)：投影与持久化
- [`sources/opencode/packages/effect-drizzle-sqlite/`](../../sources/opencode/packages/effect-drizzle-sqlite)：SQLite 支撑包

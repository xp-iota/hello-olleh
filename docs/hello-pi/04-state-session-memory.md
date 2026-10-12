---
title: "状态、会话、记忆：JSONL 会话与将来时的 durable"
---
# 状态、会话、记忆：JSONL 会话与将来时的 durable

> 基于 `sources/pi/packages/coding-agent/src/core/` 与 `sources/pi/packages/durable/` 的 pi v1.1.0 源码校对。pi 默认运行时只有 JSONL 会话，没有内建记忆系统；durable 是实验性的"将来时"方向。

**目录**

- [1. 默认会话：JSONL entry 树](#1-默认会话jsonl-entry-树)
- [2. compaction 与分支摘要](#2-compaction-与分支摘要)
- [3. 无内建记忆系统](#3-无内建记忆系统)
- [4. pi-durable：五类记录与双存储](#4-pi-durable五类记录与双存储)
- [5. Harness 与检查点状态机](#5-harness-与检查点状态机)

---

## 1. 默认会话：JSONL entry 树

`SessionManager`（`packages/coding-agent/src/core/session-manager.ts:987`）以 JSONL 持久化会话，格式见 `docs/session-format.md`：每条 entry 携带 `id` 与 `parentId`（`session-manager.ts:60`），构成一棵树而非线性列表。`SessionManager` 提供 `list/listAll/open/forkFrom/continueRecent`；`AgentSession.navigateTree()`（`agent-session.ts:3964`）在分支树上的任意节点之间切换——切到旧分支即"回到过去"，从那里再提问就自然 fork 出新分支（分支操作在 `session-manager.ts` 中，v1→v2 迁移补 `parentId` 见 `:286-298`）。

上下文编辑不改历史：`SessionManager.appendContextEdit(targetId, replacement)`（`session-manager.ts:1360`）对既有 entry 追加不可变的 omit/replace 编辑，模型视角被改写而转录本保持追加式。

## 2. compaction 与分支摘要

自动压缩挂在 agent 的请求路径上：`_exceedsCompactionThreshold()`（`agent-session.ts:767`）用 `shouldCompact`（`core/compaction/compaction.ts:267`）比对 `estimateProjectedContextTokens` 与模型 `contextWindow`，超阈值即触发 `_compactBeforeNextAssistantResponse`（`agent-session.ts:780` 附近，经 pi-ai 的 `estimateContextTokens` 估算，`agent-session.ts:3061`）。压缩由 `core/compaction/compaction.ts` 执行，切换分支产生的"旁支历史"由 `core/compaction/branch-summarization.ts` 生成摘要 entry（`BranchSummaryResult`），扩展可订阅 `session_before_compact`/`session_compact` 事件。上下文总量则由 pi-ai 提供估算原语：`estimateContextTokens`（`packages/ai/src/utils/estimate.ts:97`）锚定最近一次 `AssistantMessage.usage`、按 3.5 字符/token 估算尾部消息；溢出检测 `isContextOverflow`（`utils/overflow.ts:137`）内置 25+ 条 provider 专属正则。

## 3. 无内建记忆系统

默认运行时没有跨会话记忆、没有向量库、没有 auto-memory：会话恢复靠 JSONL 树，"记忆"至多是 AGENTS.md 式项目上下文文件（`resource-loader.ts` 的 `loadProjectContextFiles`）与 skills/prompts 资源。持久化复用即 `Agent.reset()`（只留系统基线）+ 会话树。这与 nanobot 内建 `memory.py`、Claude Code 的 auto memory 形成对照——pi 把这留给扩展生态。

## 4. pi-durable：五类记录与双存储

实验包 `@earendil-works/pi-durable`（"API changes without notice"）把会话升级为持久化的事务运行时，五类记录对应 `StorageWrite` 联合（`packages/durable/src/types.ts:708`）：

| 记录 | 位置 | 语义 |
| --- | --- | --- |
| Conversation | `types.ts:286` | 不可变身份 + fork 血统（`parent: {conversationId, at}`），根为 `ROOT_CONVERSATION_ID = 1`（`:39`） |
| Entry | `types.ts:317` | 不可变转录事件；`head` 指针选择活跃上下文起点，`edits: ContextEdit[]` 是对早期 entry 的不可变改写 |
| Task | `types.ts:486` 附近 | 持久状态机：`pending → running → waiting(join) → completing → terminal`，带 checkpoint、abort 标记、归属 |
| Submission | `types.ts:363` | 用户输入的持久收件箱（queued → placed → done），`requestId` 去重（`:359`） |
| Document | `types.ts:563` | 按 `session/conversation/task` 作用域的 JSON 状态文档，checkpoint 或 Chord delta 两种内容形态 |

双存储实现：**JSONL**（`storage/jsonl/storage.ts`，commit 标记 + `doc-*`/`task-*` sidecar + 墓碑回收）与 **SQLite**（`storage/sqlite/storage.ts` + `migrations.ts`，含 Cloudflare D1 变体），另有 `storage/memory.ts` 测试实现。所有提交在单一"commit 线"上原子化，`Seq` 严格递增（`types.ts:36`）。

## 5. Harness 与检查点状态机

`Session`（`session/session.ts:49` `createSession`）拥有 commit 线、id/seq 分配与 fork（`session/forks.ts`）；`Harness.open()`（`harness/harness.ts:411` 起）= Session + 调度器 + 内建任务与文档：`pi.agent`（每会话模型/工具选择，`harness/agent.ts:42`，压缩策略默认 `reserveTokens: 16384`）、`pi.live`、`pi.inbox`、`pi.usage`、`pi.provider`。内建任务（`harness/registry.ts`）把"回合"做成检查点状态机：

- **`GenerationTask`**（`harness/generation.ts:115`）：checkpoint 相 `prepare → request → retry/poll → tools`（`GenerationCheckpoint`，`:51` 起）；崩溃恢复时从已提交 checkpoint 重放，被打断的 tool call 得到 "interrupted" 结果。
- **`CompactionTask`**（`harness/compaction.ts:103`）：相 `select → summarize → retry`；摘要落为 `head: "self"` 的 `CompactionEntry`，配合 `ContextEdit` 实现不重写历史的持久压缩。

coding-agent 在 `src/experimental/durable/` 用它搭了完整的实验代理（`runtime.ts:139` 打开 `openNodeSqliteStorage` + `Harness.open`，会话落在 `~/.pi/agent/experimental/durable-sessions/` 下），但它**不是**默认运行时——默认 agent 仍是 pi-agent-core 那条进程内链路（[03-agent-loop.md](./03-agent-loop.md)）。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/session-manager.ts`](../../sources/pi/packages/coding-agent/src/core/session-manager.ts)：JSONL 会话、entry 树、fork、appendContextEdit
- [`sources/pi/packages/coding-agent/src/core/compaction/compaction.ts`](../../sources/pi/packages/coding-agent/src/core/compaction/compaction.ts)：自动压缩与 shouldCompact 阈值
- [`sources/pi/packages/coding-agent/docs/session-format.md`](../../sources/pi/packages/coding-agent/docs/session-format.md)：会话文件格式与 entry 树
- [`sources/pi/packages/durable/src/types.ts`](../../sources/pi/packages/durable/src/types.ts)：五类记录、StorageWrite、ContextEdit
- [`sources/pi/packages/durable/src/harness/generation.ts`](../../sources/pi/packages/durable/src/harness/generation.ts)：GenerationTask 检查点状态机
- [`sources/pi/packages/coding-agent/src/experimental/durable/runtime.ts`](../../sources/pi/packages/coding-agent/src/experimental/durable/runtime.ts)：Harness 的实验性接入点

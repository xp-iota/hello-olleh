---
title: "会话恢复：JSONL entry 树与 durable 的 checkpoint 未来"
---
# 会话恢复：JSONL entry 树与 durable 的 checkpoint 未来

> 基于 `sources/pi/` 快照（pi v1.1.0），对照 `docs/session-format.md`、`SessionManager` 与 experimental durable 包校对。

**目录**

- [1. JSONL 会话格式](#1-jsonl-会话格式)
- [2. CLI 恢复路径](#2-cli-恢复路径)
- [3. 会话树与分支切换](#3-会话树与分支切换)
- [4. 导出与分享](#4-导出与分享)
- [5. 对照 durable：崩溃恢复的 checkpoint 状态机](#5-对照-durable崩溃恢复的-checkpoint-状态机)

---

## 1. JSONL 会话格式

会话是一个 JSONL 文件（`~/.pi/agent/sessions/--<路径>--/<时间戳>_<session-id>.jsonl`），每行一个带 `type` 字段的对象（`docs/session-format.md`）。核心设计是 **entry 树**：除 header 外每个 entry 都有 `id` / `parentId`（`SessionEntryBase`），从线性日志升级为树结构后，**分支原地生长、不新建文件**。文件头有版本字段，v1（线性）与 v2（`id`/`parentId` 树）在加载时自动迁移到 v3（`hookMessage` 角色更名为 `custom`，配合扩展统一）。

entry 类型不止消息：`SessionMessageEntry` 之外还有 `ThinkingLevelChangeEntry`、`ModelChangeEntry`、`UsageEntry`、`CompactionEntry`、`BranchSummaryEntry`、`CustomEntry`（扩展经 `appendEntry` 持久化的非 LLM 状态）、`LabelEntry`、`ContextEditEntry`——切换模型、压缩、分支摘要、上下文编辑都是树上的节点，重放即可重建完整状态机。

## 2. CLI 恢复路径

| 入口 | 行为 |
| --- | --- |
| `--session <id|path>` | 按精确 ID、ID 前缀或文件路径解析；也支持跨项目全局搜索，命中后提示是否 fork |
| `--resume` / `-r` | 交互式会话选择器（`src/cli/session-picker.ts`），可按项目过滤 |
| `--continue` / `-c` | 继续当前项目最近一次会话 |
| `--fork <id>` | 打开指定会话并从其当前分支分叉 |
| `--session-id <id>` | 使用精确项目会话 ID，不存在则创建（供脚本/嵌入方使用） |
| `--no-session` | 完全无会话运行 |

解析逻辑在 `src/core/session-manager.ts` 与 `src/cli/args.ts`；会话选择界面 `/resume` 中还支持 `Ctrl+D` 删除（有 `trash` CLI 时走回收站而非永久删除）。

## 3. 会话树与分支切换

会话内的树操作由 `AgentSession.navigateTree()`（`agent-session.ts:3964`）承载：`/tree` 命令弹出树形选择器，切换到任意分支意味着**把活动 `parentId` 指针移过去**，而非复制历史。旧分支保留原样，压缩与分支摘要（`CompactionEntry` / `BranchSummaryEntry`）在树视图中可见。这是"entry 树 + 重放"相对"每分支一个文件"（claude code 早期做法）的结构优势：分支的存储成本是一条 `parentId`。

## 4. 导出与分享

- `exportToHtml()`（`agent-session.ts:4288`）：把会话（含工具调用的渲染产物）渲染为自包含 HTML，对应交互命令 `/export`；
- `exportToJsonl()`（`:4314`）：导出为可再导入的 JSONL（`/import` 反向操作）；
- `session-share.ts`（`/share`）：把会话上传生成只读分享链接，查看器基址可用 `PI_SHARE_VIEWER_URL` 覆盖。

## 5. 对照 durable：崩溃恢复的 checkpoint 状态机

当前 JSONL 会话是**事后重放**模型：崩溃后能找回已写入的行，但进行中的模型请求、流式部分输出与工具调用结果都会丢失。experimental 的 `@earendil-works/pi-durable` 包展示的是另一条路，其 README 的承诺是："every streamed partial, tool output, queue, and turn is committed. Kill the process in the middle of a tool call and start it again with `--continue`: the interrupted call gets an interrupted result and the turn finishes."

| 维度 | JSONL 会话（默认） | durable Harness（experimental） |
| --- | --- | --- |
| 存储 | 单 JSONL 文件 | SQLite/JSONL，事务化提交（`CommitPublication {seq, changes}`） |
| 模型回合 | 一次性写最终消息 | `GenerationTask` 状态机：checkpoint 走 `prepare → request → retry/poll → tools` 分相提交 |
| 崩溃后果 | 在途轮次丢失 | 从 checkpoint 恢复：被中断的工具调用补一条 "interrupted" 结果，回合继续走完 |
| 上下文编辑 | 启动重放时应用 | `ContextEdit` 不可变 omit/replace，直接覆盖历史 entry 的模型消息 |

durable 目前只在 `packages/coding-agent/src/experimental/durable/` 下以实验 harness 形态接入（SQLite 会话存于 `~/.pi/agent/experimental/durable-sessions/`），但"每个流式 partial、工具输出、队列操作都提交"的承诺，就是 pi 会话恢复的可见未来方向。

## 源码锚点

- [`sources/pi/packages/coding-agent/docs/session-format.md`](../../sources/pi/packages/coding-agent/docs/session-format.md)：格式规范与版本迁移
- [`sources/pi/packages/coding-agent/src/core/session-manager.ts`](../../sources/pi/packages/coding-agent/src/core/session-manager.ts)：SessionManager 与 entry 类型
- [`sources/pi/packages/coding-agent/src/cli/args.ts`](../../sources/pi/packages/coding-agent/src/cli/args.ts)：`--session` / `--resume` / `--continue` / `--fork` 解析
- [`sources/pi/packages/coding-agent/src/core/agent-session.ts`](../../sources/pi/packages/coding-agent/src/core/agent-session.ts)：navigateTree 与导出
- [`sources/pi/packages/coding-agent/src/modes/interactive/session-share.ts`](../../sources/pi/packages/coding-agent/src/modes/interactive/session-share.ts)：/share 上传
- [`sources/pi/packages/durable/src/harness/generation.ts`](../../sources/pi/packages/durable/src/harness/generation.ts)：GenerationTask checkpoint 状态机

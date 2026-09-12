---
layout: content
title: "Gemini CLI Session 持久化与会话恢复"
---
# Gemini CLI Session 持久化与会话恢复

本文档分析 Gemini CLI 的会话持久化与恢复机制。和 Codex / OpenCode 不同，它没有单独抽出一套 thread/session 协议，而是把“可恢复会话”落实为项目级 JSON 会话文件、路径计算服务和 `--resume` 解析链。

**目录**

- [1. 这套机制在源码里的真实位置](#1-这套机制在源码里的真实位置)
- [2. 会话文件是什么](#2-会话文件是什么)
- [3. `--resume` 真实是怎么走的](#3-resume-真实是怎么走的)
- [4. 持久化不是一次性保存，而是增量录制](#4-持久化不是一次性保存而是增量录制)
- [5. Checkpoint 需要单独澄清](#5-checkpoint-需要单独澄清)
- [6. 与 OpenCode 的 Session 对比](#6-与-opencode-的-session-对比)
- [7. 当前限制](#7-当前限制)
- [8. 关键源码锚点](#8-关键源码锚点)
- [9. 总结](#9-总结)

---

## 1. 这套机制在源码里的真实位置

Gemini CLI 当前与 session 直接相关的主链主要由四个节点组成：

| 组件 | 代码路径 | 作用 |
| --- | --- | --- |
| `Storage` | `sources/gemini-cli/packages/core/src/config/storage.ts` | 计算 `~/.gemini/`、项目级 `.gemini/` 与 `tmp/<project-hash>/` 等目录 |
| `ChatRecordingService` | `sources/gemini-cli/packages/core/src/services/chatRecordingService.ts` | 持续把用户/模型/工具/思考摘要写入当前 conversation JSON 文件 |
| `SessionSelector` | `sources/gemini-cli/packages/cli/src/utils/sessionUtils.ts` | 把 `--resume latest|<index>|<uuid>` 解析成具体会话文件 |
| `gemini.tsx` | `sources/gemini-cli/packages/cli/src/gemini.tsx` | 启动时处理 `--resume`，把已选会话传给交互式或非交互式入口 |

核心判断要先立住：

1. Gemini CLI 有“可恢复会话”，但没有 OpenCode 那种一等的 thread 协议对象。
2. 会话恢复的基础单位是 conversation JSON 文件，而不是数据库里的 turn / item 表。
3. Checkpoint 不是另一套 session 文件树，而是 Git 驱动的可选能力。

---

## 2. 会话文件是什么

`ChatRecordingService` 的注释和 `initialize()` 实现已经把存储形态说得很清楚：会话以 JSON 文件存放在 `~/.gemini/tmp/<project-hash>/chats/` 下。新会话会创建一个带时间戳和 session 前缀的文件；恢复会话时则直接复用已有文件。

就源码可证实的字段看，会话文件至少包含：

- `sessionId`
- `projectHash`
- `startTime`
- `lastUpdated`
- `messages`
- `kind`（`main` 或 `subagent`）

这里最重要的一点是：Gemini CLI 持久化的重点不是抽象 `Session` 类，而是 **ConversationRecord**。也就是说，恢复时更多是在“重新拿回一份对话记录”，而不是重建一个复杂的运行时对象图。

---

## 3. `--resume` 真实是怎么走的

启动恢复链路主要发生在 `sources/gemini-cli/packages/cli/src/gemini.tsx:577-609` 附近：

1. 如果传入 `argv.resume`，先创建 `SessionSelector(config)`。
2. `resolveSession()` 负责把 `latest`、列表序号或显式会话标识解析成具体文件。
3. CLI 把结果包装成 `resumedSessionData = { conversation, filePath }`。
4. 随后调用 `config.setSessionId(...)`，确保后续录制继续写回同一个会话。
5. 交互式路径把 `resumedSessionData` 传给 `startInteractiveUI(...)`；非交互路径则继续沿当前 CLI 入口传递。

这意味着 Gemini CLI 的“恢复”更像：

> 选择一份已有 conversation 文件，然后让当前运行时继续沿这份记录追加写入。

而不是：

> 先恢复一个独立的 session runtime，再把新请求附着上去。

---

## 4. 持久化不是一次性保存，而是增量录制

`ChatRecordingService` 会在对话进行时持续写入：

- 用户消息
- Gemini 模型消息
- 工具调用与结果
- token 使用统计
- thought / reasoning 摘要

所以从工程形态看，Gemini CLI 的 session 更接近“聊天录音带”，而不是“数据库事务日志”。这也是它和 OpenCode / Codex 最大的结构差异之一。

---

## 5. Checkpoint 需要单独澄清

旧版文档把 Gemini CLI 写成“没有 checkpoint”，这个说法过于绝对。当前源码里确实存在 **可选的 checkpointing 能力**，但它的形态不是 session 子目录，而是围绕 Git 恢复建立：

- 配置入口：`general.checkpointing.enabled`
- 核心服务：`sources/gemini-cli/packages/core/src/services/gitService.ts`
- 恢复命令：`sources/gemini-cli/packages/core/src/commands/restore.ts`
- CLI / ACP 暴露：`sources/gemini-cli/packages/cli/src/acp/commands/restore.ts`

因此更准确的表述应该是：

- Gemini CLI **有 checkpointing 能力**
- 但它不是 OpenCode 那种 durable turn/state 体系
- 它主要服务于“恢复工作区变更”，而不是构建完整的 session 协议

---

## 6. 与 OpenCode 的 Session 对比

### 6.1 主要差异

| 特性 | OpenCode | Gemini CLI |
| --- | --- | --- |
| 存储后端 | SQLite | JSON 文件 |
| Session 协议 | 完整 Thread 协议 | 简化版 |
| Checkpoint | 完整 durable state | 有，但以 Git/restore 为主 |
| 并发控制 | 支持多线程 | 无 |
| 远程 Session | 支持 | 无 |

### 6.2 差别不在“能不能恢复”，而在抽象层次

OpenCode 把 session/thread 做成 durable runtime 的中心对象；Gemini CLI 则把 conversation 录制、resume 参数解析和 Git checkpoint 拆散在几个服务里。两者都能“继续上次工作”，但工程抽象完全不同。

---

## 7. 当前限制

### 7.1 缺失的能力

| 能力 | OpenCode 有 | Gemini CLI 状态 |
| --- | --- | --- |
| Checkpoint | 完整 | 有，但不是 thread 级协议 |
| 并发控制 | 多 Thread | 无 |
| 远程 Session | app-server | 无 |
| Session 协议 | 标准化 | 未独立建模为协议对象 |
| 自动恢复 | 完整 | 基础 |

### 7.2 改进建议

1. **增强恢复语义**：把 conversation resume 与 Git checkpoint 的边界写得更清楚
2. **补齐中断后恢复**：支持更细粒度的部分失败恢复
3. **并发控制**：支持多 Session 并行

---

## 8. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| Storage | `sources/gemini-cli/packages/core/src/config/storage.ts` | 目录与文件路径接口 |
| SessionSelector | `sources/gemini-cli/packages/cli/src/utils/sessionUtils.ts` | `--resume` 解析 |
| ChatRecordingService | `sources/gemini-cli/packages/core/src/services/chatRecordingService.ts` | conversation 录制与续写 |
| Checkpoint | `sources/gemini-cli/packages/core/src/services/gitService.ts`, `sources/gemini-cli/packages/core/src/commands/restore.ts` | Git 驱动的恢复能力 |

---

## 9. 总结

Gemini CLI 的 session 机制本质上是“conversation 文件 + resume 解析 + Git checkpoint”的组合，而不是一套独立的 thread runtime。它已经具备可恢复会话和可选 checkpointing，但在协议化程度、并发控制和远程 session 方面，仍明显轻于 OpenCode。

---

> 关联阅读：[05-state-management.md](./04-state-session-memory.md) 了解状态管理详情。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Storage.initialize()` | `sources/gemini-cli/packages/core/src/config/storage.ts` | 计算 `~/.gemini/tmp/<project-hash>/chats/` 等持久化路径 |
| `ChatRecordingService.recordMessage()` | `sources/gemini-cli/packages/core/src/services/chatRecordingService.ts` | 增量录制消息到 conversation JSON 文件 |
| `SessionSelector.resolveSession()` | `sources/gemini-cli/packages/cli/src/utils/sessionUtils.ts` | 将 `--resume latest|<index>|<uuid>` 解析为具体会话文件路径 |
| `config.setSessionId()` | `sources/gemini-cli/packages/core/src/config/config.ts` | 设置 session ID，确保后续录制续写同一文件 |
| `startInteractiveUI()` | `sources/gemini-cli/packages/cli/src/gemini.tsx:577-609` | 恢复链路入口：将选中 session 传入 UI 启动 |
| `GitService.getDiff()` | `sources/gemini-cli/packages/core/src/services/gitService.ts` | Checkpoint 时捕获工作区 Git diff |
| `restore` command | `sources/gemini-cli/packages/core/src/commands/restore.ts` | Git 驱动的工作区还原命令 |

---

## 代码质量评估

**优点**

- **Conversation 录制增量写入**：`ChatRecordingService` 持续写入，非会话结束时一次性保存，进程意外退出不会全量丢失对话历史。
- **`--resume` 语义灵活**：支持 `latest`、列表序号、显式 UUID 三种方式选择历史会话，用户体验友好。
- **Checkpoint 集成 Git**：`general.checkpointing.enabled` 可选，工作区恢复通过 Git 管理，与版本控制体系天然对齐。

**风险与改进点**

- **会话存储为 JSON 文件**：JSON 文件无原子写入保证，多进程并发写同一文件时存在竞态风险，相比 SQLite 事务安全性低。
- **无 Thread 协议抽象**：恢复语义是"续写 conversation 文件"，不是重建完整 runtime 对象图，部分工具调用上下文（如待审批、运行中 tool）无法恢复。
- **无并发会话支持**：单进程模型，无法同时运行多个独立 session，相比 OpenCode thread 并发能力弱。

## 横向对齐补强：Gemini Resume 是文件会话续写

Gemini CLI 的 resume 语义更接近“选择一个历史 conversation 文件继续写”，而不是 Codex/OpenCode 的 runtime object reconstruction。

| 恢复对象 | Gemini 侧含义 | 横向对比 |
| --- | --- | --- |
| conversation JSON | 历史消息主载体 | 简单可读，但事务性弱 |
| checkpoint | 可选 Git 工作区恢复 | 对应 Codex ghost snapshot、OpenCode revert |
| tool context | 多数运行中状态不恢复 | 比 durable runtime 弱 |
| UI state | 启动后重新派生 | 不像 OpenCode 多端共享 durable projection |

后续本章应明确“恢复的是历史上下文，不是运行中 turn”，避免读者期待 pending tool 或审批能无损恢复。

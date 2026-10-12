---
title: "输入命令队列：steering、followUp 与 durable 收件箱"
---
# 输入命令队列：steering、followUp 与 durable 收件箱

> 基于 `sources/pi/packages/agent/src/agent.ts` / `agent-loop.ts` / `types.ts`、`packages/coding-agent/src/modes/` 与 `packages/durable/src/types.ts` 校对（pi `v1.1.0`）。

**目录**

- [1. 两条队列与 QueueMode](#1-两条队列与-queuemode)
- [2. 注入时机：steer 不打断工具，followUp 只在停时启动新轮](#2-注入时机steer-不打断工具followup-只在停时启动新轮)
- [3. 交互层与 RPC 的队列操作](#3-交互层与-rpc-的队列操作)
- [4. input 事件：扩展拦截终端输入](#4-input-事件扩展拦截终端输入)
- [5. durable 对照：SubmissionRecord 收件箱](#5-durable-对照submissionrecord-收件箱)

---

## 1. 两条队列与 QueueMode

pi-agent-core 的 `Agent` 内部有两个 `PendingMessageQueue`（`agent.ts:143`，实例在 `:191-192`）：`steeringQueue` 与 `followUpQueue`，分别由 `steer()`（`:299`）与 `followUp()`（`:304`）入队。每个队列有独立的放水模式 `QueueMode = "all" | "one-at-a-time"`（`types.ts:55`）：`"all"` 一次清空队列全部消息，`"one-at-a-time"` 每个注入点只取最旧一条、其余留待下次。运行时默认 `steeringMode` 为 `"one-at-a-time"`（`agent.ts:247`），即流式期间的多次纠偏按顺序逐条进入上下文，避免一次塞入压垮正在进行的回合。`Agent.prompt()` 在忙碌时抛错并提示改用 `steer()` 或 `followUp()`（`agent.ts:376`）。

## 2. 注入时机：steer 不打断工具，followUp 只在停时启动新轮

两条队列的差异完全在 **drain 点**（`agent-loop.ts`）：

| 队列 | drain 点 | 语义 |
| --- | --- | --- |
| steering | `:176` / `:205` / `:295`：回合开头、长 `prepareNextTurn` 之后、每轮工具执行完之后、下一请求之前 | 在**工具调用之间**注入；不打断正在执行的工具；若有 steering 消息则本应结束的回合继续 |
| followUp | `:302`：内层循环停止、agent 即将停止时 | 只有 agent 真的要停了才取出，作为**新一轮 prompt** 启动 |

`finishTurn` 钩子决定 `end/continue` 后，steering 的存在会把 `explicitContinuation` 压回 false（`agent-loop.ts:295-298`），模型因此总能"看到"新指令。这与 Claude Code 的 queued-user-input 相比多了顺序与节奏控制：steering 是"跑着也能插话"，followUp 是"停下再接力"。

## 3. 交互层与 RPC 的队列操作

- **交互模式**（详见 [20-repl-and-state.md](./20-repl-and-state.md) §5）：流式期间 Enter → `session.prompt(text, { streamingBehavior: "steer" })`（`interactive-mode.ts:3381`）；`app.message.followUp` 动作走 followUp 队列（`:4496`）；`getAllQueuedMessages()`（`:4691`）与 `clearAllQueues()`（`:4708`）统一检视/清空两条队列（含 compaction 期间暂存的消息）。
- **RPC 模式**：`clear_queue` 命令（`rpc-types.ts:26`）→ `session.clearQueue()`（`rpc-mode.ts:431-432`）；`steer` / `follow_up` 命令分别入队两条队列，宿主程序可远程操纵注入节奏。

## 4. input 事件：扩展拦截终端输入

队列之外还有第三条输入通道：`pi.on("input", handler)`（`core/extensions/types.ts:1636`）。扩展可拦截 TUI 的终端按键输入，返回 `InputEventResult`（`:1156`）可吞掉该输入或 **redirect** 到别处。底层 pi-tui 的输入管线先经过 `inputListeners` 集合（`tui.ts:499`，`handleTerminalInput` 在 `:920` 接入），再交给焦点组件——扩展由此实现快捷键全局捕获、自定义模式等，而不需要 fork 整个 REPL。

## 5. durable 对照：SubmissionRecord 收件箱

`PendingMessageQueue` 是**进程内**队列，进程崩溃即丢。pi-durable 给出了持久化对照：用户输入是一等持久记录 `SubmissionRecord`（`packages/durable/src/types.ts:363`），状态机为 `queued → placed → done`（`:369-385`），无法安放的被动写与未回答收件箱条目为 `unanswered`（`:393`），并用 `requestId` 去重（`:359`）保证重放幂等——恢复时收件箱里的输入可重新安放，回合继续。

| 维度 | PendingMessageQueue（agent） | SubmissionRecord（durable） |
| --- | --- | --- |
| 存储 | 进程内数组 | 持久记录（JSONL/SQLite） |
| 状态 | 无状态、即时 drain | queued/placed/done/unanswered 状态机 |
| 去重 | 无 | `requestId` |
| 崩溃语义 | 丢失 | 恢复后重放安放 |

durable 目前仍是实验路径（`src/experimental/durable/`），默认运行时用的就是前者的进程内队列。

## 源码锚点

- [`sources/pi/packages/agent/src/agent.ts`](../../sources/pi/packages/agent/src/agent.ts)：`PendingMessageQueue` 与 `steer()` / `followUp()`
- [`sources/pi/packages/agent/src/agent-loop.ts`](../../sources/pi/packages/agent/src/agent-loop.ts)：两条队列的 drain 点（`:176/:205/:295/:302`）
- [`sources/pi/packages/agent/src/types.ts`](../../sources/pi/packages/agent/src/types.ts)：`QueueMode` 定义
- [`sources/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts`](../../sources/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts)：`clear_queue` / `steer` / `follow_up` 命令
- [`sources/pi/packages/durable/src/types.ts`](../../sources/pi/packages/durable/src/types.ts)：`SubmissionRecord` 收件箱
- [`sources/pi/packages/tui/src/tui.ts`](../../sources/pi/packages/tui/src/tui.ts)：终端输入管线与扩展拦截点

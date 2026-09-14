---
title: "Agent 循环：准入、执行所有权与 Step/Attempt 模型"
---
# Agent 循环：准入、执行所有权与 Step/Attempt 模型

> 基于 `sources/opencode/specs/v2/session.md` 与 `sources/opencode/packages/core/src/session/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 循环总览](#1-循环总览)
- [2. 准入先于执行](#2-准入先于执行)
- [3. 执行是进程内所有权](#3-执行是进程内所有权)
- [4. 一个 Step 可有多个 Physical Attempt](#4-一个-step-可有多个-physical-attempt)
- [5. 工具调用的 durable 边界](#5-工具调用的-durable-边界)
- [6. 循环终止与中断](#6-循环终止与中断)

---

## 1. 循环总览

OpenCode v2 的 agent 循环由三段拼成：**Session 操作层**（准入策略、幂等性、wake 策略）-> **进程内执行协调**（`SessionRunCoordinator` + `SessionExecution`）-> **Location 作用域 runner**（历史重载、模型请求、工具执行、continuation）。与“内存里跑一个 while 循环”的实现不同，v2 每个 Step 前都从 projection 重建模型可见历史，编排不委托给内存工具循环。

## 2. 准入先于执行

`Session.prompt(...)` 的语义（`specs/v2/session.md` § Prompt Admission Precedes Execution）：

1. 先发布一条 durable `session.inbox.enqueued` 事实，其 projection 插入一行 `session_inbox`——**输入先持久化，执行只是建议性的**。
2. inbox 项在投递前不属于模型可见历史；`session.inbox.delivered` projection 消费该行并原子插入 user 或 synthetic 消息。compaction 与 move 控制项被消费但不进入 transcript。
3. 幂等性：复用 Session ID 会认领既有 Session；同 Session 同类型复用 inbox 项 ID 时**首次准入获胜**，重试的载荷、元数据与投递被忽略；跨 Session 或跨类型复用失败。
4. `resume` 只控制调度而非持久化：省略或 `true` 时记录输入并调度 `SessionExecution.wake(sessionID)`；`false` 只记录不唤醒。

投递模式分两种（详见 [23-input-command-queue.md](./23-input-command-queue.md)）：`steer` 在下一个安全 Step 边界按入队序投递；`queue` 等到空闲边界才逐条投递。新用户输入会重置所选 agent 的步数配额，一批 steer 只重置一次。

## 3. 执行是进程内所有权

`SessionExecution` 是**进程全局、仅按 Session ID 键控**的协调器（`session/execution.ts`、`session/run-coordinator.ts`）。`SessionRunCoordinator` 的本地所有权规则：

| 规则 | 语义 |
| --- | --- |
| 显式 resume | 加入同 Session 的活动执行 |
| 重复 wake | 合并为一次后续 drain |
| 不同 Session | 可以并发运行 |
| 中断 | 停止本地拥有的执行，但不删除 pending 输入 |

执行开始时会提交一条 **write-ahead claim**；成功、失败、用户中断会释放 claim，而关机中断与不干净退出会保留它。启动时，受管运行时恢复被 claim 的顶层 Session、追加 durable continuation 指令并计数恢复尝试——恢复是有界的，但**不承诺 provider 请求或工具副作用的恰好一次**（见 [16-resilience.md](./16-resilience.md)）。

`sessions.active()` 只快照本进程当前拥有的忙碌期；durable 执行事件与 claim 是历史记录，不是存活证明。

## 4. 一个 Step 可有多个 Physical Attempt

每个 Step 开始前，runner 重新加载 Session History、解析所选 agent 与模型、准备 instructions、物化工具。多数 Step 只有一次 Physical Attempt，但以下情况会产生额外 Attempt，且不重新准入输入：

- 通用重试（限流、provider 内部失败、未送达或送达状态未知的传输失败、被判为 incomplete stream 的输出）；
- continuation-state 拒绝后的立即全量重建；
- 溢出触发的 compaction 重建同一逻辑 Step。

通用重试预算为**首次请求 + 至多 4 次重试**，使用带抖动的指数退避；provider 给出更长重试延迟时从其值。细节上，durable 输出前的重试保留逻辑步号与 assistant message ID；durable 输出后的 incomplete stream 则保留失败的部分 assistant、追加 synthetic continuation 指令、换用新 assistant message ID，且共享同一重试预算。

## 5. 工具调用的 durable 边界

- 每个完整的本地工具调用在副作用开始前就是 durable 的；本地调用**急切启动、可并发**，但终态发布是串行的。
- 每个本地与托管调用都到达 durable 成功或失败后，Step 才发布唯一的 ended/failed 终态事件。
- 工具调用属于其 assistant 消息：tool-call `id` 只在一个 Step 内唯一，因此 durable 工具事件同时携带 `assistantMessageID`。
- drain 开始时的**孤儿 reconciliate**会把上一进程遗留的 streaming/running 工具 projection 判为失败，保留原始 assistant 归属，且绝不直接重放存疑的副作用。
- 本地调用有结果后，continuation 重载 projection 历史并开始新 Step——编排权始终在 runner，不在内存工具循环。

## 6. 循环终止与中断

公共 interrupt 操作先校验 durable Session 存在：未知 Session 报 `SessionNotFoundError`；已知但空闲、已 settled 或非本地拥有的 Session 是 no-op。Step 的终止条件包括：模型给出终态回答、步数配额耗尽、content-filter 归一化为失败（部分流式内容保留可见）、或触发不可恢复错误（见 [16-resilience.md](./16-resilience.md)）。

## 源码锚点

- [`sources/opencode/specs/v2/session.md`](../../sources/opencode/specs/v2/session.md)：Session 语义契约
- [`sources/opencode/packages/core/src/session/session.ts`](../../sources/opencode/packages/core/src/session/session.ts)：ID 绑定 Session 操作
- [`sources/opencode/packages/core/src/session/inbox.ts`](../../sources/opencode/packages/core/src/session/inbox.ts)：inbox 准入
- [`sources/opencode/packages/core/src/session/execution.ts`](../../sources/opencode/packages/core/src/session/execution.ts) 与 [`run-coordinator.ts`](../../sources/opencode/packages/core/src/session/run-coordinator.ts)：进程内执行所有权
- [`sources/opencode/packages/core/src/session/runner/`](../../sources/opencode/packages/core/src/session/runner)：Step/Attempt、retry、LLM 请求

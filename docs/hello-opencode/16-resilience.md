---
title: "韧性机制：窄重试、续接与有界恢复"
---
# 韧性机制：窄重试、续接与有界恢复

> 基于 `sources/opencode/specs/v2/session.md` 与 `sources/opencode/packages/core/src/session/runner/retry.ts` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 韧性策略总览](#1-韧性策略总览)
- [2. 窄而可观测的重试](#2-窄而可观测的重试)
- [3. incomplete stream 与 continuation 拒绝](#3-incomplete-stream-与-continuation-拒绝)
- [4. 溢出触发的 compaction](#4-溢出触发的-compaction)
- [5. 进程级恢复边界](#5-进程级恢复边界)

---

## 1. 韧性策略总览

v2 的韧性哲学是**窄而可观测**：只重试明确可重试的失败类别，每次重试都留下 durable 痕迹（`session.retry.scheduled`），恢复有界且计数。不信任"无限重试 + 内存状态"的隐含韧性。

## 2. 窄而可观测的重试

通用计划重试只覆盖三类失败（`session/runner/retry.ts`）：

| 类别 | 例子 |
| --- | --- |
| 限流与 provider 内部失败 | rate-limit、provider 5xx |
| 传输失败 | 未发送、或送达状态未知的请求 |
| 不完整流 | provider 输出被判为 incomplete stream |

预算与退避：首次请求 + 至多 4 次重试，带抖动的指数退避；provider 给出更长重试延迟时从其值。`session.retry.scheduled` 记录通用退避事件；后续活动或终态执行事件会清除 projection 中的重试状态。

**durable 输出前后语义不同**：输出前的重试保留逻辑步号与 assistant message ID，不消耗额外步数配额；输出后的 incomplete stream 则保留失败的部分 assistant、追加 synthetic continuation 指令、以新 assistant message ID 继续，且共享同一重试预算。

## 3. incomplete stream 与 continuation 拒绝

- provider 拒绝 continuation 状态时，允许**一次**立即的全量上下文重建，且不产生计划重试事件。
- 归一化的 content-filter finish 使 Step 失败；任何已流式输出的部分内容保持可见。

## 4. 溢出触发的 compaction

自动 compaction 开启时，provider 在 durable assistant 输出或工具执行前报告上下文溢出，runner 可做**一次**溢出触发 compaction 并重建同一逻辑 Step。以下情况都是终态失败：第二次溢出、durable 输出之后的溢出、未开启自动 compaction 时的溢出（详见 [04-state-session-memory.md](./04-state-session-memory.md) §5）。

## 5. 进程级恢复边界

- 执行 claim：进程本地忙碌期开始时提交 write-ahead claim；终态释放，不干净退出保留（见 [10-session-resume.md](./10-session-resume.md) §3）。
- 启动恢复：恢复被 claim 的顶层 Session，追加 durable continuation 指令，按 claim 有界计数。
- 明确的非承诺：无法证明被中断外部操作是否已生效，**不保证 provider 请求或工具副作用的恰好一次**；孤儿 running 工具投影在继续前被判失败。
- 事件馈送侧的韧性是隔离而非重试：慢连接独立溢出失败，健康连接按序继续（见 [08-performance.md](./08-performance.md) §2）。

## 源码锚点

- [`sources/opencode/packages/core/src/session/runner/retry.ts`](../../sources/opencode/packages/core/src/session/runner/retry.ts)：重试分类与退避
- [`sources/opencode/specs/v2/session.md`](../../sources/opencode/specs/v2/session.md)：§ Retry Is Narrow And Observable / § Recovery Boundaries Stay Explicit
- [`sources/opencode/packages/core/src/session/execution.ts`](../../sources/opencode/packages/core/src/session/execution.ts)：执行 claim

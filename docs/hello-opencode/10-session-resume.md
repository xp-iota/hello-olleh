---
title: "会话恢复：durable 回放、执行 claim 与孤儿 reconciliate"
---
# 会话恢复：durable 回放、执行 claim 与孤儿 reconciliate

> 基于 `sources/opencode/specs/v2/session.md` 与 `sources/opencode/packages/core/src/session/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 两条"恢复"路径](#1-两条恢复路径)
- [2. durable 事件回放](#2-durable-事件回放)
- [3. 崩溃恢复：write-ahead claim](#3-崩溃恢复write-ahead-claim)
- [4. 孤儿工具 projection 的 reconciliate](#4-孤儿工具-projection-的-reconciliate)
- [5. 恢复语义的边界](#5-恢复语义的边界)

---

## 1. 两条"恢复"路径

v2 把两类容易混淆的恢复显式分开：

| 路径 | 触发 | 语义 |
| --- | --- | --- |
| 会话续接（resume/continue） | 用户显式操作（CLI `--continue` / `--session`、API 调用） | 认领既有 durable Session，从 projection 读权威历史继续 |
| 崩溃恢复（crash recovery） | 进程启动时发现未释放的执行 claim | 有界地恢复被 claim 的顶层 Session |

注意：**建议性 wake 本身不是崩溃恢复**；事件回放所有权与 Session 执行所有权也是分离的——本地执行保持进程所有，直到将来引入显式 placement 与 fencing 协议的集群化。

## 2. durable 事件回放

- `sessions.log({ sessionID, after?, follow? })` 先校验 Session，再按聚合序号做排他读取。
- `follow: true` 的关键顺序是**先订阅、再回放**：在捕获的水位线发出一个同步标记后接续 live durable 事件，从而不丢"回放完成前刚好发生"的事件。
- 回放故意不含 live-only 的 text/reasoning/tool-input/compaction delta；这些只走实例级 live 流（schema 不同、无回放保证）。
- 没有独立的"有限 Session 历史 endpoint"：请求/响应消费者用权威 projection（messages、pending input、context），回放消费者用 durable 日志。

## 3. 崩溃恢复：write-ahead claim

执行在进程本地忙碌期开始时提交 write-ahead claim（见 [03-agent-loop.md](./03-agent-loop.md) §3）：

- 成功、失败、用户中断都会**释放** claim；关机中断与不干净退出会**保留** claim。
- 启动时，受管 Node 与 fetch 运行时恢复被 claim 的顶层 Session，追加一条 durable continuation 指令，并对恢复尝试计数——**恢复是有界的**（按 claim 计次），不会无限重试。
- 恢复从 durable projection 历史继续，而不是从内存状态继续。

## 4. 孤儿工具 projection 的 reconciliate

drain 开始时（在一切模型工作之前）执行孤儿 reconciliate：

- 把上一进程遗留、仍投影为 streaming 或 running 的工具调用**判为失败**；
- 保留原始 assistant 归属（`assistantMessageID`），维持 transcript 的可读性；
- **绝不直接重放存疑的副作用**——进程无法证明被中断的外部操作是否已经生效。

## 5. 恢复语义的边界

| 承诺 | 不承诺 |
| --- | --- |
| 恢复有界、可计数、可观测 | provider 请求的恰好一次 |
| 孤儿工具投影被显式失败 | 工具外部副作用的恰好一次 |
| durable 历史完整可回放 | live 增量（delta）可回放 |
| claim 随终态释放 | 不干净退出下的 claim 自动清理（这正是恢复输入） |

## 源码锚点

- [`sources/opencode/specs/v2/session.md`](../../sources/opencode/specs/v2/session.md)：§ Durable Events Are Session-Scoped / § Recovery Boundaries Stay Explicit
- [`sources/opencode/packages/core/src/session/execution.ts`](../../sources/opencode/packages/core/src/session/execution.ts)：claim 与恢复
- [`sources/opencode/packages/core/src/session/revert.ts`](../../sources/opencode/packages/core/src/session/revert.ts)、[`move.ts`](../../sources/opencode/packages/core/src/session/move.ts)、[`transfer.ts`](../../sources/opencode/packages/core/src/session/transfer.ts)：会话级状态操作
- [`sources/opencode/packages/core/src/snapshot.ts`](../../sources/opencode/packages/core/src/snapshot.ts)：快照支撑

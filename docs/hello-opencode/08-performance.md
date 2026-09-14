---
title: "性能与缓存：一次编码、有界队列与持久化成本控制"
---
# 性能与缓存：一次编码、有界队列与持久化成本控制

> 基于 `sources/opencode/specs/v2/event-stream-architecture.md`、`packages/server/` 与 `packages/core/src/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 性能策略总览](#1-性能策略总览)
- [2. 事件馈送：从 N 次编码到 1 次编码](#2-事件馈送从-n-次编码到-1-次编码)
- [3. 持久化与回放成本](#3-持久化与回放成本)
- [4. 并发与限界](#4-并发与限界)
- [5. 模型请求侧的成本控制](#5-模型请求侧的成本控制)

---

## 1. 性能策略总览

v2 的性能设计围绕三条原则：**热路径上的工作总量恒定**（编码一次、投递多次）、**每条连接独立背压**（慢连接不传染）、**durable 优先但批量化**（事件落库与 projection 同事务）。性能相关的边界分散在各层，本文按层汇总。

## 2. 事件馈送：从 N 次编码到 1 次编码

`event-stream-architecture.md` 记录了这次改动的动机：改动前每条 `/api/event` 连接各自调用 `EventV2.liveBounded`、各自注册 Core 回调并分配 dropping 队列，公共事件过滤、`OpenCodeEvent` schema 编码、`JSON.stringify`、SSE 分帧、UTF-8 编码这 5 步对每条连接独立执行——N 条 TUI 连接时每个事件的编码成本是 N 倍。

改动后（`packages/server/src/event-feed.ts`）：

| 阶段 | 执行次数 |
| --- | --- |
| Core 订阅 | 全局一次 |
| 公共事件过滤 + schema/JSON/SSE 编码 | 每事件一次 |
| 帧投递 | 每连接一次非阻塞 `Queue.offer`（共享不可变字符串，零拷贝） |

每条连接拿到容量 4 096 的 `Queue.dropping`：溢出时立即移除该队列并以 `SubscriberOverflowError` 失败，同帧继续投递其它队列，Core 发布与 Server 观察者从不为慢连接挂起。同时保留了 `liveBounded` 当初的强契约——慢订阅者可以溢出失败而不阻塞健康订阅者。

## 3. 持久化与回放成本

- 会话事件与 projection 落在 SQLite（`packages/effect-drizzle-sqlite`），会话侧读写集中在 `session/store.ts` / `session/sql.ts` / `session/projector.ts`，发布、持久化与 projection 在同一事务边界内完成。
- 回放按聚合序号排他读取（`sessions.log({ after })`），`follow: true` 先订阅再回放并发出一个同步水位标记——避免“回放与直播之间丢事件”导致的重复拉取。
- live-only 增量（text/reasoning/tool-input/compaction delta）故意不进 durable 日志，减少高频写放大；请求/响应消费者读权威 projection 而不是重放日志。

## 4. 并发与限界

| 位置 | 限界 |
| --- | --- |
| 事件馈送 | 每连接 4 096 帧 dropping 队列 |
| skill 发现 | skill 并发 4、文件并发 8（`skill/discovery.ts`） |
| 工具输出 | registry 只测量文本部分，默认保留头+尾、中间省略；超限文本落受管存储换有界预览 |
| 本地工具调用 | 急切启动、可并发，但终态发布串行 |
| 通用重试 | 首次 + 至多 4 次，带抖动指数退避，provider 给出更长延迟时从其值 |
| MCP | 启动/目录超时 30s，执行超时 12h |

## 5. 模型请求侧的成本控制

- **工具快照按请求捕获**：注册变更只影响之后的请求，避免为每次调用重建工具清单；最终 Step 保留工具定义并置 `toolChoice: "none"`，让 provider 侧缓存的 prompt 前缀存活。
- **compaction 预算**：每 Step 前按模型窗口与输出余量估算请求，只在需要时存储“滚动摘要 + 有界近期上下文”，完整 transcript 不重写。
- **instruction 增量**：来源值内容寻址（SHA-256），`instruction_blob` 只存一份；无变化时基线渲染复用存储值，不重读来源。
- **生产者侧限界**：进程类工具可先行截断/落盘输出，但必须如实报告自身损失——限界责任分层，registry 的限界不替代生产者的。

## 源码锚点

- [`sources/opencode/specs/v2/event-stream-architecture.md`](../../sources/opencode/specs/v2/event-stream-architecture.md)：馈送决策与背压法则
- [`sources/opencode/packages/server/src/event-feed.ts`](../../sources/opencode/packages/server/src/event-feed.ts)：`SubscriberCapacity = 4096` 与投递实现
- [`sources/opencode/packages/effect-drizzle-sqlite/`](../../sources/opencode/packages/effect-drizzle-sqlite)：持久化支撑
- [`sources/opencode/packages/core/src/session/runner/retry.ts`](../../sources/opencode/packages/core/src/session/runner/retry.ts)：重试预算

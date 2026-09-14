---
title: "性能：异步总线、上下文预算与流式"
---
# 性能：异步总线、上下文预算与流式

> 基于 `sources/nanobot/nanobot/bus/`、`sources/nanobot/nanobot/agent/context_governance.py` 与 `sources/nanobot/nanobot/session/manager.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 性能设计基调](#1-性能设计基调)
- [2. 消息总线与并发](#2-消息总线与并发)
- [3. 上下文治理预算](#3-上下文治理预算)
- [4. 会话与记忆的成本控制](#4-会话与记忆的成本控制)
- [5. 流式路径](#5-流式路径)

---

## 1. 性能设计基调

nanobot 的性能目标是"个人助手级别的低延迟与低资源"，不是高吞吐：单进程 asyncio、文件系统持久化、无外部服务依赖。优化集中在三处：消息流转不阻塞、送给模型的上下文有硬预算、长会话的成本有上限。

## 2. 消息总线与并发

- `bus/queue.py` 的 `MessageBus` 是 asyncio 队列：`publish_inbound` / `consume_inbound` / `publish_outbound` / `consume_outbound`，渠道生产、AgentLoop 消费、渠道再消费出站，全链路无锁；
- 常驻形态下 channels、cron、triggers 是并行 asyncio task（`create_task(..., name="nanobot-channels")` 等命名任务，便于诊断）；
- 工具执行可选并发：`AgentRunSpec.concurrent_tools` 打开后 runner 并行跑同一迭代的多个 tool call；
- `_cancel_active_tasks(session_key)` 按会话键取消在途任务，`/stop` 命令即时生效。

## 3. 上下文治理预算

`agent/context_governance.py` 的 `ContextGovernor` 是送给模型前的最后一道闸门：

| 方法 | 作用 |
| --- | --- |
| `prepare_for_model` | 总入口：按序执行下面各项治理 |
| `normalize_tool_result` | 统一工具结果形状 |
| `strip_malformed_tool_calls` | 剔除畸形 tool call 消息 |
| `drop_orphan_tool_results` / `backfill_missing_tool_results` | 孤儿 tool result 丢弃、缺失的补齐占位——保证消息序列对 provider 合法 |
| `apply_tool_result_budget` | 工具结果字符预算（配合 `max_tool_result_chars`） |
| `compact_inflight_overflow` | 在途消息超上下文窗口时压缩 |

这套治理保证"无论历史多脏，发出的请求都是 provider 能接受的"，把上下文损坏从运行时错误降级为可恢复行为。

## 4. 会话与记忆的成本控制

- 回放上限：`replay_max_messages_for_context(context_window_tokens)` 按模型上下文窗口限制回放条数，老消息不进 prompt；
- 文件上限：`Session.enforce_file_cap` + archiver 归档，防止 JSONL 无限增长；
- 闲置压缩：AutoCompact 把闲置会话的旧段搬进记忆（见 [04-state-session-memory.md](./04-state-session-memory.md)）；
- 历史游标：MemoryStore 的 cursor 机制让 Dream 增量消费，不全量重读。

## 5. 流式路径

`_request_model` 支持流式 delta（`_stream`）、思考流（`_thinking`）、流恢复（`_stream_recover`）与进度流（`_stream_progress`）；CLI 侧 `StreamRenderer` 增量渲染 Markdown，WebUI 经 `StreamedResponseEvent`（`bus/outbound_events.py`）推送。流式是默认开的（`stream_progress_deltas: bool = True`），可在 spec 层关闭。

## 源码锚点

- [`sources/nanobot/nanobot/bus/queue.py`](../../sources/nanobot/nanobot/bus/queue.py)：MessageBus
- [`sources/nanobot/nanobot/agent/context_governance.py`](../../sources/nanobot/nanobot/agent/context_governance.py)：ContextGovernor
- [`sources/nanobot/nanobot/session/manager.py`](../../sources/nanobot/nanobot/session/manager.py)：回放与文件上限

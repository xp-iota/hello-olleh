---
layout: content
title: "Codex 可观测性：日志、追踪与监控"
---
# Codex 可观测性：日志、追踪与监控

本文档分析 Codex 的可观测性基础设施。


**目录**

- [1. 可观测性在 Codex 里的现状](#1-可观测性在-codex-里的现状)
- [2. 日志系统](#2-日志系统)
- [3. 线程状态追踪](#3-线程状态追踪)
- [4. 日志数据库](#4-日志数据库)
- [5. 与 OpenCode 的完整可观测性对比](#5-与-opencode-的完整可观测性对比)
- [6. 改进建议](#6-改进建议)
- [7. 关键源码锚点](#7-关键源码锚点)
- [8. 总结](#8-总结)

---

## 1. 可观测性在 Codex 里的现状

### 1.1 基本架构

Codex 的可观测性相比 OpenCode 较为基础，主要依赖：

- **tracing 日志**：Rust 的 structured logging
- **线程事件**：Thread/Turn/ThreadItem 状态变化
- **数据库日志**：SQLite logs 表

### 1.2 与 OpenCode 的对比

| 特性 | OpenCode | Codex |
| --- | --- | --- |
| 结构化日志 | Log + 文件轮转 | tracing crate |
| 事件总线 | Bus + GlobalBus | 无专用事件总线 |
| 状态追踪 | SessionStatus | ThreadState |
| 可配置观测 | 丰富 | 基础 |

---

## 2. 日志系统

### 2.1 tracing crate

Codex 使用 Rust 的 `tracing` crate。TUI 主循环和工具任务会在异常路径上写 `warn!`/`debug!`/`error!`，例如 app-server shutdown、terminal input stream closed、用户 shell command failed 等（`sources/codex/codex-rs/tui/src/app.rs:686`, `sources/codex/codex-rs/tui/src/app.rs:1025`, `sources/codex/codex-rs/core/src/tasks/user_shell.rs:274`）。

```rust
tracing::info!("Starting thread");
tracing::debug!("Processing turn");
tracing::warn!("Retry attempt {}", attempt);
tracing::error!("Connection failed: {}", error);
```

### 2.2 事件输出

| 输出目标 | 说明 |
| --- | --- |
| protocol event | `EventMsg` 承载 turn、tool、approval、error 等 UI/SDK 可见事件 |
| tracing | core/TUI 内部诊断，主要面向开发者 |
| rollout/state | 历史回放与 resume 相关记录 |

`EventMsg` 是更重要的可观测性骨架：协议层枚举事件类型（`sources/codex/codex-rs/protocol/src/protocol.rs:1515`），regular turn 直接发出 `TurnStarted`（`sources/codex/codex-rs/core/src/tasks/regular.rs:47`），工具执行由 `ToolEmitter` 发出 begin/end/failure 事件（`sources/codex/codex-rs/core/src/tools/events.rs:151`）。

---

## 3. 线程状态追踪

### 3.1 AppEvent 与 EventMsg

Codex 并不是靠一个单独 `ThreadState` 枚举完成观测，而是把 UI 内部事件、协议事件和工具事件分层：

| 层 | 源码锚点 | 触发时机 |
| --- | --- |
| TUI app event | `sources/codex/codex-rs/tui/src/app_event.rs:105` | UI 组件、后台请求、thread routing 之间的内部消息 |
| protocol event | `sources/codex/codex-rs/protocol/src/protocol.rs:1515` | core 对 TUI/SDK 暴露的稳定事件 |
| turn lifecycle | `sources/codex/codex-rs/core/src/tasks/regular.rs:47` | 回合开始 |
| tool lifecycle | `sources/codex/codex-rs/core/src/tools/events.rs:74` | exec/apply_patch begin/end/failure |
| timing state | `sources/codex/codex-rs/core/src/turn_timing.rs:43` | TTFT/TTFM 统计 |

---

## 4. 诊断与历史记录

Codex 的“可观测性”更接近三条链路：

| 链路 | 源码锚点 | 说明 |
| --- | --- | --- |
| 事件流 | `sources/codex/codex-rs/protocol/src/protocol.rs:1515` | TUI/SDK 可消费的 turn/tool/approval/error 事件 |
| 工具事件 | `sources/codex/codex-rs/core/src/tools/events.rs:151` | 将 exec/apply_patch begin/end/failure 映射成 protocol events |
| 反馈诊断 | `sources/codex/codex-rs/feedback/src/feedback_diagnostics.rs:14` | 收集 connectivity diagnostics 供用户反馈附带 |
| rollout reconstruction | `sources/codex/codex-rs/core/src/session/rollout_reconstruction_tests.rs:1289` | 测试覆盖历史事件重建与 resume 边界 |
| UI 路由 | `sources/codex/codex-rs/tui/src/app.rs:993` | TUI 主循环集中处理 app event、thread event、terminal event、app-server event |

---

## 5. 与 OpenCode 的完整可观测性对比

### 5.1 OpenCode 的三支柱

OpenCode 有更完整的可观测性：

1. **结构化日志**：`util/log.ts` 带 service tag、时间差、文件轮转
2. **实例内事件总线**：`Bus` 按 instance scope 的 typed pub/sub
3. **进程级全局广播**：`GlobalBus` 跨 instance 传递事件

### 5.2 Codex 缺少的机制

| 能力 | OpenCode 有 | Codex 状态 |
| --- | --- | --- |
| 专用事件总线 | Bus + GlobalBus | 无 |
| 日志文件轮转 | 10 个文件保留 | 无 |
| SessionStatus | idle/busy/retry 状态机 | 无 |
| 实时事件订阅 | SSE/WebSocket | 无 |
| Structured Logging | 带 service tag | tracing 基础 |

---

## 6. 改进建议

### 6.1 短期增强

1. **增加日志文件轮转**：防止日志无限增长
2. **实现基本事件总线**：支持状态变化的实时通知
3. **增强 ThreadState**：添加 WaitingForPermission 等更多状态

### 6.2 长期规划

| 能力 | 实现建议 |
| --- | --- |
| 事件总线 | 参考 OpenCode Bus 实现 |
| 日志轮转 | 实现 10 文件保留策略 |
| 运行时指标 | 接入 OpenTelemetry |
| 分布式追踪 | 实现 trace context |

---

## 7. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| 协议事件枚举 | `sources/codex/codex-rs/protocol/src/protocol.rs:1515` | UI/SDK 消费的主事件集合 |
| TUI 内部事件 | `sources/codex/codex-rs/tui/src/app_event.rs:105` | UI 组件与 app loop 的内部消息总线 |
| 主循环 select | `sources/codex/codex-rs/tui/src/app.rs:993` | 同时监听 app event、thread event、terminal event 和 app-server event |
| 工具事件映射 | `sources/codex/codex-rs/core/src/tools/events.rs:151` | exec/apply_patch 事件发射 |
| turn timing | `sources/codex/codex-rs/core/src/turn_timing.rs:43` | TTFT/TTFM 统计状态 |
| feedback diagnostics | `sources/codex/codex-rs/feedback/src/feedback_diagnostics.rs:14` | 反馈附件诊断结构 |

---

## 8. 总结

Codex 的可观测性相比 OpenCode 较为基础，但不是“没有结构”：

1. **protocol event**：稳定表达 turn、tool、approval、error。
2. **tracing 日志**：Rust/TUI 内部诊断。
3. **rollout/history**：支撑 resume、undo、回放和调试。

缺少 OpenCode 的专用事件总线（Bus/GlobalBus）、日志文件轮转、SessionStatus 状态机等高级机制。对于基础调试场景，当前架构足以支撑；对于跨 CLI/TUI/app-server/SDK 的全链路追踪，还需要统一 trace id。

---

> 关联阅读：[05-state-management.md](./04-state-session-memory.md) 了解线程状态、持久化与回放链路。

---

## 代码质量评估

**优点**

- **`tracing` crate 结构化日志**：Rust 端使用 `tracing` 提供 span/event 层级日志，可接入 OpenTelemetry collector，远优于 `console.log` 型日志。
- **日志 SQLite 持久化**：事件持久化到数据库而非纯文件，支持时间戳索引查询，长期调试可回溯历史事件。
- **线程状态追踪内置**：`ThreadState`/`TurnState` 是核心运行时对象，状态变更路径有记录，Thread 生命周期可追踪。

**风险与改进点**

- **JS 层日志与 Rust 层 tracing 不统一**：JS 侧使用 `console.log`，Rust 侧使用 `tracing`，跨边界的调试需要同时看两套日志，关联困难。
- **`tracing` 输出默认不暴露给用户**：开发者需主动配置 subscriber 才能看到 trace 输出，默认 release 构建中 trace 信息被编译优化掉，生产调试能力弱。
- **无全局 Trace ID**：单次请求跨越 JS→Rust 边界、submission_loop、多工具并发时，没有统一的 trace_id 关联所有事件，多层调试需手动对齐时间戳。

## 横向对齐补强：Codex 需要统一 Rust event 与外部 SDK 日志

Codex 的可观测性强在 runtime event 结构，弱在跨边界关联。横向分析应围绕 trace id 串起 CLI/TUI/app-server/SDK。

| 信号 | Codex 侧来源 | 对齐对象 |
| --- | --- | --- |
| thread event | Rust session/thread state | OpenCode durable event、Claude stream event |
| tracing | Rust core internal diagnostics | Gemini console/log service |
| approval event | tools/sandboxing/orchestrator | 四项目工具治理共用指标 |
| SDK event | JSON protocol consumer | bridge/transport 横向章节 |

横向看，Codex 最需要补“跨协议相关性”：一次用户 prompt 应能串起 input、turn、LLM request、tool call、approval、final event。

## 单次 Prompt Trace 口径

| Trace 阶段 | Codex 侧信号 | 需要关联的字段 |
| --- | --- | --- |
| 输入提交 | TUI / app-server submission | thread id、turn id、source |
| Prompt 构造 | core turn / prompt fields | model、instructions、tools、parallel_tool_calls |
| Provider stream | client request/response event | request id、model、retry count、finish reason |
| Tool governance | orchestrator approval/sandbox event | tool name、approval decision、sandbox policy |
| Tool result | handler output / thread item | call id、output length、truncation state |
| SDK/UI 投影 | protocol/app-server event | event seq、consumer、delivery status |

这张表给后续埋点和调试文档一个统一口径：不是单独增加日志量，而是确保每一层能用同一个 thread/turn/request 维度被串起来。

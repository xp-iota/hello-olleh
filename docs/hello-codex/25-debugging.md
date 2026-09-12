---
layout: content
title: "调试指南"
---
# 调试指南

本文介绍 Codex 的调试方法。

**目录**

- [1. 调试标志](#1-调试标志)
- [2. 日志配置](#2-日志配置)
- [3. 关键源码](#3-关键源码)
- [4. IDE 调试](#4-ide-调试)
- [5. 常见调试技巧](#5-常见调试技巧)

---

## 1. 调试标志

| 标志 | 说明 |
| :------| :------|
| `RUST_LOG=level` | 设置 Rust 日志级别 (error, warn, info, debug, trace) |
| `RUST_LOG=crate=level` | 按 crate 设置日志级别 |
| `--debug` | 子命令: `codex debug` |

**可用子命令**:

```bash
codex debug app-server        # 调试 app server
codex debug clear-memories    # 清除本地记忆状态
```

## 2. 日志配置

Codex 使用 `tracing_subscriber` 进行日志管理。

**默认日志级别**:

```
codex_core=info,codex_tui=info,codex_rmcp_client=info
```

**自定义日志级别**:

```bash
# 所有 crate 设为 debug
RUST_LOG=debug codex

# 特定 crate
RUST_LOG=codex_core=debug,codex_tui=trace codex

# 模式匹配
RUST_LOG=codex_tui::app=debug codex
```

**日志文件**: `~/.codex/logs/codex-tui.log`

## 3. 关键源码

| 文件 | 功能 |
| :------| :------|
| `codex-rs/tui/src/lib.rs:822-840` | `tracing_subscriber` 配置 |
| `codex-rs/cli/src/main.rs:163-176` | Debug 子命令定义 |
| `codex-rs/core/src/otel_init.rs` | OpenTelemetry 初始化 |

## 4. IDE 调试

### Rust (LLDB/GDB)

```bash
# 开发模式运行
cargo run --bin codex

# 调试模式
RUST_LOG=debug cargo run --bin codex
```

### VS Code (Rust Analyzer)

- 安装 rust-analyzer 扩展
- 使用 "Cargo: Run (debug)" 任务

### Bazel 调试

```bash
# 构建
bazel build //cli:codex

# 运行
bazel run //cli:codex -- --debug
```

## 5. 常见调试技巧

### 过滤日志

```bash
# 只看核心模块 debug
RUST_LOG=codex_core::client=debug codex

# 查看所有 trace
RUST_LOG=trace codex
```

### 查看日志文件

```bash
tail -f ~/.codex/logs/codex-tui.log
```

### 沙箱调试

```bash
codex sandbox macos -- your command
codex sandbox linux -- your command
```

---

*文档版本: 1.0*
*分析日期: 2026-04-06*

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `RUST_LOG` env | `codex-rs/cli/src/main.rs` | 控制 `tracing` 日志级别：`RUST_LOG=codex=debug` 开启详细日志 |
| `tracing::instrument` macro | `codex-rs/core/src/*.rs` | 函数级追踪宏：自动记录函数进入/退出和参数 |
| `DebugDump::write()` | `codex-rs/core/src/debug.rs` | 将当前 session 状态（messages/tools/config）导出为 JSON |
| `--replay` flag | `codex-rs/cli/src/args.rs` | 从历史文件重放对话，用于复现 bug 时的确定性输入 |
| `SandboxAuditLog` | `codex-rs/exec/src/sandbox.rs` | 记录沙盒内所有文件操作：用于事后审计工具调用行为 |
| `PanicSummary` | `codex-rs/cli/src/main.rs` | 顶层 panic 格式化：输出结构化错误信息和 github issue 链接 |

---

## 代码质量评估

**优点**

- **`tracing` 生态集成完整**：Rust `tracing` crate 提供结构化日志和 span 追踪，与 `RUST_LOG` 过滤器配合灵活调整粒度。
- **`--replay` 确定性重放**：从历史文件重放消息可精确复现 bug，避免依赖真实 LLM 响应的不确定性。
- **Panic 友好化输出**：`PanicSummary` 将底层 Rust panic 转换为用户可读的错误信息，降低用户对内部崩溃的困惑。

**风险与改进点**

- **调试日志缺少结构化查询工具**：`RUST_LOG=debug` 输出纯文本，无内置日志聚合或查询 UI，大量日志中定位问题依赖手动 grep。
- **`DebugDump` 包含敏感信息**：dump 输出包含完整的对话历史和 API key（若通过 env），无脱敏处理，不宜直接分享。
- **`--replay` 依赖历史文件格式稳定**：histor 文件格式变更会导致旧 `--replay` 文件失效，影响历史 bug 复现能力。

## 横向对齐补强：Codex 调试应围绕 thread event 和 Rust tracing

Codex 调试路径要把 Rust tracing、thread/turn events、tool approval、sandbox failure 和 SDK JSON protocol 串起来。

| 调试目标 | 推荐入口 |
| --- | --- |
| turn loop | `RUST_LOG` + session/turn event |
| tool/sandbox | approval/sandboxing/orchestrator logs |
| transport | client.rs request/stream logs |
| resume/replay | rollout/session reconstruction |
| SDK | JSON event protocol dump |

## 按症状定位

| 症状 | 优先看哪里 | 关键判断 |
| --- | --- | --- |
| 卡在审批 | approval policy、orchestrator 等待点、TUI approval response | 是没有收到用户决策，还是 policy 计算为必须询问 |
| 工具无输出 | tool handler、sandbox runtime、tool result 格式化 | 是命令未启动、stdout 被截断，还是结果未回注 |
| Stream 断开 | client.rs provider stream、transport tracing、retry/backoff | 是 provider 断流、网络重试，还是 JSON event 解析失败 |
| Resume 异常 | rollout replay、thread/session reconstruction、ghost snapshot | 是历史记录损坏，还是运行中状态被错误期待恢复 |
| Sandbox 失败 | sandbox policy、platform runtime、approval escalation | 是 OS 不支持、策略拒绝，还是权限升级未生效 |
| SDK 事件错乱 | app-server tracing、protocol event dump | 是 core event 顺序问题，还是 SDK 消费端处理问题 |

最小复现路径优先使用 `RUST_LOG` 缩小模块，再配合 debug 子命令或 replay/rollout 文件固定输入。不要先修改工具代码；先确认问题发生在 provider、orchestrator、sandbox、protocol 还是 UI 消费层。

## 源码锚点补强：调试应从 tracing、debug 子命令和 app-server 事件开始

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/tui/src/lib.rs:913` | TUI tracing / `RUST_LOG` 配置 | 对应 Gemini `debugLogger` |
| `sources/codex/codex-rs/tui/src/lib.rs:952` | OpenTelemetry provider 初始化 | 对应可观测性章节 |
| `sources/codex/codex-rs/core/src/otel_init.rs:13` | OTEL provider 构造入口 | 说明 core 也有结构化遥测 |
| `sources/codex/codex-rs/cli/src/main.rs:201` | `debug` 子命令结构 | 调试入口不是只靠日志 |
| `sources/codex/codex-rs/cli/src/main.rs:1241` | `debug prompt-input` 执行入口 | 对应输入解析调试 |
| `sources/codex/codex-rs/app-server/src/app_server_tracing.rs:87` | app-server transport tracing 维度 | 对应 SDK/Transport 调试 |

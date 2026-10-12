---
title: "用户输入、命令解析与 Mailbox 队列系统"
---
# 用户输入、命令解析与 Mailbox 队列系统

本篇梳理 Codex 中用户提交输入后，系统如何完成命令解析、邮箱队列管理和跨 Agent 通信的完整流程。

**目录**

- [1. 核心架构概述](#1-核心架构概述)
- [2. 整体流程图](#2-整体流程图)
- [3. CLI 入口与子命令](#3-cli-入口与子命令)
- [4. TUI 事件循环](#4-tui-事件循环)
- [5. Mailbox：Agent 间通信队列](#5-mailboxagent-间通信队列)
- [6. Submission / Event Queue 模式](#6-submission-event-queue-模式)
- [7. 命令规范化 (Command Canonicalization)](#7-命令规范化-command-canonicalization)
- [8. 命令解析 (ParsedCommand)](#8-命令解析-parsedcommand)
- [9. Exec 模块](#9-exec-模块)
- [10. 与 Claude Code 的差异](#10-与-claude-code-的差异)
- [11. 关键源码锚点](#11-关键源码锚点)
- [12. 总结](#12-总结)

---

## 1. 核心架构概述

Codex 的输入处理涉及以下核心模块：

| 模块 | 路径 | 职责 |
| :------| :------| :------|
| CLI 入口 | `codex-rs/cli/src/main.rs` | 命令行解析，启动 TUI 或 headless |
| TUI | `codex-rs/tui/src/lib.rs` | 交互式界面，事件循环 |
| CodexThread | `codex-rs/core/src/codex_thread.rs` | 主 agent 线程封装 |
| Mailbox | `codex-rs/core/src/agent/control/mailbox.rs` | Agent 间通信队列 |
| Protocol | `codex-rs/protocol/src/protocol.rs` | Submission/Event 队列协议 |
| 命令规范化 | `codex-rs/core/src/command_canonicalization.rs` | 命令标准化（用于审批缓存） |
| Exec | `codex-rs/core/src/exec.rs` | 命令执行与沙箱 |

## 2. 整体流程图

![整体流程图](diagrams/23-input-command-queue-diagram-01.svg)

**整体流程图** — [交互版](diagrams/23-input-command-queue-diagram-01.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/23-input-command-queue-diagram-01.architecture.json)

- **组成**：16 个节点
- **关系**：源图 15 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：CLI main.rs → 是否有子命令? · 是否有子命令? → codex_exec::run_main（exec） · 是否有子命令? → McpCli::run（mcp）

## 3. CLI 入口与子命令

### 3.1 主入口

`codex-rs/cli/src/main.rs` 定义 `MultitoolCli` 子命令枚举，`cli_main()` 解析后按子命令分派；不带子命令时进入交互式 TUI（`run_interactive_tui()`）。核心子命令的声明位置：

| 子命令 | 声明 | 功能 |
| :--------| :------| :------|
| `exec` | `codex-rs/cli/src/main.rs:156` | Headless 命令执行 |
| `mcp` | `codex-rs/cli/src/main.rs:168` | MCP 管理命令（`cli/src/mcp_cmd.rs`）|
| `resume` | `codex-rs/cli/src/main.rs:207` | 恢复历史会话 |
| `app-server` | `codex-rs/cli/src/main.rs:174` | 独立 app-server 进程 |
| (无) | TUI | 交互式模式 |

## 4. TUI 事件循环

### 4.1 主循环

TUI 的入口是 `run_main()`（`codex-rs/tui/src/lib.rs:1092`）：组装配置、启动（本地或 daemon 模式的）app-server，然后进入渲染与事件分发主循环（`codex-rs/tui/src/app/startup.rs:1238` 的 `select!`）。用户输入不直接构造 core `Op`，而是包装成 app-server 的 `turn/start` 请求提交；线程事件经 app-server 订阅回流后由 `App::handle_tui_event()`（`codex-rs/tui/src/app.rs:846`）分发到各 widget。

### 4.2 CodexThread

`CodexThread`（定义在 `codex-rs/core/src/codex_thread.rs:208`）是主 agent 线程实例，由 `ThreadManager` 创建。它通过 `session/handlers.rs` 的 `submission_loop()`（:439）消费 `Op` 提交：`Op::TurnInput`（:541）触发 `run_turn()`（`session/turn.rs:163`），事件经 thread 的 channel 回流给订阅方。

## 5. Mailbox：Agent 间通信队列

### 5.1 核心结构

多代理之间的消息队列由 `Mailboxes` 管理（`codex-rs/core/src/agent/control/mailbox.rs:15`），每个目标 agent 一个 `Mailbox`，承载 `InterAgentCommunication` 消息：

```rust
// codex-rs/core/src/agent/control/mailbox.rs:23-31

struct Mailbox {
    pending: Vec<StoredMail>,
    state: watch::Sender<bool>,   // pending 是否非空，供订阅方 await
}

struct StoredMail {
    id: Option<String>,
    communication: InterAgentCommunication,
    // ...
}
```

`InterAgentCommunication`（`codex-rs/protocol/src/protocol.rs:822`）携带 author/recipient 路径、文本内容与 trigger_turn 标记，是多代理消息的协议化载体。

### 5.2 待处理通知机制

![待处理通知机制](diagrams/23-input-command-queue-diagram-02.svg)

**待处理通知机制** — [交互版](diagrams/23-input-command-queue-diagram-02.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/23-input-command-queue-diagram-02.sequence.json)

- **组成**：4 个参与方
- **关系**：投递 → 置位 → 订阅 → 取走 → 复位 · 每个目标 agent 一个 Mailbox（mailbox.rs:24）
- **要点**：Mailboxes 自调用：retain 回收空邮箱（mailbox.rs:87） · take() 时发射 agent 通信接收事件

每个 `Mailbox` 用 `watch::Sender<bool>` 广播"pending 是否非空"：`enqueue()` 投递消息后置位，`take()` 取走全部消息后复位，目标 agent 在处理循环中等待该状态变化后再取消息。

## 6. Submission / Event Queue 模式

### 6.1 SQ/EQ 模式

输入侧的 submission 是协议化类型 `Submission`（`codex-rs/core/src/session/submission.rs:8`）：携带 `Op`、可选 `W3cTraceContext` 与 turn 关联 id，经 `submit_with_trace()`（`codex-rs/core/src/session/mod.rs:1007`）进入 core 的提交队列；事件侧由 thread 的 event channel 回流，形成"submission 进、event 出"的双队列模式。

### 6.2 Op 类型

```rust
// codex-rs/protocol/src/protocol.rs:576

pub enum Op {
    // ...
    Interrupt,
    TurnInput {
        request: Box<TurnInputRequest>,
        mode: TurnInputMode,
        reply: oneshot::Sender<...>,
    },
    // ...（审批、apply_patch、用户输入应答等操作）
}
```

用户 turn 以 `Op::TurnInput`（:617）提交，取消走独立的 `Op::Interrupt`（:579）。

## 7. 命令规范化 (Command Canonicalization)

### 7.1 目的

命令规范化用于**审批缓存**：相同逻辑的命令即使文本略有不同，也能匹配到之前的审批决策。

```rust
// codex-rs/core/src/command_canonicalization.rs

pub(crate) fn canonicalize_command_for_approval(command: &[String]) -> Vec<String> {
    // `bash -lc "纯命令"` 之类包装：剥掉 wrapper，原样返回单一命令
    if let Some(commands) = parse_shell_lc_plain_commands(command)
        && let [single_command] = commands.as_slice()
    {
        return single_command.clone();
    }
    // 复杂 bash 脚本：保留脚本原文，加协议前缀与 shell 模式
    if let Some((_shell, script)) = extract_bash_command(command) {
        let shell_mode = command.get(1).cloned().unwrap_or_default();
        return vec![
            CANONICAL_BASH_SCRIPT_PREFIX.to_string(),   // "__codex_shell_script__"
            shell_mode,
            script.to_string(),
        ];
    }
    // PowerShell 脚本：加协议前缀
    if let Some((_shell, script)) = extract_powershell_command(command) {
        return vec![
            CANONICAL_POWERSHELL_SCRIPT_PREFIX.to_string(), // "__codex_powershell_script__"
            script.to_string(),
        ];
    }
    command.to_vec()
}
```

### 7.2 规范化策略

| 原始 | 规范化后 |
| :------| :----------|
| `bash -lc "echo hi"` | `echo hi`（剥掉 wrapper，还原纯命令）|
| `bash -c "复杂; 脚本"` | `__codex_shell_script__ <mode> <脚本原文>` |
| `powershell -Command "dir"` | `__codex_powershell_script__ <脚本原文>` |
| `/usr/bin/python3 script.py` | 保持原样（不匹配任何 shell 包装模式）|

## 8. 命令解析 (ParsedCommand)

### 8.1 解析类型

```rust
// codex-rs/protocol/src/parse_command.rs

pub enum ParsedCommand {
    Read { cmd: String, name: String, path: PathBuf },
    ListFiles { cmd: String, path: Option<String> },
    Search { cmd: String, query: Option<String>, path: Option<String> },
    Unknown { cmd: String },
}

// 解析结果随 ResponseItem 携带（protocol/src/items.rs:266 的 parsed_cmd 字段），
// 供审批链和安全判断复用
```

## 9. Exec 模块

### 9.1 命令执行流程

![命令执行流程](diagrams/23-input-command-queue-diagram-03.svg)

**命令执行流程** — [交互版](diagrams/23-input-command-queue-diagram-03.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/23-input-command-queue-diagram-03.architecture.json)

- **组成**：10 个节点
- **关系**：源图 10 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：execute command → 沙箱策略 · 沙箱策略 → SandboxedExec（需要沙箱） · 沙箱策略 → DirectExec（直接执行）

### 9.2 沙箱集成

`codex-rs/core/src/exec.rs` 承载命令执行主链路：`process_exec_tool_call()`（:302）接收工具调用，`build_exec_request()`（:341）组装执行请求，`execute_exec_request()`（:445）落地执行。执行前会结合审批策略与沙箱策略决定运行方式；命令会先经过规范化，使审批缓存能按规范化形态命中。

## 10. 与 Claude Code 的差异

| 特性 | Claude Code | Codex |
| :------| :-------------| :-------|
| 入口架构 | TypeScript REPL | Rust CLI + TUI |
| 队列实现 | `messageQueueManager.ts` + React hooks | `agent/control/mailbox.rs`（Vec + watch channel）|
| 并发控制 | `QueryGuard` 状态机 | watch channel 通知待处理消息 |
| 命令解析 | `processSlashCommand.tsx` | `parse_command.rs` |
| 命令规范化 | 无 (直接字符串匹配) | `command_canonicalization.rs` |
| 执行策略 | `execPolicy.rs` | 同上 |

## 11. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| :------| :----------| :------|
| CLI 入口 | `codex-rs/cli/src/main.rs` | 子命令解析 |
| TUI 主循环 | `codex-rs/tui/src/lib.rs:1092` | `run_main()` |
| CodexThread | `codex-rs/core/src/codex_thread.rs` | Agent 线程封装 |
| Mailbox | `codex-rs/core/src/agent/control/mailbox.rs` | 通信队列 |
| Protocol | `codex-rs/protocol/src/protocol.rs` | SQ/EQ 模式 |
| 命令规范化 | `codex-rs/core/src/command_canonicalization.rs` | 审批缓存支持 |
| Exec | `codex-rs/core/src/exec.rs` | 命令执行 |

## 12. 总结

Codex 的输入层特点：

1. **Rust-first 架构**：核心逻辑在 Rust，追求性能与安全
2. **Mailbox 模式**：Agent 间的协议化消息投递（`Mailboxes` + `InterAgentCommunication`）
3. **Submission 队列**：`Op` 提交经 `submit_with_trace()` 进入 core，事件经 thread channel 回流
4. **命令规范化**：为审批缓存提供稳定匹配
5. **沙箱优先**：命令执行默认考虑沙箱隔离

---

*文档版本: 1.0*
*分析日期: 2026-04-06*

---

## 跨工具横向对比

本章（Codex）与同主题其他工具的差异：

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :------------| :-------| :------------| :----------|
| 核心主题 | Slash 命令 + QueryGuard 并发控制 | Mailbox + Command Canonicalization + Exec | CommandService + Shell 状态 | PromptInput 编译 + Durable Message |
| 独有机制 | `QueryGuard` 防并发 query | `Mailbox` 跨 Agent 通信 | `Shell 状态管理` | `Part` 编译类型系统 |
| 命令返回 | 可改变工具/模型/effort | 命令规范化元数据 | CommandService 统一分发 | 模板化 command 编译 |
| 架构驱动 | 单 Agent，query 并发控制 | 多 Agent，Mailbox 通信 | 单 Agent，Shell 状态隔离 | Durable State，输入即消息 |

**要点**：Codex 因有多 Agent 架构（含 child-agents），其队列系统加入了 Mailbox 机制和命令规范化，远比其他三个工具复杂；其他三者均面向单 Agent，核心问题是"slash 命令解析 + 输入队列调度"。

## Codex 输入队列要包含 Mailbox 和多代理消息

Codex 的输入队列复杂度高于其他项目，因为普通用户 prompt、slash command、child-agent mailbox、approval response 都可能进入同一 session/turn 调度面。

| 输入类型 | Codex 侧处理 | 横向对比 |
| --- | --- | --- |
| 用户 prompt | submission loop -> turn | 四项目共享 |
| slash command | 解析后规范化为 submission | 对应 Gemini/OpenCode command |
| child-agent message | mailbox / multi-agent handler | Codex 特有复杂度 |
| approval response | 工具运行时等待用户决策 | 对应工具治理章节 |

## 当前 Turn 中断与排队规则

| 输入/事件 | 对当前 turn 的影响 | 进入位置 | 横向对齐 |
| --- | --- | --- | --- |
| 普通用户 prompt | 忙碌时排队或等待当前 turn 结束 | TUI submission / protocol submission | 对应 Gemini message queue |
| Slash command | 若是本地 UI 命令可立即处理；若转为 prompt 则排队 | command parser -> submission | 对应 Claude slash command |
| Approval response | 唤醒当前等待中的 tool，不开启新 turn | approval channel / orchestrator wait point | 对应 OpenCode permission ask |
| Cancel/interrupt | 中断当前 turn，取消 token 生效 | turn control path | 对应 Claude QueryGuard / Gemini abort |
| Child-agent mailbox | 作为 multi-agent 消息进入目标 agent | mailbox / handler | Codex 特有 |
| Resume/fork request | 不插入当前 turn，而是创建/恢复 thread | ThreadManager start/resume/fork | 对应 session resume 章节 |

因此 Codex 的“输入队列”至少有两层：UI/Protocol submission 队列，以及工具/多代理运行时等待点。横向比较时，不能只把 slash command 当作命令解析问题，还要看 approval、cancel 和 mailbox 这些运行中控制消息。

## 源码锚点：输入命令队列从 TUI 进入 Protocol，再进 core

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/tui/src/lib.rs:1092` | TUI `run_main()` 交互入口 | 对应 Gemini `interactiveCli.tsx` |
| `sources/codex/codex-rs/tui/src/app/thread_routing.rs:500` | `submit_thread_op()` 提交用户操作 | 输入进入 app/core 边界 |
| `sources/codex/codex-rs/tui/src/app_server_session.rs:1414` | `turn_start()` 包装 app-server 请求 | 对应 OpenCode server route |
| `sources/codex/codex-rs/protocol/src/protocol.rs` | Submission/Event 协议类型 | Codex 输入队列的类型化边界 |
| `sources/codex/codex-rs/protocol/src/parse_command.rs` | 命令解析（ParsedCommand） | 对应 Claude slash parser、Gemini CommandService |
| `sources/codex/codex-rs/core/src/session/mod.rs:1007` | `submit_with_trace()` 生成 core submission | 连接 Agent loop |

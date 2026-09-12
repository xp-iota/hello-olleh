---
layout: content
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
| Mailbox | `codex-rs/core/src/agent/mailbox.rs` | Agent 间通信队列 |
| Protocol | `codex-rs/protocol/src/protocol.rs` | Submission/Event 队列协议 |
| 命令规范化 | `codex-rs/core/src/command_canonicalization.rs` | 命令标准化（用于审批缓存） |
| Exec | `codex-rs/core/src/exec.rs` | 命令执行与沙箱 |

## 2. 整体流程图

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    A[CLI main.rs] --> B{是否有子命令?}
    B -->|exec| C[run_exec]
    B -->|mcp| D[run_mcp]
    B -->|无| E[run_interactive_tui]
    E --> F[TUI run_main]
    F --> G[CodexThread.new]
    G --> H[Mailbox 创建]
    H --> I[事件循环]
    I --> J{等待输入}
    J -->|用户输入| K[Submission]
    K --> L[Mailbox.tx.send]
    L --> M[Codex 处理]
    M --> N[Event 产生]
    N --> O[EventQueue]
    O --> P[TUI 渲染]
```

## 3. CLI 入口与子命令

### 3.1 主入口

```rust
// codex-rs/cli/src/main.rs

fn main() {
    let matches = Command::new("codex")
        .subcommand(Exec::def())
        .subcommand(Mcp::def())
        .subcommand(Resume::def())
        .get_matches();

    match matches.subcommand() {
        Some(("exec", args)) => run_exec(args),
        Some(("mcp", args)) => run_mcp(args),
        Some(("resume", args)) => run_resume(args),
        None => run_interactive_tui(),
    }
}
```

### 3.2 可用子命令

| 子命令 | 路径 | 功能 |
| :--------| :------| :------|
| `exec` | `codex-rs/cli/src/exec.rs` | Headless 命令执行 |
| `mcp` | `codex-rs/cli/src/mcp.rs` | MCP 服务器模式 |
| `mcp-server` | `codex-rs/mcp-server/` | MCP 协议服务器 |
| `resume` | `codex-rs/cli/src/resume.rs` | 恢复历史会话 |
| (无) | TUI | 交互式模式 |

## 4. TUI 事件循环

### 4.1 主循环

```rust
// codex-rs/tui/src/lib.rs:587

pub fn run_main() -> Result<()> {
    let config = load_config()?;
    let mut codex_thread = CodexThread::new(&config)?;

    loop {
        match event::recv()? {
            Event::Input(input) => {
                codex_thread.mailbox().send_user_input(input)?;
            }
            Event::AgentEvent(event) => {
                render(event);
            }
            Event::Key(key) => {
                handle_key(key);
            }
        }
    }
}
```

### 4.2 CodexThread

```rust
// codex-rs/core/src/codex_thread.rs

pub struct CodexThread {
    client: Codex,
    mailbox: Mailbox,
    state: State,
}

impl CodexThread {
    pub fn new(config: &Config) -> Result<Self> {
        let client = Codex::new(config);
        let mailbox = Mailbox::new();
        Ok(Self { client, mailbox, state: State::Idle })
    }

    pub fn mailbox(&self) -> &Mailbox {
        &self.mailbox
    }
}
```

## 5. Mailbox：Agent 间通信队列

### 5.1 核心结构

```rust
// codex-rs/core/src/agent/mailbox.rs:11-49

pub(crate) struct Mailbox {
    tx: mpsc::UnboundedSender<InterAgentCommunication>,
    next_seq: AtomicU64,
    seq_tx: watch::Sender<u64>,
}

pub(crate) enum InterAgentCommunication {
    UserInput(Submission),
    AgentEvent(Event),
    ToolResult(ToolResult),
    Elicitation(ElicitationRequest),
}

pub(crate) struct Submission {
    pub id: String,
    pub op: Op,           // 用户操作
    pub trace: Option<W3cTraceContext>,
}
```

### 5.2 序列号机制

```mermaid
---
config:
  theme: neutral
---
sequenceDiagram
    participant User as 用户输入
    participant Mailbox as Mailbox
    participant Codex as Codex
    participant Watch as Watch Channel

    User->>Mailbox: send_user_input(submission)
    Mailbox->>Mailbox: next_seq++
    Mailbox->>Codex: InterAgentCommunication::UserInput
    Mailbox->>Watch: seq_tx.send(seq)
    Codex->>Codex: process submission
    Codex->>Mailbox: InterAgentCommunication::AgentEvent
    Mailbox->>Watch: seq_tx.send(seq)
```

## 6. Submission / Event Queue 模式

### 6.1 SQ/EQ 模式

```rust
// codex-rs/protocol/src/protocol.rs

pub struct Protocol {
    submission_queue: Vec<Submission>,
    event_queue: Vec<AgentEvent>,
}

// Submission Queue: 用户输入 → Codex
// Event Queue: Codex → TUI/用户
```

### 6.2 Op 类型

```rust
// codex-rs/protocol/src/protocol.rs

pub enum Op {
    UserMessage { content: String },
    ToolCall { tool: String, args: serde_json::Value },
    ToolResult { tool: String, result: serde_json::Value },
    Approve { request_id: String },
    Deny { request_id: String },
}
```

## 7. 命令规范化 (Command Canonicalization)

### 7.1 目的

命令规范化用于**审批缓存**：相同逻辑的命令即使文本略有不同，也能匹配到之前的审批决策。

```rust
// codex-rs/core/src/command_canonicalization.rs

pub fn canonicalize_command(cmd: &str) -> String {
    // 1. 识别 shell 类型 (bash/powershell)
    // 2. 规范化脚本内容
    // 3. 添加协议前缀
    match detect_shell(cmd) {
        Shell::Bash => format!("__codex_shell_script__{}", normalize_bash(cmd)),
        Shell::PowerShell => format!("__codex_powershell_script__{}", normalize_ps(cmd)),
    }
}
```

### 7.2 规范化策略

| 原始 | 规范化后 |
| :------| :----------|
| `bash -c "echo hi"` | `__codex_shell_script__echo hi` |
| `powershell -Command "dir"` | `__codex_powershell_script__dir` |
| `/usr/bin/python3 script.py` | `__codex_shell_script__python3 script.py` |

## 8. 命令解析 (ParsedCommand)

### 8.1 解析类型

```rust
// codex-rs/protocol/src/parse_command.rs

pub enum ParsedCommand {
    Read { cmd: String, name: String, path: String },
    ListFiles { cmd: String, path: String },
    Search { cmd: String, query: String, path: Option<String> },
    Unknown { cmd: String },
}

pub fn parse_command(input: &str) -> ParsedCommand {
    // 模式匹配识别命令类型
}
```

## 9. Exec 模块

### 9.1 命令执行流程

```mermaid
---
config:
  theme: neutral
---
flowchart TB
    A[execute command] --> B{沙箱策略}
    B -->|需要沙箱| C[SandboxedExec]
    B -->|直接执行| D[DirectExec]
    C --> E[sandbox_tags]
    D --> F[ExecPolicy.check]
    E --> F
    F -->|允许| G[spawn process]
    F -->|拒绝| H[Return Error]
    G --> I[capture output]
    I --> J[return ExecResult]
```

### 9.2 沙箱集成

```rust
// codex-rs/core/src/exec.rs

pub async fn execute(
    cmd: &str,
    cwd: &Path,
    context: &ExecContext,
) -> Result<ExecOutput> {
    let canonical = canonicalize_command(cmd);

    // 检查执行策略
    let policy = ExecPolicy::from_context(context)?;
    if !policy.allows(&canonical) {
        return Err(ExecError::DeniedByPolicy);
    }

    // 确定是否需要沙箱
    let sandboxed = should_sandbox(&cmd, context);

    if sandboxed {
        sandboxed_execute(cmd, cwd, context).await
    } else {
        direct_execute(cmd, cwd, context).await
    }
}
```

## 10. 与 Claude Code 的差异

| 特性 | Claude Code | Codex |
| :------| :-------------| :-------|
| 入口架构 | TypeScript REPL | Rust CLI + TUI |
| 队列实现 | `messageQueueManager.ts` + React hooks | `Mailbox.rs` (mpsc channels) |
| 并发控制 | `QueryGuard` 状态机 | Watch channel 序列号 |
| 命令解析 | `processSlashCommand.tsx` | `parse_command.rs` |
| 命令规范化 | 无 (直接字符串匹配) | `command_canonicalization.rs` |
| 执行策略 | `execPolicy.rs` | 同上 |

## 11. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| :------| :----------| :------|
| CLI 入口 | `codex-rs/cli/src/main.rs` | 子命令解析 |
| TUI 主循环 | `codex-rs/tui/src/lib.rs:587` | `run_main()` |
| CodexThread | `codex-rs/core/src/codex_thread.rs` | Agent 线程封装 |
| Mailbox | `codex-rs/core/src/agent/mailbox.rs` | 通信队列 |
| Protocol | `codex-rs/protocol/src/protocol.rs` | SQ/EQ 模式 |
| 命令规范化 | `codex-rs/core/src/command_canonicalization.rs` | 审批缓存支持 |
| Exec | `codex-rs/core/src/exec.rs` | 命令执行 |

## 12. 总结

Codex 的输入层特点：

1. **Rust-first 架构**：核心逻辑在 Rust，追求性能与安全
2. **Mailbox 模式**：基于 mpsc 的 Actor-style 通信
3. **Sequence Channel**：Watch channel 追踪处理序列号
4. **命令规范化**：为审批缓存提供稳定匹配
5. **沙箱优先**：命令执行默认考虑沙箱隔离

---

*文档版本: 1.0*
*分析日期: 2026-04-06*

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `InputQueue` | `codex-rs/tui/src/input.rs` | 用户输入队列：缓冲多行输入，等待 Enter 确认后统一发送 |
| `CommandParser::parse()` | `codex-rs/tui/src/command.rs` | 解析以 `/` 开头的斜杠命令，返回 `Command` 枚举 |
| `Command` enum | `codex-rs/tui/src/command.rs` | 内置命令集：/clear /model /resume /history /help 等 |
| `CommandHandler::execute()` | `codex-rs/tui/src/command.rs` | 执行解析后的 Command，更新 AppState 或发送到 core |
| `HistoryNavigator` | `codex-rs/tui/src/input.rs` | 上下键历史导航：在 InputQueue 中注入历史输入条目 |
| `PromptInput` | `codex-rs/tui/src/input.rs` | 统一输入模型：文本内容 + 附件（文件/图片引用） |

---

## 代码质量评估

**优点**

- **斜杠命令系统可发现**：`/help` 提供命令列表，用户无需记忆所有命令；命令补全可扩展。
- **PromptInput 统一附件与文本**：文本和文件附件在同一输入模型中，发送给 core 时格式一致，不需要两套处理路径。
- **InputQueue 支持多行组合**：缓冲区设计允许用户粘贴多行代码后一次确认发送，不会因换行提前触发。

## 跨工具横向对比

本章（Codex）与同主题其他工具的差异：

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :------------| :-------| :------------| :----------|
| 核心主题 | Slash 命令 + QueryGuard 并发控制 | Mailbox + Command Canonicalization + Exec | CommandService + Shell 状态 | PromptInput 编译 + Durable Message |
| 独有机制 | `QueryGuard` 防并发 query | `Mailbox` 跨 Agent 通信 | `Shell 状态管理` | `Part` 编译类型系统 |
| 命令返回 | 可改变工具/模型/effort | 命令规范化元数据 | CommandService 统一分发 | 模板化 command 编译 |
| 架构驱动 | 单 Agent，query 并发控制 | 多 Agent，Mailbox 通信 | 单 Agent，Shell 状态隔离 | Durable State，输入即消息 |

**要点**：Codex 因有多 Agent 架构（含 child-agents），其队列系统加入了 Mailbox 机制和命令规范化，远比其他三个工具复杂；其他三者均面向单 Agent，核心问题是"slash 命令解析 + 输入队列调度"。

**风险与改进点**

- **命令解析与输入处理耦合**：`CommandParser` 嵌入 `InputQueue` 处理流程，难以在集成测试中独立测试命令解析逻辑。
- **无 shell-style tab 补全**：斜杠命令无 Tab 补全，命令名需要完整输入，不如 fish/zsh 交互友好。
- **PromptInput 附件无大小限制**：内联文件引用时未限制文件大小，大文件注入可能超出 LLM context window。

## 横向对齐补强：Codex 输入队列要包含 Mailbox 和多代理消息

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

## 源码锚点补强：输入命令队列从 TUI 进入 Protocol，再进 core

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/tui/src/lib.rs:664` | TUI `run_main()` 交互入口 | 对应 Gemini `interactiveCli.tsx` |
| `sources/codex/codex-rs/tui/src/app/thread_routing.rs:422` | `submit_thread_op()` 提交用户操作 | 输入进入 app/core 边界 |
| `sources/codex/codex-rs/tui/src/app_server_session.rs:397` | `turn_start()` 包装 app-server 请求 | 对应 OpenCode server route |
| `sources/codex/codex-rs/protocol/src/protocol.rs` | Submission/Event 协议类型 | Codex 输入队列的类型化边界 |
| `sources/codex/codex-rs/protocol/src/parse_command.rs` | slash / command parsing | 对应 Claude slash parser、Gemini CommandService |
| `sources/codex/codex-rs/core/src/session/mod.rs:698` | `submit_with_trace()` 生成 core submission | 连接 Agent loop |

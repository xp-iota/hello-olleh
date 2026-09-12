---
layout: content
title: "REPL 与交互层：TUI、非交互模式与输入分发"
---
# REPL 与交互层：TUI、非交互模式与输入分发

本文分析 Codex 的交互层实现，包括 TUI 渲染、非交互（headless）模式及输入事件分发机制。

**目录**

- [1. 双模式入口](#1-双模式入口)
- [2. TUI 模式](#2-tui-模式)
- [3. 非交互模式（Headless）](#3-非交互模式headless)
- [4. 与 Claude Code REPL 的对比](#4-与-claude-code-repl-的对比)

---

## 1. 双模式入口

Codex 支持两种运行模式，在启动时根据 CLI 参数选择：

```
codex [prompt]
  ├─ 有 prompt 且无 tty → 非交互模式（headless）
  └─ 无 prompt 或有 tty → 交互 TUI 模式
```

```rust
// codex-rs/tui/src/main.rs
if args.prompt.is_some() && !atty::is(Stream::Stdin) {
    run_headless(args).await
} else {
    run_tui(args).await
}
```

## 2. TUI 模式

Codex TUI 基于 `ratatui`（Rust TUI 框架）实现，核心组件：

```
App（顶层状态）
  ├── ChatView（对话历史渲染）
  │     ├── MessageList（消息列表）
  │     └── ToolCallView（工具调用展示）
  ├── InputBox（用户输入框）
  │     └── 键盘事件处理
  └── StatusBar（状态栏：模型/token/审批状态）
```

### 2.1 输入事件循环

```rust
// codex-rs/tui/src/app.rs
loop {
    // 渲染当前帧
    terminal.draw(|f| ui.render(f, &state))?;
    
    // 等待键盘事件
    if let Event::Key(key) = event::read()? {
        match key.code {
            KeyCode::Enter => {
                let input = input_box.take();
                tx.send(Op::UserInput(input)).await?;
            }
            KeyCode::Char('c') if key.modifiers.contains(Modifiers::CTRL) => {
                tx.send(Op::Interrupt).await?;
            }
            _ => input_box.handle_key(key),
        }
    }
    
    // 接收 Agent 输出更新 UI 状态
    while let Ok(event) = rx.try_recv() {
        state.apply(event);
    }
}
```

### 2.2 流式渲染

模型输出通过 channel 实时推送到 TUI，实现字符级流式渲染：

```rust
// 每收到一个 token 就触发重渲染
while let Some(chunk) = stream.next().await {
    state.append_token(chunk);
    // ratatui 的下一帧会自动展示新内容
}
```

## 3. 非交互模式（Headless）

非交互模式用于 CI/脚本场景：

```bash
echo "分析 src/ 目录的代码质量" | codex
# 或
codex "修复所有 clippy 警告" --approval-policy full-auto
```

```rust
// codex-rs/core/src/headless.rs
pub async fn run_headless(prompt: String, config: Config) -> ExitCode {
    let (tx, mut rx) = channel(32);
    let agent = CodexAgent::new(config, tx);
    
    agent.send(Op::UserInput(prompt)).await;
    
    while let Some(event) = rx.recv().await {
        match event {
            AgentEvent::Text(s) => print!("{}", s),
            AgentEvent::Done => break,
            AgentEvent::Error(e) => { eprintln!("{}", e); return ExitCode::FAILURE; }
        }
    }
    ExitCode::SUCCESS
}
```

## 4. 与 Claude Code REPL 的对比

| 特性 | Codex | Claude Code |
| :------| :-------| :-------------|
| **UI 框架** | ratatui（Rust）| Ink（React/Node）|
| **Headless 模式** | ✅ stdin/args | ✅ `--print` / pipe |
| **流式渲染** | ✅ token 级 | ✅ token 级 |
| **Slash 命令** | 少量内置 | 丰富（可扩展）|
| **审批 UI** | 终端内嵌 | 终端内嵌 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Repl::run()` | `codex-rs/tui/src/repl.rs` | TUI REPL 主循环：读取用户输入，发送到 agent，渲染响应 |
| `InputHandler` | `codex-rs/tui/src/input.rs` | 键盘事件处理：多行输入、历史导航、快捷键绑定 |
| `AppState` | `codex-rs/tui/src/state.rs` | TUI 全局状态：当前会话、消息列表、加载状态、选中工具 |
| `Renderer::draw()` | `codex-rs/tui/src/ui.rs` | Ratatui 渲染函数：根据 AppState 绘制完整 TUI 画面 |
| `AgentHandle` | `codex-rs/tui/src/state.rs` | TUI 和 agent 核心的桥接句柄：发送消息、接收事件流 |
| `ReplHistory` | `codex-rs/tui/src/history.rs` | REPL 输入历史：上下键导航历史命令，持久化到磁盘 |

---

## 代码质量评估

**优点**

- **Ratatui TUI 框架成熟**：Ratatui 是 Rust 生态中最活跃的 TUI 框架，布局系统和组件化支持完善，UI 代码可测试。
- **AppState 集中管理**：所有 TUI 状态集中在 `AppState` 结构体，渲染函数是纯函数（状态 → 画面），易于推理和 debug。
- **REPL 历史持久化**：输入历史写入磁盘，重启后可恢复，与 bash/zsh 历史体验一致。

**风险与改进点**

- **TUI 状态与 agent 状态双份维护**：AppState 需要镜像 agent 核心的状态，两者可能出现短暂不一致，需要精细的事件同步。
- **多行输入体验弱**：复杂代码块输入在 TUI 中体验不佳，不如外部编辑器（未集成 `$EDITOR` 回退）。
- **终端兼容性依赖 Ratatui**：某些老旧终端（如 xterm-256color 降级场景）可能出现渲染异常，缺少 fallback plain 模式。

## 横向对齐补强：REPL 状态不是 agent 状态本身

Codex 的 TUI/REPL 层主要消费和投影 Rust core 产生的 thread/session events。用户看到的“状态”不是单独的前端真相，而是 runtime event log 的 UI 视图。

| 层级 | 责任 |
| --- | --- |
| TUI 输入层 | 接收用户 prompt、slash command、取消/审批动作 |
| submission loop | 把输入转成 core submission，进入 session/turn |
| thread/session state | 保存 turn item、approval、history、ghost snapshot 等运行时事实 |
| UI render state | 从事件流派生显示状态、进度和工具结果 |

这和 Claude Code 的 React state 深耦合不同，也和 OpenCode 的 durable state + Bus/SSE 投影不同。Codex 更接近“runtime event 是真相，TUI 是订阅者”。

## 状态同步补强：TUI 到 core 的最短路径

Codex 的 REPL/TUI 状态不能只看 Ratatui widget。用户动作进入 core 的主链路是：

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant TUI as tui/app.rs
    participant APP as app-server session/client
    participant MSP as codex_message_processor
    participant CORE as CodexThread
    participant LOOP as submission_loop

    TUI->>APP: submit thread op
    APP->>MSP: turn/start or command request
    MSP->>CORE: submit_core_op()
    CORE->>LOOP: Op::UserInput / Op::Interrupt / approval
    LOOP-->>TUI: thread events projected back
```

| 状态面 | 源码锚点 | 说明 |
| --- | --- | --- |
| app-server request 规范化 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:276` | `normalize_collaboration_mode()` 处理 turn/start 的协作模式 |
| core op 提交 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:372` | `submit_core_op()` 是 app-server 到 core thread 的关键桥 |
| turn/start 入口 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:403` | 外部请求在这里变成 turn operation |
| user turn 提交 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:741` | turn op 最终进入 core op 队列 |
| interrupt 提交 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:1331` | interrupt 不是普通 prompt，而是独立 `Op::Interrupt` |

这个结构说明：TUI 的“状态”只是 thread event 的投影；真正的执行权在 core thread 的 `submission_loop()`。因此调试 UI 卡住时，要先分清是 TUI 渲染没有消费 event，还是 app-server 没有提交 op，还是 core turn 阻塞在工具/审批。

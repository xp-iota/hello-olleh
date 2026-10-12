---
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

![双模式入口](diagrams/20-repl-and-state-diagram.svg)

**双模式入口** — [交互版](diagrams/20-repl-and-state-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/20-repl-and-state-diagram.architecture.json)

- **组成**：5 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：codex [prompt · 末节点：交互 TUI 模式

TUI 二进制入口在 `codex-rs/tui/src/main.rs`：`main()` 解析 `TopCli` 后经过 `arg0` 分派，调用 `run_main()`（`codex-rs/tui/src/lib.rs:1092`）进入交互模式。无 TUI 的非交互执行不在这个入口里，而是 CLI 的 `exec` 子命令（`codex-rs/cli/src/main.rs:156`）。

## 2. TUI 模式

Codex TUI 基于 `ratatui`（Rust TUI 框架）实现，核心组件：

![TUI 模式](diagrams/20-repl-and-state-tui.svg)

**TUI 模式** — [交互版](diagrams/20-repl-and-state-tui.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/20-repl-and-state-tui.architecture.json)

- **组成**：7 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：App（顶层状态） · 末节点：StatusBar（状态栏：模型/token…

### 2.1 输入事件循环

TUI 基于 ratatui/crossterm 的事件模型工作：键盘事件进入 `App`（`codex-rs/tui/src/app.rs:529`）的事件处理（如 `handle_tui_event()`，`codex-rs/tui/src/app.rs:846`），用户 prompt 被包装成 app-server 的 `turn/start` 请求提交；线程侧事件通过 app-server 订阅回流，由 `ChatWidget` 消费并刷新画面。

### 2.2 流式渲染

模型输出以事件流实时推送到 TUI：`EventMsg` 级别的事件（如增量文本、工具调用状态）到达后触发下一帧重渲染，ratatui 的差分绘制保证刷新开销可控。

## 3. 非交互模式（Headless）

非交互模式用于 CI/脚本场景，由 `exec` 子命令承载：

```bash
codex exec "分析 src/ 目录的代码质量"
codex exec "修复所有 clippy 警告"
```

`Exec(ExecCli)` 在 `codex-rs/cli/src/main.rs:156` 分派，与 TUI 共用同一套 app-server 协议与 core runtime，只是没有终端 UI：事件直接输出为 JSON 流或汇总文本。

## 4. 与 Claude Code REPL 的对比

| 特性 | Codex | Claude Code |
| :------| :-------| :-------------|
| **UI 框架** | ratatui（Rust）| Ink（React/Node）|
| **Headless 模式** | ✅ stdin/args | ✅ `--print` / pipe |
| **流式渲染** | ✅ token 级 | ✅ token 级 |
| **Slash 命令** | 少量内置 | 丰富（可扩展）|
| **审批 UI** | 终端内嵌 | 终端内嵌 |

---

## REPL 状态不是 agent 状态本身

Codex 的 TUI/REPL 层主要消费和投影 Rust core 产生的 thread/session events。用户看到的“状态”不是单独的前端真相，而是 runtime event log 的 UI 视图。

| 层级 | 责任 |
| --- | --- |
| TUI 输入层 | 接收用户 prompt、slash command、取消/审批动作 |
| submission loop | 把输入转成 core submission，进入 session/turn |
| thread/session state | 保存 turn item、approval、history 等运行时事实 |
| UI render state | 从事件流派生显示状态、进度和工具结果 |

这和 Claude Code 的 React state 深耦合不同，也和 OpenCode 的 durable state + Bus/SSE 投影不同。Codex 更接近“runtime event 是真相，TUI 是订阅者”。

## 状态同步：TUI 到 core 的最短路径

Codex 的 REPL/TUI 状态不能只看 Ratatui widget。用户动作进入 core 的主链路是：

![状态同步：TUI 到 core 的最短路径](diagrams/20-repl-and-state-tui-core.svg)

**状态同步：TUI 到 core 的最短路径** — [交互版](diagrams/20-repl-and-state-tui-core.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/20-repl-and-state-tui-core.sequence.json)

- **组成**：6 个参与方
- **关系**：源图 5 条消息
- **要点**：submit_core_op() 桥接 app-server 到 core（turn_processor.rs:492）

| 状态面 | 源码锚点 | 说明 |
| --- | --- | --- |
| app-server request 规范化 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:404` | `normalize_collaboration_mode()` 处理 turn/start 的协作模式 |
| core op 提交 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:492` | `submit_core_op()` 是 app-server 到 core thread 的关键桥 |
| turn/start 入口 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:175` | 外部请求在这里变成 turn operation |
| user turn 提交 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:653` | turn 输入经 `start_or_steer_turn()` 最终进入 core op 队列 |
| interrupt 提交 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:1649` | interrupt 不是普通 prompt，而是独立 `Op::Interrupt` |

这个结构说明：TUI 的“状态”只是 thread event 的投影；真正的执行权在 core thread 的 `submission_loop()`。因此调试 UI 卡住时，要先分清是 TUI 渲染没有消费 event，还是 app-server 没有提交 op，还是 core turn 阻塞在工具/审批。

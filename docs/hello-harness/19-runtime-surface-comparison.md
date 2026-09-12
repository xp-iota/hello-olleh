---
layout: content
title: "19 - 入口、传输与 UI 状态横向对比"
---
<!-- markdownlint-disable MD060, MD024 -->

# 入口、传输与 UI 状态横向对比

对应项目章节：

- `15-sdk-transport.md`
- `20-repl-and-state.md`
- `21-bridge-system.md`
- `23-input-command-queue.md`

## 1. 为什么这几章需要合并读

用户请求进入 agent 之前，会先经过入口、输入队列、UI 状态和传输协议。单看 agent loop 容易忽略一个事实：很多行为差异不是模型层造成的，而是入口层决定的。

## 2. 对比矩阵

| 项目 | 主入口 | UI/交互 | 传输/桥接 | 状态投影 |
| --- | --- | --- | --- | --- |
| Claude Code | React TUI / SDK / headless | React state + hooks | SDK transport / bridge | stream event 驱动 UI |
| Codex | Rust CLI/TUI/app-server | Ratatui + event loop | JSON event / HTTP / WebSocket | thread event 投影 |
| Gemini CLI | packages/cli + core | Ink TUI | Headless / IDE / MCP | hook + stream callback |
| OpenCode | CLI/TUI/Web/Desktop/serve | 多表面共享 server contract | Hono server / SSE / SDK | Bus/SSE + durable state |

## 3. 代表源码证据

| 项目 | 输入 / 队列 | Runtime 请求 | Event / 状态投影 |
| --- | --- | --- | --- |
| Claude Code | `sources/claude-code/src/query.ts:241`, `sources/claude-code/src/hooks` | `sources/claude-code/src/query.ts:323`, `sources/claude-code/src/services/tools/toolOrchestration.ts` | `sources/claude-code/src/query.ts:337`, `sources/claude-code/src/services/tools/StreamingToolExecutor.ts` |
| Codex | `sources/codex/codex-rs/tui/src/app.rs`, `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:99` | `sources/codex/codex-rs/core/src/session/mod.rs:698`, `sources/codex/codex-rs/core/src/session/handlers.rs:698` | `sources/codex/codex-rs/tui/src/app_server_session.rs:397`, `sources/codex/codex-rs/core/src/session/turn.rs:137` |
| Gemini CLI | `sources/gemini-cli/packages/cli/src/ui/hooks/useMcpStatus.ts:15`, `sources/gemini-cli/packages/core/src/core/client.ts:868` | `sources/gemini-cli/packages/core/src/core/client.ts:585`, `sources/gemini-cli/packages/core/src/core/turn.ts:257` | `sources/gemini-cli/packages/core/src/core/client.ts:925`, `sources/gemini-cli/packages/core/src/core/turn.ts:404` |
| OpenCode | `sources/opencode/packages/opencode/src/server/routes/instance/session.ts:846`, `sources/opencode/packages/opencode/src/session/prompt.ts:162` | `sources/opencode/packages/opencode/src/session/prompt.ts:278`, `sources/opencode/packages/opencode/src/session/processor.ts:548` | `sources/opencode/packages/opencode/src/session/processor.ts:46`, `sources/opencode/packages/opencode/src/server/routes/instance/session.ts` |

## 4. 生命周期合并图

```mermaid
---
config:
  theme: neutral
---
flowchart LR
  U["user input"] --> I["CLI/TUI/Web input layer"]
  I --> Q["command queue / parser"]
  Q --> R["runtime request"]
  R --> L["agent loop"]
  L --> E["event stream"]
  E --> S["state projection"]
  S --> V["UI render / SDK consumer"]
```

## 5. 统一章节要求

| 章节 | 统一主题 |
| --- | --- |
| 15 | SDK、transport、headless/server/API 如何复用 runtime |
| 20 | REPL/TUI 与 agent state 如何同步 |
| 21 | bridge、IDE、remote、external host 如何接入 |
| 23 | slash command、自然语言、队列、取消、中断如何进入 loop |

## 6. 横向结论

OpenCode 的入口面最宽，因为 server contract 是中心；Codex 的 runtime 边界最清楚，因为 Rust event protocol 是中心；Claude Code 的 UI 和 agent loop 耦合更深；Gemini CLI 的 core/cli 分层适合阅读和扩展，但需要在文档里补足状态投影细节。

## 7. 请求生命周期对齐

入口与传输章节应统一回答“用户输入什么时候才真正变成 agent turn”。

| 阶段 | Claude Code | Codex | Gemini CLI | OpenCode |
| --- | --- | --- | --- | --- |
| 输入捕获 | React TUI / slash command / SDK headless | Ratatui TUI、app-server client、remote WebSocket | Ink TUI、non-interactive CLI、IDE/ACP | CLI/TUI/Web/Desktop/API server |
| 命令预处理 | slash command 可返回 UI、prompt message、background task | app-server 把 request 映射成 `Op` | command service / UI hook 决定本地处理或提交 | server route / command compiler 生成 prompt 或 TUI event |
| runtime 提交 | `query()` 消费 messages 和 `ToolUseContext` | `submit_core_op()` -> `submission_loop()` | `submitQuery()` -> `GeminiClient.sendMessageStream()` | `session.prompt()` 先写 durable user message |
| 状态投影 | stream event 更新 React state / transcript | thread event 投影到 TUI/app-server consumers | core events、hook state、Scheduler 状态投影到 UI | Bus/SSE + SQLite durable state |
| 外部宿主 | SDK、bridge、remote sessions | app-server protocol、HTTP/WebSocket、thread API | non-interactive、IDE、ACP、MCP/extension | Hono OpenAPI、SSE、SDK、ACP、attach |

## 8. 章节边界

| 章节 | 应保留的重点 | 不应混入 |
| --- | --- | --- |
| `15-sdk-transport.md` | 协议、SDK、server/headless 如何复用 runtime | 具体 TUI 组件细节 |
| `20-repl-and-state.md` | 输入框、渲染状态、运行态状态同步 | 外部 API 的完整协议 |
| `21-bridge-system.md` | IDE、remote、ACP、bridge 等外部宿主边界 | 普通 CLI 启动流程 |
| `23-input-command-queue.md` | slash command、自然语言、取消、中断、排队规则 | agent loop 内部采样细节 |

## 9. 输入分类维护表

每个项目的 `23-input-command-queue.md` 都应保留一张输入分类表：

| 输入类型 | 是否进入模型 | 是否改变工具池 | 是否可中断当前 turn | 是否写入会话历史 |
| --- | --- | --- | --- | --- |
| 自然语言 | 是 | 通常否 | 取决于 runtime | 是 |
| slash command | 取决于命令 | 可能 | 可能 | 取决于命令 |
| tool approval | 否 | 否 | 是，解除阻塞 | 通常作为事件/状态记录 |
| interrupt/cancel | 否 | 否 | 是 | 需要记录取消边界 |
| extension/MCP 状态变化 | 否 | 是 | 通常否 | 取决于项目 |

这张表能直接修复当前几篇入口章节最常见的问题：只写“输入怎么解析”，没有写“输入是否进入模型、是否排队、是否改变运行时能力”。

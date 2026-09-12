---
layout: default
title: "Codex 源码分析 README"
---

# Codex 源码分析 README

本目录记录 OpenAI Codex `rust-v0.141.0` 的源码阅读结果。分析对象是 `sources/codex/` 上游快照，重点不是复述 Rust workspace 目录，而是追踪 Codex 如何把 CLI/TUI/SDK 输入收束到同一套 Rust runtime、thread protocol、tool execution、sandbox approval 和 session state。

## 阅读入口

- 网页索引：[index.md](./index.md)
- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)

## 推荐阅读顺序

先读 `01-08`，建立“Rust runtime + 协议边界 + 工具闭环”的主线；再读 `09-21` 对齐其他 CLI 的共享主题；最后读 `22-26` 的专项补充。

1. [01-architecture.md](./01-architecture.md)：Rust workspace、TypeScript 分发层、IPC/FFI 边界和核心抽象。
2. [02-startup-flow.md](./02-startup-flow.md)：CLI/TUI/app-server 的入口分发与初始化顺序。
3. [03-agent-loop.md](./03-agent-loop.md)：Codex turn loop、LLM 请求、tool call 和 event 回流。
4. [04-state-session-memory.md](./04-state-session-memory.md)：Thread/Turn/ThreadItem、上下文管理、memory pipeline。
5. [05-tool-system.md](./05-tool-system.md)：ToolRegistry、ToolRouter、approval、sandbox 与执行闭环。
6. [06-extension-mcp.md](./06-extension-mcp.md)：MCP、skill dependency、外部工具发现与接入。
7. [07-error-security.md](./07-error-security.md)：错误归一化、重试、sandbox manager 与安全边界。
8. [08-performance.md](./08-performance.md)：Rust async、持久化、流式渲染和维护成本。

## 章节索引

> 横向对齐规则：`01-25` 是四个 AI Coding CLI 目录共享的主题主干；Codex 特有的 `26-ghost-snapshot.md` 作为附录保留。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 判断 Rust/TS 边界、crate 拓扑和核心抽象 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | 从二进制入口追到 TUI/app-server 初始化 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | 理解自然语言请求如何变成模型请求和工具调用 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | 分析 Thread/Turn/rollout/history/memory 的职责 |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | 追踪工具注册、权限审批、沙箱执行和结果回注 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | 理解外部 MCP server 与 skill dependency 如何接入 |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | 查看错误恢复、sandbox、敏感操作控制 |
| [08-performance.md](./08-performance.md) | 性能与质量 | 评估流式处理、大仓库任务和工程代价 |
| [09-observability.md](./09-observability.md) | 可观测性 | 日志、事件、调试信号和监控缺口 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | resume/fork/rollout 恢复语义 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | `build_prompt()`、AGENTS.md 与工具声明拼装 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | Codex child-agents 与单代理主线的关系 |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | AGENTS.md/skills 如何形成能力扩展 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | MCP 作为主要插件机制的边界 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | app-server、remote websocket、TypeScript SDK 复用方式 |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | 重试、错误归一化、sandbox failure handling |
| [17-settings-config.md](./17-settings-config.md) | 配置 | config.toml、环境变量、运行时策略 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 代码语义理解能力和缺口 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | 生命周期拦截点与扩展约束 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL/TUI | Ratatui 交互层与 agent state 同步 |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge | app-server protocol 与多宿主复用 |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入 Codex 仓库的完整摘要 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | 用户输入、slash command、mailbox 分发 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统 | RMCP 连接、工具发现、调用与资源管理 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | 本地调试、日志和常见定位路径 |
| [26-ghost-snapshot.md](./26-ghost-snapshot.md) | GhostSnapshot | Git 快照、Undo、compaction 幸存机制 |

## 核心心智模型

Codex 应按“Rust runtime 为中心、TypeScript 只做分发和协议消费”的模型阅读。TS SDK 不直接 FFI 调 Rust，而是通过命令行、stdio、HTTP/WebSocket 或 JSON event protocol 接入；真正的 agent loop、工具权限、sandbox 和 durable state 都在 Rust 侧。

## 维护注意

- 新增章节时同步更新本 README 和 [index.md](./index.md)。
- 新增源码锚点后运行 `powershell -NoProfile -ExecutionPolicy Bypass -File ../scripts/check_doc_refs.ps1 -DocDirs hello-codex`。
- 若行号来自旧快照或反编译结果，应在正文中标注版本来源，避免和 `rust-v0.141.0` 混淆。

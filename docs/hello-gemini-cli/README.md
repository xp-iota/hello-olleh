---
layout: default
title: "Gemini CLI 源码分析 README"
---

# Gemini CLI 源码分析 README

本目录记录 Gemini CLI `v0.47.0` 的源码分析。分析对象是 `sources/gemini-cli/` 上游快照，技术栈是 TypeScript monorepo：`packages/core` 承载 Agent runtime，`packages/cli` 承载 Ink TUI 和非交互入口，扩展面包括 MCP、Extensions、Skills、A2A 和 IDE 集成。

## 阅读入口

- 网页索引：[index.md](./index.md)
- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先建立 monorepo、Config 组合根、GeminiClient/Turn/Scheduler 的全局图。
2. [02-startup-flow.md](./02-startup-flow.md)：理解 CLI 入口、sandbox、config initialize、TUI/non-interactive 分支。
3. [03-agent-loop.md](./03-agent-loop.md)：追踪一次 prompt 如何进入 `GeminiClient.sendMessageStream()`、`Turn.run()` 和 Scheduler。
4. [05-tool-system.md](./05-tool-system.md)：理解 ToolRegistry、PolicyEngine、Scheduler、ToolExecutor 的执行闭环。
5. [04-state-session-memory.md](./04-state-session-memory.md)：再回头看会话、上下文、memory 和 tool output masking。
6. [06-extension-mcp.md](./06-extension-mcp.md)：看 MCP server、transport、OAuth、trust 和 skill 激活。
7. [07-error-security.md](./07-error-security.md)：补齐 retry、sandbox、policy、环境清洗和工作区信任。
8. [15-sdk-transport.md](./15-sdk-transport.md)：理解 `GeminiClient` / `GeminiChat` 作为内部复用层的边界。

## 章节索引

> 横向对齐规则：`01-25` 是四个 AI Coding CLI 目录共享的主题主干；Gemini CLI 当前没有项目特有附录。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | TypeScript monorepo、核心抽象和分层模型 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | 从 CLI 到 Config、TUI、headless 的初始化顺序 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | Turn 事件流、模型请求、工具回流和循环检测 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | conversation history、context、memory、masking |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | ToolRegistry、PolicyEngine、Scheduler、ToolExecutor |
| [06-extension-mcp.md](./06-extension-mcp.md) | MCP 与扩展 | MCP discovery、transport、OAuth、trust、skills |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | retry、sandbox、环境清洗、工作区信任 |
| [08-performance.md](./08-performance.md) | 性能与质量 | 大仓库处理、流式响应、工具输出治理 |
| [09-observability.md](./09-observability.md) | 可观测性 | MessageBus、日志、TUI 状态和遥测 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | ChatRecording、resume、history 重建 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | PromptProvider、system instruction、上下文拼装 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | 本地 agent、A2A 远程代理和调度器 |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | Markdown skill、动态激活和 prompt 注入 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | MCP/Extension 作为插件面的实现 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | GeminiClient、GeminiChat、交互/非交互复用 |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | 重试、自愈、错误归一化和终止路径 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | settings、环境变量、`.gemini` 和 runtime policy |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 代码语义理解能力和当前限制 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | 生命周期事件、hook 执行和扩展稳定性 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | Ink TUI、非交互模式、输入分发 |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge | IDE、A2A、MCP、Extensions 多接入面 |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的完整总览 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | Slash command、队列、UI 到 core 的桥接 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统 | MCP 工具、Prompt、Resource 发现与调用流程 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | 本地 debug、日志、断点和常见问题 |

## 核心心智模型

把 Gemini CLI 看成“以 `Config` 为组合根、以 `GeminiClient` 为会话编排器、以 `Turn.run()` 为模型事件解释器、以 `Scheduler` 为工具执行器”的 TypeScript Agent runtime。`packages/cli` 提供交互体验，`packages/core` 才是可复用的行为中心。

## 维护注意

- 新增章节时同步更新本 README 和 [index.md](./index.md)。
- 源码引用统一写成 repo-root 路径，例如 `sources/gemini-cli/packages/core/src/core/client.ts:883`。
- 修改源码锚点后运行 `powershell -NoProfile -ExecutionPolicy Bypass -File ../scripts/check_doc_refs.ps1 -DocDirs hello-gemini-cli`。

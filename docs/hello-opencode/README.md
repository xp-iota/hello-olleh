---
layout: default
title: "OpenCode 源码分析 README"
---

# OpenCode 源码分析 README

本目录记录 OpenCode `v1.4.14` 的源码分析。分析对象是 `sources/opencode/` 上游快照，技术栈是 Bun + TypeScript + Effect-ts，核心特征是 Hono Server、SQLite durable state、Bus/SSE 事件投影、Session loop 和 provider/tool/system 的晚绑定。

## 阅读入口

- 网页索引：[index.md](./index.md)
- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 主线索引：[36-mainline-index.md](./36-mainline-index.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先建立 OpenCode 的 server/session/durable state 总图。
2. [02-startup-flow.md](./02-startup-flow.md)：理解 CLI/TUI/Web/Desktop/serve 如何收束到 server contract。
3. [26-server-routing.md](./26-server-routing.md)：补齐 Hono server、Workspace、Instance、路由边界。
4. [11-prompt-system.md](./11-prompt-system.md)：看输入如何先落 durable user message。
5. [27-session-loop.md](./27-session-loop.md)：深入 `SessionPrompt.loop()` 的状态机。
6. [28-stream-processor.md](./28-stream-processor.md)：看模型流如何写回 MessageV2/Part。
7. [29-llm-request.md](./29-llm-request.md)：理解 provider、tool、system prompt 的晚绑定。
8. [30-model.md](./30-model.md) 和 [31-infra.md](./31-infra.md)：最后补齐 durable object model、SQLite、Storage、Bus。

## 章节索引

> 横向对齐规则：`01-25` 是四个 AI Coding CLI 目录共享的主题主干；OpenCode 的 `26-38` 是 durable state、server routing、session loop、Effect-ts 等项目特有深挖附录。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 目录、分层、核心抽象 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | 多表面入口到 server contract |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | `prompt -> loop -> processor -> llm` 主线 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | Durable State、context、memory |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | 工具注册、权限、执行和写回 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | MCP、Plugin、Skill、custom tool |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | 重试、自愈、认证、权限边界 |
| [08-performance.md](./08-performance.md) | 性能与质量 | 流式传输、SSE、架构代价 |
| [09-observability.md](./09-observability.md) | 可观测性 | Bus、日志、运行状态 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | Durable State 写回、数据库、前端投影 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | `SessionPrompt.prompt()` 和 durable user message |
| [12-multi-agent.md](./12-multi-agent.md) | 高级编排 | Subagent、Command、Compaction |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | Skill 发现、注入和执行语义 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | Plugin 生命周期、hook、custom tool |
| [15-sdk-transport.md](./15-sdk-transport.md) | 入口与传输 | CLI/TUI/Web/Desktop 协议复用 |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | retry、overflow、交互式阻塞 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | 全局目录、`.opencode`、运行时覆盖 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 符号定位、诊断和代码理解 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | Effect-ts 事件流与扩展点 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | 多表面入口和统一 server contract |
| [21-bridge-system.md](./21-bridge-system.md) | 扩展面 | Plugin、MCP、Command、Skill 接入骨架 |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的总览 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | 用户输入编译、命令队列、执行流程 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统 | Tool/Prompt/Resource 发现与调用 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | 断点、日志、调试路径 |
| [26-server-routing.md](./26-server-routing.md) | Server 路由 | Hono 中间件、Workspace、Instance |
| [27-session-loop.md](./27-session-loop.md) | Session Loop | 历史回放、分支判断、并发闸门 |
| [28-stream-processor.md](./28-stream-processor.md) | Stream Processor | 模型流事件到 durable part |
| [29-llm-request.md](./29-llm-request.md) | LLM 请求 | 上下文、工具、provider 晚绑定 |
| [30-model.md](./30-model.md) | 对象模型 | Session、MessageV2、Part、Agent |
| [31-infra.md](./31-infra.md) | 基础设施 | SQLite、Storage、Bus、Instance |
| [32-worktree-sandbox.md](./32-worktree-sandbox.md) | Worktree/Sandbox | Git worktree 与隔离机制 |
| [33-mcp-details.md](./33-mcp-details.md) | MCP 细节 | MCP 连接、schema、状态和错误 |
| [34-design-philosophy.md](./34-design-philosophy.md) | 设计哲学 | 固定骨架与晚绑定策略 |
| [35-prompt-diff.md](./35-prompt-diff.md) | Prompt 对比 | Anthropic/Codex/default prompt 差异 |
| [36-mainline-index.md](./36-mainline-index.md) | 主线索引 | OpenCode 运行主线深度导航 |
| [37-durable-state-comparison.md](./37-durable-state-comparison.md) | 迁移说明 | 跨工具 Durable State 对比已迁移到 Harness |
| [38-effect-ts.md](./38-effect-ts.md) | Effect-ts | Service/Layer/Effect 依赖注入骨架 |

## 核心心智模型

OpenCode 应按“输入先落 durable history，loop 每轮从 durable history 重新推导状态，processor 把模型流增量写回 part，Bus/SSE 把状态投影给 UI”的模型阅读。它不是一个内存会话对象驱动的 agent，而是一套 durable state 驱动的运行时。

## 维护注意

- 新增正文专题时同步更新本 README 和 [index.md](./index.md)。
- `37-durable-state-comparison.md` 是迁移占位页，跨工具状态/记忆对比维护在 [../hello-harness/06-context-and-memory.md](../hello-harness/06-context-and-memory.md)。
- OpenCode 文档里短路径较多；新增源码锚点建议写成 `sources/opencode/packages/opencode/src/...:line`。

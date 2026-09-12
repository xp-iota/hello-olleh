---
layout: default
title: "Claude Code 源码分析 README"
---

# Claude Code 源码分析 README

本目录记录 Claude Code `v2.1.87` 反编译快照的源码分析。由于输入是反编译版，阅读时需要特别区分“真实运行链路”“反编译残留/stub”“文件行号漂移”三类内容。本文档的目标是给 `docs/hello-claude-code/` 提供稳定导航：从启动、REPL、`query()` 主循环、工具、MCP、prompt、memory 到桥接和多代理。

## 阅读入口

- 网页索引：[index.md](./index.md)
- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先确认反编译快照的结构、入口层、UI 层、状态层和请求层。
2. [02-startup-flow.md](./02-startup-flow.md)：追踪 `main.tsx`、setup、trust、配置、REPL 启动。
3. [20-repl-and-state.md](./20-repl-and-state.md)：理解 React TUI 的交互中心和状态更新方式。
4. [23-input-command-queue.md](./23-input-command-queue.md)：看用户输入如何进入命令/消息队列。
5. [03-agent-loop.md](./03-agent-loop.md)：深入 `query()` 主循环、模型请求、工具批处理和结果回注。
6. [05-tool-system.md](./05-tool-system.md)：理解工具 schema、权限、并发执行和回流。
7. [11-prompt-system.md](./11-prompt-system.md)：系统性阅读 Claude Code 的 prompt runtime。
8. [04-state-session-memory.md](./04-state-session-memory.md)：补齐 session、context、memory、compaction 和恢复。

## 章节索引

> 横向对齐规则：`01-25` 是四个 AI Coding CLI 目录共享的主题主干；Claude Code 特有的 `24b`、`25b` 作为附录保留。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 反编译快照结构、主分层和核心抽象 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | 从入口到 REPL 的初始化顺序 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | `query()` 主循环、模型请求和工具回流 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | AppState、context、memory、compaction、resume |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | 工具定义、权限、执行编排和结果注入 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | Skills、plugins、MCP 总接入面 |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | provider、请求构造、重试、敏感边界 |
| [08-performance.md](./08-performance.md) | 性能与缓存 | prompt cache、prefetch、长会话稳定性 |
| [09-observability.md](./09-observability.md) | 可观测性 | 日志、遥测、状态追踪 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | transcript、resume、恢复消毒 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | system/tool/command/agent/memory prompt 全谱 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | 子代理、后台任务、远程会话 |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | Markdown skill、命令总线注入 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | 插件加载、命令贡献、hooks 注册 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | SDK/headless、transport、stream event |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | provider fallback、重试、长会话恢复 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | settings、managed env、托管策略 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 代码理解与符号定位 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | 生命周期钩子和运行时语义 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | React TUI、状态分发、输入与渲染 |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge | 远程桥接、JWT、历史同步 |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的总览 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | Slash command、自然语言输入、队列分发 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统 | MCP client、transport、resource、prompt、权限 |
| [24b-mcp-deep.md](./24b-mcp-deep.md) | MCP 深挖 | OAuth/XAA、生命周期钩子、渠道权限 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | 调试入口、日志和风险点 |
| [25b-growthbook.md](./25b-growthbook.md) | GrowthBook | feature flags、远程配置、三层覆盖 |

## 核心心智模型

Claude Code 可以按“React TUI + `query()` 主循环 + prompt/cache/memory 侧通道 + 工具/MCP 执行面”的模型阅读。反编译快照里类型系统和文件边界不总是可靠，因此应优先跟随运行时主链路，而不是只相信目录名或 stub 文件。

## 维护注意

- 新增文档时同步更新本 README 和 [index.md](./index.md)。
- 涉及反编译推断时在正文中显式标注“推断”或“反编译残留”。
- 源码锚点应尽量使用 repo-root 路径；若校验脚本无法覆盖反编译短路径，要在正文解释来源。

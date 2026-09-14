---
title: "Nanobot 源码分析 README"
---
# Nanobot 源码分析 README

本目录记录 nanobot `v0.3.0`（PyPI 包名 `nanobot-ai`）的源码分析。分析对象是 `sources/nanobot/` 上游快照。nanobot 是一个轻量级个人 AI 助手框架：单 Python 包（`nanobot/`），核心是把"聊天渠道接入"与"模型推理循环"拆成两层——`MessageBus` 承载入站/出站消息，`AgentLoop` 面向渠道做回合状态机，`AgentRunner` 面向模型做迭代与工具执行；外围再挂上 17 个聊天渠道、WebUI、OpenAI 兼容 API、cron/trigger 自动化与 MCP 扩展。

## 阅读入口

- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)
- 上游权威文档：[`sources/nanobot/docs/`](../../sources/nanobot/docs/README.md)（architecture、concepts、configuration 等）

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先建立"渠道 -> 总线 -> AgentLoop -> AgentRunner -> Provider/工具"的分层模型。
2. [02-startup-flow.md](./02-startup-flow.md)：追踪 typer CLI 入口、onboard 向导与 gateway/WebUI 启动。
3. [03-agent-loop.md](./03-agent-loop.md)：理解 TurnState 状态机与 AgentRunner 的迭代/注入/收尾语义。
4. [04-state-session-memory.md](./04-state-session-memory.md)：补齐 JSONL 会话、MemoryStore/Dream 与 AutoCompact。
5. [05-tool-system.md](./05-tool-system.md)：理解 ToolRegistry、内建工具清单与插件发现。
6. [06-extension-mcp.md](./06-extension-mcp.md)：看 MCP、skill、channel package、tool plugin 四类扩展面的总览。
7. [15-sdk-transport.md](./15-sdk-transport.md)：理解进程内 SDK 与 OpenAI 兼容 HTTP API 的边界。
8. [23-input-command-queue.md](./23-input-command-queue.md)：看消息总线准入与 slash command 的分发。

## 章节索引

> 横向对齐规则：`01-25` 是五个 AI Coding CLI 目录共享的主题主干；nanobot 目前没有项目特有附录。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 单包分层、渠道/总线/循环/Provider 的职责边界 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | typer 命令树、onboard、gateway 服务与 WebUI 启动 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | TurnState 状态机、AgentRunner 迭代、注入与工具回流 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | JSONL 会话、MemoryStore/Dream、AutoCompact |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | Tool 契约、注册表、内建工具与插件加载 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | MCP、skill、channel package、tool plugin 的总览 |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | 工作区边界、SSRF 防护、配对与错误兜底 |
| [08-performance.md](./08-performance.md) | 性能 | 异步总线、上下文治理预算、会话缓存与流式 |
| [09-observability.md](./09-observability.md) | 可观测性 | loguru 日志、运行时事件、token 统计与 Langfuse |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | JSONL 持久化、fork、重建与合法性修剪 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | 模板目录、ContextBuilder 与身份文件 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | SubagentManager、spawn 工具与结果宣告 |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | SkillsLoader、内建 skills 与需求检查 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | 工具插件 entry points 与渠道自包含包 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | 进程内 SDK、OpenAI 兼容 API 与流式事件 |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | fallback provider、取消、注入上限与错误兜底 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | config.json、pydantic schema、环境变量插值与迁移 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 无 LSP 集成，说明边界 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | AgentHook 生命周期方法与 CompositeHook |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | prompt-toolkit 交互、流式渲染与键绑定 |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge / 外部集成 | 17 个聊天渠道、gateway 与 WebUI |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的总览与包清单 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | MessageBus 准入、CommandRouter 与内建命令 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统 | MCP 连接管理、工具名清洗与容错 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | 日志开关、状态命令与常见问题定位 |

## 核心心智模型

nanobot 可以按"渠道产生 `InboundMessage` -> `MessageBus` 排队 -> `AgentLoop` 按 TurnState 状态机组织回合（恢复/压缩/命令/构建/运行/保存/响应）-> `AgentRunner` 做模型迭代与工具执行 -> `OutboundMessage` 回投渠道"的模型阅读。三个最关键的设计取舍：会话是 JSONL 追加文件（而非数据库）；记忆是工作区 Markdown 文件加 Dream 整合（而非向量库）；扩展面以"自包含渠道包 + 工具 entry points + MCP"三条轻量路径覆盖，没有重型插件运行时。

## 维护注意

- 引用运行时语义时优先链到 `sources/nanobot/docs/` 的上游文档与具体源码文件，而不是复述内存中的类型名。
- nanobot 迭代较快，配置键同时存在 camelCase 与 snake_case 别名；引用配置时以 `nanobot/config/schema.py` 为准。
- 本目录暂未补 Archify 图表；新增图表时遵循仓库 `tools/archify/` 的 IR -> validate -> deliver -> extract-svg 流水线。

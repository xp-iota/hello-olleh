---
title: "OpenCode 源码分析 README"
---
# OpenCode 源码分析 README

本目录记录 OpenCode `v2.0.2` 的源码分析。分析对象是 `sources/opencode/` 上游快照。v2 是一次多包架构重建：公共形状归 `packages/schema`，HTTP 操作归 `packages/protocol`，运行时与持久化归 `packages/core`，传输与 SSE 归 `packages/server`，插件公共契约归 `packages/plugin`，CLI/TUI/SDK/Desktop 等宿主只消费组装后的 API。运行时内核基于 Effect-ts，会话状态采用 durable event log + projection 模型，而不是内存对象树。

## 阅读入口

- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)
- v2 跨包语义契约（上游权威文档）：[`specs/v2/`](../../sources/opencode/specs/v2/README.md)

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先建立多包拓扑、所有权分层与 Location/Host 作用域模型。
2. [02-startup-flow.md](./02-startup-flow.md)：追踪 CLI 入口、命令树分发与后台 service 的连接策略。
3. [03-agent-loop.md](./03-agent-loop.md)：理解 prompt 准入、进程内执行所有权、Step/Attempt 与工具回流。
4. [04-state-session-memory.md](./04-state-session-memory.md)：补齐 durable event log、projection、compaction 与 instruction delta。
5. [05-tool-system.md](./05-tool-system.md)：理解 `Tool.make` 结构契约、Scope 注册覆盖与请求快照。
6. [06-extension-mcp.md](./06-extension-mcp.md)：看 MCP、plugin、skill、catalog 的扩展接入面。
7. [15-sdk-transport.md](./15-sdk-transport.md)：理解 Protocol/Server/SDK/Client 的传输边界与 SSE 事件流。
8. [23-input-command-queue.md](./23-input-command-queue.md)：看 steer/queue 两种输入准入模式与 slash command 的分发。

## 章节索引

> 横向对齐规则：`01-25` 是五个 AI Coding CLI 目录共享的主题主干；OpenCode 在 v2 重建后没有项目特有附录，v1 时代的 `26-38` 深挖内容已按主题并入主干各章。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 多包拓扑、所有权分层、Location/Host 作用域与事件架构 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | CLI 入口、命令树懒加载、后台 service 连接与 TUI 启动 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | prompt 准入、进程内执行所有权、Step/Physical Attempt 与工具回流 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | durable event log、projection、inbox、compaction 与 instruction delta |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | `Tool.make` 契约、Scope 注册覆盖、请求快照与输出边界 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | MCP、plugin、skill、catalog 四类扩展面的总览 |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | 结构化错误、权限断言、provider policy 与事件流隔离 |
| [08-performance.md](./08-performance.md) | 性能与缓存 | 一次编码多处投递、有界队列、SQLite 持久化与并发上限 |
| [09-observability.md](./09-observability.md) | 可观测性 | 事件日志、请求追踪、结构化日志与调试命令 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | durable 事件回放、同步水位线、执行 claim 与孤儿工具 reconciliate |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | system prompt 模板、instruction 来源谱系与 epoch 基线 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | Agent 目录、子代理任务、plan agent 与代理选择 |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | skill 发现、路径安全校验与 instruction 注入 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | 插件宿主、监督器、模块加载与 hooks 注册 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | Protocol/Server/Client/SDK 分层、OpenAPI 生成与 SSE |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | 窄重试、incomplete stream 续接、溢出 compaction 与恢复边界 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | 配置发现、归一化、变量插值、watch 与 catalog 生命周期 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | v2 仅保留公共 LSP 事件形状，说明边界变化 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | 五域 hooks、失败通道规则与 Scope 生命周期 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | Solid TUI、context provider 树与 mini 模式 |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge / 外部集成 | ACP 桥接、Desktop 宿主与 IDE 事件 |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的总览与包清单 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | inbox 准入、steer/queue、控制项与 slash command |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统 | MCP client、stdio/remote、OAuth、elicitation 与 instruction 注入 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | debug 命令、日志开关、profile 与录制/仿真设施 |

## 核心心智模型

OpenCode v2 可以按“Schema 定义公共形状 -> Protocol 组装 HTTP 操作 -> Core 以 durable event log + projection 承载运行时 -> Server 一次编码向多连接投递 SSE -> 各类宿主（CLI/TUI/SDK/Desktop）消费公共 API”的模型阅读。会话侧最关键的三条性质：输入先持久化再执行（inbox 准入）、执行是进程内所有权（SessionExecution + write-ahead claim）、模型历史由 projection 重建（instructions 是内容寻址的值增量，compaction 只改活跃历史不动完整 transcript）。

## 维护注意

- 引用跨包语义时优先链到 `sources/opencode/specs/v2/` 的契约文档，而不是复述内存中的类型名。
- v2 把 v1 的单包 `packages/opencode` 拆成多包；引用旧路径的内容一律视为过期。
- 本目录暂未补 Archify 图表；新增图表时遵循仓库 `tools/archify/` 的 IR -> validate -> deliver -> extract-svg 流水线。

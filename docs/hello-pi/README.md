---
title: "Pi 源码分析 README"
---
# Pi 源码分析 README

本目录记录 [earendil-works/pi](https://github.com/earendil-works/pi) `v1.1.0`（`abe508e`，2026-10-07 发布）的源码分析。分析对象是 `sources/pi/` 上游快照（由 `sync_repos.sh` 刷新）。pi 是 Mario Zechner（badlogic）开发的"minimal, extensible agent harness"：一个刻意把内核做小的编码 agent——核心只保留 `pi-agent-core` 双层 agent 循环、`pi-ai` 统一多 provider LLM API 与 8 个内建工具，其余一切能力（MCP、codemode、tool-search、llama.cpp，乃至 sub-agent 与 plan mode）都是扩展；定制方向是"让 pi 适配你的工作流，而不是反过来"。

## 阅读入口

- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)
- 上游权威文档：[`sources/pi/packages/coding-agent/docs/`](../../sources/pi/packages/coding-agent/docs/extensions.md)（extensions、skills、rpc、session-format 等 40+ 篇，随 npm 包一起发布）

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先建立"14 包底向上分层 + 三个刻意没有（子代理/计划模式/权限系统）"的全景模型。
2. [03-agent-loop.md](./03-agent-loop.md)：理解 `Agent` 状态层与 `runAgentLoop` 低层循环的两层设计，以及 steer / followUp 两条输入队列。
3. [05-tool-system.md](./05-tool-system.md)：看 8 个内建工具、五段工具执行链与 `toolExposure` 五档暴露控制。
4. [06-extension-mcp.md](./06-extension-mcp.md)：理解"扩展第一公民"——事件、注册、jiti 加载与内建扩展可替换机制。
5. [11-prompt-system.md](./11-prompt-system.md)：看分节 system prompt 与按节 diff 的缓存友好设计。
6. [04-state-session-memory.md](./04-state-session-memory.md)：补齐 JSONL entry 树会话、compaction，以及实验性 `pi-durable` 检查点状态机这条"将来时"主线。
7. 其余章节按 `07-25` 的共享主题主干横向对照其他 CLI 阅读。

## 章节索引

> 横向对齐规则：`01-25` 是七个 AI Coding CLI 目录共享的主题主干；pi 目前没有项目特有附录。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 14 包分层、核心极小哲学与端到端调用链 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | `pi` 入口十步：auth/包管理子命令、模式判定、runtime 工厂 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | 两层循环、流式事件、工具执行与 pi-ai 请求路径 |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | JSONL entry 树、compaction、pi-durable 检查点状态机 |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | AgentTool 契约、内建工具、执行链与暴露控制 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | 扩展工厂、jiti 加载、发现位置与内建扩展替换 |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | 无权限系统的安全模型、trust 门控与供应链加固 |
| [08-performance.md](./08-performance.md) | 性能 | 差分渲染 TUI、入口图预算、分节 prompt diff |
| [09-observability.md](./09-observability.md) | 可观测性 | pi-telemetry 契约、crash-log、/bug 与调试开关 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | `--resume/--continue/--fork`、会话树与导出/分享 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | 分节 system prompt、AGENTS.md 加载、模板与 skills 广告 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | 无内建 sub-agent 的官方姿态与扩展补法 |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | SKILL.md 约定、`~/.agents/skills` 跨工具发现 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | Pi packages（npm/git 资源包）与 chord facets 辨析 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | SDK、print/JSON/RPC 三自动化面与 CBOR 远程会话栈 |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | 重试、溢出检测、截断保护与跨模型 transcript 清洗 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | SettingsManager 两层合并、`~/.pi/agent` 目录全景 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 无 LSP 集成的边界说明与替代能力 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | 扩展事件全清单即 pi 的 hooks，带返回值事件即审批门 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | InteractiveMode、pi-tui 编辑器与流式期间输入处理 |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge / 外部集成 | RPC 驱动的集成生态、pi.dev 服务与 pi-chat |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的总览与包清单 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | steer/followUp 双队列语义与 durable 收件箱对照 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统深挖 | 独立 MCP 客户端、传输、OAuth 与 `mcp__*` 命名空间 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | `/debug` 日志、crash-log、扩展热重载与源码运行 |

## 核心心智模型

pi 可以按"扩展事件驱动的极小内核"模型阅读：`pi-agent-core` 的 `Agent.prompt()` 持有 transcript 与两条输入队列（steer 在轮间注入、followUp 在将停时续跑）→ `runAgentLoop` 每轮先跑 `prepareNextTurn` 钩子，再把 `AgentMessage[]` 经 `convertToLlm` 折叠成 `pi-ai` 的 `Message[]` 请求任意 provider → 工具调用经五段执行链（参数 shim → typebox 校验 → beforeToolCall 审批 → execute → afterToolCall 改写）回注。三个最关键的设计取舍：核心不做的（sub-agent、plan mode、权限审批）都留给扩展，内建扩展本身也可被同名第三方替换；system prompt 与工具声明都是 transcript-delta（分节可 diff、只重发送变化区），为 prompt 缓存与跨模型切换服务；会话默认是 JSONL entry 树，而 `pi-durable`（Conversation/Entry/Task/Submission/Document + SQLite/JSONL 双存储 + 检查点任务状态机）是官方明确标注的实验性未来形态。

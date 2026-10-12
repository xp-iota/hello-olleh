---
title: "OpenClaw 源码分析 README"
---
# OpenClaw 源码分析 README

本目录记录 [openclaw/openclaw](https://github.com/openclaw/openclaw) `v2026.10.2`（`b8952d4`，2026-10-11 发布）的源码分析。分析对象是 `sources/openclaw/` 上游快照（由 `sync_repos.sh` 刷新）。OpenClaw 是 OpenClaw Foundation（独立 501(c)(3)）维护的开源个人 AI 助理网关——"Multi-channel AI gateway with extensible messaging integrations"：一个常驻本机的 Gateway 进程是唯一控制面（"One Gateway per host"），把助手桥接到 WhatsApp、Telegram、Slack、Discord、iMessage 等 20+ 消息通道；Control UI / CLI / TUI / 原生应用都只是同一 WS 协议的客户端；模型 provider 与 agent harness（Claude、Codex、本地模型）皆是可替换插件，状态、记忆、凭据全部留在本机。

## 阅读入口

- 总览版报告：[22-project-init-analysis.md](./22-project-init-analysis.md)
- 根项目说明与当前源码快照版本：[../../README.md](../../README.md)
- 上游权威文档：[`sources/openclaw/docs/`](../../sources/openclaw/docs/concepts/architecture.md)（docs.openclaw.ai 全量文档源随仓库携带，31 MB）

## 推荐阅读顺序

1. [01-architecture.md](./01-architecture.md)：先建立"单 Gateway 控制面 + 通道/模型/harness 皆插件"的全景模型与六层 workspace 分层。
2. [02-startup-flow.md](./02-startup-flow.md)：看 752 行入口守门人 `openclaw.mjs` 如何在应用代码之前完成 runtime 门与自愈 respawn，以及常驻进程的三平台守护化。
3. [03-agent-loop.md](./03-agent-loop.md)：理解与 pi 同构的 `@openclaw/agent-core` 通用循环，以及 OpenClaw 在外包的厚嵌入式运行时（准入、failover、压缩恢复）。
4. [21-bridge-system.md](./21-bridge-system.md)：看"通道即插件"如何把 20+ 消息平台压进统一适配面，以及 pairing 带外审批安全模型。
5. [04-state-session-memory.md](./04-state-session-memory.md)：补齐"状态上收 Gateway"的双 SQLite 模型与 provenance 列级防投毒的记忆体系。
6. 其余章节按 `07-25` 的共享主题主干横向对照其他 CLI 阅读。

## 章节索引

> 横向对齐规则：`01-25` 是七个 AI Coding CLI 目录共享的主题主干；openclaw 目前没有项目特有附录。跨项目比较统一维护在 [`../hello-harness/15-topic-alignment-matrix.md`](../hello-harness/15-topic-alignment-matrix.md)。

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | 架构全景 | 单 Gateway 控制面、src/packages/crates/apps/ui 六层分层、端到端调用链 |
| [02-startup-flow.md](./02-startup-flow.md) | 启动链路 | 入口守门人四跳、runGatewayLoop 六步、launchd/systemd/schtasks 守护化 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent 循环 | 双 lane 准入、`runAgentLoop` 回合循环、StreamFn 与 tool-batch admission |
| [04-state-session-memory.md](./04-state-session-memory.md) | 状态、会话、记忆 | 双 SQLite（schema 20/24）、session key、五层记忆与 dreaming 巩固 |
| [05-tool-system.md](./05-tool-system.md) | 工具系统 | AgentTool 契约、tool-catalog 四档 profile、policy 管道与批次准入 |
| [06-extension-mcp.md](./06-extension-mcp.md) | 扩展与 MCP | native plugin / compatible bundle / MCP server 三形态、174 内建插件 |
| [07-error-security.md](./07-error-security.md) | 错误与安全 | 单一信任边界、pairing 准入、permission mode 与审计体检 |
| [08-performance.md](./08-performance.md) | 性能 | 入口 fast path、V8 compile cache、用测试守护的激活边界 |
| [09-observability.md](./09-observability.md) | 可观测性 | 双日志面、统一脱敏引擎、metadata-only 审计与 opt-in 遥测 |
| [10-session-resume.md](./10-session-resume.md) | 会话恢复 | 三道中断标记、合成消息对账、随守护进程收缩的 drain 预算 |
| [11-prompt-system.md](./11-prompt-system.md) | Prompt 系统 | cache boundary 字节级切分、provider 三通道、skills 懒广告 |
| [12-multi-agent.md](./12-multi-agent.md) | 多代理 | agent 即人格边界、bindings 路由、subagent registry 与 fleet |
| [13-skill-system.md](./13-skill-system.md) | Skill 系统 | 七级加载优先级、门控三分离、不可变修订与 ClawHub 信任封套 |
| [14-plugin-system.md](./14-plugin-system.md) | Plugin 系统 | capability 注册模型、consent 门、热替换与 plugin-state 持久化 |
| [15-sdk-transport.md](./15-sdk-transport.md) | SDK 与传输 | WS wire v4 协议、三层客户端谱系、ACP 桥与 Rust 客户端 |
| [16-resilience.md](./16-resilience.md) | 韧性机制 | failover 候选链、压缩恢复、crash-loop breaker、共享算术的关机预算 |
| [17-settings-config.md](./17-settings-config.md) | 配置 | JSON5 单文件、严格校验、防破坏写三件套与 onboard 向导 |
| [18-lsp-integration.md](./18-lsp-integration.md) | LSP | 插件 bundle 声明 `lspServers`、三个只读符号工具与刻意缺位清单 |
| [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) | Hooks | typed hooks 与 internal hooks 双轨、fail-closed 门、daemon 生命周期 |
| [20-repl-and-state.md](./20-repl-and-state.md) | REPL 与状态 | TuiBackend 双后端、Control UI 投影、实时状态与 outbox |
| [21-bridge-system.md](./21-bridge-system.md) | Bridge / 外部集成 | 通道即插件五适配面、九级 binding 路由、pairing 安全模型 |
| [22-project-init-analysis.md](./22-project-init-analysis.md) | 初始化报告 | 首次进入仓库的总览与 24 包清单 |
| [23-input-command-queue.md](./23-input-command-queue.md) | 输入队列 | 按键 debounce、steer/followup/collect/interrupt 四模式、溢出压缩 |
| [24-mcp-system.md](./24-mcp-system.md) | MCP 系统深挖 | 三传输与自建 OAuth、指数退避、三条服务腿 |
| [25-debugging.md](./25-debugging.md) | 调试指南 | status→doctor 命令阶梯、JSONL 日志、proxy 抓包与 Docker healthcheck |

## 核心心智模型

OpenClaw 可以按"常驻网关持有状态、其余皆插件"模型阅读：Gateway 是唯一控制面（`src/infra/gateway-lock.ts` 保证单实例），通道连接、会话、transcript、队列、工具、事件全部由它持有并落在本机双 SQLite（schema 20/24，前向 only）；所有客户端——Control UI、CLI、TUI、原生应用、ACP 桥、Rust node host——都是同一条 WebSocket 协议（wire v4）的普通客户端，没有特权通道。执行面上模型与 harness 皆是插件：内建的 174 个 `extensions/` 与第三方走完全相同的 capability 契约。内核循环来自与 pi 同构的 `@openclaw/agent-core`（LLM 调用是可替换 `StreamFn`、steer/followUp 双队列），但外面包了一层远为厚重的嵌入式运行时——双 lane 准入、模型候选链 failover、压缩/溢出恢复、tool-loop 熔断与"恢复即结算"的重启语义；连"与助手对话改配置"的 system agent 也复用同一循环。安全上它是"trusted gateway, untrusted execution, deterministic policy"：通道消息默认不可信，DM 准入靠带外 pairing 审批，记忆防投毒靠 SQLite 列级 provenance 而非内容检测，审计只记元数据。与一次性 CLI 相反，"重启是常态"是一等工程约束——启动失败宁可保活等修复也不退出喂给守护进程下一次崩溃。

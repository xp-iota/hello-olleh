---
title: "架构全景：单 Gateway 控制面与可替换执行面"
---
# 架构全景：单 Gateway 控制面与可替换执行面

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 自我定位为 "Multi-channel AI gateway with extensible messaging integrations"（`package.json` 的 description 字段）：常驻本机的 Gateway 是唯一控制面，Control UI / CLI / TUI / 消息通道都只是它的客户端，模型 provider 与 agent harness 皆可替换。

**目录**

- [1. 总体形态与关键取舍](#1-总体形态与关键取舍)
- [2. workspace 分层：src、packages、crates、apps、ui](#2-workspace-分层srcpackagescratesappsui)
- [3. 端到端调用链](#3-端到端调用链)
- [4. 架构不变量](#4-架构不变量)

---

## 1. 总体形态与关键取舍

OpenClaw 是 pnpm workspace monorepo，核心形态是"一个主机一个 Gateway"（`docs/concepts/architecture.md`："One Gateway per host"）。它刻意保持了四类取舍：

| 取舍 | 说明 |
| --- | --- |
| Gateway 单进程控制面 | 所有通道连接、会话、工具、事件都由 Gateway 持有；`src/infra/gateway-lock.ts` 加端口/锁保证唯一实例，客户端经 WebSocket 连接默认 `127.0.0.1:18789`（`src/gateway/server.ts:26`） |
| 通道是一等公民 | `src/channels/` 约 70 个顶层实现文件；生成式清单收录 27 个 bundled channel id（`src/channels/bundled-channel-ids.generated.ts`，WhatsApp/Telegram/Slack/Discord/Signal/iMessage/Matrix……），README 宣称 "20+ more" |
| 模型与 harness 皆插件 | 内建 runtime id 为 `openclaw`，`codex` 等由插件 harness 注册，`auto` 按路由选择（`docs/agent-runtime-architecture.md`）；"No external agent framework packages remain" |
| 单一信任边界 | "trusted gateway, untrusted execution, deterministic policy"；DM 通道默认 pairing 准入（见 [07-error-security.md](./07-error-security.md)） |

状态全部落在本地 `~/.openclaw/`（双 SQLite 库），见 [04-state-session-memory.md](./04-state-session-memory.md)。

## 2. workspace 分层：src、packages、crates、apps、ui

按依赖方向自底向上（内部包以 `@openclaw/*` 互相引用）：

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 0 | `packages/{normalization-core,retry,markdown-core,terminal-core,net-policy,...}` | 无状态原语：字符串/数字规整、重试退避、Markdown、终端组件、网络策略 |
| 1 | `packages/{llm-core,ai,model-catalog-core,tool-call-repair,media-core,...}` | LLM 消息类型与流式契约、模型目录、工具调用修复 |
| 2 | `packages/agent-core`（`@openclaw/agent-core`） | 通用 agent loop（`agent-loop.ts`、`Agent` 类）、harness 类型、prompt 模板、技能、会话存储契约 |
| 3 | `packages/{gateway-protocol,gateway-client,plugin-sdk,sdk,acp-core,worker-runtime,...}` | Gateway 线协议、客户端、插件 SDK barrel、worker 运行时 |
| 4 | `src/`（78 个子目录） | Gateway / CLI 主体：`gateway/`、`agents/`、`channels/`、`daemon/`、`cli/`、`context-engine/`、`sessions/`、`state/`、`llm/`、`process/`、`worker/` |
| 5 | `crates/`（Rust） | `openclaw-node-host`："Reusable Rust OpenClaw node runtime and headless host"（有界命令运行时、心跳、协作取消）；`openclaw-gateway-client`：Rust 客户端的传输与 TLS/连接策略 |
| 6 | `apps/`、`ui/`、`extensions/` | 原生伴侣应用（macOS/iOS/Android/Linux）、Vite 构建的 Control UI、浏览器扩展等 |

## 3. 端到端调用链

一条通道消息到回复的主干（循环细节见 [03-agent-loop.md](./03-agent-loop.md)，启动侧见 [02-startup-flow.md](./02-startup-flow.md)）：

```
Channel (WhatsApp/Telegram/...)
  │ inbound
  ▼
Gateway WS server :18789            src/gateway/server.ts:23 startGatewayServer
  ├─ pairing / allowlist 准入       src/pairing/、src/channels/allow-from.ts
  ├─ chat pipeline                  src/gateway/chat-*.ts
  ▼
agentCommandFromGatewayIngress      src/agents/agent-command.ts:716
  └─ runEmbeddedAgentAttempt        src/agents/command/run-embedded-attempt.ts:68
      └─ runEmbeddedAgent           src/agents/embedded-agent-runner/run-orchestrator.ts:113
          └─ runAgentLoop           packages/agent-core/src/agent-loop.ts:73
              ├─ streamAgentResponse → StreamFn（provider 可替换）
              └─ executeToolCalls    agent-loop.ts:459（beforeToolCall 审批门）
```

关键边界：`@openclaw/agent-core` 对 provider 目录零依赖，LLM 调用是一个可替换的 `StreamFn`；`src/agents/` 是 OpenClaw 自有的嵌入式包装（模型/harness 选择、压缩、恢复），比 pi 的同构层厚得多。

## 4. 架构不变量

- **单 Gateway 锁**：`acquireGatewayLock`（`src/infra/gateway-lock.ts`）+ state owner 信号；锁语义有专文 `docs/gateway/gateway-lock.md`。
- **插件边界**：插件只准走 `openclaw/plugin-sdk/*` barrel，不得 import `src/**` 内部（`docs/agent-runtime-architecture.md` 的 Boundaries 节）；`@earendil-works/pi-tui` 是仅存的第三方 TUI 依赖。
- **配置只读当前 schema**：`VISION.md` 明言不保留旧配置键的静默别名；破坏性改动必须同 PR 配 doctor 迁移。
- **prepared model runtime generation**：Gateway 启动与配置发布按 agent 构建原子快照（auth 模板 + 模型注册 + 目录投影一体），失败的旧代永不与新代并行服务（`docs/agent-runtime-architecture.md`）。
- **worker CPU 准入**：code-mode / 压缩规划 / 文件工具规划共享 `max(1, availableParallelism() - 1)` 的 CPU 准入上限，给 Gateway 留一核。

## 源码锚点

- [`sources/openclaw/package.json`](../../sources/openclaw/package.json)：bin 指向 `openclaw.mjs`、schemaVersions、workspace 声明
- [`sources/openclaw/docs/concepts/architecture.md`](../../sources/openclaw/docs/concepts/architecture.md)：Gateway/客户端/节点的官方架构描述与 WS 协议摘要
- [`sources/openclaw/src/gateway/server.ts`](../../sources/openclaw/src/gateway/server.ts)：`startGatewayServer` 懒加载入口（默认端口 18789）
- [`sources/openclaw/src/channels/bundled-channel-ids.generated.ts`](../../sources/openclaw/src/channels/bundled-channel-ids.generated.ts)：生成式 bundled 通道清单
- [`sources/openclaw/packages/agent-core/src/agent-loop.ts`](../../sources/openclaw/packages/agent-core/src/agent-loop.ts)：`@openclaw/agent-core` 的通用循环
- [`sources/openclaw/crates/openclaw-node-host/src/lib.rs`](../../sources/openclaw/crates/openclaw-node-host/src/lib.rs)：Rust 节点宿主的能力/命令运行时
- [`sources/openclaw/docs/agent-runtime-architecture.md`](../../sources/openclaw/docs/agent-runtime-architecture.md)：runtime 布局、边界与 runtime 选择策略
- [`sources/openclaw/VISION.md`](../../sources/openclaw/VISION.md)：配置兼容性纪律与项目优先级

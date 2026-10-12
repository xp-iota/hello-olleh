---
title: "项目初始化报告（总览）：Multi-channel AI gateway"
---
# 项目初始化报告（总览）：Multi-channel AI gateway

> 基于 `sources/openclaw/` 快照通读（openclaw `v2026.10.2`，commit `b8952d4`，2026-10-11）。这是本分析集的"首次进入仓库"导读章；各主题细节见后续章节，本页只回答"这个项目是什么、长什么样、从哪读起"。

**目录**

- [1. 仓库定位](#1-仓库定位)
- [2. 上游信息](#2-上游信息)
- [3. 24 个 workspace 包](#3-24-个-workspace-包)
- [4. 仓库分层结构](#4-仓库分层结构)
- [5. 技术栈与工程约束](#5-技术栈与工程约束)
- [6. 目录速览与阅读路径](#6-目录速览与阅读路径)

---

## 1. 仓库定位

根 README 第一句：**"OpenClaw 🦞 — Your assistant, on your devices, in your chats"**；`package.json` 的 description 是 "Multi-channel AI gateway with extensible messaging integrations"。OpenClaw 是运行在自己设备上的开源个人 AI 助理：一个常驻 Gateway 进程是唯一控制面（"One Gateway per host"），把助手桥接到 WhatsApp、Telegram、Slack、Discord、iMessage 等 20+ 消息通道，Control UI / CLI / TUI / 原生伴侣应用都只是它的 WebSocket 客户端。模型与 agent harness（Claude、Codex、本地模型）皆是可替换插件；状态、记忆、凭据全部留在本机（默认仅每日版本检查回传，特性统计 opt-in）。治理方为独立的 OpenClaw Foundation（501(c)(3)），无付费层、无托管服务。

## 2. 上游信息

| 项 | 值 |
| --- | --- |
| 仓库 | [openclaw/openclaw](https://github.com/openclaw/openclaw)（GitHub） |
| 版本 | v2026.10.2（日历版本号；根 `package.json` `version: "2026.10.2"`，`schemaVersions: state 20 / agent 24`） |
| commit | `b8952d4`（2026-10-11 发布 tag v2026.10.2） |
| 作者 | OpenClaw Foundation（openclaw.org），MIT |
| 站点 / 文档 | [openclaw.ai](https://openclaw.ai) / [docs.openclaw.ai](https://docs.openclaw.ai)（快照内 `docs/` 随仓库携带全量文档源） |
| 安装 | `curl -fsSL https://openclaw.ai/install.sh \| bash`，或 `npm install -g openclaw@latest`；另有 Docker / Nix / launchd / systemd 部署路径 |
| 语言 | TypeScript（Node `>=24.16.0 <25 \|\| >=26.1.0`），Rust（`crates/`），测试 vitest |

## 3. 24 个 workspace 包

pnpm workspace，内部包一律 `@openclaw/*`。多数包无 description 字段，职责按导出面归纳（分层见 [01-architecture.md](./01-architecture.md) §2）：

| 包组 | 包 | 一句话职责 |
| --- | --- | --- |
| 无状态原语 | normalization-core、retry、markdown-core、terminal-core、net-policy | 字符串/数字规整、重试退避、Markdown、终端组件、网络策略 |
| LLM 契约 | llm-core、ai、model-catalog-core、tool-call-repair | LLM 消息类型与流式契约、"Reusable model provider adapters and streaming runtime"、模型目录、工具调用修复 |
| 媒体 | media-core、media-generation-core、media-understanding-common、mermaid-renderer | 媒体处理/生成/理解公共面、Mermaid 渲染 |
| Agent 内核 | agent-core | 通用 agent loop（`Agent` 类 + `runAgentLoop`），对 provider 目录零依赖 |
| Gateway 协议 | gateway-protocol、gateway-client、sdk | WS 线协议的 typed schema 与校验、参考客户端、客户端 SDK barrel |
| 扩展面 | plugin-sdk、plugin-package-contract | 插件唯一合法 import 面、插件包 manifest 契约 |
| 运行时 | worker-runtime、memory-host-sdk、acp-core、session-url-contract、workboard-contract | worker 准入运行时、记忆宿主 SDK、ACP 桥核心、会话 URL / workboard 契约 |

## 4. 仓库分层结构

| 位置 | 规模 | 内容 |
| --- | --- | --- |
| `src/` | 78 个子目录，实现文件数以万计（另有等量 `*.test.ts` 同置） | Gateway / CLI 主体：`gateway/`、`channels/`（约 70 个顶层实现文件）、`agents/`、`daemon/`、`cli/`、`sessions/`、`state/`、`memory/`、`context-engine/`、`mcp/`、`plugins/`、`skills/`、`tui/`、`security/`、`audit/`…… |
| `packages/` | 24 个 `@openclaw/*` 包 | 见 §3 |
| `extensions/` | 174 个目录 | 内建插件树：模型 provider（anthropic、amazon-bedrock、google、openai…）、通道（whatsapp、telegram…）、能力（browser、canvas、code-mode-quickjs…）——内建与第三方同赛 |
| `crates/` | 2 个 crate | `openclaw-node-host`（Rust 节点宿主：有界命令运行时、心跳、协作取消）、`openclaw-gateway-client`（Rust 客户端传输与 TLS pin） |
| `apps/` | 7 个 | 原生伴侣应用：macOS / iOS / Android / Linux、macos-mlx-tts、共享层与 swabble |
| `ui/` | Vite 工程 | Control UI（浏览器控制台），经同一 WS 协议连接 Gateway |
| `docs/` | 31 MB | 随仓库发布的全量文档站源（docs.openclaw.ai） |

## 5. 技术栈与工程约束

- **常驻优先**：与一次性 CLI 相反，一切设计围绕 daemon——launchd / systemd / schtasks 三平台守护化、crash-loop breaker、315s 优雅关机预算、启动失败"保活等修复"而非退出（[16-resilience.md](./16-resilience.md)）。
- **状态版本化**：`state: 20` / `agent: 24` 两套 SQLite schema 前向 only，新 schema 拒读旧库（Linux exit 78），破坏性配置改动必须同 PR 配 doctor 迁移（`VISION.md`）。
- **入口即守门人**：`openclaw.mjs`（752 行）在应用代码运行前完成 Node 版本门、受管 Node 安装与 compile-cache 自检，不合格即 respawn 自己（[02-startup-flow.md](./02-startup-flow.md)）。
- **测试与工具链**：vitest（含 `test/vitest/` 多工程配置与 live/进程级测试）、`scripts/run-lint.mts`；大量 `*-cold-imports.test.ts`、`plugin-activation-boundary.test.ts` 用测试守护启动性能与插件激活边界（[08-performance.md](./08-performance.md)）。
- **部署面**：Dockerfile / docker-compose / fly.toml / Nix / 三平台包管理器；`appcast*.xml` 服务原生应用的自更新。

## 6. 目录速览与阅读路径

```
sources/openclaw/
├── openclaw.mjs         入口守门人（runtime 门 + respawn）
├── src/                 Gateway/CLI 主体（124 个子系统目录）
├── packages/            24 个 @openclaw/* workspace 包
├── extensions/          174 个内建插件（provider/通道/能力）
├── crates/              Rust 节点宿主与 Rust 客户端
├── apps/  ui/           原生伴侣应用、Control UI
├── docs/                docs.openclaw.ai 全量文档源
└── skills/  custodian-skills/  config/  deploy/  examples/  qa/
```

建议阅读顺序：根 README → `docs/concepts/architecture.md` → 本集 [01-architecture.md](./01-architecture.md) → 启动与循环（[02-startup-flow.md](./02-startup-flow.md)、[03-agent-loop.md](./03-agent-loop.md)）→ 状态与恢复（[04-state-session-memory.md](./04-state-session-memory.md)、[10-session-resume.md](./10-session-resume.md)）→ 通道桥接（[21-bridge-system.md](./21-bridge-system.md)）→ 扩展面（[06-extension-mcp.md](./06-extension-mcp.md)、[14-plugin-system.md](./14-plugin-system.md)、[13-skill-system.md](./13-skill-system.md)）→ 排障（[25-debugging.md](./25-debugging.md)）。

## 源码锚点

- [`sources/openclaw/README.md`](../../sources/openclaw/README.md)：定位声明、安装、Gateway/通道/安全总览
- [`sources/openclaw/package.json`](../../sources/openclaw/package.json)：version、schemaVersions、engines、pnpm workspace 声明
- [`sources/openclaw/VISION.md`](../../sources/openclaw/VISION.md)：配置兼容性纪律与项目优先级
- [`sources/openclaw/docs/concepts/architecture.md`](../../sources/openclaw/docs/concepts/architecture.md)：官方架构描述（One Gateway per host）
- [`sources/openclaw/openclaw.mjs`](../../sources/openclaw/openclaw.mjs)：入口守门人
- [`sources/openclaw/CONTRIBUTING.md`](../../sources/openclaw/CONTRIBUTING.md)：贡献门禁与工程约束

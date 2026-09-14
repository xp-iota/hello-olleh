---
title: "项目初始化报告：仓库总览与阅读入口"
---
# 项目初始化报告：仓库总览与阅读入口

> 基于 `sources/opencode/` 中的 OpenCode `v2.0.2` 源码校对。本文是首次进入仓库时的总览报告。

**目录**

- [1. 仓库元信息](#1-仓库元信息)
- [2. 顶层目录地图](#2-顶层目录地图)
- [3. 开发入口脚本](#3-开发入口脚本)
- [4. 权威文档位置](#4-权威文档位置)
- [5. 推荐阅读路径](#5-推荐阅读路径)

---

## 1. 仓库元信息

| 项 | 值 |
| --- | --- |
| 包名 / 版本 | `opencode` / `2.0.2`（private monorepo 根） |
| 包管理 | `bun@1.4.2`，`bunfig.toml` + turbo（`turbo.json`） |
| 运行时 | Bun（CLI shebang 为 `#!/usr/bin/env bun`），内核 Effect-ts |
| 基础设施 | SST（`sst.config.ts`）、Nix（`flake.nix`）、Bazel 不涉及 |
| 多语言 | 30+ 语言 README（`README.<locale>.md`） |

## 2. 顶层目录地图

| 目录 | 内容 |
| --- | --- |
| `packages/` | 30+ 子包：schema、protocol、core、server、plugin、client、sdk、cli、tui、app、desktop、web、ai、codemode、session-ui、effect-drizzle-sqlite、httpapi-codegen、http-recorder、simulation、stats、console、enterprise、containers、storybook、theme、ui、util 等 |
| `specs/v2/` | v2 跨包语义契约与决策记录（本目录分析的上游权威来源） |
| `services/` | 部署形态（www 等） |
| `sdks/` | 分发型 SDK |
| `infra/`、`script/`、`patches/`、`perf/`、`artifacts/`、`github/` | 基础设施、脚本、依赖补丁、性能基准与产物 |

## 3. 开发入口脚本

根 `package.json` 的关键脚本：

| 脚本 | 作用 |
| --- | --- |
| `dev` | `bun run --cwd packages/cli src/index.ts`——直接以源码跑 CLI |
| `dev:vite` / `dev:live` | 浏览器条件入口与 live 通道 |
| `dev:desktop` / `dev:web` / `dev:console` / `dev:stats` / `dev:www` | 各宿主的开发入口 |
| `dev:storybook` | 组件库开发 |
| `bench:devex` | 开发体验基准 |

## 4. 权威文档位置

| 文档 | 权威内容 |
| --- | --- |
| `specs/v2/session.md` | Session 语义契约（准入、执行、指令、compaction、恢复） |
| `specs/v2/tools.md` | 工具语义契约与法则 |
| `specs/v2/event-stream-architecture.md` | 事件流架构决策（已定案） |
| `specs/v2/provider-policy.md` | provider 授权决策（已实现） |
| `specs/v2/catalog-config-plugin-lifecycle.md` | catalog/配置/插件生命周期（历史背景） |
| 根 `AGENTS.md` | 贡献者级回归护栏 |

## 5. 推荐阅读路径

先读 [01-architecture.md](./01-architecture.md) 建立多包分层，再沿 [02-startup-flow.md](./02-startup-flow.md) -> [03-agent-loop.md](./03-agent-loop.md) -> [04-state-session-memory.md](./04-state-session-memory.md) 走通主链路；扩展面从 [06-extension-mcp.md](./06-extension-mcp.md) 分发到 [13](./13-skill-system.md)/[14](./14-plugin-system.md)/[24](./24-mcp-system.md)。完整索引见 [README.md](./README.md)。

## 源码锚点

- [`sources/opencode/package.json`](../../sources/opencode/package.json)：版本与脚本
- [`sources/opencode/packages/`](../../sources/opencode/packages)：多包树
- [`sources/opencode/specs/v2/`](../../sources/opencode/specs/v2)：语义契约

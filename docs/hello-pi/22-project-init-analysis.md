---
title: "项目初始化报告（总览）：minimal extensible harness"
---
# 项目初始化报告（总览）：minimal extensible harness

> 基于 `sources/pi/` 快照通读（pi `v1.1.0`）。这是本分析集的"首次进入仓库"导读章；各主题细节见后续章节，本页只回答"这个项目是什么、长什么样、从哪读起"。

**目录**

- [1. 仓库定位](#1-仓库定位)
- [2. 上游信息](#2-上游信息)
- [3. 14 个 workspace 包](#3-14-个-workspace-包)
- [4. 分层结构](#4-分层结构)
- [5. 技术栈与工程约束](#5-技术栈与工程约束)
- [6. 目录速览与阅读路径](#6-目录速览与阅读路径)

---

## 1. 仓库定位

根 README 第一句：**"Pi is a minimal, extensible agent harness that you can make your own."** pi 是一个刻意保持内核最小的编码 agent harness：默认工具面只有 `read / bash / edit / write`（加只读的 `grep / find / ls`、Windows 的 `powershell`），刻意不做 sub-agent 与 plan mode（"Ask Pi to build what you want"），一切增值能力——扩展、skills、prompt templates、themes——以资源形式从用户/项目目录装载，可打包成 npm/git 分发的 Pi packages。定制方向是"让 pi 适配你的工作流，而不是反过来"。

## 2. 上游信息

| 项 | 值 |
| --- | --- |
| 仓库 | [earendil-works/pi](https://github.com/earendil-works/pi)（GitHub） |
| 版本 | v1.1.0（snapshot 内 14 个包 `package.json` 均为 `1.1.0`） |
| commit | `abe508e`（2026-10-07 发布 tag v1.1.0） |
| 作者 | Mario Zechner（badlogic），Earendil Works |
| 站点 / 安装 | [pi.dev](https://pi.dev)（`curl -fsSL https://pi.dev/install.sh \| sh`） |
| 许可 | MIT |
| 语言 | TypeScript（Node >= 22.19），测试 vitest，lint biome |

## 3. 14 个 workspace 包

npm workspaces 全在 `packages/`（"src 行数"为源码 `.ts` 实测值，含 `*.lazy.ts`）：

| 包 | npm 名 | 一句话职责 | src 行数 |
| --- | --- | --- | --- |
| chord | `@earendil-works/chord` | 应用组合运行时：services、复制状态（delta）、RPC、插件 | ≈8.8k |
| telemetry | `@earendil-works/pi-telemetry` | 厂商中立的 telemetry 契约与类型化 schema | ≈0.9k |
| tui | `@earendil-works/pi-tui` | 差分渲染终端 UI 库（含各 OS 剪贴板原生模块） | ≈19.4k |
| mcp | `@earendil-works/pi-mcp` | 独立 MCP 客户端（无官方 SDK 依赖，含 OAuth 与测试入口） | ≈3.2k |
| codemode | `@earendil-works/pi-codemode` | QuickJS/WASM 沙箱：唯一能力是调用注入的工具 | ≈1.8k |
| ai | `@earendil-works/pi-ai` | 统一 LLM API：模型发现 + 多 provider（Anthropic/OpenAI/Gemini/Bedrock 等），带 `pi-ai` CLI | ≈26.8k |
| durable | `@earendil-works/pi-durable` | 持久会话/任务/文档运行时（memory/JSONL/SQLite，实验） | ≈20.4k |
| agent | `@earendil-works/pi-agent-core` | 通用 agent loop：transport 抽象、状态、attachment | ≈2.5k |
| env | `@earendil-works/pi-env` | Durable 的远程执行环境：SSH 部署的 daemon + ExecutionEnv 客户端 | ≈2.1k |
| protocol | `@earendil-works/pi-protocol` | 传输中立的 CBOR 线协议（实验） | ≈0.9k |
| client | `@earendil-works/pi-client` | CBOR 帧上的远程会话客户端（含 `./unix` transport） | ≈1.1k |
| server | `@earendil-works/pi-server` | 实验性远程会话服务端（含 `./unix`、`./testing`） | ≈2.0k |
| coding-agent | `@earendil-works/pi-coding-agent` | `pi` CLI 本体：编码 agent、会话管理、四种交互模式 | ≈85.9k |
| evals | `@earendil-works/pi-evals`（private） | 评测 harness：vitest-evals 承载 + docs eval CLI | ≈1.4k |

## 4. 分层结构

自底向上（workspace 内交叉依赖，包间用 `^1.1.0`，外部依赖一律精确锁定）：

| 层 | 包 |
| --- | --- |
| 0（无 pi 依赖） | chord、telemetry、tui、mcp、codemode |
| 1 | ai（仅依赖 telemetry） |
| 2 | durable（chord+ai）、agent（ai）、protocol（chord） |
| 3 | env（chord+durable）、client、server（chord+protocol） |
| 4（顶层消费者） | coding-agent（chord/agent/ai/codemode/mcp/tui；devDeps 另含 client/protocol/server 供实验架构） |
| 5 | evals（devDeps：ai + coding-agent） |

根 `build` 脚本按拓扑序逐包构建；`coding-agent` 的 `build:binary` 先重建运行时依赖再用 `bun build --compile` 产出独立 `dist/pi` 二进制。

## 5. 技术栈与工程约束

- **TypeScript erasable syntax only**：`packages/*/src` 禁用 `enum` / `namespace` / 参数属性 / `import =`，源码直接以 `node --experimental-strip-types` 运行；相对导入必须写 `.ts` 后缀（`scripts/check-ts-relative-imports.mjs`）。
- **Node >= 22.19**（`engines`，README 与各 `package.json` 一致）；发布另有 Bun 编译二进制与 Nix（`nix run github:earendil-works/pi/stable`）。
- **测试 vitest 4.1.11**（`test.sh` 在隔离 HOME、清空环境、`PI_NO_LOCAL_LLM=1` 下跑 `npm test`，无 API key 时 LLM 测试跳过）；**lint 用 biome**，外加 `npm run check` 的结构检查：依赖精确锁定（`check-pinned-deps`）、无幻影依赖（`check-runtime-deps`）、entry-graph 文件数预算、`tsc --noEmit`。
- **供应链硬化**：`.npmrc` `save-exact=true` + `min-release-age=2`（避开当天发布的依赖）；`install-lock/` 为 pi.dev 安装器生成全量锁定；`overrides` 钉死 `protobufjs`。
- **禁内联动态导入**：懒加载一律用显式 `.lazy.ts` 文件；coding-agent 资产解析必须走 `src/config.ts` 的 helper（源码 checkout / npm 安装 / 独立二进制三种形态可运行）。

## 6. 目录速览与阅读路径

```
sources/pi/
├── packages/           14 个 workspace 包（见 §3）
├── scripts/            构建/发布/结构检查脚本（release.mjs、check-*.mjs、generate-models.ts…）
├── nix/                Nix 打包（flake）
├── pi-test.sh/.bat/.ps1 从源码运行 pi 的包装脚本
├── test.sh             隔离环境全量测试
└── README.md / AGENTS.md / CONTRIBUTING.md / SECURITY.md
```

建议阅读顺序：根 README → `packages/coding-agent/docs/how-pi-works.md` → agent loop（[19-hooks-lifecycle.md](./19-hooks-lifecycle.md) 的内核回调与 [23-input-command-queue.md](./23-input-command-queue.md) 的队列）→ 交互层（[20-repl-and-state.md](./20-repl-and-state.md)）→ 外部集成（[21-bridge-system.md](./21-bridge-system.md)、[24-mcp-system.md](./24-mcp-system.md)）→ 排障（[25-debugging.md](./25-debugging.md)）。

## 源码锚点

- [`sources/pi/README.md`](../../sources/pi/README.md)：定位声明、安装、上游链接
- [`sources/pi/AGENTS.md`](../../sources/pi/AGENTS.md)：工程约束（erasable TS、资产解析、禁硬编码键位）
- [`sources/pi/CONTRIBUTING.md`](../../sources/pi/CONTRIBUTING.md)：贡献门禁与 check/test 命令
- [`sources/pi/packages/coding-agent/src/config.ts`](../../sources/pi/packages/coding-agent/src/config.ts)：安装检测与 `~/.pi/agent` 路径布局
- [`sources/pi/packages/coding-agent/docs/how-pi-works.md`](../../sources/pi/packages/coding-agent/docs/how-pi-works.md)：上游架构总览文档
- [`sources/pi/test.sh`](../../sources/pi/test.sh)：隔离测试入口

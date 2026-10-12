---
title: "宿主桥接：app-server 协议与多宿主复用"
---
# 宿主桥接：app-server 协议与多宿主复用

本文分析 Codex 如何通过 `app-server-protocol` 将 Rust runtime 暴露给多种宿主（CLI、SDK、Web 服务），实现跨平台复用。

**目录**

- [1. 多宿主架构](#1-多宿主架构)
- [2. app-server-protocol 核心消息](#2-app-server-protocol-核心消息)
- [3. 三种宿主的接入方式](#3-三种宿主的接入方式)
- [4. 与 Claude Code Bridge 的对比](#4-与-claude-code-bridge-的对比)

---

## 1. 多宿主架构

![多宿主架构](diagrams/21-bridge-system-diagram.svg)

**多宿主架构** — [交互版](diagrams/21-bridge-system-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/21-bridge-system-diagram.architecture.json)

- **组成**：5 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：宿主层（Host） · 末节点：ThreadManager + Agent Loop

所有宿主通过统一的 `app-server-protocol` 与 Rust 核心交互，核心逻辑不重复实现。

## 2. app-server-protocol 核心消息

协议消息定义在 `codex-rs/app-server-protocol` crate，基于 JSON-RPC：宿主向 core 发送方法级请求（如 `turn/start`、`thread/resume`、`thread/fork`、`interrupt`），core 通过请求响应与 server notification（线程事件、hook 通知等）回传。v2 协议类型按主题拆分在 `app-server-protocol/src/protocol/v2/` 目录（`turn`、`thread`、`mcp`、`fs`、`hook` 等约 45 个模块），每个方法有独立的 request/response 类型定义；事件映射在 `protocol/event_mapping.rs` 完成。

## 3. 三种宿主的接入方式

### 3.1 CLI/TUI 宿主（内嵌 app-server）

TUI 不直接调用 core，而是通过 `app-server` 的 in-process client 接入同一套 RPC 会话协议：

```rust
// codex-rs/app-server/src/in_process.rs:377
pub async fn start(mut args: InProcessStartArgs) -> IoResult<InProcessClientHandle>
```

TUI 的 `run_main()` 启动时组装配置并拉起（本地或 daemon 模式的）app-server，之后所有线程操作都走协议请求。

### 3.2 TypeScript SDK 宿主（子进程 + JSON-RPC）

```typescript
// sdk/typescript/src/exec.ts:203
const child = spawn(this.executablePath, commandArgs, { env, signal: args.signal });
```

TypeScript SDK 以子进程方式启动 codex 二进制，通过 stdin/stdout 上的 app-server JSON-RPC 协议提交 turn、订阅线程事件，是协议消费者而不是第二套 runtime。

### 3.3 远程宿主（stdio / Unix socket / WebSocket）

`app-server` 二进制（`codex-rs/app-server/src/main.rs`）可以把同一套协议暴露到进程外，transport 覆盖 stdio、Unix socket 与 WebSocket（见 `codex-rs/app-server/src/app_server_tracing.rs:85` 的 `transport_name()`）。请求进入后由 `MessageProcessor` 与 `request_processors/` 分发，宿主侧无需感知传输差异。

## 4. 与 Claude Code Bridge 的对比

| 特性 | Codex app-server | Claude Code Bridge |
| :------| :-----------------| :-------------------|
| **协议** | app-server-protocol（JSON-RPC）| IPC + JSON |
| **传输** | in-process / stdio / Unix socket / WebSocket | Unix socket / named pipe |
| **主要用途** | CLI、SDK、Web 多宿主 | IDE 插件（VS Code 等）|
| **双向通信** | ✅ | ✅ |
| **类型安全** | Rust 类型 + schema 导出 | TypeScript interface |

---

## Bridge 应归入 app-server/protocol 复用

Codex 的 bridge 能力不应按“远程 UI 功能”单独理解，而应归入 app-server 和 JSON event protocol：外部宿主通过协议复用 Rust core，而不是复制 agent loop。

| 对齐主题 | Codex 侧含义 |
| --- | --- |
| Bridge | 外部宿主连接 runtime 的协议面 |
| SDK | 协议消费者，不是第二套 runtime |
| Session | bridge 操作的持久对象 |
| Thread event | UI/SDK 共同消费的状态投影 |

横向看，Claude Code 的 bridge 更像 REPL/远程会话能力，OpenCode 的 bridge 更像 server contract，Gemini 的 bridge 更偏 IDE/headless 集成；Codex 的核心则是 Rust session protocol 的复用。

## Bridge：app-server 是统一宿主边界

Codex 的 bridge 不应理解为“额外的远程功能”，而应理解为 runtime 对外的宿主协议层。TUI 默认也会经过 app-server 抽象，因此 bridge 章节要和 `15-sdk-transport.md`、`20-repl-and-state.md` 联读。

| 入口 | 源码锚点 | 作用 |
| --- | --- | --- |
| turn/start | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:175` | 外部宿主提交用户 turn 的主入口 |
| core op 桥接 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:492` | 将 app-server request 转成 core `Op` |
| fork thread | `sources/codex/codex-rs/app-server/src/request_processors/thread_processor.rs:581` | 支持从既有 thread 派生新 thread |
| thread spawn 元数据 | `sources/codex/codex-rs/app-server/src/request_processors/thread_processor.rs:2708` | 用 source metadata 标记 spawned agent 来源 |
| hook notification | `sources/codex/codex-rs/app-server/src/bespoke_event_handling.rs:1144` | runtime hook 事件转换成宿主可见通知 |

### 协议边界

app-server 的职责是协议翻译和状态投影，不是复制一套 agent loop。模型调用、工具审批、sandbox、thread history 仍在 core runtime。这个边界让 Codex 可以支持 TUI、remote websocket、HTTP/app-server consumer 和多代理 thread，同时保持工具治理一致。

### 风险点

| 风险 | 验证点 |
| --- | --- |
| 权限绕过 | remote/app-server 入口提交的 exec/apply_patch 是否仍走 core approval/sandbox |
| 状态错配 | request id、turn id、thread id 在事件回传中是否稳定关联 |
| 派生线程污染 | fork/spawn 是否正确记录 source metadata，并限制 base instructions 与 runtime overrides 的继承范围 |

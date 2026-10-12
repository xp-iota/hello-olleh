---
title: "SDK 与传输：createAgentSession、print/JSON、RPC 与远程栈"
---
# SDK 与传输：createAgentSession、print/JSON、RPC 与远程栈

> 基于 `sources/pi/` 快照（pi v1.1.0）：`src/core/sdk.ts`、`src/modes/`、`src/modes/rpc/`、`packages/protocol|client|server|mcp|tui` 校对。

**目录**

- [1. 三个自动化面](#1-三个自动化面)
- [2. TypeScript SDK](#2-typescript-sdk)
- [3. print 与 JSON 模式](#3-print-与-json-模式)
- [4. RPC 模式](#4-rpc-模式)
- [5. 远程会话栈与可独立复用的库](#5-远程会话栈与可独立复用的库)

---

## 1. 三个自动化面

pi 把"被程序驱动"设计成一条连续光谱，全部共享同一个 `AgentSessionRuntime`（services + session + 资源加载器），只在模式层换皮：

| 面 | 入口 | 适用 |
| --- | --- | --- |
| TypeScript SDK | `import { createAgentSession } from "@earendil-works/pi-coding-agent"` | 进程内嵌 |
| print / JSON 模式 | `pi -p`、管道 stdin/stdout、`--mode json` | 一次性脚本、管道组合 |
| RPC 模式 | `pi --mode rpc`（或 `pi-rpc` bin） | 长驻子进程双向驱动 |

模式选择在 `src/main.ts` 的 `resolveAppMode()`（:112）：`rpc` / `json` 显式指定，`print` 在 `--print/-p` **或 stdin/stdout 不是 TTY** 时自动生效——管道里调用 pi 无需任何标志。

## 2. TypeScript SDK

公开面是包根的 `src/index.ts`：re-export `parseArgs`、`AgentSession`、`DefaultPackageManager`、`DefaultResourceLoader`、config 路径工具、事件总线等，`docs/sdk.md` 是其使用文档。构造入口是 `src/core/sdk.ts` 的 `createAgentSession()`：解析 cwd/agentDir → `ModelRuntime.create()`（auth.json + models.json）→ `SettingsManager` → `SessionManager` → 资源加载与 `reload()`，再组装工具允许/排除列表、provider retry/timeout/headers 请求项、扩展 payload/stream-event 钩子，最后 `new AgentSession(...)`。返回的是自足的 session 句柄，调用方订阅 `AgentSessionEvent`、`prompt()` / `steer()` / `followUp()` / `abort()` 即可，不需要理解 TUI。

## 3. print 与 JSON 模式

`src/modes/print-mode.ts` 的 `runPrintMode()` 是单发执行：`"text"` 只打最终回复，`"json"` 改为逐条输出会话事件。两个关键保护：

- **stdout 协议保护**：非交互模式一律先 `takeOverStdout()`（`src/core/output-guard.ts`），把 `console.log` 等重定向走，保证 stdout 上只有协议输出，扩展的杂散打印不会污染管道；
- **事件瘦身**：`src/modes/json-event.ts` 的 `toJsonEvent()` 把事件收敛为 `JsonAgentSessionEvent`——`message_update` 的累积增量被剥离，只保留带 usage/tool id 的稳定事件，便于外部程序按行消费重构。帧语义见 `docs/json.md`。

## 4. RPC 模式

`src/modes/rpc/rpc-mode.ts` 接管 stdin/stdout，用自写的 LF-only JSONL reader（`rpc/jsonl.ts`，刻意不用 Node readline 以保证严格 JSONL 帧）读取命令帧、按序执行、回写响应帧。命令联合类型在 `src/modes/rpc/rpc-types.ts`（:20-74），30 余条：`prompt`、`steer`、`follow_up`、`abort`、`clear_queue`、`new_session`、`get_state`、`set_model` / `cycle_model` / `get_available_models`、`set_thinking_level`、`compact`、`set_auto_compaction`、`set_auto_retry` / `abort_retry`、`bash` / `abort_bash`、`get_session_stats`、`export_html`、`switch_session`、`fork` / `clone`、`get_entries` / `get_tree` / `get_messages`、`get_commands` 等。请求可带 `id`，响应用同一 `id` 关联（异步事件与响应都如此），客户端无需假设应答顺序。

扩展 UI 也有对应子协议：扩展的 `select`/`confirm`/`input` 等交互调用被编码为 RPC 的 request/response 子协议（pending-promises map），宿主程序代为弹 UI 并回传结果，契约见 `docs/rpc-extension-ui.md`。另有 `src/rpc-entry.ts` 作为独立 `pi-rpc` bin 入口（设 `process.title`、强制 `--mode rpc`），`docs/rpc.md` 与 `rpc-commands.md` 是完整规范。

## 5. 远程会话栈与可独立复用的库

RPC 之外还有一条 experimental 的**跨进程远程栈**（coding-agent 以 devDependencies 引入）：

- **`@earendil-works/pi-protocol`**：传输无关的 CBOR 线协议——每帧为 4 字节大端长度 + 单个定长 CBOR 项；信封拒绝未知属性、非 JSON 载荷（非有限数、byte array、`undefined`、循环）；默认上限 16 MiB/帧、1e6 元素、64 层嵌套（`packages/protocol/README.md`）；
- **`@earendil-works/pi-client` / `pi-server`**：帧式 CBOR 字节流上的远程会话客户端/服务端（均含 `./unix` 传输），由 `src/experimental/` 的 client/server CLI（chord services 化，见 [14-plugin-system.md](./14-plugin-system.md)）驱动。

此外两个包刻意做成**可独立复用**：`@earendil-works/pi-mcp` 是不依赖官方 MCP SDK、也不依赖其他 pi 包的独立 MCP 客户端（stdio / Streamable HTTP / in-memory 传输，OAuth 支持，可把 MCP 工具包装为 `pi-agent-core` 的 `AgentTool`）；`@earendil-works/pi-tui` 是差分渲染终端 UI 库（CSI 2026 同步输出、16ms 渲染节流、Kitty 协议），只把 pi 当作其第一个消费者。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/sdk.ts`](../../sources/pi/packages/coding-agent/src/core/sdk.ts)：`createAgentSession` SDK 构造
- [`sources/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts`](../../sources/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts)：RPC 模式实现
- [`sources/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts`](../../sources/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts)：命令/响应联合类型与 `id` 关联
- [`sources/pi/packages/coding-agent/src/modes/json-event.ts`](../../sources/pi/packages/coding-agent/src/modes/json-event.ts)：`JsonAgentSessionEvent` 事件瘦身
- [`sources/pi/packages/protocol/README.md`](../../sources/pi/packages/protocol/README.md)：CBOR 帧协议规范
- [`sources/pi/packages/coding-agent/docs/sdk.md`](../../sources/pi/packages/coding-agent/docs/sdk.md)：SDK 嵌入文档

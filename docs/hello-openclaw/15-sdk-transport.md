---
title: "SDK 与传输：Gateway WS 协议、客户端包谱系与 ACP 桥"
---
# SDK 与传输：Gateway WS 协议、客户端包谱系与 ACP 桥

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关，所有客户端（Control UI / CLI / TUI / 原生应用）都经由同一条 Gateway 协议接入。

**目录**

- [1. Gateway WebSocket 协议](#1-gateway-websocket-协议)
- [2. 客户端包谱系](#2-客户端包谱系)
- [3. plugin SDK](#3-plugin-sdk)
- [4. ACP 桥与原生应用](#4-acp-桥与原生应用)
- [5. Rust 客户端与 node host](#5-rust-客户端与-node-host)

---

## 1. Gateway WebSocket 协议

Gateway WS 协议是 OpenClaw 唯一的控制面与 node 传输（`docs/gateway/protocol/transport.md`）：客户端在握手时声明 **role 与 scope**，此后全部 API（status、channels、chat、sessions、nodes、approvals…）都跑在这条连接上。传输契约的关键数字：

- WebSocket 文本帧、JSON payload；第一帧**必须**是 `connect` 请求；帧形固定为 `req`（`{type:"req", id, method, params, traceparent?}`）/ `res`（`{type:"res", id, ok, payload|error}`）/ `event`（`{type:"event", event, payload, seq?, stateVersion?}`）；
- 认证前每 IP 限 128 个未认证连接，pre-auth 帧上限 64 KiB（`MAX_PREAUTH_PAYLOAD_BYTES`），握手后跟随 `hello-ok.policy.maxPayload`；
- **明确拒绝 `permessage-deflate`**——浏览器端解压会拖慢请求突发，宁可用带宽换响应性；
- wire 版本常量在 `packages/gateway-protocol/src/version.ts`：`PROTOCOL_VERSION = 4`、`MIN_CLIENT_PROTOCOL_VERSION = 4`、`MIN_NODE_PROTOCOL_VERSION = 3`（node 走 N-1 窗口）。

Agent 工具在 Gateway dispatch 内直接走 router、不开第二条 WS，保留 method scope、审批权威与取消语义——协议既是传输也是权限边界（见 [07-error-security.md](./07-error-security.md)）。

## 2. 客户端包谱系

三层递进的 npm 包（`docs/gateway/clients.md`，安装要求 `--save-exact` pin）：

| 包 | 角色 | 要点 |
| --- | --- | --- |
| `@openclaw/gateway-protocol` | 契约 | TypeBox schema、运行时校验器、结构化 error reader、版本常量；tarball 附 `protocol.schema.json` |
| `@openclaw/gateway-client` | 参考连接实现 | Node 入口含 `ws` transport；`/browser` 入口浏览器安全，device identity / 签名 / token 存储交给 host 回调（`GatewayClientHostDeps`）；自带 reconnect policy、watchdog、TLS 校验 |
| `@openclaw/sdk` | 应用 SDK | `OpenClaw` / `Run` / `Session` / `Agents` / `Approvals` 等命名空间门面（`packages/sdk/src/index.ts`） |

`@openclaw/sdk` 的传输适配层（`packages/sdk/src/transport.ts`）把底层 `GatewayClient` 折成 `OpenClawTransport`：断线重连作为可观察事件（`observeGatewayReconnects` + epoch 判定），晚订阅者可重放最近 **1 000** 条原始事件（`RAW_EVENT_REPLAY_LIMIT`），`agent` / `chat.send` / `sessions.send` 被识别为 run 提交方法走恢复请求路径。

## 3. plugin SDK

扩展面是私有包 `@openclaw/plugin-sdk`（`packages/plugin-sdk/package.json`），以**子路径导出**的形式把 `src/plugin-sdk/` 下 400 余个运行时模块按能力切片（`./channel-runtime`、`./agent-runtime`、`./approval-runtime`、`./exec-approvals-runtime`、`./gateway-method-runtime`…），types 指向 `dist` 构建产物、default 直接指向源码——插件作者按需 import 单个能力面。插件形态覆盖 channel、provider、CLI backend、tool、feature 五类，经 ClawHub 分发（`openclaw plugins install clawhub:<name>`，`docs/plugins/building-plugins.md`）；宿主在加载时把 `openclaw` / `@openclaw/plugin-sdk` 两个依赖名识别为宿主别名（`src/plugins/plugin-native-namespace.ts`），不允许插件自带一份宿主。

## 4. ACP 桥与原生应用

`openclaw acp`（`src/cli/acp-cli.ts` → `src/acp/server.ts`）把 Gateway 桥接成 **Agent Client Protocol** 服务端：基于 `@agentclientprotocol/sdk` 的 ndjson 流，把 ACP 的 session/prompt 事件翻译成 Gateway 会话操作（`src/acp/translator.*.ts` 一族，含 `AcpGatewayAgent`、事件 ledger、permission relay），让任何 ACP 客户端（如 Zed 等编辑器）驱动 Gateway 背后的 agent。值得注意的设计：

- 桥自带 **event ledger**（`event-ledger.ts`，SQLite）与 `--provenance off|meta|meta+receipt` 档位，可把 Gateway 侧的执行来源作为 provenance 回传给 ACP 客户端；
- 启动期 stdin 缓冲上限 1 MiB，日志强制改道 stderr，不污染 ndjson 协议流。

原生应用（`apps/` 下的 macOS / iOS / Android / Linux）不是特权通道：全部作为普通 WS 客户端经 `@openclaw/gateway-client` 接入，设备配对与 `oc-pair://` setup code 一样走 pairing 审批。

## 5. Rust 客户端与 node host

Rust 侧有 `crates/openclaw-gateway-client`：可复用的传输与连接策略库——rustls TLS 栈、**证书 fingerprint pin**（`TLS_PIN_MISMATCH_ERROR`）、设备 token 失效判定（`AUTH_DEVICE_TOKEN_MISMATCH_DETAIL_CODE`）、常量时间比较（`subtle::ConstantTimeEq`）、从 Gateway error `details` 解析的有界恢复元数据（retryable / pause_reconnect / remediation hint）。它与 `crates/openclaw-node-host` 一起服务 Rust 实现的 node host。

Node 侧 node host 由 `node-host-launcher.mjs` 监督：supervisor 在 import config/SQLite 之前先选定运行时，管理 `releases/` 目录下的受管版本（realpath 校验版本未在激活前被替换），child 就绪超时 5 分钟，**每 12 小时定期重启**（`RESTART_INTERVAL_MS`）保持长期驻留的 node 进程干净。审计账本与 pairing 状态都落在 Gateway 的共享 SQLite 状态库，与其余可观测面共享（[09-observability.md](./09-observability.md)）。

## 源码锚点

- [`sources/openclaw/packages/gateway-protocol/src/version.ts`](../../sources/openclaw/packages/gateway-protocol/src/version.ts)：wire 版本常量
- [`sources/openclaw/docs/gateway/protocol/transport.md`](../../sources/openclaw/docs/gateway/protocol/transport.md)：帧形、限额与压缩取舍
- [`sources/openclaw/packages/sdk/src/transport.ts`](../../sources/openclaw/packages/sdk/src/transport.ts)：SDK 传输适配、重连与事件重放
- [`sources/openclaw/packages/plugin-sdk/package.json`](../../sources/openclaw/packages/plugin-sdk/package.json)：plugin SDK 子路径导出面
- [`sources/openclaw/src/acp/server.ts`](../../sources/openclaw/src/acp/server.ts)：ACP 桥服务端
- [`sources/openclaw/crates/openclaw-gateway-client/src/lib.rs`](../../sources/openclaw/crates/openclaw-gateway-client/src/lib.rs)：Rust 传输、TLS pin 与恢复元数据
- [`sources/openclaw/node-host-launcher.mjs`](../../sources/openclaw/node-host-launcher.mjs)：node host 监督进程

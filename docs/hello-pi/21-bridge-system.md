---
title: "Bridge / 外部集成：RPC、CBOR 栈与 pi.dev 生态"
---
# Bridge / 外部集成：RPC、CBOR 栈与 pi.dev 生态

> 基于 `sources/pi/README.md`、`packages/protocol|client|server/`、`packages/coding-agent/src/modes/rpc/` 与 `src/extensions/codemode/` 校对（pi `v1.1.0`）。

**目录**

- [1. 外部集成版图](#1-外部集成版图)
- [2. RPC 模式：pi 的外部驱动面](#2-rpc-模式pi-的外部驱动面)
- [3. CBOR 栈：pi-protocol / pi-client / pi-server](#3-cbor-栈pi-protocol--pi-client--pi-server)
- [4. codemode 的非 LLM 调用](#4-codemode-的非-llm-调用)
- [5. 会话发布：/share](#5-会话发布share)
- [6. pi.dev：安装器与模型目录服务](#6-pidev安装器与模型目录服务)

---

## 1. 外部集成版图

pi 把"外部世界怎么接入"拆成多个层次，均不进内核：

| 通道 | 形态 | 位置 |
| --- | --- | --- |
| 外部驱动（进程内） | `--mode rpc` JSONL 命令协议 | `src/modes/rpc/` |
| 远程会话（实验） | CBOR 帧协议 + client/server + session worker | `packages/protocol|client|server`、`src/experimental/` |
| 打印/管道 | `--mode json` 事件流、`pi -p` | `src/modes/print-mode.ts`、`json-event.ts` |
| 非 LLM 模型 | codemode 沙箱调 classifier/image 模型 | `src/extensions/codemode/` |
| 会话发布 | `/share` → Radius artifacts / GitHub gist | `session-share.ts` |
| 上游生态 | OpenClaw（实例集成）、pi-chat（Slack/聊天自动化） | README 指向外链 |

根 README 明确以 [OpenClaw](https://github.com/OpenClaw/OpenClaw) 为 real-world integration 实例；Slack/聊天自动化在上游单独仓库 [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat)（README `:86`），不在本 monorepo。

## 2. RPC 模式：pi 的外部驱动面

`runRpcMode()`（`rpc-mode.ts:42`，819 行）接管 stdout，用 LF-only JSONL 读取器（`rpc/jsonl.ts`，刻意不用 Node readline 以保证严格成帧）分发 `RpcCommand`。命令 union 在 `rpc-types.ts:20-74`：`prompt`、`steer`、`follow_up`、`clear_queue`、`new_session`、`get_state`、`set_model`、`get_tree`、`export_html` 等约 40 个，经可选 `id` 关联响应。扩展 UI 请求在 RPC 模式下降级为请求/响应子协议（`rpc-extension-ui.md`）。独立入口 `src/rpc-entry.ts`（`pi-rpc` bin）设 `process.title`、配置 HTTP dispatcher 并强制 `--mode rpc`——供宿主 App 以子进程方式嵌入（见 [25-debugging.md](./25-debugging.md) §6）。

## 3. CBOR 栈：pi-protocol / pi-client / pi-server

远程会话走一条自研的传输中立栈（均标注 experimental，无兼容保证）：

- **pi-protocol**：路由信封 + CBOR 编码 + 字节流成帧。每帧 = 4 字节大端长度前缀 + 一个定长 CBOR 项；默认单帧 16 MiB、100 万数组/映射元素、64 层嵌套；信封拒绝未知属性与非 JSON 载荷（`packages/protocol/README.md`）。
- **pi-client / pi-server**：帧化 CBOR 之上的 client/server，含 `./unix` 域套接字 transport（`packages/client/src/unix.ts`）与 `./testing` 入口。
- **coding-agent 消费侧**（devDeps）：`src/experimental/` 的 client/server/coordinator、`session-worker.ts` / `session-worker-manager.ts`（每会话一个 worker 进程）与 `services/` 的服务化重构。主交互路径不使用这套栈。

## 4. codemode 的非 LLM 调用

codemode 扩展（`src/extensions/codemode/`）让模型写 JS 脚本，在 QuickJS/WASM 沙箱里以 `tools.*` 调 pi 工具、以 `models.*` 跑**非 LLM 模型**：classifier 回答关于 JSON 状态的类型化问题（部分可判图）、image 模型生图，凭会话凭据调用（`docs/codemode.md:62`）；chat 模型可列出但脚本内不可运行。脚本无 Node API / 文件系统 / 网络，只有脚本输出回到模型，因此外部调用天然是"桥"：大结果可先在沙箱内过滤再上模型。

## 5. 会话发布：/share

`session-share.ts` 的 `shareSession()`（`:57`）先导出会话 JSONL + HTML，然后两级发布：优先上传 Radius `/v1/artifacts`（需 radius 凭据，`tryShareViaRadius()`），否则退回 GitHub **私有 gist**（`gh gist create --public=false`，需 `gh` 已登录）；发布后在终端给出 `https://pi.dev/session/<gistId>` 预览链接（`config.ts:592` 的 `DEFAULT_SHARE_VIEWER_URL`）。会话尾部附带 `pi.share` 自定义 entry（system prompt + 工具 schema），供在线 viewer 还原。

## 6. pi.dev：安装器与模型目录服务

pi.dev 不只是官网，还是运行时依赖的云端服务：

| 服务 | 用途 | 代码锚点 |
| --- | --- | --- |
| `install.sh` / `install.ps1` | 官方安装器，锁定全部依赖，`pi update` 自更新 | 根 README |
| 模型目录 overlay | 4 小时新鲜度、ETag 协商地 GET `https://pi.dev/api/models/providers/<id>`，动态合并进内置基线目录 | `core/remote-catalog-provider.ts:13`（`DEFAULT_CATALOG_BASE_URL`） |
| OAuth client-id 元数据 | MCP OAuth 动态客户端注册指向 `https://pi.dev/oauth` | `src/extensions/mcp/oauth.ts:42` |
| 会话 viewer | gist 发布会话的在线渲染 | `config.ts:592` |
| 版本检查 | 新版本通知，`PI_SKIP_VERSION_CHECK` 关闭 | `interactive-mode.ts` run() |

## 源码锚点

- [`sources/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts`](../../sources/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts)：RPC 模式服务器
- [`sources/pi/packages/protocol/README.md`](../../sources/pi/packages/protocol/README.md)：CBOR 成帧与限制说明
- [`sources/pi/packages/coding-agent/src/experimental/session-worker.ts`](../../sources/pi/packages/coding-agent/src/experimental/session-worker.ts)：每会话 worker 的实验架构
- [`sources/pi/packages/coding-agent/src/modes/interactive/session-share.ts`](../../sources/pi/packages/coding-agent/src/modes/interactive/session-share.ts)：/share 发布链
- [`sources/pi/packages/coding-agent/src/core/remote-catalog-provider.ts`](../../sources/pi/packages/coding-agent/src/core/remote-catalog-provider.ts)：pi.dev 模型目录 overlay
- [`sources/pi/packages/coding-agent/docs/codemode.md`](../../sources/pi/packages/coding-agent/docs/codemode.md)：codemode 非 LLM 模型调用

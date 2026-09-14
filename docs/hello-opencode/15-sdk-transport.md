---
title: "SDK 与传输：Protocol/Server/Client/SDK 分层"
---
# SDK 与传输：Protocol/Server/Client/SDK 分层

> 基于 `sources/opencode/packages/protocol/`、`packages/server/`、`packages/client/` 与 `packages/sdk/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 传输分层总览](#1-传输分层总览)
- [2. Protocol：类型化操作定义](#2-protocol类型化操作定义)
- [3. Server：绑定与投递](#3-server绑定与投递)
- [4. Client 与 SDK](#4-client-与-sdk)
- [5. 代码生成与仿真](#5-代码生成与仿真)

---

## 1. 传输分层总览

```text
Schema（公共形状/事件载荷）
  -> Protocol（HTTP 操作定义、传输错误、groups/ 按域分组）
    -> Server（HttpApi 组装、handler 绑定、SSE 事件馈送、auth/cors/中间件）
      -> Client（生成的 + 手写的 client 表面、service 发现）
        -> SDK（PromiseSdk / Effect service，对外编程接口）
          -> 宿主（CLI / TUI / Desktop / ACP）
```

关键法则：语义所有权在 Core，传输在 Server，形状在 Schema，操作在 Protocol——**Server 投递策略变化不影响 OpenAPI 与生成 client**。

## 2. Protocol：类型化操作定义

- `packages/protocol/src/api.ts` 定义组装面，`groups/` 按域分组 endpoint（事件组定义 `OpenCodeEvent` 与 `isOpenCodeEvent`），`errors.ts` 承载传输错误，`client.ts` 承载 client 侧契约。
- Protocol 拥有 `OpenCodeEvent` 的 SSE 契约；生成的 Promise 与 Effect client 都以此为准。

## 3. Server：绑定与投递

`packages/server/src/` 的主要文件：

| 文件 | 职责 |
| --- | --- |
| `api.ts` / `routes.ts` / `handlers.ts` + `handlers/` | 把 Protocol 操作绑定到 handler |
| `event-feed.ts` | 公共事件一次编码、逐连接有界投递（`SubscriberCapacity = 4096`，`SubscriberOverflowError` / `EncodingError`） |
| `auth.ts` / `cors.ts` / `middleware/` | 认证与跨域中间件 |
| `request-tracing.ts` | 请求追踪 |
| `server-info.ts` / `service-status.ts` | 进程信息面 |
| `location.ts` | Location 中间件（事件馈送故意不在其内，见 [07-error-security.md](./07-error-security.md) §4） |
| `workerd.ts` / `fetch.ts` | fetch 运行时适配 |

SSE 帧格式是 `data: ${JSON.stringify(event)}\n\n`；编码失败的策略是终止当前订阅者以避免静默空洞，但馈送对后续连接保持可用。

## 4. Client 与 SDK

- `packages/client/src/`：`contract.ts`（契约）、`service.ts` + `service-contender.ts` + `service-timing.ts` + `service-version.ts`（后台 service 的发现/竞争/版本协商）、`shared-events.ts`、`rpc-runtime.ts`、`pty-handoff.ts`，以及 `effect/` 与 `promise/` 双入口。
- `packages/sdk/src/`：对外编程接口 `opencode.ts` 暴露 `create()`（委托 `PromiseSdk.create`），类型出口包括 `CreateOptions` / `InstanceOptions` / `InstanceConfiguration` / `Interface`；`contracts.ts`、`tool.ts`、`logging.ts`、`workerd.ts` 与 `effect/`、`internal/` 支撑。
- SDK 不是另一套 runtime——它装配/连接 Core 能力，复用同一协议面。

## 5. 代码生成与仿真

- `packages/httpapi-codegen`：从组装的公共 `HttpApi` 生成 client 与 OpenAPI 产物；生成物随 Protocol 变化，Server 内部实现变化（如队列实现）不应改变生成 client。
- `packages/http-recorder` / `packages/simulation`：HTTP 录制与仿真，支撑传输层的可重放测试（`protocol/src/simulation.ts` 也提供协议级仿真钩子）。

## 源码锚点

- [`sources/opencode/packages/protocol/src/`](../../sources/opencode/packages/protocol/src)：操作定义与事件组
- [`sources/opencode/packages/server/src/event-feed.ts`](../../sources/opencode/packages/server/src/event-feed.ts)：SSE 馈送
- [`sources/opencode/packages/client/src/service.ts`](../../sources/opencode/packages/client/src/service.ts)：client service
- [`sources/opencode/packages/sdk/src/opencode.ts`](../../sources/opencode/packages/sdk/src/opencode.ts)：SDK 入口
- [`sources/opencode/packages/httpapi-codegen/`](../../sources/opencode/packages/httpapi-codegen)：OpenAPI 代码生成

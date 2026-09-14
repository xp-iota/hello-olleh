---
title: "可观测性：事件日志、请求追踪与结构化日志"
---
# 可观测性：事件日志、请求追踪与结构化日志

> 基于 `sources/opencode/packages/core/src/event-logger.ts`、`packages/server/` 与 `packages/cli/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 可观测性分层](#1-可观测性分层)
- [2. 结构化日志](#2-结构化日志)
- [3. 事件日志](#3-事件日志)
- [4. 请求追踪与运行时指标](#4-请求追踪与运行时指标)
- [5. 用量统计与调试面](#5-用量统计与调试面)

---

## 1. 可观测性分层

| 层 | 机制 | 位置 |
| --- | --- | --- |
| 结构化日志 | Effect 日志（`Effect.logInfo` 等），由 Observability 层输出 | `packages/util` 的 observability、CLI 启动装配 |
| 领域事件 | durable 事件日志 + live 事件流（本身就是最完整的行为记录） | `packages/core` Bus / event |
| 事件日志器 | 把关键目录类事件桥接进日志 | `packages/core/src/event-logger.ts` |
| 请求追踪 | HTTP 中间件 | `packages/server/src/request-tracing.ts` |
| 进程画像 | heap / CPU profile | `packages/cli/src/heap.ts`、`cpu-profile.ts` |
| 用量统计 | `opencode stats` 命令 + `packages/stats` | CLI 与专项包 |

## 2. 结构化日志

- CLI 启动时装配 `Observability`（`@opencode/util/observability`）作为日志输出层；`--print-logs` 全局 flag 把日志打到 stderr，server 侧日志需配合 `--standalone` 才能直接观测。
- 日志与事件是互补关系：事件是 durable/可回放的领域事实，日志是进程级诊断通道，二者不互相替代。

## 3. 事件日志

`packages/core/src/event-logger.ts` 是一个全局 Layer：订阅 Bus，把四类目录事件——`agent.updated`、`catalog.updated`、`command.updated`、`config.updated`——以 `Effect.logInfo("event", { event })` 记入日志。它的意义在于：配置/目录/命令/agent 的变更原本只在事件流里可见，事件日志器把它们桥接进进程日志，方便 `--print-logs` 下直接观察配置生命周期（与 [17-settings-config.md](./17-settings-config.md) 的 watch/变换管线配套阅读）。

## 4. 请求追踪与运行时指标

- Server 的 `request-tracing.ts` 中间件为每个 HTTP 请求建立追踪上下文；`service-status.ts`、`server-info.ts` 暴露进程信息面。
- 事件馈送本身是可观测对象：建议监控事件速率、各连接队列高水位、溢出/重连频率、帧大小、堆/RSS 与下游排空时间，再据以调容量（见 [08-performance.md](./08-performance.md)）。
- CLI 侧的 `heap.ts` 与 `cpu-profile.ts` 提供堆快照与 CPU profile 采集开关。

## 5. 用量统计与调试面

- `opencode stats` 展示用量统计；`packages/stats` 是独立的统计前端包。
- `opencode debug agents/config/paths` 检视 agent 解析、生效配置与路径解析（详见 [25-debugging.md](./25-debugging.md)）。
- `packages/http-recorder` 与 `packages/simulation` 提供 HTTP 录制与仿真能力，用于在测试中重放 provider 交互。

## 源码锚点

- [`sources/opencode/packages/core/src/event-logger.ts`](../../sources/opencode/packages/core/src/event-logger.ts)：目录事件 -> 日志桥
- [`sources/opencode/packages/server/src/request-tracing.ts`](../../sources/opencode/packages/server/src/request-tracing.ts)：HTTP 追踪中间件
- [`sources/opencode/packages/cli/src/heap.ts`](../../sources/opencode/packages/cli/src/heap.ts)、[`cpu-profile.ts`](../../sources/opencode/packages/cli/src/cpu-profile.ts)：进程画像
- [`sources/opencode/packages/stats/`](../../sources/opencode/packages/stats)：用量统计包

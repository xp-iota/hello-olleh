---
title: "架构全景：多包拓扑、所有权分层与作用域模型"
---
# 架构全景：多包拓扑、所有权分层与作用域模型

> 基于 `sources/opencode/` 中的 OpenCode `v2.0.2` 源码校对。本文重点核对 `packages/` 多包拓扑与 `specs/v2/` 的跨包契约，而不是沿用 v1 单包时代的目录名。

**目录**

- [1. 一句话结论](#1-一句话结论)
- [2. 多包拓扑与角色分工](#2-多包拓扑与角色分工)
- [3. 所有权分层](#3-所有权分层)
- [4. Location 与 Host 作用域](#4-location-与-host-作用域)
- [5. 事件架构](#5-事件架构)
- [6. 架构上的优点与真实代价](#6-架构上的优点与真实代价)

---

## 1. 一句话结论

OpenCode v2 不是 v1 那种“单包 `packages/opencode` + 内嵌服务”的结构，而是一套多包架构：**Schema 定义公共形状，Protocol 组装 HTTP 操作，Core 实现运行时与持久化，Server 绑定传输并投递 SSE，CLI/TUI/SDK/Desktop 只消费组装后的公共 API**。运行时内核全面采用 Effect-ts（`Effect` / `Layer` / `Scope` / `Stream`），会话状态以 durable event log + projection 承载。

## 2. 多包拓扑与角色分工

`packages/` 下共有 30 余个子包，核心分层包如下：

| 包 | 路径 | 角色 |
| --- | --- | --- |
| Schema | `packages/schema` | 公共领域形状与 durable 事件载荷（agent、session、permission、model、location、lsp-event 等） |
| Protocol | `packages/protocol` | 类型化 HTTP 操作定义、传输错误、按域分组的 endpoint（`groups/`） |
| Core | `packages/core` | 运行时：session 执行、持久化、工具、权限、catalog、插件、Location 作用域服务 |
| Server | `packages/server` | HTTP handler 绑定、公共 SSE 编码与逐连接投递、认证/CORS/中间件 |
| Plugin | `packages/plugin` | 公共插件契约与 `Tool.make`；`plugin/effect/*` 定义五域 hooks 形状 |
| Client / SDK | `packages/client`、`packages/sdk` | 生成与手写并存的客户端表面（`PromiseSdk`、Effect service） |
| CLI / TUI | `packages/cli`、`packages/tui` | 命令行入口（Effect CLI 命令树）与 Solid TUI |
| App / Desktop / Web | `packages/app`、`packages/desktop`、`packages/web` | 桌面与浏览器宿主 |
| Infra 支撑 | `packages/util`、`packages/effect-drizzle-sqlite`、`packages/httpapi-codegen` | Effect 工具集、SQLite 持久化、OpenAPI 代码生成 |
| 专项包 | `ai`、`codemode`、`console`、`containers`、`enterprise`、`session-ui`、`simulation`、`http-recorder`、`stats` 等 | 面向单一能力的聚焦包 |

## 3. 所有权分层

`specs/v2/README.md` 明确了权威归属：**权威随关注点走**。

| 关注点 | 所有者 |
| --- | --- |
| HTTP 操作与传输错误 | Protocol 的 endpoint 定义，由 Server 的 `HttpApi` 组装 |
| 公共领域形状与 durable 事件载荷 | Schema |
| 运行时行为与持久化 | Core |
| 贡献者级回归护栏 | 根 `AGENTS.md` |

语义所有权与传输/展示分离的直接收益：Server 的投递策略可以改变（例如共享编码事件馈送），而不影响 OpenAPI 与生成的 client。v2 规格分两类：**Current Contracts**（session、tools，描述跨模块语义法则）与 **Decision Records**（event-stream-architecture、provider-policy，记录已定案的设计取舍）；历史文档只解释旧状态，不作为当前 API 依据。

## 4. Location 与 Host 作用域

v2 的核心抽象之一是把“会话身份”与“执行位置”解耦：

- **Session 拥有 durable 身份**，独立于当前 Location。
- **Location 作用域服务**：runner、model 解析、工具、权限、插件、文件系统——随 placement 解析。
- **Host 作用域服务**：进程级协调与 durable Session 准入（如 `SessionInbox`、`SessionExecution` 协调器）。
- `LocationServiceMap`（`packages/core/src/location-service-map.ts`）是选择 Location 服务的边界；ID 绑定的 Session 值只保留 ID，不永久缓存 runner 或 projection。
- **移动（move）**改变后续操作的服务解析位置，但不会创建第二个 Session 身份。

这一模型让“会话可以从本地移动到 worktree/远程位置”成为一等能力，而不是事后补丁。

## 5. 事件架构

事件是 v2 的中枢神经，分两条平面：

- **durable 事件日志**（Core 拥有）：记录 Session 作用域事实，负责发布、持久化、回放与 projection，schema 由 `packages/schema/src/event.ts` 与 `event-manifest.ts` 定义。
- **实例级 live 事件流**：用于实时增量（text/reasoning/tool-input delta），schema 不同且无回放保证。

Server 侧只订阅一次公共事件流，过滤公共事件后**每个事件只编码一次**，把不可变 SSE 帧投递给每个连接各自的有界队列（容量 4 096）。慢连接独立溢出，不阻塞健康连接。详见 [15-sdk-transport.md](./15-sdk-transport.md) 与 [08-performance.md](./08-performance.md)。

## 6. 架构上的优点与真实代价

| 维度 | 优点 | 代价 |
| --- | --- | --- |
| 多包所有权 | 公共形状稳定，client 可生成；Server 投递策略可独立演化 | 包边界纪律要求高，跨包语义要靠 `specs/v2` 显式记录 |
| Effect-ts 内核 | 结构化并发、Scope 资源管理、类型化错误通道 | 学习曲线陡；Effect 的 `Layer`/`Scope` 渗透所有运行时代码 |
| durable event log | 崩溃恢复、回放、move/revert 都是同一原语 | 写路径先落库再执行，延迟高于纯内存实现 |
| Location/Host 分离 | 会话可移动、placement 可重解析 | 每个操作都要考虑“当前在哪个 Location 解析服务” |
| 单编码 SSE 馈送 | 慢连接隔离、编码成本恒定 | 编码失败要终止当前订阅者以避免静默空洞，实现复杂度高 |

## 源码锚点

- [`sources/opencode/specs/v2/README.md`](../../sources/opencode/specs/v2/README.md)：权威归属表
- [`sources/opencode/packages/`](../../sources/opencode/packages)：多包树
- [`sources/opencode/packages/core/src/location-service-map.ts`](../../sources/opencode/packages/core/src/location-service-map.ts)：Location 服务选择边界
- [`sources/opencode/packages/core/src/session.ts`](../../sources/opencode/packages/core/src/session.ts)：ID 寻址 Session facade
- [`sources/opencode/packages/server/src/`](../../sources/opencode/packages/server/src)：传输层

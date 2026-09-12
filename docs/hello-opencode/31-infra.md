---
layout: content
title: "OpenCode 深度专题 B05：基础设施，SQLite、Storage、Bus、Instance 与事件投影"
---
# OpenCode 深度专题 B05：基础设施，SQLite、Storage、Bus、Instance 与事件投影

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

如果不看基础设施，很容易把 OpenCode 理解成“一个内存态 agent，顺手把历史写数据库”。当前实现恰好相反：数据库、实例作用域、事件总线和 SSE 投影本来就是 runtime 骨架的一部分。

---

**目录**

- [1. 当前基础设施不是单一存储，而是两层](#1-当前基础设施不是单一存储而是两层)
- [2. 哪些表真正决定系统行为](#2-哪些表真正决定系统行为)
- [3. `Database.use()` / `transaction()` / `effect()` 才是“一致性基石”](#3-databaseuse-transaction-effect-才是一致性基石)
- [4. `Bus` 和 `GlobalBus` 是两级事件投影，不是一个 EventEmitter 就完事](#4-bus-和-globalbus-是两级事件投影不是一个-eventemitter-就完事)
- [5. `SessionStatus` 是基础设施层里的“非 durable 运行态”](#5-sessionstatus-是基础设施层里的非-durable-运行态)
- [6. `Instance` / `WorkspaceContext` 决定请求落在哪份 runtime 上](#6-instance-workspacecontext-决定请求落在哪份-runtime-上)
- [7. `Storage` 还承担着派生数据和迁移职责](#7-storage-还承担着派生数据和迁移职责)
- [8. 为什么这套基础设施天然支持“恢复现场”](#8-为什么这套基础设施天然支持恢复现场)

---

## 1. 当前基础设施不是单一存储，而是两层

| 层 | 代码坐标 | 存什么 |
| --- | --- | --- |
| SQLite / Drizzle | `packages/opencode/src/session/session.sql.ts`、`storage/db.ts` | session、message、part、todo、permission、project、workspace 等主状态 |
| JSON Storage | `packages/opencode/src/storage/storage.ts` | `session_diff` 等文件化辅助状态，以及旧存储迁移通道 |

所以 OpenCode 不是“全量都在 SQLite”，而是：

1. 主执行状态进 SQLite
2. 某些派生数据仍走 JSON storage

最典型的例子就是 `SessionSummary` 写出来的 `session_diff`。

---

## 2. 哪些表真正决定系统行为

`session.sql.ts` 当前最重要的表是：

### 2.1 `SessionTable`

关键列包括：

1. `project_id`
2. `workspace_id`
3. `parent_id`
4. `directory`
5. `title`
6. `share_url`
7. `summary_*`
8. `revert`
9. `permission`
10. `time_compacting` / `time_archived`

这张表定义了 session 的 durable 边界。

### 2.2 `MessageTable`

1. `session_id`
2. `time_created`
3. `data(json)`

它只存 message header，不存 parts。

### 2.3 `PartTable`

1. `message_id`
2. `session_id`
3. `time_created`
4. `data(json)`

这张表承载了真正的执行细节。

### 2.4 其他辅助表

1. `TodoTable`
2. `PermissionTable`
3. `ProjectTable`
4. `WorkspaceTable`

这些表让 todo、项目、workspace 和已批准权限也能纳入 durable runtime。

---

## 3. `Database.use()` / `transaction()` / `effect()` 才是“一致性基石”

`packages/opencode/src/storage/db.ts:121-162` 这组 API 是当前基础设施层最关键的实现。

### 3.1 `Database.use()`

它会：

1. 优先复用当前上下文里的 tx/db
2. 若当前没有 DB 上下文，就自动挂一个新的上下文

这样上层代码不用显式传 transaction 对象，也能共享同一上下文。

### 3.2 `Database.transaction()`

没有外层 tx 时，就用底层 SQLite transaction 包起来；有外层 tx 时，直接复用。

### 3.3 `Database.effect()`

effect 不会立刻执行，而是先塞进当前 DB 上下文的 effects 队列，等 `use()` / `transaction()` 主体写完后再统一执行。

这就是为什么 `Session.updateMessage()` / `updatePart()` 能做到：

1. 先落库
2. 再发 Bus 事件

这不是编码习惯，而是基础设施层提供的语义保障。

---

## 4. `Bus` 和 `GlobalBus` 是两级事件投影，不是一个 EventEmitter 就完事

### 4.1 `Bus`

`packages/opencode/src/bus/index.ts:18-104` 的 `Bus` 是 instance-scoped：

1. 订阅者保存在 `Instance.state(...)`
2. 只对当前 `Instance.directory` 作用域生效
3. 负责向本地订阅者投递 `message.updated` / `message.part.updated` / `session.status` 等事件

### 4.2 `GlobalBus`

`packages/opencode/src/bus/global.ts:1-10` 是进程级 EventEmitter。`Bus.publish()` 每次本地发布事件时，都会顺便：

```ts
GlobalBus.emit("event", { directory: Instance.directory, payload })
```

这使得桌面壳、控制平面或跨 workspace 观察者可以收到全局事件流。

### 4.3 SSE 只是 Bus 的网络投影

1. `/event` 用 `Bus.subscribeAll()`，见 `server/routes/event.ts:13-84`
2. `/global/event` 用 `GlobalBus`，见 `server/routes/global.ts:43-124`

所以 SSE 不是额外的数据源，只是 Bus/GlobalBus 的网络投影。

---

## 5. `SessionStatus` 是基础设施层里的“非 durable 运行态”

`packages/opencode/src/session/status.ts:55-99` 当前把 `busy/retry/idle` 存在 `InstanceState` 里，而不是 SQLite。

这意味着：

1. session 正在运行与否是进程内态
2. session 历史本身是 durable 态

这两者分开是合理的，因为：

1. “是否 busy” 不适合持久化回放
2. 但 UI 又需要实时知道它

于是它就通过 `session.status` 事件流暴露出去。

---

## 6. `Instance` / `WorkspaceContext` 决定请求落在哪份 runtime 上

`Server.createApp()` 的中间件会用 `WorkspaceContext.provide(...)` 和 `Instance.provide(...)` 把请求绑定到：

1. 当前 `workspaceID`
2. 当前 `directory`
3. 当前 `project`

这使得后续代码里看似“全局”的这些对象：

1. `Instance.directory`
2. `Instance.worktree`
3. `Instance.project`
4. `Bus`
5. `Permission`
6. `SessionStatus`

其实都是**作用域化单例**，不是进程级裸全局。

这是 OpenCode 能同时支持多工程、多 workspace、本地 sidecar 和远端 attach 的基础。

---

## 7. `Storage` 还承担着派生数据和迁移职责

`packages/opencode/src/storage/storage.ts` 还有两件经常被忽略的事：

### 7.1 派生数据持久化

`SessionSummary` 会把 diff 写到：

```ts
Storage.write(["session_diff", sessionID], diffs)
```

这说明 session diff 当前不进主 SQLite 表，而是落在 JSON storage。

### 7.2 旧存储迁移

`25-152` 的 migration 逻辑会把历史 JSON 结构迁到新的 storage 布局，CLI 启动时再由 `index.ts` 触发一次性 SQLite 迁移。

所以基础设施层不只是“现在怎么存”，还负责把历史版本带到当前模型上。

---

## 8. 为什么这套基础设施天然支持“恢复现场”

把 B05 的对象放在一起看，会发现 OpenCode 当前有一条非常稳定的 infra 规律：

1. 主状态进 SQLite
2. 派生状态进 JSON storage
3. 写完再发事件
4. 事件再投影成 SSE
5. 所有“全局对象”都被 `Instance` / `WorkspaceContext` 限定作用域

因此所谓“恢复现场”，本质上不是重新构造一个内存 agent，而是：

1. 重新打开 SQLite
2. 重新按 session/message/part 历史回放
3. 必要时再恢复文件系统 snapshot

这就是 OpenCode 当前 durable runtime 能成立的基础设施前提。

## 源码锚点补强：Infra 由 SQLite、Storage、Bus、Instance 共同支撑

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/opencode/packages/opencode/src/storage/db.ts:29` | 数据库模块入口 | 对比 Claude JSONL / Gemini 文件存储 |
| `sources/opencode/packages/opencode/src/storage/storage.ts:13` | Storage 抽象入口 | 说明 SQLite 外还有文件存储层 |
| `sources/opencode/packages/opencode/src/bus/index.ts:7` | Bus 模块入口 | 对应 Claude stream events |
| `sources/opencode/packages/opencode/src/bus/index.ts:66` | bus publish / subscribe 核心 | 说明 UI/server 通过事件投影 |
| `sources/opencode/packages/opencode/src/bus/index.ts:85` | GlobalBus 相关实现 | 对应跨实例事件 |
| `sources/opencode/packages/opencode/src/project/instance.ts:64` | `Instance` 单例上下文 | 解释请求如何落到工作目录 |
| `sources/opencode/packages/opencode/src/control-plane/workspace-context.ts:10` | workspace context | 说明 server/control-plane 还有工作区维度 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Database.use()` | `storage/database.ts` | 获取当前 workspace 的 SQLite 连接，带连接池管理 |
| `Database.transaction()` | `storage/database.ts` | 包裹多个写操作为原子事务 |
| `Database.effect()` | `storage/database.ts` | 将 SQLite 操作提升为 Effect，集成错误类型系统 |
| `Bus` / `GlobalBus` | `bus/bus.ts` | 内存 pub/sub：`Bus` 为 session 级、`GlobalBus` 跨 session 级 |
| `SessionStatus` | `session/session.ts` | session 状态枚举：idle/running/waiting/completed/error |
| `Instance` / `WorkspaceContext` | `server/context.ts` | 请求 scope 上下文：绑定 workspace 路径和 runtime 实例 |

---

## 代码质量评估

**优点**

- **Effect 集成 Database 层**：SQLite 操作包裹在 Effect 中，错误类型在编译期可见，不会被 `try/catch` 吞掉。
- **双级 Bus 设计**：session 级 Bus 隔离 session 事件，GlobalBus 允许跨 session 订阅全局状态，粒度恰当。
- **`Instance` context 绑定**：每个 HTTP 请求都绑定 workspace context，保证操作不会跨 workspace，天然多工作区隔离。

**风险与改进点**

- **SQLite 单文件写锁**：多 session 并发写入时，SQLite WAL 可缓解但高并发场景仍存在锁竞争，事务窗口长时影响吞吐。
- **Bus 无持久化**：Bus 事件仅存在于内存，进程崩溃后 SSE 客户端重连无法回放历史事件，需轮询 HTTP 接口补偿。
- **GlobalBus 无细粒度订阅**：GlobalBus 是全局广播，客户端需在本地过滤无关 session 事件，无法服务端按需过滤。

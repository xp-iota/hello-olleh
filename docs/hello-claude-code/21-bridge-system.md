---
layout: content
title: "Claude Code 的桥接系统"
---
# Claude Code 的桥接系统

**目录**

- [1. 桥接系统概述](#1-桥接系统概述)
- [2. 远程桥接核心](#2-远程桥接核心)
- [3. 传输层实现](#3-传输层实现)
- [4. 消息处理](#4-消息处理)
- [5. JWT 刷新机制](#5-jwt-刷新机制)
- [6. 传输重建](#6-传输重建)
- [7. 桥接状态](#7-桥接状态)
- [8. 历史记录同步](#8-历史记录同步)
- [9. 会话归档](#9-会话归档)
- [11. 补充：关键实现细节](#11-补充关键实现细节)

---

## 1. 桥接系统概述

本篇讨论远程桥接、会话同步、JWT 刷新与写入缓冲如何共同构成远程控制链路。

桥接直接建立在底层 transport 之上；网络通道与事件上传器的细节见 [17-sdk-transport.md](./15-sdk-transport.md)。

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    subgraph Local["本地 CLI"]
        A1["REPL<br/>本地命令行"]
    end

    subgraph Bridge["Bridge 系统"]
        B1["HybridTransport<br/>WebSocket + HTTP"]
        B2["FlushGate<br/>写入缓冲"]
        B3["TokenRefreshScheduler<br/>JWT 刷新"]
    end

    subgraph Remote["远程服务器"]
        C1["Session Ingress"]
        C2["Bridge Endpoint"]
        C3["Worker JWT"]
    end

    subgraph Client["Remote Client"]
        D1["移动端/网页"]
    end

    A1 <--> B1
    B1 <-->|SSE/POST| C1
    D1 <-->|WebSocket| C1

    B2 --> B1
    B3 --> B1
```

## 2. 远程桥接核心

**位置**: `src/bridge/remoteBridgeCore.ts`

### 2.1 EnvLessBridge 初始化流程

```mermaid
---
config:
  theme: neutral
---
sequenceDiagram
    participant CLI as Claude Code CLI
    participant API as Session API
    participant Bridge as Bridge Endpoint
    participant Transport as HybridTransport

    CLI->>API: POST /v1/code/sessions
    API-->>CLI: sessionId

    CLI->>Bridge: POST /bridge
    Bridge-->>CLI: worker_jwt, expires_in

    CLI->>Transport: createV2ReplTransport()
    Transport->>Transport: 创建 WebSocket + HTTP

    CLI->>Transport: transport.connect()
    Transport-->>CLI: 连接就绪

    Note over CLI: 启动 JWT 刷新调度器
```

### 2.2 凭证获取

```typescript
// 获取远程桥接凭证
async function fetchRemoteCredentials(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  timeoutMs: number,
): Promise<RemoteCredentials | null> {
  const response = await axios.post(
    `${baseUrl}/bridge`,
    { session_id: sessionId },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
      },
      timeout: timeoutMs,
    }
  )

  return {
    worker_jwt: response.data.worker_jwt,
    expires_in: response.data.expires_in,
    api_base_url: response.data.api_base_url,
    worker_epoch: response.data.worker_epoch,
  }
}
```

## 3. 传输层实现

### 3.1 HybridTransport

**位置**: `src/cli/transports/HybridTransport.ts`

混合传输：WebSocket 用于读取，HTTP POST 用于写入。

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    A["write(stream_event)"] --> B["缓冲队列<br/>100ms 定时器"]
    A1["write(other)"] --> C["立即 flush"]

    B -->|定时触发| D["SerialBatchEventUploader"]
    C --> D

    D -->|批量| E["POST /events"]
    D -->|重试| D

    E -->|成功| F["继续"]
    E -->|429/5xx| D
    E -->|4xx| G["丢弃"]
```

### 3.2 SerialBatchEventUploader

**位置**: `src/cli/transports/SerialBatchEventUploader.ts`

串行批量上传器：

```typescript
export class SerialBatchEventUploader<T> {
  private queue: T[][] = []
  private inFlight: boolean = false

  constructor(private config: {
    maxBatchSize: number
    maxQueueSize: number
    baseDelayMs: number
    maxDelayMs: number
    maxConsecutiveFailures?: number
    send: (batch: T[]) => Promise<void>
  }) {}

  async enqueue(items: T[]): Promise<void> {
    // 背压检查
    if (this.queueLength > this.config.maxQueueSize) {
      await this.drain()
    }

    this.queue.push(items)
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.shift()!
      await this.sendWithRetry(batch)
    }
  }
}
```

## 4. 消息处理

### 4.1 入口消息处理

**位置**: `src/bridge/bridgeMessaging.ts`

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    A["SSE/WebSocket 消息"] --> B{"消息类型?"}

    B -->|user| C["onInboundMessage"]
    B -->|control_request| D{"子类型?"}
    B -->|control_response| E["onPermissionResponse"]
    B -->|control_cancel| F["处理取消"]

    D -->|can_use_tool| G["权限请求"]
    D -->|其他| H["控制请求"]

    C --> I["去重检查"]
    G --> I
    H --> I
```

### 4.2 服务器控制请求

```typescript
export async function handleServerControlRequest(
  req: SDKControlRequest,
  handlers: {
    transport: ReplBridgeTransport
    sessionId: string
    onInterrupt?: () => void
    onSetModel?: (model: string) => void
    onSetMaxThinkingTokens?: (tokens: number | null) => void
    onSetPermissionMode?: (mode: PermissionMode) => {...}
  }
): Promise<void> {

  switch (req.request.subtype) {
    case 'interrupt':
      handlers.onInterrupt?.()
      break

    case 'set_model':
      handlers.onSetModel?.(req.request.model)
      break

    case 'set_permission_mode':
      handlers.onSetPermissionMode?.(req.request.mode)
      break

    case 'update_max_thinking_tokens':
      handlers.onSetMaxThinkingTokens?.(req.request.max_tokens)
      break
  }
}
```

## 5. JWT 刷新机制

### 5.1 Token 刷新调度

**位置**: `src/bridge/jwtUtils.ts`

```mermaid
---
config:
  theme: neutral
---
sequenceDiagram
    participant Scheduler as TokenRefreshScheduler
    participant Auth as Auth Server
    participant Transport as Transport

    Note over Scheduler: 启动时设置定时器
    Note over Scheduler: expiresIn - refreshBufferMs 后触发

    Scheduler->>Auth: 获取新 OAuth Token
    Auth-->>Scheduler: oauthToken

    Scheduler->>Transport: rebuildTransport(fresh)
    Transport->>Transport: 关闭旧连接
    Transport->>Transport: 创建新连接
    Transport-->>Scheduler: 完成

    Note over Scheduler: 重新调度下一次刷新
```

### 5.2 认证失败恢复

```typescript
async function recoverFromAuthFailure(): Promise<void> {
  authRecoveryInFlight = true
  onStateChange?.('reconnecting', 'JWT expired — refreshing')

  try {
    // 刷新 OAuth token
    const stale = getAccessToken()
    if (onAuth401) await onAuth401(stale ?? '')

    const oauthToken = getAccessToken() ?? stale
    if (!oauthToken) {
      onStateChange?.('failed', 'JWT refresh failed: no OAuth token')
      return
    }

    // 获取新凭证
    const fresh = await fetchRemoteCredentials(
      sessionId,
      baseUrl,
      oauthToken,
      cfg.http_timeout_ms,
    )

    // 重建传输
    await rebuildTransport(fresh, 'auth_401_recovery')
  } finally {
    authRecoveryInFlight = false
  }
}
```

## 6. 传输重建

### 6.1 重建流程

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    A["JWT 刷新/401 错误"] --> B["flushGate.start()"]

    B --> C["暂停写入"]
    C --> D["获取当前序列号"]

    D --> E["关闭旧传输"]
    E --> F["创建新传输"]

    F --> G["重新连接回调"]
    G --> H["transport.connect()"]

    H --> I["刷新缓冲队列"]
    I --> J["flushGate.drop()"]
```

### 6.2 FlushGate

**位置**: `src/bridge/flushGate.ts`

在传输重建期间缓冲写入：

```typescript
export class FlushGate<T> {
  private queue: T[] = []
  private active: boolean = false

  start() {
    this.active = true
  }

  enqueue(...items: T[]): boolean {
    if (!this.active) return false  // 不在门内，直接发送

    this.queue.push(...items)
    return true  // 已入队
  }

  end(): T[] {
    this.active = false
    const items = this.queue
    this.queue = []
    return items
  }

  drop() {
    this.active = false
    this.queue = []
  }
}
```

## 7. 桥接状态

### 7.1 状态定义

```typescript
export type BridgeState =
  | 'idle'           // 初始状态
  | 'ready'          // 凭证获取完成
  | 'connected'      // 传输已连接
  | 'reconnecting'   // 重连中
  | 'failed'         // 失败
```

### 7.2 状态转换

```mermaid
---
config:
  theme: neutral
---
stateDiagram-v2
    [*] --> idle: 启动
    idle --> ready: createCodeSession
    ready --> connected: transport.connect()
    connected --> reconnecting: JWT refresh / 401
    reconnecting --> connected: 成功
    reconnecting --> failed: 失败
    connected --> [*]: 关闭
    failed --> [*]: 关闭
```

## 8. 历史记录同步

### 8.1 历史记录上传

```typescript
async function flushHistory(msgs: Message[]): Promise<void> {
  // 过滤可上传的消息
  const eligible = msgs.filter(isEligibleBridgeMessage)

  // 限制大小
  const capped = eligible.length > initialHistoryCap
    ? eligible.slice(-initialHistoryCap)
    : eligible

  const events = toSDKMessages(capped).map(m => ({
    ...m,
    session_id: sessionId,
  }))

  // 发送
  await transport.writeBatch(events)
}
```

### 8.2 消息去重

```typescript
// 最近发送的 UUID (用于识别服务器回显)
const recentPostedUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)

// 最近接收的 UUID (用于识别重复消息)
const recentInboundUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)

function writeMessages(messages: Message[]) {
  const filtered = messages.filter(m =>
    isEligibleBridgeMessage(m) &&
    !initialMessageUUIDs.has(m.uuid) &&
    !recentPostedUUIDs.has(m.uuid)
  )

  // 添加到已发送
  for (const msg of filtered) {
    recentPostedUUIDs.add(msg.uuid)
  }

  // 发送
  transport.writeBatch(filtered)
}
```

## 9. 会话归档

### 9.1 关闭时归档

```typescript
async function teardown(): Promise<void> {
  tornDown = true
  refresh.cancelAll()

  // 发送空闲状态
  transport.reportState('idle')
  void transport.write(makeResultMessage(sessionId))

  // 归档会话
  let status = await archiveSession(
    sessionId,
    baseUrl,
    token,
    orgUUID,
    cfg.teardown_archive_timeout_ms,
  )

  // 关闭传输
  transport.close()
}
```

## 11. 补充：关键实现细节

### 11.1 Worker Epoch 语义

worker_epoch 是 Bridge 会话的版本号。当远程服务器重启或发生故障转移时，epoch 会递增。客户端收到新的 epoch 后必须重建传输层，因为旧的 WebSocket 连接已经失效。这是一个幂等性保证机制——即使客户端收到多次相同的 epoch，也不会重复重建。

### 11.2 并发消息处理

Bridge 使用 BoundedUUIDSet 做消息去重，分别维护 sent 和 received 两个集合。集合大小有上限，超过后自动驱逐最旧的条目。这意味着在极端情况下（非常长的会话），理论上可能出现重复消息。但实际上 UUID 冲突的概率极低。

### 11.3 WebSocket 心跳

HybridTransport 继承自 WebSocketTransport，后者实现了基于 ping/pong 帧的心跳机制。心跳间隔和超时由服务端配置控制。心跳失败会触发重连流程。

### 11.4 重连退避策略

WebSocket 重连使用指数退避：1 秒起步，最大 30 秒，每次失败翻倍。成功连接后重置计数器。重连期间通过 FlushGate 缓冲所有写操作，防止消息丢失。

---

*文档版本: 1.0*
*分析日期: 2026-03-31*

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `IpcServer` | `src/ipc/ipcServer.ts` | IPC server：监听来自外部工具（IDE 插件、Claude.app）的连接 |
| `IpcClient` | `src/ipc/ipcClient.ts` | IPC client：IDE 插件侧发起连接，转发用户指令到 Claude Code |
| `BridgeProtocol` | `src/ipc/protocol.ts` | 消息协议定义：统一 IPC 和内部 agent 之间的消息格式 |
| `AgentEventEmitter` | `src/agent/events.ts` | agent 事件发布：将 agent 内部事件转发给 IPC 订阅者 |
| `VSCodeExtensionAdapter` | `src/bridge/vscodeBridge.ts` | VS Code 扩展适配器：将 VS Code API 事件转换为 bridge 消息 |
| `InterruptSignal` | `src/bridge/interrupt.ts` | 中断信号传播：将外部工具的取消请求传播到 agent 主循环 |

---

## 代码质量评估

**优点**

- **IPC 协议隔离**：`BridgeProtocol` 定义统一消息格式，IDE 插件和 agent 核心通过协议解耦，未来可支持多种 IDE 而不改核心逻辑。
- **`AgentEventEmitter` 透明事件转发**：agent 内部事件无需感知外部订阅者，单向事件流设计简单可靠。
- **中断信号双向传播**：外部工具的取消请求可通过 `InterruptSignal` 传入 agent，agent 中断也可通知外部工具更新 UI 状态。

**风险与改进点**

- **IPC socket 无身份验证**：本地 IPC 连接无 auth token，同一机器的其他进程可连接 IPC server 并发送指令。
- **BridgeProtocol schema 无版本控制**：协议格式变更时，旧版 IDE 插件与新版 Claude Code 可能不兼容，无协议版本协商机制。
- **`VSCodeExtensionAdapter` IDE 耦合深**：适配器直接依赖 VS Code API 类型，移植到其他 IDE（如 JetBrains）需要重写适配层。

## 横向对齐补强：Claude Bridge 是远程会话控制面

Claude Bridge 章节应和 SDK/Transport 区分：它关注远程 REPL、多 session、IDE/daemon 同步，而不是单次模型请求。

| Bridge 面 | 横向对比 |
| --- | --- |
| 远程 REPL | 对应 OpenCode server surface |
| IDE adapter | 对应 Gemini IDE integration |
| poll/heartbeat | 对应 OpenCode SSE/Bus |
| GrowthBook gate | Claude 特有 rollout 控制 |

## 协议、身份验证与 session lifecycle

| 维度 | 源码锚点 | 说明 |
| --- | --- | --- |
| WebSocket base URL | `sources/claude-code/src/remote/SessionsWebSocket.ts:108` | remote session 把 OAuth base API URL 转成 WSS |
| 认证方式 | `sources/claude-code/src/remote/SessionsWebSocket.ts:79` | 连接后发送 OAuth credential/auth message |
| 未授权关闭码 | `sources/claude-code/src/remote/SessionsWebSocket.ts:35` | 4003 表示 unauthorized |
| fresh token | `sources/claude-code/src/remote/SessionsWebSocket.ts:113` | 每次连接尝试取 fresh token，降低过期风险 |
| permission bridge | `sources/claude-code/src/remote/RemoteSessionManager.ts:153` | remote control request 可转成本地 permission prompt |
| permission response | `sources/claude-code/src/remote/RemoteSessionManager.ts:246` | 本地审批结果回传远端 |

安全评估时要分清两条链：身份验证链决定能否连接远端 session；permission bridge 链决定远端 agent 请求本地危险操作时如何让用户确认。二者缺一不可。

## 源码锚点补强：Bridge 是独立远程控制面

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/claude-code/src/bridge/bridgeEnabled.ts:120` | Bridge 启用判断 | 对应其他项目的 server/control-plane 开关 |
| `sources/claude-code/src/bridge/initReplBridge.ts:397` | REPL bridge 初始化 | 说明它接在本地交互循环旁路 |
| `sources/claude-code/src/bridge/replBridge.ts:1532` | bridge 消息处理深层逻辑 | 对比 OpenCode server route / SSE |
| `sources/claude-code/src/bridge/types.ts:227` | Bridge 类型协议 | 用于区分 transport、auth 和 session control |

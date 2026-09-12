---
layout: content
title: "Gemini CLI 可观测性：日志、MessageBus 与 UI 状态追踪"
---
# Gemini CLI 可观测性：日志、MessageBus 与 UI 状态追踪

本文档分析 Gemini CLI 的可观测性基础设施。

**目录**

- [1. 可观测性在 Gemini CLI 里的定位](#1-可观测性在-gemini-cli-里的定位)
- [2. 日志系统](#2-日志系统)
- [3. MessageBus 事件总线](#3-messagebus-事件总线)
- [4. UIStateContext 状态管理](#4-uistatecontext-状态管理)
- [5. Storage 持久化](#5-storage-持久化)
- [6. 与 OpenCode 的完整可观测性对比](#6-与-opencode-的完整可观测性对比)
- [7. 改进建议](#7-改进建议)
- [8. 关键源码锚点](#8-关键源码锚点)
- [9. 总结](#9-总结)

---

## 1. 可观测性在 Gemini CLI 里的定位

### 1.1 三支柱架构

Gemini CLI 的可观测性围绕三个核心机制：

1. **日志**：结构化日志输出
2. **MessageBus**：状态广播事件总线
3. **UIStateContext**：UI 层的状态投影

### 1.2 与其他项目的对比

| 特性 | Claude Code | Codex | OpenCode | Gemini CLI |
| --- | --- | --- | --- | --- |
| 结构化日志 | Logger | tracing | Log + 轮转 | console 基础 |
| 事件总线 | 专用 Bus | 无 | Bus + GlobalBus | MessageBus |
| 状态追踪 | SessionStatus | ThreadState | SessionStatus | UIStateContext |
| 实时订阅 | 支持 | 无 | 支持 | React Context |

---

## 2. 日志系统

### 2.1 console 日志

Gemini CLI 使用标准 console 输出：

```typescript
console.log('Starting initialization')
console.error('Failed to connect:', error)
console.warn('Retry attempt:', attempt)
```

### 2.2 Ink 组件的日志

TUI 使用 Ink 组件渲染日志：

```typescript
import { Text } from 'ink'

<Text color="green">✓ Initialized</Text>
<Text color="red">✗ Error: {message}</Text>
```

---

## 3. MessageBus 事件总线

### 3.1 MessageBus 架构

`sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts`：

```typescript
class MessageBus extends EventEmitter {
  emit(event: string, data: any): boolean
  on(event: string, listener: (...args: any[]) => void): this
  off(event: string, listener: (...args: any[]) => void): this
}
```

### 3.2 事件类型

| 事件 | 触发时机 | 数据 |
| --- | --- | --- |
| `turn:start` | 回合开始 | `{ turnId }` |
| `turn:end` | 回合结束 | `{ turnId, result }` |
| `tool:call` | 工具调用 | `{ tool, params }` |
| `tool:result` | 工具返回 | `{ tool, result }` |
| `error` | 错误发生 | `{ error }` |
| `approval:required` | 需要审批 | `{ tool, params }` |

### 3.3 使用场景

```typescript
// 监听工具调用
messageBus.on('tool:call', ({ tool, params }) => {
  console.log(`Calling ${tool}:`, params)
})

// 监听回合结束
messageBus.on('turn:end', ({ turnId, result }) => {
  updateUI({ turnId, result })
})
```

---

## 4. UIStateContext 状态管理

### 4.1 React Context 架构

```typescript
const UIStateContext = React.createContext<UIState>({
  currentTurn: null,
  messages: [],
  tools: [],
  status: 'idle'
})
```

### 4.2 状态投影

| 状态字段 | 类型 | 说明 |
| --- | --- | --- |
| `currentTurn` | `Turn \| null` | 当前回合 |
| `messages` | `Message[]` | 消息历史 |
| `tools` | `Tool[]` | 可用工具 |
| `status` | `'idle' \| 'running' \| 'waiting'` | 运行状态 |

### 4.3 与 MessageBus 的协作

```typescript
// MessageBus 事件 → UIState 更新
messageBus.on('turn:end', ({ result }) => {
  setUIState(prev => ({
    ...prev,
    messages: [...prev.messages, result]
  }))
})
```

---

## 5. Storage 持久化

### 5.1 Storage 接口

```typescript
interface Storage {
  saveSession(session: Session): Promise<void>
  loadSession(id: string): Promise<Session | null>
  listSessions(): Promise<SessionSummary[]>
  deleteSession(id: string): Promise<void>
}
```

### 5.2 JSON 文件存储

```typescript
class JsonStorage implements Storage {
  async saveSession(session: Session): Promise<void> {
    const path = `${this.dir}/${session.id}.json`
    await writeFile(path, JSON.stringify(session))
  }
}
```

### 5.3 与 MessageBus 的集成

```typescript
// 回合结束后自动保存
messageBus.on('turn:end', async ({ turnId, result }) => {
  const session = buildSessionFromHistory()
  await storage.saveSession(session)
})
```

---

## 6. 与 OpenCode 的完整可观测性对比

### 6.1 主要差距

| 能力 | OpenCode | Gemini CLI |
| --- | --- | --- |
| 结构化日志 | Log + 文件轮转 | console 基础 |
| 事件总线 | Bus + GlobalBus | MessageBus (local) |
| 日志持久化 | 10 文件保留策略 | JSON 文件 |
| 实时订阅 | SSE/WebSocket | React Context |
| 分布式追踪 | OpenTelemetry | 无 |

### 6.2 缺失的机制

1. **日志文件轮转**：无自动清理
2. **全局事件广播**：MessageBus 仅本地
3. **结构化日志**：无 service tag
4. **OpenTelemetry**：无分布式追踪

---

## 7. 改进建议

### 7.1 短期增强

1. **增强日志格式**：添加 timestamp、level、service tag
2. **实现日志轮转**：防止日志无限增长
3. **GlobalBus**：跨进程事件广播

### 7.2 长期规划

| 能力 | 实现建议 |
| --- | --- |
| 结构化日志 | 使用 pino 或 winston |
| 日志轮转 | 实现 10 文件保留策略 |
| 分布式追踪 | 接入 OpenTelemetry |
| 全局广播 | 实现 GlobalBus 机制 |

---

## 8. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| MessageBus | `sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts` | 事件总线 |
| UIStateContext | `sources/gemini-cli/packages/cli/src/ui/contexts/UIStateContext.tsx` | UI 状态 |
| Storage | `sources/gemini-cli/packages/core/src/config/storage.ts` | 持久化根目录与路径接口 |
| TUI 渲染 | `sources/gemini-cli/packages/cli/src/ui/App.tsx` | Ink 组件 |

---

## 9. 总结

Gemini CLI 的可观测性相比 OpenCode 较为基础：

1. **日志**：console 基础输出
2. **MessageBus**：本地 EventEmitter 事件总线
3. **UIStateContext**：React Context 状态管理
4. **Storage**：JSON 文件持久化

相比 OpenCode 的 Log + Bus + GlobalBus 三支柱，Gemini CLI 缺少日志轮转、全局广播和结构化日志。对于本地开发调试，当前架构足以支撑。

---

> 关联阅读：[05-state-management.md](./04-state-session-memory.md) 了解 Storage 详情。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `MessageBus` | `sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts` | 继承 EventEmitter，提供 emit/on/off 工具调用状态广播 |
| `UIStateContext` | `sources/gemini-cli/packages/cli/src/ui/contexts/UIStateContext.tsx` | React Context 状态容器：持有 currentTurn、messages、status |
| `Storage.initialize()` | `sources/gemini-cli/packages/core/src/config/storage.ts` | 计算 `~/.gemini/`、项目级 `.gemini/` 等持久化根路径 |
| `ChatRecordingService.recordMessage()` | `sources/gemini-cli/packages/core/src/services/chatRecordingService.ts` | 实时录制用户/模型/工具/思考消息并序列化到 JSON 文件 |
| `JsonStorage.saveSession()` | — | 将 session 对象序列化为 JSON 文件写入 Storage 目录 |

---

## 代码质量评估

**优点**

- **MessageBus 事件驱动解耦**：工具执行状态通过 EventEmitter 广播，Scheduler 不直接依赖 UI 层，各层可独立测试。
- **UIStateContext 增量渲染**：React Context + Ink 组合实现增量 UI 更新，不需要全量重绘终端。
- **ChatRecordingService 实时落盘**：每次消息增量写入，不等会话结束才保存，进程崩溃后数据不全量丢失。

**风险与改进点**

- **MessageBus 仅本地 EventEmitter**：无法跨进程广播，不支持多 session 全局事件（相比 OpenCode GlobalBus 功能弱）。
- **日志无结构化格式与文件轮转**：仅使用 `console.log/error`，无 timestamp、level、service tag，也无自动日志清理机制，长期运行 log 会无限增长。
- **UIStateContext 无虚拟化**：长会话下持有大量历史消息的 Context 会导致 Ink 组件频繁全量 re-render，存在性能瓶颈。

## 横向对齐补强：Gemini 可观测性要补结构化事件

Gemini CLI 的可观测性目前更偏开发者调试，而不是运行时审计。它需要把 core client、Scheduler、PolicyEngine、UI hook 的事件统一成可关联结构。

| 信号 | Gemini 侧来源 | 缺口 |
| --- | --- | --- |
| model stream | `GeminiClient.sendMessageStream()` | 需要 trace id |
| tool lifecycle | `Scheduler` | 需要状态转移日志 |
| policy decision | `PolicyEngine` | 需要解释为什么 allow/deny/confirm |
| UI state | Ink/React Context | 需要长会话虚拟化和渲染指标 |

横向看，Gemini 可读性好，但审计能力弱于 OpenCode durable Bus 和 Codex thread events。

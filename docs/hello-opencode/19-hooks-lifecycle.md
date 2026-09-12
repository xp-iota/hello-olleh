---
layout: content
title: "Hooks 与生命周期：Effect-ts 驱动的事件流与扩展点"
---
# Hooks 与生命周期：Effect-ts 驱动的事件流与扩展点

本文分析 OpenCode 基于 Effect-ts 的生命周期管理与事件扩展机制。

**目录**

- [1. OpenCode 生命周期概览](#1-opencode-生命周期概览)
- [2. Effect-ts Layer 作为生命周期边界](#2-effect-ts-layer-作为生命周期边界)
- [3. Bus 事件系统](#3-bus-事件系统)
- [4. 工具调用生命周期 Hook](#4-工具调用生命周期-hook)
- [5. 与 Claude Code Hooks 的对比](#5-与-claude-code-hooks-的对比)

---

## 1. OpenCode 生命周期概览

```
进程启动
  → Effect.runMain() 启动运行时
  → Server 初始化（HTTP/WebSocket）
  → Workspace 加载（项目目录扫描）
  → 等待客户端连接（CLI/TUI/Web）
      → 收到 Session.prompt() 请求
          → Session Loop 启动
              → 历史回放 → LLM 请求
              → StreamProcessor 处理事件流
              → Tool 执行 → Durable 写回
              → Bus 广播 → 前端更新
          → Session 完成
  → 等待下一个请求
```

## 2. Effect-ts Layer 作为生命周期边界

OpenCode 用 Effect-ts 的 `Layer` 系统管理资源生命周期，每个 Layer 有明确的 acquire/release：

```typescript
// src/session/index.ts
const SessionLayer = Layer.scoped(
  Session,
  Effect.gen(function* () {
    const db = yield* Database;
    const bus = yield* Bus;
    
    // acquire：初始化会话资源
    const session = yield* createSession(db);
    
    // 注册 finalizer（release）
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* session.flush();          // 确保写回完成
        yield* bus.publish({ type: 'session_ended', id: session.id });
      })
    );
    
    return session;
  })
);
```

## 3. Bus 事件系统

`Bus` 是 OpenCode 的核心事件总线，驱动前端投影和 Hook 触发：

```typescript
// src/bus/index.ts
type BusEvent =
  | { type: 'message.part'; sessionId: string; content: string }
  | { type: 'tool.start'; toolId: string; name: string }
  | { type: 'tool.complete'; toolId: string; result: unknown }
  | { type: 'session.complete'; sessionId: string; usage: Usage }
  | { type: 'error'; code: string; message: string };

// 订阅所有工具调用事件
Bus.subscribe('tool.*', (event) => auditLog.record(event));
```

## 4. 工具调用生命周期 Hook

```typescript
// src/tool/index.ts
const executeWithHooks = (tool: Tool, input: unknown) =>
  Effect.gen(function* () {
    yield* Bus.publish({ type: 'tool.start', toolId, name: tool.name });
    
    const result = yield* tool.execute(input).pipe(
      Effect.timeout(tool.timeout ?? Duration.seconds(60)),
      Effect.retry(tool.retryPolicy),
    );
    
    yield* Bus.publish({ type: 'tool.complete', toolId, result });
    yield* Database.saveToolResult(toolId, result);  // Durable 写回
    
    return result;
  });
```

## 5. 与 Claude Code Hooks 的对比

| 特性 | OpenCode | Claude Code |
| :------| :---------| :-------------|
| **Hook 机制** | Effect-ts Layer + Bus 事件 | settings.json hooks（Shell 命令）|
| **生命周期管理** | Effect.addFinalizer（编译期安全）| 进程信号处理 |
| **事件总线** | Bus（类型化）| 无独立总线 |
| **用户可配置** | 无 Shell Hook | ✅ 配置驱动 |
| **错误传播** | Effect 类型安全传播 | Shell 退出码 |

OpenCode 的生命周期完全由 Effect-ts 类型系统保证，资源泄漏在编译期即可发现；Claude Code 的 Hooks 则面向用户配置，更易扩展但运行时保证较弱。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Effect.Service` | Effect-ts | 声明式服务定义，类型系统保证 service 在 scope 内有效 |
| `Bus.subscribe()` | — | 订阅 instance 内 typed 事件，绑定生命周期到当前 scope |
| `GlobalBus.subscribe()` | — | 订阅全局 typed 事件，跨 instance 协调 |
| `Plugin.trigger('tool.execute.before')` | `plugin/index.ts` | 工具执行前 hook：插件改写 tool args |
| `Plugin.trigger('tool.execute.after')` | `plugin/index.ts` | 工具执行后 hook：插件改写 tool output/metadata |
| `Permission.check()` | `session/index.ts` | 工具调用审批门控：返回 allow/deny/pending_user |

---

## 代码质量评估

**优点**

- **Effect-ts Layer 作为声明式生命周期边界**：Service 的获取、使用、释放由类型系统管理，不需要手写 try/finally 清理，生命周期泄漏在编译期可发现。
- **Bus 强类型事件**：`BusEvent` 联合类型保证事件发布和订阅之间的类型一致，新增事件类型时编译器会提示所有未处理的消费者。
- **Plugin hook 覆盖工具执行全周期**：`tool.execute.before/after` hook 让第三方 plugin 可以透明地修改工具行为，而不需要 fork 工具实现。

**风险与改进点**

- **Effect-ts 学习曲线陡峭**：`Layer/Effect/Scope` 的心智模型与传统 OOP 差异大，贡献者上手成本高，生命周期 debug 信息可读性差。
- **生命周期 hook 无标准顺序文档**：`InstanceBootstrap()` 中各 service 的注册顺序隐式决定了生命周期启动/关闭顺序，无公开的依赖图文档。
- **Bus 事件无优先级**：订阅者接收同一事件的顺序依赖注册顺序，若两个 subscriber 修改同一状态，后注册者静默覆盖前者，无冲突检测。

## 横向对齐补强：OpenCode 生命周期由 Effect Layer 和 Bus 共同表达

OpenCode 的 lifecycle 不只是 plugin hook。Effect-ts Layer/Scope 决定服务启动和释放，Bus 决定运行时事件传播。

| 生命周期面 | 说明 |
| --- | --- |
| Effect Layer | service dependency 和资源生命周期 |
| InstanceBootstrap | workspace/session 级装配 |
| Plugin trigger | 运行时扩展 hook |
| Bus event | 状态投影和订阅 |

横向看，OpenCode lifecycle 最工程化，但学习曲线最高；维护时要把依赖图和关闭顺序一起保留。

## 依赖图与关闭顺序

```mermaid
flowchart TD
    Instance[InstanceBootstrap] --> Layer[Effect Layer / Scope]
    Layer --> Services[Agent / Permission / Plugin / MCP / LSP / FileWatcher]
    Services --> Bus[Bus events]
    Services --> Session[Session runtime]
    ConfigChange[config change / workspace close] --> Dispose[Instance.dispose / disposeAll]
    Dispose --> Scoped[ScopedCache invalidate / registered disposers]
    Scoped --> Shutdown[LSP shutdown / watcher close / MCP cleanup]
```

| 生命周期点 | 源码锚点 | 说明 |
| --- | --- | --- |
| Runtime layer | `sources/opencode/packages/opencode/src/effect/run-service.ts:4` | 全局 memo map 让 service layer 可复用 |
| Instance scoped cache | `sources/opencode/packages/opencode/src/effect/instance-state.ts:17` | workspace/directory 维度缓存 service state |
| Disposer registry | `sources/opencode/packages/opencode/src/effect/instance-registry.ts:3`, `sources/opencode/packages/opencode/src/effect/instance-registry.ts:10` | 注册并批量释放 instance 相关资源 |
| Config dispose | `sources/opencode/packages/opencode/src/config/config.ts:723`, `sources/opencode/packages/opencode/src/config/config.ts:728` | 配置变化或退出时触发 instance 清理 |
| LSP shutdown | `sources/opencode/packages/opencode/src/lsp/lsp.ts:219`, `sources/opencode/packages/opencode/src/lsp/client.ts:239` | language server 是显式 shutdown 的外部资源 |
| Plugin trigger | `sources/opencode/packages/opencode/src/plugin/index.ts:164` | 运行时 hook 通过 plugin service 分发 |

关闭顺序的关键是先让 Instance/Scope 失效，再释放 scoped service 与外部进程/连接。Bus 事件负责通知状态变化，但不应该承担资源释放本身。

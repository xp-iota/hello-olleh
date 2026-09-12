---
layout: content
title: "REPL 与交互层：多表面入口与统一 Server Contract"
---
# REPL 与交互层：多表面入口与统一 Server Contract

本文分析 OpenCode 的交互层设计，包括多表面（CLI/TUI/Web/Desktop）共享同一 Server 协议的架构，以及用户输入处理流程。

**目录**

- [1. 多表面架构](#1-多表面架构)
- [2. Server Contract](#2-server-contract)
- [3. TUI 模式](#3-tui-模式)
- [4. Web UI](#4-web-ui)
- [5. 非交互（CLI）模式](#5-非交互cli模式)
- [6. 与其他系统的对比](#6-与其他系统的对比)

---

## 1. 多表面架构

OpenCode 是四个系统中交互层最丰富的：

```
用户界面
  ├── CLI（命令行，非交互）
  ├── TUI（终端 UI，Bun + 自定义渲染）
  ├── Web UI（浏览器，React）
  └── Desktop App（Tauri 封装）
         │
         │ 统一协议（HTTP SSE + WebSocket）
         ▼
    OpenCode Server（src/server/）
         │
         ▼
    Session Loop（src/session/）
```

所有表面连接到同一个 OpenCode Server，无论是本地 TUI 还是远程 Web UI，都通过相同的 API 协议交互。

## 2. Server Contract

```typescript
// src/server/routes.ts
// 核心 API 路由
POST /session                    → 创建新会话
POST /session/:id/prompt         → 发送用户消息
GET  /session/:id/events         → SSE 事件流（流式输出）
GET  /session/:id                → 获取会话状态
POST /session/:id/abort          → 中断当前执行
GET  /workspace                  → 获取工作区信息
```

## 3. TUI 模式

OpenCode TUI 是基于 Bun 的自定义终端渲染器：

```typescript
// src/tui/index.ts
const tui = new TUI({
  onInput: async (input) => {
    await fetch(`/session/${sessionId}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ content: input }),
    });
  },
  onEvent: (event) => {
    switch (event.type) {
      case 'message.part': tui.appendContent(event.content); break;
      case 'tool.start': tui.showToolIndicator(event.name); break;
      case 'session.complete': tui.showComplete(event.usage); break;
    }
  },
});

// 连接 SSE 流
const es = new EventSource(`/session/${sessionId}/events`);
es.onmessage = (e) => tui.onEvent(JSON.parse(e.data));
```

## 4. Web UI

Web UI 使用 React，通过相同的 SSE API 接收流式事件：

```typescript
// web/src/hooks/useSession.ts
function useSession(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  
  useEffect(() => {
    const es = new EventSource(`/session/${sessionId}/events`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'message.part') {
        setMessages(prev => appendToLast(prev, event.content));
      }
    };
    return () => es.close();
  }, [sessionId]);
  
  return messages;
}
```

## 5. 非交互（CLI）模式

```bash
# 直接执行并等待结果
opencode run "修复 src/ 目录下的所有 TypeScript 错误"

# 管道输入
cat error.log | opencode run "分析这些错误并给出修复方案"
```

## 6. 与其他系统的对比

| 特性 | OpenCode | Claude Code | Codex | Gemini CLI |
| :------| :---------| :-------------| :-------| :-----------|
| **UI 框架** | 自定义 TUI + React Web | Ink | ratatui | Ink |
| **多表面** | ✅（CLI/TUI/Web/Desktop）| ❌（仅 TUI）| ❌（仅 TUI）| ❌（仅 TUI）|
| **统一协议** | HTTP SSE | 无（内嵌）| app-server-protocol | 无（内嵌）|
| **远程访问** | ✅（Web UI）| ❌ | 部分 | ❌ |

OpenCode 的多表面架构是四个系统中最开放的，Server 协议使得任意客户端（甚至第三方）都能接入。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `TuiTransport` | `cli/` | TUI 模式 transport：本地 Ink UI + Bun HTTP server 通信 |
| `HttpTransport` | `cli/` | HTTP 模式 transport：远端附加或 headless API 客户端 |
| `Server.start()` | `server/server.ts` | 统一 Bun HTTP server：所有 surface 的服务端 |
| `ui.tsx` | `cli/` | Ink TUI 主组件入口：渲染 session 状态和工具执行进度 |
| `nonInteractive()` | `cli/cmd/run.ts` | Headless/pipe 模式：stdin/args 驱动，不启动 TUI |
| `Bus.subscribe()` (UI side) | — | 前端 SSE 订阅反代：将 server Bus 事件推送到 TUI 组件状态 |

---

## 代码质量评估

**优点**

- **多 surface 共享同一 server 和 durable history**：TUI/Web/ACP 不各自维护状态，统一从 durable history 读数据，表面切换不丢状态。
- **`attach` 命令支持远端 TUI**：在远端机器上运行 server 后，本地 attach 打开 TUI，开发体验接近本地运行。
- **Headless 模式通过 HTTP client 接入，非特殊路径**：非交互模式复用与 TUI 相同的 SSE event 流，无"静默模式"特例代码。

**风险与改进点**

- **TUI 与 server 的通信无认证**：本地 TUI 通过 HTTP 与同进程 server 通信，若端口绑定到 `0.0.0.0`，外部可直接访问 session API，存在安全风险。
- **Web UI 无官方构建产物**：Web UI 需要独立构建，CLI 分发包默认不包含前端资源，普通用户无法直接使用 Web surface，DX 受限。
- **attach 模式无 session 选择 UI**：attach 命令连接到 server 后自动选择最新 session，不能在 TUI 内切换到其他正在运行的 session。

## 横向对齐补强：OpenCode REPL 是 server state 的客户端

OpenCode 的 TUI/REPL 不应被理解成 agent runtime 本体。真正的状态中心是 server + SQLite durable history + Bus/SSE。

| 状态面 | OpenCode 侧含义 | 横向对比 |
| --- | --- | --- |
| TUI | server contract consumer | 不像 Claude React state 那样深耦合 |
| Server | prompt/command/session route | OpenCode 中心 |
| Durable DB | message/part 真相 | 强于 Gemini 文件会话 |
| Bus/SSE | 多端状态投影 | 对应 Codex event protocol |

## TUI 操作到 server route / Bus / durable row

| 操作类型 | server route / 事件 | durable 影响 |
| --- | --- | --- |
| 追加 prompt | `sources/opencode/packages/opencode/src/server/routes/instance/tui.ts:100` 发布 `TuiEvent.PromptAppend` | 后续进入 `session.prompt()` 后先写 user message |
| 执行命令 | `sources/opencode/packages/opencode/src/server/routes/instance/tui.ts:122` 等发布 `TuiEvent.CommandExecute` | command 若编译成 prompt，会进入 message/part history |
| 选择 session | `sources/opencode/packages/opencode/src/server/routes/instance/tui.ts:374` 发布 `TuiEvent.SessionSelect` | 只改变 UI 所选 session，不直接写 message |
| 查询状态 | `sources/opencode/packages/opencode/src/server/routes/instance/session.ts:77` 暴露 `session.status` | 返回 `SessionStatus` 运行态，不是 durable message |
| prompt 执行 | `sources/opencode/packages/opencode/src/session/prompt.ts:299` 设置 busy | 进入 loop 后通过 `MessageV2.stream()` 读 durable history |
| assistant 写回 | `sources/opencode/packages/opencode/src/session/prompt.ts:359` 创建 assistant message | 后续 processor 持续写 part |

因此，OpenCode 的 REPL 状态要分成三层：TUI route 只表达用户动作，Bus event 是跨前端投影，SQLite durable row 才是 resume 的事实源。不是所有 TUI 操作都会写 durable row。

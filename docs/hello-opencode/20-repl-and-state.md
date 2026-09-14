---
title: "REPL 与状态：Solid TUI 的装配与事件驱动渲染"
---
# REPL 与状态：Solid TUI 的装配与事件驱动渲染

> 基于 `sources/opencode/packages/tui/` 与 `packages/cli/src/run/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. TUI 是一个瘦宿主](#1-tui-是一个瘦宿主)
- [2. 装配根与 context provider 树](#2-装配根与-context-provider-树)
- [3. 输入到渲染的链路](#3-输入到渲染的链路)
- [4. mini 模式](#4-mini-模式)
- [5. 状态来源：事件而非轮询](#5-状态来源事件而非轮询)

---

## 1. TUI 是一个瘦宿主

`packages/tui` 基于 `@opentui/solid`（SolidJS 的终端渲染器）与 `@opentui/core` 的 `CliRenderer`。TUI 不执行 agent 逻辑：它经 `@opencode/client` 连接 server（默认后台 service，`--standalone`/`--server` 改变连接目标），把用户输入转成协议操作，把事件流转成界面状态。

## 2. 装配根与 context provider 树

`tui/src/app.tsx` 的装配顺序展示了宿主骨架：

- 渲染基础设施：`render` / `useRenderer` / `useTerminalDimensions`（@opentui/solid）、`createCliRenderer`、`registerOpencodeSpinner`；
- client 注入：`@opencode/client` 的 `OpenCode`、`Service`（`@opencode/client/effect/service`）；
- context provider 树：`ClipboardProvider`、`LogProvider`（`LogSink`）、`ExitProvider`、`EpilogueProvider`、`RouteProvider`（`useRoute`），配合 Solid 的 `createEffect` / `createMemo` / `createSignal` / `ErrorBoundary` 组织响应式状态；
- 平台差异以变体文件承载：`attention-sounds.bun.ts` / `.node.ts`、`editor-zed-sqlite.bun.ts` / `.node.ts`。

目录划分上：`component/` 是组件库，`prompt/` 是输入区，`routes/` 是路由页，`context/` 是 provider 集合，`feature-plugins/` 承载 TUI 侧插件特性，`devtools/` 是调试视图，`mini/` 是迷你模式。

## 3. 输入到渲染的链路

```text
键盘输入 -> prompt/ 组件 -> @opencode/client 的协议操作（prompt/steer/queue、命令）
  -> server/Core 处理并发布事件
    -> 事件馈送（SSE）-> client shared-events -> TUI 状态更新 -> Solid 重渲染
```

`editor.ts` / `editor-zed*.ts` 处理外置编辑器集成；`clipboard.ts`、`attention.ts`/`attention-sounds.*` 处理系统交互点。

## 4. mini 模式

`packages/tui/src/mini/` 与 CLI 的 `mini` 命令（`cli/src/mini-host.ts`、`mini.ts`）提供裁剪宿主：共享同一 client 与事件流，但渲染面更小，适合嵌入与低带宽终端。

## 5. 状态来源：事件而非轮询

TUI 的状态更新完全由事件驱动：全局跨 Location 的事件馈送携带 location 元数据，TUI 用它同时更新多个 Location 的状态（这正是事件馈送 endpoint 故意不做请求级 Location 过滤的原因，见 [07-error-security.md](./07-error-security.md) §4）。会话内容本身读权威 projection；实时增量（text/reasoning delta）来自 live 事件流——两层分离使 TUI 既能瞬时渲染流式 token，又能在重连后从 durable projection 重建一致视图。

## 源码锚点

- [`sources/opencode/packages/tui/src/app.tsx`](../../sources/opencode/packages/tui/src/app.tsx)：装配根
- [`sources/opencode/packages/tui/src/`](../../sources/opencode/packages/tui/src)：component / prompt / routes / context / mini
- [`sources/opencode/packages/cli/src/run/ui.ts`](../../sources/opencode/packages/cli/src/run/ui.ts)：交互模式启动
- [`sources/opencode/packages/session-ui/`](../../sources/opencode/packages/session-ui)：可复用会话 UI 包

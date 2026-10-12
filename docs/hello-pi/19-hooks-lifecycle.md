---
title: "Hooks 生命周期：扩展事件即 hooks"
---
# Hooks 生命周期：扩展事件即 hooks

> 基于 `sources/pi/packages/coding-agent/src/core/extensions/`（types.ts / runner.ts / loader.ts）与 `packages/agent/src/` 校对（pi `v1.1.0`）。

**目录**

- [1. pi 没有独立的 hooks 概念](#1-pi-没有独立的-hooks-概念)
- [2. pi.on 全事件清单](#2-pion-全事件清单)
- [3. 带返回值的事件即审批门](#3-带返回值的事件即审批门)
- [4. ExtensionRunner 的 emit 链](#4-extensionrunner-的-emit-链)
- [5. 与 Claude Code hooks 的对照](#5-与-claude-code-hooks-的对照)

---

## 1. pi 没有独立的 hooks 概念

pi 代码树里没有 "hooks" 配置文件、没有 hook 注册表；`hooks` 一词只出现在注释里（如 `nested-tool-calls.ts` 描述工具管线的 hook 点）。与 Claude Code 把 hooks 作为 settings.json 里的声明式配置不同，pi 的对应物是**扩展事件**：扩展是一个 default-export 工厂函数，拿到 `ExtensionAPI` 后用 `pi.on(event, handler)` 订阅事件（`core/extensions/types.ts:1569-1636` 的重载清单），事件既用于观察，也用于拦截。

内核层另有一组**进程内回调**：pi-agent-core 的 `AgentLoopConfig`（`packages/agent/src/types.ts`）暴露 `beforeToolCall` / `afterToolCall` / `prepareNextTurn` / `prepareRequest` / `finishTurn` / `transformContext`。coding-agent 的 `AgentSession` 把扩展事件接到这些回调上，扩展因此能覆盖整个 agent loop。

## 2. pi.on 全事件清单

按生命周期分组（完整 `on()` 重载见 `types.ts:1569-1636`，`ExtensionEvent` union 在 `:1377-1416`）：

| 分组 | 事件 |
| --- | --- |
| 会话生命周期 | `session_start`、`session_shutdown`、`session_info_changed`、`session_before_switch` / `session_before_fork` / `session_before_compact` / `session_before_tree`、`session_compact`、`session_compact_failed`、`session_tree` |
| agent 回合 | `before_agent_start`、`agent_start`、`agent_end`、`agent_before_settle`、`agent_settled`、`turn_start`、`turn_end` |
| 消息 | `message_start`、`message_update`、`message_end` |
| 工具执行 | `tool_execution_start`、`tool_execution_update`、`tool_execution_end` |
| 工具审批 | `tool_call`、`tool_result` |
| 请求层 | `context`、`context_with_system`、`cache_warming_decision`、`before_provider_request`、`before_provider_headers`、`after_provider_response`、`provider_stream_event` |
| UI 与输入 | `ui_prompt_start`、`ui_prompt_end`、`model_select`、`thinking_level_select`、`user_bash`、`input` |
| 资源与其他 | `project_trust`、`resources_discover`、`mcp_servers_change` |

## 3. 带返回值的事件即审批门

多数事件 handler 返回 `void`（纯观察），但一批事件的 handler 返回 typed result，构成拦截/审批门：

- `tool_call` → `ToolCallEventResult`（`types.ts:1426`）：可以 block 该工具调用并给出原因；
- `tool_result` → `ToolResultEventResult`：可逐字段改写结果（content / details / isError / terminate）；
- `user_bash` → `UserBashEventResult`（`:1438`）：拦截用户 `!` shell 命令；
- `input` → `InputEventResult`（`:1156`）：拦截并可 redirect 终端输入（见 [23-input-command-queue.md](./23-input-command-queue.md) §5）;
- `context` / `context_with_system` → `ContextEventResult`：改写发往模型的上下文；
- `turn_end` / `message_end` 也可返回改写后的对象。

这比 Claude Code 的 exit-code 二值审批表达力强：同一事件既能看也能改，且类型化。

## 4. ExtensionRunner 的 emit 链

事件分发集中在 `class ExtensionRunner`（`core/extensions/runner.ts:357`）：

- 通用入口 `emit()`（`:1089`）按事件类型走注册表快照，按注册顺序 await 每个 handler；
- 专用入口有各自的 result 聚合语义：`emitToolCall()`（`:1242`）、`emitUserBash()`（`:1262`）、`emitMessageEnd()`（`:1144`）、`emitToolResult()`（`:1183`）、`emitContext()`（`:1298`）、`emitCacheWarmingDecision()`（`:1121`）、`emitBoundary()`（`:1029`，会话边界草稿/预览协商）；
- `hasHandlers(eventType)`（`:765`）让热路径在无订阅者时零成本跳过；
- `session_start` / `session_shutdown` 由 runner 统一管理（`loader.ts` 加载扩展、`jiti` 执行工厂）。

## 5. 与 Claude Code hooks 的对照

| 维度 | Claude Code | pi |
| --- | --- | --- |
| 形态 | settings.json 声明式配置（`PreToolUse` / `PostToolUse` / `SessionStart` / `Stop` 等） | 进程内扩展 + `pi.on()` 订阅 |
| 载体 | 外部 shell 命令（matcher + exit code / JSON 控制） | TypeScript 扩展函数，typed result |
| 审批 | exit code 0/2 或 JSON `permissionDecision` | `ToolCallEventResult` 等直接对象返回 |
| 分发 | CLI 每次触发点起子进程 | `ExtensionRunner.emit` 顺序 await，无子进程 |
| 热更新 | 改配置文件即生效 | `clearExtensionCache()` + `/reload` 热重载（见 [25-debugging.md](./25-debugging.md) §5） |

pi 用"扩展是一等公民"换掉了独立的 hooks 机制：任何 hooks 能做的事（拦截、审批、观察）都是某个带返回值的扩展事件。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/extensions/types.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/types.ts)：`pi.on` 事件清单与各 `*EventResult` 类型
- [`sources/pi/packages/coding-agent/src/core/extensions/runner.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/runner.ts)：`ExtensionRunner` emit 链
- [`sources/pi/packages/agent/src/types.ts`](../../sources/pi/packages/agent/src/types.ts)：`AgentLoopConfig` 内核回调（`beforeToolCall` 等）
- [`sources/pi/packages/coding-agent/src/core/extensions/loader.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/loader.ts)：扩展加载（jiti）与热重载
- [`sources/pi/packages/coding-agent/docs/extensions.md`](../../sources/pi/packages/coding-agent/docs/extensions.md)：上游扩展事件文档

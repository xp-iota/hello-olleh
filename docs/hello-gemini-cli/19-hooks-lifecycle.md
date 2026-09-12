---
layout: content
title: "Hooks 与生命周期：Gemini CLI 的事件回调与扩展点"
---
# Hooks 与生命周期：Gemini CLI 的事件回调与扩展点

这一层在当前仓库里其实分成三套机制：`HookSystem`、`coreEvents`、`MessageBus`。旧版把它们混成一个“内部事件总线”，容易把职责写乱。


**目录**

- [1. 进程主链路上的关键阶段](#1-进程主链路上的关键阶段)
- [2. HookSystem 是显式的生命周期扩展点](#2-hooksystem-是显式的生命周期扩展点)
- [3. `coreEvents` 负责全局可观察性](#3-coreevents-负责全局可观察性)
- [4. `MessageBus` 负责确认与策略闭环](#4-messagebus-负责确认与策略闭环)
- [5. 工具执行生命周期在调度器里闭合](#5-工具执行生命周期在调度器里闭合)
- [6. 关键源码锚点](#6-关键源码锚点)

---

## 1. 进程主链路上的关键阶段

按当前代码，更接近真实的主流程是：

1. CLI 入口初始化 `Config`
2. 初始化 `HookSystem`、`MessageBus`、`GeminiClient`
3. 启动交互式 TUI 或非交互式 CLI
4. 用户输入进入 `GeminiClient` 主循环
5. 主循环在模型调用前后、工具选择前后、压缩前后触发不同 hook
6. 调度器通过 `MessageBus` 处理确认与策略
7. UI 和宿主层通过 `coreEvents` 接收用户反馈、日志和状态更新

这里的关键对象已经不是旧文里写的 `GeminiAgent`，而是 `GeminiClient`、`Scheduler`、`HookSystem` 这几层协作。

## 2. HookSystem 是显式的生命周期扩展点

核心实现位于 `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts`。

它不是单文件硬编码逻辑，而是由几部分协作：

- `HookRegistry`
- `HookRunner`
- `HookAggregator`
- `HookPlanner`
- `HookEventHandler`

从 `HookSystem` 暴露的方法看，当前已经有比较完整的 hook 生命周期：

- `fireSessionStartEvent`
- `fireSessionEndEvent`
- `firePreCompressEvent`
- `fireBeforeAgentEvent`
- `fireAfterAgentEvent`
- `fireBeforeModelEvent`
- `fireAfterModelEvent`
- `fireBeforeToolSelectionEvent`
- `fireBeforeToolEvent`
- `fireAfterToolEvent`
- `fireToolNotificationEvent`

这说明 Gemini CLI 并不是“没有 hook，只能靠 MCP 间接扩展”，而是已经有一套正式的 hook 执行框架。

## 3. `coreEvents` 负责全局可观察性

`sources/gemini-cli/packages/core/src/utils/events.ts` 里的 `coreEvents` 更像全局事件汇聚点，主要服务于 UI、日志和宿主反馈。

当前 `CoreEvent` 至少包括：

- `UserFeedback`
- `ModelChanged`
- `ConsoleLog`
- `Output`
- `MemoryChanged`
- `McpClientUpdate`
- `HookStart`
- `HookEnd`
- `AgentsRefreshed`
- `RetryAttempt`
- `ConsentRequest`
- `McpProgress`
- `QuotaChanged`

因此，`coreEvents` 的职责重点是“广播状态变化给宿主层”，而不是承担工具确认或策略决策。

## 4. `MessageBus` 负责确认与策略闭环

工具确认和策略检查走的是另一条线：`sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts`。

`MessageBus` 的特点是：

- 发布工具确认请求
- 在发布时就调用 `PolicyEngine.check(...)`
- 根据策略结果直接放行、拒绝或转交 UI 询问用户
- 支持 request/response 模式
- 支持 `derive(subagentName)`，为子代理生成作用域化消息总线

所以它更像“工具确认总线”，而不是通用 UI event bus。

## 5. 工具执行生命周期在调度器里闭合

旧文里把 `ToolExecutor` 写在 `tools` 目录下已经不对。当前真实位置是：

- `sources/gemini-cli/packages/core/src/scheduler/tool-executor.ts`
- `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts`

调度器负责：

- 工具选择后的实际执行
- 确认与审批
- 和 hook system / message bus 的衔接
- 在需要时更新 UI 状态

因此，“工具前后生命周期”这件事并不是单靠 `ToolExecutor` 一个类完成，而是 `Scheduler + ToolExecutor + HookSystem + MessageBus` 一起闭合。

## 6. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| Hook 总入口 | `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts` | 统一暴露生命周期 hook |
| Hook 事件处理 | `sources/gemini-cli/packages/core/src/hooks/hookEventHandler.ts` | 各类 hook 的具体分发 |
| 全局事件总线 | `sources/gemini-cli/packages/core/src/utils/events.ts` | UI / 宿主侧状态广播 |
| 工具确认总线 | `sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts` | 策略检查、确认请求、子代理作用域 |
| 调度器 | `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts` | 工具执行主编排 |
| 工具执行器 | `sources/gemini-cli/packages/core/src/scheduler/tool-executor.ts` | 单次工具调用执行 |

---

## 代码质量评估

**优点**

- **`HookSystem` 显式生命周期钩子**：不依赖 EventEmitter 的匿名监听，钩子通过命名函数注册，位置可追踪，副作用可预测。
- **`coreEvents` 全局可观测**：将 `beforeToolCall`/`afterToolCall` 等关键事件作为可订阅流暴露，外部监控工具无需侵入核心代码。
- **`MessageBus` 将审批决策与执行解耦**：工具是否执行的决策通过 MessageBus 事件传播，而不是函数返回值，Scheduler 无需直接持有 UI 状态。

**风险与改进点**

- **Hook 执行顺序依赖注册顺序**：多个 hook 监听同一阶段时，执行顺序由注册时序决定，无显式优先级控制，重构时容易引入顺序敏感 bug。
- **生命周期事件无完整文档态**：哪些 hook 属于"稳定 API"、哪些是"内部实现细节"没有明确界定，extension 开发者可能依赖不稳定 hook 点。
- **`coreEvents` 无背压保护**：若事件消费者处理慢，事件可能在内存中积压，高频工具调用场景（如多工具并发）存在性能风险。

## 横向对齐补强：Gemini Hooks 更像事件总线

Gemini CLI 的 hooks/lifecycle 应按 core events、Scheduler events、UI hook 和 extension lifecycle 分层，而不是寻找单一 plugin hook runtime。

| 事件面 | 说明 |
| --- | --- |
| coreEvents | core 层事件广播 |
| Scheduler | tool call 生命周期 |
| UI hooks | stream/input/render 状态 |
| Extension | 启动时装配，热更新弱 |

横向看，Gemini lifecycle 比 OpenCode plugin hook 更轻，比 Claude hooks 更分散；本章把稳定 API 与内部事件边界拆开写，避免 extension 开发者依赖不稳定实现细节。

## 稳定面与内部事件边界

Gemini CLI 的生命周期事件至少分成三层，不能混写：

| 层级 | 源码锚点 | 稳定性判断 | 用途 |
| --- | --- | --- | --- |
| HookSystem | `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:151` | 最接近稳定扩展 API | session、agent、model、tool 前后事件 |
| MessageBus | `sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79` | 运行时内部治理面 | tool confirmation、PolicyEngine 决策、request/response |
| coreEvents | `sources/gemini-cli/packages/core/src/utils/events.ts:249` | 宿主可观察事件面 | UI、日志、状态广播 |
| ExtensionLoader | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:129` | 装配/重载控制面 | extension 变更后刷新 hooks |

### HookSystem 的关键生命周期

| Hook | 源码锚点 | 说明 |
| --- | --- | --- |
| Session start/end | `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:222`, `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:229` | 进程/会话边界 |
| Before/after agent | `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:241`, `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:248` | agent turn 边界 |
| Before/after model | `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:261`, `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:310` | 模型请求边界 |
| Before/after tool | `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:382`, `sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:402` | 工具执行边界 |

### MessageBus 不是普通事件总线

`MessageBus` 在 `sources/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:101-121` 直接处理 `ALLOW`、`DENY`、`ASK_USER` 三类 policy decision；`derive()`（`message-bus.ts:51`）还能为 subagent 派生作用域化 bus。因此它的核心职责是确认和策略闭环，不是 UI 通知。

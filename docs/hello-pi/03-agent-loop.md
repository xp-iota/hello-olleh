---
title: "Agent 循环：两层设计与事件流"
---
# Agent 循环：两层设计与事件流

> 基于 `sources/pi/packages/agent/src/`（pi-agent-core）与 `sources/pi/packages/ai/src/`（pi-ai）的 pi v1.1.0 源码校对。

**目录**

- [1. 两层设计：Agent 与 runAgentLoop](#1-两层设计agent-与-runagentloop)
- [2. 一次 run 的完整调用链](#2-一次-run-的完整调用链)
- [3. steer 与 followUp 的语义差异](#3-steer-与-followup-的语义差异)
- [4. 事件流 AgentEvent](#4-事件流-agentevent)
- [5. pi-ai 的请求路径与成本计算](#5-pi-ai-的请求路径与成本计算)

---

## 1. 两层设计：Agent 与 runAgentLoop

pi-agent-core 只有 6 个源文件，对 provider 目录零依赖，LLM 调用是注入的 `StreamFn`（`packages/agent/src/stream-fn.ts`）：

- **`Agent` 类**（`agent.ts:188`）：有状态包装层。持有 `MutableAgentState` 转录本（`createMutableAgentState`，`agent.ts:82`），用 pi-ai 的 `createInitialSystemMessage` 播种系统消息（`agent.ts:85`），对外暴露 `prompt()`（`:373`）/ `continue()` / `steer()`（`:299`）/ `followUp()`（`:304`）/ `abort()`（`:341`）。
- **`runAgentLoop`**（`agent-loop.ts:102`）及其内部 `runLoop`（`:163`）：低层循环，操作 `AgentMessage[]`。到 LLM 边界才经 `convertToLlm`（`types.ts:222`）转成 `Message[]`；`AgentMessage` 可通过 declaration merging 扩展（`types.ts:384` 附近）。

`createLoopConfig`（`agent.ts:467-505`）组装 `AgentLoopConfig`（`types.ts:193`）：model、reasoning、`beforeToolCall`/`afterToolCall`/`finishTurn`/`prepareRequest`/`prepareNextTurn` 钩子、`transformContext`/`convertToLlm`，以及背靠两个 `PendingMessageQueue` 的 `getSteeringMessages`/`getFollowUpMessages`（队列抽取模式 `QueueMode = "all" | "one-at-a-time"`，`types.ts:55`）。

## 2. 一次 run 的完整调用链

1. `Agent.prompt()` → `runWithLifecycle`（`agent.ts:507`）创建 `AbortController`、置 `isStreaming`，包裹 `runAgentLoop(...)`。
2. `runAgentLoop` 发出 `agent_start`/`turn_start`；`declareToolChanges`（`agent-loop.ts:333`）对比转录本与 `context.tools` 的工具集差异，插入/修补系统消息，让模型始终知道当前工具集。
3. `runLoop` 每轮迭代：`prepareNextTurn` 钩子可换 context/model/思考等级并注入消息（`:186-208`，长准备期间还会补抽 steering，`:204`）；`prepareRequest` 钩子在请求前最后一刻更新运行态（`:219`）。
4. **LLM 调用** `streamAssistantResponse`（`:381`）：先施加 `transformContext`（应用层注入的修剪钩子，`types.ts:244`），再 `convertToLlm` + pi-ai `normalizeContext`，经 `getApiKey` 取新 key，调 `streamFunction(model, llmContext, options)`（`:403`）。消费 `AssistantMessageEventStream`：`start` → 部分消息入转录并 `message_start`；每个 `text_*`/`thinking_*`/`toolcall_*` 事件更新部分消息并 `message_update`；`done`/`error` 定稿并 `message_end`（`:414-468`）。
5. 若 `stopReason` 为 `error`/`aborted` 直接 `turn_end` + `agent_end` 短路（`:245-255`）；若 `stopReason === "length"`（输出截断），所有 tool call 不执行，改由 `failToolCallsFromTruncatedMessage`（`:478`）以错误结果回喂（`:268-269`）。
6. `executeToolCalls`（`:508`）执行工具（见 [05-tool-system.md](./05-tool-system.md)）；`finishTurn` 钩子（`:286`）可 `{action:"end"}` 或 `{action:"continue"}`。
7. 循环条件 `hasMoreToolCalls || pendingMessages`（steering 在 `:295` 补抽）；内层停下后抽 followUp（`:302`），最后 `agent_end`（`:320`）。

## 3. steer 与 followUp 的语义差异

| | `steer()`（`agent.ts:299`） | `followUp()`（`agent.ts:304`） |
| --- | --- | --- |
| 注入时机 | 轮与轮之间（工具执行完、下一次请求前，`agent-loop.ts:295`） | 仅当 agent 本会停下时（`agent-loop.ts:302`） |
| 对工具调用 | 不跳过正在执行的工具 | 不打断收尾 |
| 典型用途 | 用户中途纠偏、补充指令 | 追加连续任务 |

## 4. 事件流 AgentEvent

`AgentEvent` 联合（`types.ts:516-539`）：`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_start/update/end`（end 携带 `durationMs`，用单调时钟计时）。监听器经 `Agent.subscribe`（`agent.ts:266`）注册、按序 await；`agent_end` 的落定门控 `waitForIdle`（`agent.ts:350`）。`processEvents`（`agent.ts:565`）把事件归约进状态：`message_end` 推入 assistant 消息、维护 `pendingToolCalls` 集合与 `streamingMessage`。`reset()`（`:355`）只保留可重放的系统基线。

## 5. pi-ai 的请求路径与成本计算

`StreamFn` 的默认实现是 pi-ai 的 `Models.streamSimple`：

1. `ModelsImpl.streamSimple(model, context, options)`（`packages/ai/src/models.ts:901`）→ `normalizeContext`（`utils/transcript.ts:30`）把转录本折叠为 `TranscriptContext`；流同步返回，auth 解析异步进行（`api/lazy.ts` 的 `lazyStream`）。
2. `applyAuth`（`models.ts:843`）经 `resolveProviderAuth` 解析 API key/OAuth，合并请求头、`transformHeaders`、修补 `baseUrl`。
3. provider 由 `createProvider` 构建，按 `model.api` 分派（`apiFor`/`dispatch`，`models.ts:1070-1072`）。`KnownApi`（`types.ts:17`）是分派键——anthropic-messages、openai-completions、openai-responses、google-generative-ai、bedrock-converse-stream、mistral-conversations、pi-messages 等——按 **API 协议**而非厂商划分。
4. adapter（如 `api/anthropic-messages.ts:571` 的 `stream`）折叠/保留会话中系统消息、转换消息与工具、流式消费 SSE、映射 stop reason，把归一化的 `AssistantMessageEvent` 推进 `AssistantMessageEventStream`（`utils/event-stream.ts:97`）。
5. **成本**：每个 adapter 在每次响应上调 `calculateCost(model, usage)`（`models.ts:1200`），按每百万 token 费率与阶梯定价（`ModelCost.tiers`）计算，连同 `Usage` 嵌入 `AssistantMessage`。跨 provider 换模型时的转录本安全由 `api/transform-messages.ts` 保证（降级图片、按模型保留/丢弃 thinking 签名、补齐孤儿 tool result）。

## 源码锚点

- [`sources/pi/packages/agent/src/agent.ts`](../../sources/pi/packages/agent/src/agent.ts)：Agent 类、runWithLifecycle、steer/followUp 队列
- [`sources/pi/packages/agent/src/agent-loop.ts`](../../sources/pi/packages/agent/src/agent-loop.ts)：runAgentLoop、runLoop、executeToolCalls
- [`sources/pi/packages/agent/src/types.ts`](../../sources/pi/packages/agent/src/types.ts)：AgentLoopConfig、AgentTool、AgentEvent
- [`sources/pi/packages/ai/src/models.ts`](../../sources/pi/packages/ai/src/models.ts)：streamSimple、applyAuth、calculateCost、provider dispatch
- [`sources/pi/packages/ai/src/utils/transcript.ts`](../../sources/pi/packages/ai/src/utils/transcript.ts)：normalizeContext 与系统消息重放语义
- [`sources/pi/packages/ai/src/api/anthropic-messages.ts`](../../sources/pi/packages/ai/src/api/anthropic-messages.ts)：adapter 范例

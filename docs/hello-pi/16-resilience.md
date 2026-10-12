---
title: "韧性机制：重试、溢出、截断与恢复"
---
# 韧性机制：重试、溢出、截断与恢复

> 基于 `sources/pi/` 快照（pi v1.1.0）：`packages/ai/src/utils/{overflow,retry}.ts`、`packages/agent/src/{agent,agent-loop}.ts`、`packages/ai/src/api/transform-messages.ts` 与 durable Harness 校对。

**目录**

- [1. 自动重试](#1-自动重试)
- [2. 上下文溢出检测](#2-上下文溢出检测)
- [3. 截断输出的工具调用保护](#3-截断输出的工具调用保护)
- [4. steering 与 follow-up 排队](#4-steering-与-follow-up-排队)
- [5. abort 全链路](#5-abort-全链路)
- [6. 跨模型 transcript 清洗](#6-跨模型-transcript-清洗)
- [7. durable 检查点恢复](#7-durable-检查点恢复)

---

## 1. 自动重试

判定与退避在 `packages/ai/src/utils/retry.ts`：`isRetryableAssistantError()`（:252）按错误消息判断可重试性，`retryDelayMs()`（:128）按策略计算退避延迟。coding-agent 把二者接进 `AgentSession`：出错时按 settings 的 retry 配置自动重试，事件流里可见 `auto_retry_start` / `auto_retry_end`（含 attempt / maxAttempts / delayMs / 最终错误，`src/core/agent-session.ts:221-222` 的事件定义）。用户侧可经 RPC 命令 `set_auto_retry` / `abort_retry`（`src/modes/rpc/rpc-types.ts:51-52`）运行时开关或中止重试。durable 侧的 `GenerationTask` / `CompactionTask` 复用同一套 retry 工具做检查点化的重试阶段。

## 2. 上下文溢出检测

`packages/ai/src/utils/overflow.ts` 的 `isContextOverflow()`（:137）是单一判定入口，覆盖三类溢出：

| 类型 | 机制 |
| --- | --- |
| 显式报错 | `OVERFLOW_PATTERNS`（:37 起，25 条上下）provider 专属正则——Anthropic "prompt is too long"、z.ai `1261` / `model_context_window_exceeded`、各家的 context window / token limit 变体 |
| 静默溢出 | z.ai 有时照单全收：`usage.input + cacheRead > contextWindow` 即判溢出（:152 一带） |
| 零输出截断 | Xiaomi MiMo 把输入截到恰好填满 contextWindow，然后以 `stopReason: "length"` 返回零输出——按长度停止 + 空输出识别（:116 一带） |

配套的 `isRecoverableLength()`（:179）区分"还能挽救的 length 停止"与真溢出。消费者是自动压缩：`AgentSession` 的压缩路径与 durable 的 `GenerationTask` 都在溢出时触发 compaction 而不是把错误抛给用户。

## 3. 截断输出的工具调用保护

模型输出被 max tokens 截断时，消息尾部可能悬着半个工具调用——其 arguments JSON 是坏的。`packages/agent/src/agent-loop.ts:269` 在 `stopReason === "length"` 时**不执行**任何工具调用，而是调用 `failToolCallsFromTruncatedMessage()`（:478）把每个调用标记为失败结果，并在错误文案里提示模型重新发起完整调用。这是宁可多一轮对话也不把损坏 JSON 喂给工具执行器的防御。

## 4. steering 与 follow-up 排队

代理运行中来的新消息不会丢，也不会打断当前工具批：`packages/agent/src/agent.ts` 用两个 `PendingMessageQueue`（:143，支持 `"all"` / `"one-at-a-time"` 两种排空模式）分别承接 `steer()`（:299，回合间注入、不跳过已排队的工具调用）与 `followUp()`（:304，仅当代理本要停下时才接续新回合）。循环里每个迭代点都会重新轮询这两个队列——即使在 `prepareNextTurn` 长准备期间入队的 steering 也会被捞出来，`AgentSession` 侧的 `steer()` / `followUp()` 是对它们的直通封装。

## 5. abort 全链路

`Agent.abort()` 中止当前 run 的 `AbortController`；循环在**每个阶段**检查 `signal.aborted`——流式响应、每批工具调用、每个工具的 `execute(toolCallId, params, signal, ...)` 都收到同一个 signal，工具执行器内部自行响应取消。在飞的工具被中止时产出错误结果而不是悬挂；stopReason 为 `aborted` 时 run 立即以 `turn_end` + `agent_end` 收束，不进入下一迭代。用户 Ctrl+C 的路径与此汇合（见 `docs/sessions.md` 的中断语义）。

## 6. 跨模型 transcript 清洗

`/model` 换模型（甚至换 provider）之所以能发生在对话中途，靠的是 `packages/ai/src/api/transform-messages.ts` 的 `transformMessages()`（:64）在每次请求前对 transcript 做能力降级与修补：

- 非视觉模型的会话里把图片块降级处理；
- thinking 块按 `provider + api + model` 三元组判断同源：`redacted` 加密 thinking 跨模型一律丢弃；带签名的 thinking 只在同模型保留（OpenAI 加密推理重放需要它）；跨模型时把明文 thinking 拍平成普通文本；
- 工具调用 ID 规范化，Google `thoughtSignature` 跨 provider 剥除；
- 错误/中止的 assistant 消息剔除；
- **孤儿工具调用补结果**（:175）：找不到配对 toolResult 的 toolCall 会合成一条 `"No result provided"` 的工具结果，保证任何 API 的消息形状校验都能通过。

## 7. durable 检查点恢复

以上都是进程内的韧性；durable Harness 把同一套防御升级为**跨进程崩溃恢复**：`GenerationTask` 把模型回合做成带检查点的状态机（`prepare → request → retry/poll → tools`），每个流式 partial、工具输出、队列与回合都提交到 SQLite。README 的验证场景：在工具调用中途 kill 进程，`--continue` 重启后，被打断的调用得到一条 "interrupted" 结果、回合照常收尾；`replay: "safe"` 的工具与 requestId 去重（见 [12-multi-agent.md](./12-multi-agent.md)）保证重放不重复执行。进程内机制处理"请求失败"，durable 处理"进程失败"。

## 源码锚点

- [`sources/pi/packages/ai/src/utils/overflow.ts`](../../sources/pi/packages/ai/src/utils/overflow.ts)：溢出正则库与 `isContextOverflow`
- [`sources/pi/packages/ai/src/utils/retry.ts`](../../sources/pi/packages/ai/src/utils/retry.ts)：可重试判定与退避
- [`sources/pi/packages/agent/src/agent-loop.ts`](../../sources/pi/packages/agent/src/agent-loop.ts)：截断保护、abort 检查、工具执行
- [`sources/pi/packages/ai/src/api/transform-messages.ts`](../../sources/pi/packages/ai/src/api/transform-messages.ts)：跨模型 transcript 清洗
- [`sources/pi/packages/agent/src/agent.ts`](../../sources/pi/packages/agent/src/agent.ts)：steering/follow-up 队列与 abort
- [`sources/pi/packages/coding-agent/src/experimental/durable/README.md`](../../sources/pi/packages/coding-agent/src/experimental/durable/README.md)：检查点恢复语义

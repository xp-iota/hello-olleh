---
title: "Agent 循环：嵌入式运行时与 @openclaw/agent-core"
---
# Agent 循环：嵌入式运行时与 @openclaw/agent-core

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。openclaw 的 agent 循环分两层：`packages/agent-core` 是从 pi 借来并自有的通用循环（无 provider 依赖），`src/agents/` 是 OpenClaw 的嵌入式包装——模型/harness 选择、双 lane 准入、压缩与失败恢复都在这一层。

**目录**

- [1. 从消息到 run：编排层](#1-从消息到-run编排层)
- [2. 通用循环 runAgentLoop](#2-通用循环-runagentloop)
- [3. 传输与工具边界](#3-传输与工具边界)
- [4. context engine 与 compaction](#4-context-engine-与-compaction)
- [5. System agent：OpenClaw 自己也是 agent](#5-system-agentopenclaw-自己也是-agent)

---

## 1. 从消息到 run：编排层

通道消息进入编排层的链路（接 [01-architecture.md](./01-architecture.md) 的 §3）：

```
agentCommandFromGatewayIngress      src/agents/agent-command.ts:716
 └─ runEmbeddedAgentAttempt         src/agents/command/run-embedded-attempt.ts:68
     └─ runEmbeddedAgentEntry       src/agents/embedded-agent-runner/run-entry.ts
         └─ runEmbeddedAgent        src/agents/embedded-agent-runner/run-orchestrator.ts:113
             └─ attempt             src/agents/embedded-agent-runner/run/attempt.ts
                 └─ Agent.prompt    packages/agent-core/src/agent.ts:293
```

`runEmbeddedAgent` 先做会话目标回填（sessionKey 尽早解析，issue #60552 的教训）与 run admission 断言，然后用**双 lane** 串行化：`resolveSessionLane` / `resolveGlobalLane`（`run-orchestrator.ts:181-182`）+ `enqueueSession` → `enqueueGlobal`（`:230` / `:244`）——同一会话严格串行，跨会话只受全局并发闸约束。模型与 harness 在此选定：`resolveModelCandidateChain`（`:315`）解析出含 fallback 的候选链，runtime id `openclaw` 是内建 harness，`codex` 等由插件注册，`auto` 按有效路由选择；订阅类 claude-cli 凭据的 run 还可能被改派到 CLI backend（`:261` 的 `runEmbeddedAgentViaCliBackendIfEligible`）。

## 2. 通用循环 runAgentLoop

`packages/agent-core/src/agent-loop.ts:73` 的 `runAgentLoop`（续跑走 `runAgentLoopContinue`，要求末条消息非 assistant）进入 `runLoop`（`:136`）的 `while(true)` 回合循环，每个回合：

1. 依次过 `stopIfAborted`（`:159`）——每个迭代点都查 abort，且**中止也会落一条 failure assistant 消息**（`:163-187`），防止会话后处理从悬空的 toolUse 消息上错误压缩/续跑。
2. 排空 steering 队列并注入（`commitPendingMessages`，`:189`）；用户消息会把 turn 的 taint 标记清零。
3. `streamAgentResponse`（`:265`）流式拉取 assistant 回复；期间已可执行早到的 toolCall（流内 tool plan）。
4. `stopReason === "toolUse"` 且流内没执行完的调用补一个 terminal 批（`:296-318`）；`error`/`aborted` 则不再续（`:383-386`）。
5. `prepareNextTurn`（`:388`）是宿主钩子：可换模型、换 thinking level、替换 context/systemPrompt，也可声明 `stop` 终止。
6. 回合末轮询 steering 与 `getFollowUpMessages`，都为空才 `agent_end`（`:444-452`）。

`Agent` 类（`agent.ts:293`）在此之上持 transcript、事件监听与两个 `PendingMessageQueue`：`steer()`（`:399`）在工具/模型检查点插入，`followUp()`（`:409`）只在代理本要停下时接续——与 pi 的同构设计一致，但队列 drain 模式（"all" / "one-at-a-time"）和流式 steering 配置由 OpenClaw 包装层注入。

## 3. 传输与工具边界

LLM 调用是一个可替换的 `StreamFn`（由 `AgentOptions.streamFn` / `runtime` 决定，经 `src/llm/stream.ts` 的 `streamSimple` 系落到 provider 实现）。嵌入式层在 `attempt-llm-boundary.ts:326` 包装 `agent.prompt`：把 runtime context 片段（BOOT.md、operator 指令等）绑到 transcript 中"原始那条"用户消息上，重试与压缩重建历史时不会错绑到后来的 steering 消息。工具侧有批级 admission（`packages/agent-core/src/tool-batch-admission.ts`）与 OpenClaw 的 `beforeToolCall` 审批门（见 [07-error-security.md](./07-error-security.md)）；system agent 等受限 run 用 toolsAllow 只暴露白名单工具。

## 4. context engine 与 compaction

压缩/上下文工程是插件化槽位：`src/context-engine/init.ts` 的 `ensureContextEnginesInitialized` 恒注册内建 `legacy` 引擎兜底，插件经 `api.registerContextEngine()` 追加；`src/context-engine/registry.ts` 负责注册、解析、兼容性检查与 **quarantine**（解析失败的引擎被隔离而非拖垮 run）。压缩本身带 180 秒 safety timeout（`src/agents/embedded-agent-runner/compaction-safety-timeout.ts:19`），watchdog 以 AbortSignal 为键挂在 globalThis 注册表上（`src/context-engine/compaction-watchdog.ts`）——插件包装层叠多少层，规范运行时都能续上这只表。溢出触发的压缩恢复链见 [16-resilience.md](./16-resilience.md)。

## 5. System agent：OpenClaw 自己也是 agent

`src/system-agent/` 是"跟 OpenClaw 对话改配置"的入口，但它不是旁路解释器：`agent-turn.ts:39` 起名为 `openclaw` 的 ring-zero 工具 + 同一套嵌入式循环、同一种 session transcript——注释明言 "OpenClaw is a real agent: same loop, session transcript, and tool pipeline as regular agents — restricted to the single ring-zero `openclaw` tool"。`SystemAgentChatEngine`（`src/system-agent/chat-engine.ts:68`）是传输无关的 facade，CLI 与 Gateway 表面共用，配置写操作还必须经核验过的 inference 路由（`verifiedInference`）才被放行。

## 源码锚点

- [`sources/openclaw/src/agents/embedded-agent-runner/run-orchestrator.ts`](../../sources/openclaw/src/agents/embedded-agent-runner/run-orchestrator.ts)：`runEmbeddedAgent`：双 lane、候选链、CLI 改派
- [`sources/openclaw/packages/agent-core/src/agent-loop.ts`](../../sources/openclaw/packages/agent-core/src/agent-loop.ts)：`runAgentLoop`/`runLoop`：回合循环、steering、tool 批
- [`sources/openclaw/packages/agent-core/src/agent.ts`](../../sources/openclaw/packages/agent-core/src/agent.ts)：`Agent` 状态机外壳与 steer/followUp 队列
- [`sources/openclaw/src/agents/agent-command.ts`](../../sources/openclaw/src/agents/agent-command.ts)：`agentCommandFromGatewayIngress` 等四个入口
- [`sources/openclaw/src/agents/embedded-agent-runner/run/attempt-llm-boundary.ts`](../../sources/openclaw/src/agents/embedded-agent-runner/run/attempt-llm-boundary.ts)：prompt 包装与 runtime context 绑定
- [`sources/openclaw/src/context-engine/registry.ts`](../../sources/openclaw/src/context-engine/registry.ts)：引擎注册、解析与 quarantine
- [`sources/openclaw/src/system-agent/agent-turn.ts`](../../sources/openclaw/src/system-agent/agent-turn.ts)：ring-zero `openclaw` 工具的受限 agent 回合
- [`sources/openclaw/docs/agent-runtime-architecture.md`](../../sources/openclaw/docs/agent-runtime-architecture.md)：runtime 布局与 harness 选择官方文档

---
title: "Agent Loop 闭环拓扑对比"
---
<!-- markdownlint-disable MD060, MD024 -->

# Agent Loop 闭环拓扑对比

这篇是 `hello-harness` 中专门对应四份执行环路分析的章节：

- [`../hello-claude-code/03-agent-loop.md`](../hello-claude-code/03-agent-loop.md)
- [`../hello-codex/03-agent-loop.md`](../hello-codex/03-agent-loop.md)
- [`../hello-gemini-cli/03-agent-loop.md`](../hello-gemini-cli/03-agent-loop.md)
- [`../hello-opencode/03-agent-loop.md`](../hello-opencode/03-agent-loop.md)

---

## 1. 为什么 Agent Loop 值得单独深挖

Harness 视角下，Agent Loop 不只是"模型调用然后执行工具"的 while 循环。它是整个控制系统真正落地的位置——控制平面决定规则从哪里来，前馈决定规则怎样在行动前进入上下文，反馈决定偏差怎样被检测和纠正；但这些最终都要在一条循环里实现为真实行为。

对选型读者来说，Agent Loop 的设计直接影响：

- **延迟**：闭环路径越短、跨层跳转越少，单 turn 延迟越低
- **可治理性**：控制点（审批、hook、policy）能不能自然地插入 loop，决定了安全围栏的实施成本
- **可恢复性**：loop 崩溃后能否 resume，取决于状态存储在内存还是持久层
- **并发吞吐**：多个工具调用能否并行执行，受限于 loop 内的并发控制策略
- **可扩展性**：新工具、新 provider、新 hook 是否能在不改动 loop 核心的情况下接入

因此本文从源码层面逐行剖析四个工程的 Agent Loop 实现，给出精确到代码行的技术对比。

---

## 2. 四种闭环拓扑总览

![四种闭环拓扑总览](diagrams/13-agent-loop-diagram-01.svg)

**四种闭环拓扑总览** — [交互版](diagrams/13-agent-loop-diagram-01.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/13-agent-loop-diagram-01.architecture.json)

- **组成**：画布 16 个节点 · 源图共 30 个节点，其余见正文
- **关系**：源图 15 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：while(true) / query.ts:307 → callModel() 流式消费 · callModel() 流式消费 → StreamingToolExecutor… · StreamingToolExecutor… → toolResults 注回 messages

---

## 3. Claude Code：单核 `queryLoop` 深度解析

### 3.1 主循环结构

Claude Code 的全部闭环逻辑集中在 `sources/claude-code/src/query.ts` 的 `queryLoop()` 异步生成器中。

**入口签名** — `sources/claude-code/src/query.ts:241-251`：

```typescript
async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
): AsyncGenerator<
  StreamEvent | RequestStartEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
>
```

**核心状态对象** — `sources/claude-code/src/query.ts:271-282`：

```typescript
let state: State = {
  messages: params.messages,
  toolUseContext: params.toolUseContext,
  maxOutputTokensOverride: params.maxOutputTokensOverride,
  autoCompactTracking: undefined,
  stopHookActive: undefined,
  maxOutputTokensRecoveryCount: 0,
  hasAttemptedReactiveCompact: false,
  turnCount: 1,
  pendingToolUseSummary: undefined,
  transition: undefined,
}
```

**循环条件** — `sources/claude-code/src/query.ts:307`：`while (true)`，通过显式 `return` 退出。这意味着所有退出路径都必须走 `return { reason: '...' }`。

### 3.2 单次迭代生命周期

每次迭代依序执行以下阶段：

| 阶段 | 代码位置 | 职责 |
| :------| :----------| :------|
| 状态解构 | `query.ts:311-320` | 从 `state` 解构当前迭代所需字段 |
| History Snip | `query.ts:403` | 特性门控下的历史裁剪（`snipCompactIfNeeded()`） |
| Microcompact | `query.ts:412-426` | 每轮迭代前的轻量上下文压缩（`deps.microcompact()`） |
| Context Collapse | `query.ts:427-446` | 折叠视图投影 + 提交更多 collapse（特性门控） |
| Autocompact | `query.ts:454-535` | 主动式上下文摘要（满足 token 阈值时触发） |
| 构建 system prompt | `query.ts:449` | `appendSystemContext()` 生成 `fullSystemPrompt` |
| 流式模型调用 | `query.ts:654-910` | `while (attemptWithFallback)` 消费 `deps.callModel()` SSE 流 |
| 工具检测与执行 | `query.ts:833-845` | 累积 `tool_use` 块，设置 `needsFollowUp` |
| 工具结果收集 | `query.ts:1382-1410` | 运行 `runTools()` 或 `StreamingToolExecutor` |
| 错误恢复 | `query.ts:1123-1260` | reactive compact、max_output_tokens recovery |
| 退出/继续判断 | `query.ts:1270-1360` & `1708-1726` | stop hooks、`needsFollowUp` 和 `maxTurns` |

### 3.3 工具结果回注机制

工具执行完毕后，结果通过 continue site 注入下一迭代（`query.ts:1721-1730`）：

```typescript
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  toolUseContext: toolUseContextWithQueryTracking,
  turnCount: nextTurnCount,
  transition: { reason: 'next_turn' },
}
state = next  // loop continues with injected tool_results
```

注意这是**内存态拼接**——工具结果直接合并到 `messages` 数组，然后传给下一次 `callModel()`。没有任何持久化层介入。

### 3.4 并发工具执行

Claude Code 拥有两套工具执行引擎：

**1. 批处理模式** — `sources/claude-code/src/services/tools/toolOrchestration.ts:19`

`runTools()` 函数将工具调用按 `isConcurrencySafe` 属性分区（`partitionToolCalls()`，行 91-119）：

```typescript
function partitionToolCalls(toolUseMessages, toolUseContext): Batch[] {
  return toolUseMessages.reduce((acc, toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const isConcurrencySafe = tool?.isConcurrencySafe(parsedInput.data) || false
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1].blocks.push(toolUse)  // 合并到同一批
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })  // 新建批次
    }
    return acc
  }, [])
}
```

规则是：连续的只读工具合并为一批并发执行，遇到写操作工具则独立成批串行。

最大并发度由环境变量控制（`toolOrchestration.ts:8-11`）：

```typescript
function getMaxToolUseConcurrency(): number {
  return parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
}
```

**2. 流式并发模式** — `sources/claude-code/src/services/tools/StreamingToolExecutor.ts`

`StreamingToolExecutor` 在模型还在流式输出时就开始执行已完成的工具调用。其核心并发控制（行 129-135）：

```typescript
private canExecuteTool(isConcurrencySafe: boolean): boolean {
  const executingTools = this.tools.filter(t => t.status === 'executing')
  return (
    executingTools.length === 0 ||
    (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
  )
}
```

当模型流输出一个完整的 `tool_use` 块时，`addTool()`（行 76）立即将其排入队列并调用 `processQueue()`（行 140）尝试启动执行。这实现了**流式推理与工具执行的流水线并行**。

### 3.5 三级上下文压缩

Claude Code 拥有业界最复杂的上下文压缩体系：

| 级别 | 函数 | 代码位置 | 触发条件 |
| :------| :------| :----------| :----------|
| History Snip | `snipModule.snipCompactIfNeeded()` | `query.ts:403` | 特性门控 |
| Microcompact | `deps.microcompact()` | `query.ts:414` | **每轮迭代**都运行 |
| Autocompact | `deps.autocompact()` | `query.ts:454` | token 接近上限（主动） |
| Reactive Compact | `reactiveCompact.tryReactiveCompact()` | `query.ts:1123` | API 返回 `prompt_too_long`（被动） |

### 3.6 错误恢复

**模型 fallback** — `query.ts:654-910`：

```typescript
while (attemptWithFallback) {
  attemptWithFallback = false
  try {
    for await (const message of deps.callModel({...})) { /* 处理流 */ }
  } catch (innerError) {
    if (innerError instanceof FallbackTriggeredError && fallbackModel) {
      currentModel = fallbackModel
      attemptWithFallback = true  // 用备选模型重试
      continue
    }
    throw innerError
  }
}
```

**Max Output Tokens 恢复** — `query.ts:1226-1260`：

最多重试 3 次（`MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3`，行 164）。每次注入一条 meta 消息 `"Output token limit hit. Resume directly..."`，要求模型从断点继续。

### 3.7 退出条件

| 退出路径 | 代码位置 | 条件 |
| :----------| :----------| :------|
| 正常完成 | `query.ts:1267` & `:1360` | `!needsFollowUp` 且无待恢复错误（`return { reason: 'completed' }`） |
| 达到 maxTurns | `query.ts:1708-1714` | `nextTurnCount > maxTurns` |
| 用户中断 | `query.ts:1018-1054` | `abortController.signal.aborted` |
| Stop hook 阻止 | `query.ts:1270-1282` | hook 返回 stop 指令 |
| 无法恢复的错误 | `query.ts:1123-1185` | reactive compact 和 max_tokens 恢复都失败 |

### 3.8 关键函数清单

| 函数 | 文件:行 | 职责 |
| :------| :---------| :------|
| `queryLoop()` | `src/query.ts:241` | 主闭环生成器 |
| `runTools()` | `src/services/tools/toolOrchestration.ts:19` | 批处理工具编排 |
| `partitionToolCalls()` | `src/services/tools/toolOrchestration.ts:91` | 并发安全分区 |
| `StreamingToolExecutor.addTool()` | `src/services/tools/StreamingToolExecutor.ts:76` | 流式工具入队 |
| `StreamingToolExecutor.canExecuteTool()` | `src/services/tools/StreamingToolExecutor.ts:129` | 并发门控 |
| `queryModelWithStreaming()` | `src/services/api/claude.ts:753` | SSE 流消费 |
| `withRetry()` | `src/services/api/withRetry.ts:170` | 协议层重试 |

---

## 4. Codex：四层分治闭环深度解析

### 4.1 分层架构

Codex 是四个工程中层次最分明的。整条执行链拆分在 `sources/codex/codex-rs/core/src/session/` 树中：事件分发在 `session/handlers.rs`，Turn 编排与采样在 `session/turn.rs`，可按四层阅读：

![分层架构](diagrams/13-agent-loop-diagram-02.svg)

**分层架构** — [交互版](diagrams/13-agent-loop-diagram-02.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/13-agent-loop-diagram-02.architecture.json)

- **组成**：4 个节点
- **关系**：源图 4 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：submissionloop() / sessio… → runturn() / session/turn.… · runturn() / session/turn.… → runsamplingrequest() / se… · runsamplingrequest() / se… → tryrunsamplingrequest()…

### 4.2 第一层：submission_loop() — 事件分发

**位置** — `sources/codex/codex-rs/core/src/session/handlers.rs:439`

```rust
pub(super) async fn submission_loop(
    sess: Arc<Session>, config: Arc<Config>, rx_sub: Receiver<Submission>
) {
    let mut shutdown_received = false;
    let mut mailbox = sess.input_queue.mailbox_updates();
    loop {
        let sub = tokio::select! {
            biased;
            _ = sess.services.local_agent_runtime.shutdown.cancelled() => { /* 关停 */ }
            sub = rx_sub.recv() => match sub {
                Ok(sub) => sub,
                Err(_) => break,   // 唯一退出点之一
            },
            update = /* mailbox 变更 */ => { /* 输入队列通知 */ }
        };
        match sub.op.clone() {
            Op::Interrupt => { handlers::interrupt(&sess).await; }
            Op::TurnInput { request, mode, reply } => {
                let result = turn_input::handle(&sess, request, mode, sub.id.clone()).await;
            }
            Op::ExecApproval { id, turn_id, decision } => {
                handlers::exec_approval(...).await;
            }
            Op::PatchApproval { id, decision } => { ... }
            Op::Shutdown => { return; }
            // ... 更多 Op 变体（RecoverTurn、UserInputAnswer、DynamicToolResponse 等）
        }
    }
}
```

这一层用**有界异步通道**（容量 512，`core/src/session/mod.rs:515` 的 `SUBMISSION_CHANNEL_CAPACITY`）接收外部操作，并通过 `tokio::select!` 同时监听关停信号与输入队列的 mailbox 变更。每个 `Op` 变体有独立的 handler。**关键设计**：`Op::Interrupt`、`Op::ExecApproval`（`session/handlers.rs:638`）和 `Op::PatchApproval`（`session/handlers.rs:646`）都可以在 turn 运行期间被处理——这意味着审批和中断是**非阻塞地插入**闭环的，而不是在 loop 体内轮询检查。用户输入统一通过 `Op::TurnInput`（`session/handlers.rs:541`）进入，由 `turn_input::handle` 处理；turn 恢复走 `Op::RecoverTurn`。

### 4.3 第二层：run_turn() — Turn 编排

**位置** — `sources/codex/codex-rs/core/src/session/turn.rs:163`

`run_turn()` 是单次对话轮的完整生命周期：

```rust
pub(crate) async fn run_turn(
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    input: Vec<TurnInput>,
    mcp_startup_requirements: &mut McpStartupRequirements,
    prewarmed_client_session: Option<ModelClientSession>,
    cancellation_token: CancellationToken,
) -> CodexResult<Option<String>> {
    // 1. Pre-sampling compaction          (session/turn.rs:183)
    run_pre_sampling_compact(...).await;

    // 2. Context recording                (session/turn.rs:355)
    sess.record_context_updates_and_set_reference_context_item(...).await;

    // 3. MCP/Plugin tool collection + Skill injection
    // 4. Client session preparation

    loop {  // <-- 内部采样循环 (session/turn.rs:424)
        let sampling_request_input = sess.clone_history()
            .await
            .for_prompt(&turn_context.model_info.input_modalities);

        match run_sampling_request(...).await {
            Ok(SamplingRequestResult { needs_follow_up, last_agent_message }) => {
                // token 上限 + needs_follow_up 判定 (session/turn.rs:547-609)
                let token_limit_reached = ...;

                if token_limit_reached && needs_follow_up {
                    run_auto_compact(...).await;  // session/turn.rs:621
                    continue;  // 压缩后重新采样
                }
                if !needs_follow_up {
                    // 运行 stop hooks、after_agent hooks (core/src/hook_runtime.rs:392)
                    break;
                }
                continue;  // 工具结果已注录，继续采样
            }
            Err(CodexErr::TurnAborted) => break,
            Err(e) => { /* 发送错误事件 */ break; }
        }
    }
}
```

**关键洞察**：`run_turn()` 的 `loop` 是**采样级循环**——每次 `run_sampling_request()` 返回后，根据 `needs_follow_up` 决定是否继续。这是工具结果回注的实际闭合点。

### 4.4 第三层：run_sampling_request() — 重试封装

**位置** — `sources/codex/codex-rs/core/src/session/turn.rs:1603`

```rust
loop {
    let err = match try_run_sampling_request(...).await {
        Ok(output) => return Ok((output, original_input)),
        Err(err) => match err.details() {
            CodexErrorDetails::ContextWindowExceeded => {
                sess.set_total_tokens_full(&turn_context).await;
                return Err(err);
            }
            _ => err,
        },
    };

    let retry = handle_response_stream_error(
        &mut retry_state,  // ResponsesStreamRetryState
        max_retries,
        err,
        client_session, ...
    ).await?;
    retry??;
}
```

重试与传输降级决策集中在 `core/src/responses_retry.rs`：`handle_response_stream_error()`（`:57`）配合 `ResponsesStreamRetryState`（`:32`）维护退避计数，并在重试耗尽时调用 `client_session.try_switch_fallback_transport()`（`responses_retry.rs:121`）做 WebSocket → HTTPS 传输层降级。

**三级容错策略**：

1. 可重试错误 → 指数退避重试
2. 达到重试上限 → 尝试传输层降级（WebSocket → HTTPS）
3. 降级后继续失败 → 上抛不可恢复错误

### 4.5 第四层：try_run_sampling_request() — 流消费 + 工具派发

**位置** — `sources/codex/codex-rs/core/src/session/turn.rs:2512`

```rust
let mut stream = client_session
    .stream(prompt, &step_context.settings.model_info, ...)
    .or_cancel(&cancellation_token)
    .await??;

let mut in_flight: FuturesOrdered<InFlightFuture<'static>> = FuturesOrdered::new();
let mut needs_follow_up = false;

loop {
    let event = match stream.next()
        .or_cancel(&cancellation_token).await {
        Ok(event) => event,
        Err(CancelErr::Cancelled) => break Err(CodexErr::TurnAborted),
    };

    match event {
        Some(Ok(ResponseEvent::OutputItemDone(item))) => {
            // 工具派发 (session/turn.rs:2774-2782)
            if let Ok(Some(call)) = ToolRouter::build_tool_call(...).await {
                let tool_future = Box::pin(
                    tool_runtime.clone()
                       .handle_tool_call(call, cancellation_token)
                );
                in_flight.push_back(tool_future);
                needs_follow_up = true;
            }
        }
        Some(Ok(ResponseEvent::OutputTextDelta(delta))) => {
            // 流式文本推送
        }
        Some(Ok(ResponseEvent::Completed { token_usage })) => {
            needs_follow_up |= sess.has_pending_input().await;
            break Ok(SamplingRequestResult { needs_follow_up, last_agent_message });
        }
        // ...
    }
}
```

**关键设计**：工具调用的 future 被推入 `FuturesOrdered`（`session/turn.rs:2579`），这意味着**工具在模型流式输出期间就开始并行执行**，但结果按顺序收集。这与 Claude Code 的 `StreamingToolExecutor` 思路一致，但 Codex 使用 Rust 的 `FuturesOrdered` 实现，开销更低。

### 4.6 并发工具执行

**位置** — `sources/codex/codex-rs/core/src/tools/parallel.rs`

```rust
pub(crate) struct ToolCallRuntime {
    router: Arc<ToolRouter>,
    session: Arc<Session>,
    turn_context: Arc<TurnContext>,
    tracker: SharedTurnDiffTracker,
    parallel_execution: Arc<RwLock<()>>,  // 读写锁控制并发
}
```

并发策略（`parallel.rs:205-208`）：

```rust
let _guard = if supports_parallel {
    Either::Left(lock.read().await)   // 读锁 → 允许并行
} else {
    Either::Right(lock.write().await) // 写锁 → 互斥执行
};
```

这是一个优雅的 `RwLock` 模式：只读工具获取读锁（共享），写入型工具获取写锁（互斥）。这比 Claude Code 的 `partitionToolCalls` 分批策略更细粒度——不需要预先分区，锁竞争自然实现排序。

### 4.7 审批系统嵌入

Codex 的审批不在 loop 内部轮询，而是通过 `Op::ExecApproval` 和 `Op::PatchApproval` 异步注入 `submission_loop`：

- **Exec 审批** — `session/handlers.rs:638`（handler 实现在 `session/handlers.rs:177` 的 `exec_approval()`）：按决策解除待审批项阻塞，Abort 决策直接中断当前任务
- **Patch 审批** — `session/handlers.rs:646`（handler 实现在 `session/handlers.rs:208` 的 `patch_approval()`）：审批请求先以 `ApplyPatchApprovalRequestEvent` 发出（`session/mod.rs:2896`），用户决策经 `notify_approval()` 路由回 `apply_patch` 链路

### 4.8 关键函数清单

| 函数 | 文件:行 | 职责 |
| :--- | :--- | :--- |
| `submission_loop()` | `session/handlers.rs:439` | Op 事件分发，最外层 |
| `run_turn()` | `session/turn.rs:163` | Turn 生命周期编排 |
| `run_sampling_request()` | `session/turn.rs:1603` | 重试 + 传输降级封装（降级决策在 `responses_retry.rs:57`） |
| `try_run_sampling_request()` | `session/turn.rs:2512` | 流消费 + 工具 future 派发 |
| `handle_output_item_done()` | `stream_events_utils.rs:315` | 输出项完成处理 |
| `ToolCallRuntime.handle_tool_call()` | `tools/parallel.rs:77` | 读写锁并发执行 |
| `ToolRouter::build_tool_call()` | `tools/router.rs:246` | 工具调用构建 |
| `run_auto_compact()` | `session/turn.rs:1434` | 自动上下文压缩 |

---

## 5. Gemini CLI：跨层闭环深度解析

### 5.1 三层异步生成器栈

Gemini CLI 的闭环跨越三个层次的异步生成器，加上一个 UI hook 层完成闭合：

![三层异步生成器栈](diagrams/13-agent-loop-diagram-03.svg)

**三层异步生成器栈** — [交互版](diagrams/13-agent-loop-diagram-03.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/13-agent-loop-diagram-03.architecture.json)

- **组成**：12 个节点
- **关系**：源图 9 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：sendMessageStream() / cli… → processTurn() / client.ts… · processTurn() / client.ts… → Turn.run() / turn.ts:270 · schedule() / scheduler.ts… → processQueue() / while lo…

### 5.2 sendMessageStream() — 编排入口

**位置** — `sources/gemini-cli/packages/core/src/core/client.ts:924`

```typescript
async *sendMessageStream(message, signal, prompt_id, turns, displayContent, stopHookActive) {
  // 前置：新 prompt 时重置 loopDetector，触发 Before-Agent hook（可拦截、可注入上下文）
  // Line 980: 委托给 processTurn()
  turn = yield* this.processTurn(request, signal, prompt_id, boundedTurns, displayContent);
  // Lines 985-1010: After-Agent hook（可停止执行、清除上下文）
  // Lines 888-916: 无待执行工具时做 Next-Speaker 检查，期待模型继续时递归续行
}
```

**MAX_TURNS 硬限制** — `client.ts:79`：

```typescript
const MAX_TURNS = 100
```

### 5.3 processTurn() — 单 Turn 编排

**位置** — `sources/gemini-cli/packages/core/src/core/client.ts:628`

这是 Gemini CLI 最复杂的函数，包含了大量前置检查：

| 阶段 | 代码行 | 职责 |
| :------| :--------| :------|
| Turn 计数 | `637-646` | 强制 `MAX_SESSION_TURNS` / `MAX_TURNS` 限制 |
| 上下文压缩 | `665-705` | contextManager `renderHistory()` 或 `tryCompressChat()` |
| 输出遮罩 | `713` | `tryMaskToolOutputs()` |
| Token 窗口检查 | `715-731` | 请求前 token 估算，超限直接终止 |
| IDE 上下文注入 | `735-760` | 编辑器上下文增量追踪（有 pending tool call 时挂起） |
| Loop Detection | `761-778` | `loopDetector.turnStarted()`，检测重复模式 |
| 模型路由 | `780-812` | 模型选择与 stickiness（`currentSequenceModel`） |
| Turn.run() 流消费 | `819-855` | 消费 Turn 事件生成器，流内再跑 `loopDetector.addAndCheck()` |
| Next-Speaker 检查 | `888-916`（sendMessageStream 尾部） | 模型期待响应时自动续行 |

**Loop Detection 实现**（`client.ts:761-778` 入口、`827-847` 流内检查、`1284` 恢复入口）是 Gemini CLI 独有的：

```typescript
const loopResult = await this.loopDetector.turnStarted(signal);   // :761
if (loopResult.count > 1) {
  yield { type: GeminiEventType.LoopDetected };
  return turn;  // 强制停止
} else if (loopResult.count === 1) {
  if (boundedTurns <= 1) {
    yield { type: GeminiEventType.MaxSessionTurns };
    return turn;
  }
  return yield* this._recoverFromLoop(...);  // 注入反馈消息尝试恢复
}
```

这是一个**两级响应机制**：第一次检测到循环模式时尝试注入反馈消息恢复；第二次仍然循环则强制终止。其他三个工程都没有这种主动的循环模式检测。

### 5.4 Turn.run() — 模型流解析

**位置** — `sources/gemini-cli/packages/core/src/core/turn.ts:270-425`

```typescript
async *run(modelConfigKey, req, signal, options) {
  const responseStream = await this.chat.sendMessageStream(
    modelConfigKey, req, this.prompt_id, signal, role, displayContent, apiHistoryOverride
  );

  for await (const streamEvent of responseStream) {
    if (signal?.aborted) {
      yield { type: GeminiEventType.UserCancelled };
      return;
    }
    // RETRY 事件透传，agent_execution_stopped/blocked 转发 (行 299-318)
    const resp = streamEvent.value;
    const parts = resp.candidates?.[0]?.content?.parts ?? [];

    // Thought 处理 (行 366-377)
    for (const part of parts) {
      if (part.thought) {
        yield { type: GeminiEventType.Thought, value: parseThought(part.text ?? ''), traceId };
      }
    }

    // Text 内容 (行 379-381)
    const text = getResponseText(resp);
    if (text) yield { type: GeminiEventType.Content, value: text, traceId };

    // Function Call 提取 (行 380-388)
    const functionCalls = resp.functionCalls ?? [];
    for (const fnCall of functionCalls) {
      const event = this.handlePendingFunctionCall(fnCall, traceId);  // → ToolCallRequest
      if (event) yield event;
    }

    // Finish Reason (行 394-411)
    const finishReason = resp.candidates?.[0]?.finishReason;
    if (finishReason) {
      yield { type: GeminiEventType.Finished, value: { reason: finishReason, usageMetadata: resp.usageMetadata } };
    }
  }
}
```

注意 `Turn.run()` **只负责解析和转发事件**，不执行任何工具。工具执行发生在完全不同的层。

### 5.5 Scheduler — 生命周期驱动的工具执行

**位置** — `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts:445-576`

Scheduler 使用一个 while 循环，每次迭代把活动工具调用沿生命周期推进一步：

```typescript
private async _processQueue(signal: AbortSignal): Promise<void> {
  while (this.state.queueLength > 0 || this.state.isActive) {
    const shouldContinue = await this._processNextItem(signal);
    if (!shouldContinue) break;
  }
}
```

每次迭代（`_processNextItem()`，行 456-576）先出队：若队首工具可并行，则把后续**连续可并行的工具批量出队**（行 488-497），再按三步推进：

**第 1 步 — 验证**（行 513-521）：

```typescript
const validatingCalls = activeCalls.filter(
  (c): c is ValidatingToolCall => c.status === CoreToolCallStatus.Validating,
);
if (validatingCalls.length > 0) {
  await Promise.all(
    validatingCalls.map((c) => this._processValidatingCall(c, signal)),
  );
}
```

验证包含：hook 检查、policy 评估、用户确认（可能进入 `AwaitingApproval` 状态）。

**第 2 步 — 执行**（行 523-534）：

```typescript
const scheduledCalls = activeCalls.filter(
  (c): c is ScheduledToolCall => c.status === CoreToolCallStatus.Scheduled,
);
const allReady = activeCalls.every(
  (c) => c.status === CoreToolCallStatus.Scheduled || this.isTerminal(c.status),
);
if (allReady && scheduledCalls.length > 0) {
  const execResults = await Promise.all(
    scheduledCalls.map((c) => this._execute(c, signal)),
  );
}
```

**第 3 步 — 终结**（行 537-542）：

```typescript
for (const call of activeCalls) {
  if (this.isTerminal(call.status)) {
    this.state.finalizeCall(call.request.callId);
  }
}
```

若无任何调用推进但仍在等待审批或执行，则让出事件循环 10ms 后重试（行 560-570），避免忙等。

**并发控制**（`scheduler.ts:577-594`）：

```typescript
private _isParallelizable(request: ToolCallRequestInfo): boolean {
  // update_topic 与编辑类工具强制串行
  if (request.name === UPDATE_TOPIC_TOOL_NAME || EDIT_TOOL_NAMES.has(request.name)) {
    return false;
  }
  if (request.args) {
    const wait = request.args['wait_for_previous'];
    if (typeof wait === 'boolean') return !wait;
  }
  return true;  // 默认并行
}
```

Gemini CLI 把并发控制权交给**模型端**：模型可以在工具参数中设置 `wait_for_previous: true` 来要求串行执行；`update_topic` 和编辑类工具被运行时强制串行。这与 Claude Code/Codex 在客户端判断 `isConcurrencySafe` 的策略截然不同。

### 5.6 handleCompletedTools() — 闭合点

**位置** — `sources/gemini-cli/packages/cli/src/ui/hooks/useGeminiStream.ts:1972-2203`

```typescript
const handleCompletedTools = useCallback(
  async (completedToolCallsFromScheduler) => {
    const completedAndReady = completedToolCallsFromScheduler.filter(
      (tc) => ['success', 'error', 'cancelled'].includes(tc.status)
             && tc.response?.responseParts
    );
    markToolsAsSubmitted(completedAndReady.map(t => t.request.callId));

    const geminiTools = completedAndReady.filter(
      t => !t.request.isClientInitiated
    );
    if (geminiTools.length === 0) return;

    // 把工具结果重新提交给模型 — 这是闭合点
    submitQuery(responsesToSend, {
      isContinuation: true   // useGeminiStream.ts:2189
    }, prompt_ids[0]);
  }
)
```

**这是 Gemini CLI 与其他三者最大的区别**：闭环的闭合发生在 **UI hook 层**，而不是 core 内部。`submitQuery(..., { isContinuation: true })` 重新进入 `sendMessageStream()`，完成完整闭环。

### 5.7 工具状态机

![工具状态机](diagrams/13-agent-loop-diagram-04.svg)

**工具状态机** — [交互版](diagrams/13-agent-loop-diagram-04.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/13-agent-loop-diagram-04.architecture.json)

- **组成**：10 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：ToolCallRequestInfo · 末节点：Cancelled

### 5.8 关键函数清单

| 函数 | 文件:行 | 职责 |
| :--- | :---------| :------|
| `sendMessageStream()` | `core/src/core/client.ts:924` | 编排入口生成器 |
| `processTurn()` | `core/src/core/client.ts:628` | Turn 前置检查 + 编排 |
| `Turn.run()` | `core/src/core/turn.ts:270` | 模型流事件解析 |
| `_recoverFromLoop()` | `core/src/core/client.ts:1284` | 循环检测恢复 |
| `Scheduler.schedule()` | `core/src/scheduler/scheduler.ts:211` | 工具调度入口 |
| `Scheduler._processQueue()` | `core/src/scheduler/scheduler.ts:445` | 生命周期推进循环 |
| `Scheduler._isParallelizable()` | `core/src/scheduler/scheduler.ts:577` | 模型端并发控制 |
| `ToolExecutor.execute()` | `core/src/scheduler/tool-executor.ts:63` | 工具执行包装 |
| `handleCompletedTools()` | `cli/src/ui/hooks/useGeminiStream.ts:1972` | 闭环闭合点 |
| `processGeminiStreamEvents()` | `cli/src/ui/hooks/useGeminiStream.ts:1533` | UI 层事件消费 |

---

## 6. OpenCode：durable inbox 驱动的 drain 循环深度解析

### 6.1 结构总览

OpenCode 2.0.27 的闭环不再是一个显式的 `prompt()` 循环，而是一个由 **durable inbox 驱动的 drain 循环**：用户输入先持久化为 SQLite inbox 条目，`SessionRunner.drain()` 决定是否推进，内层 `runStep()` / `SessionStep.attempt()` 完成单步采样与工具执行：

![drain 循环结构](diagrams/13-agent-loop-diagram-05.svg)

**drain 循环结构** — [交互版](diagrams/13-agent-loop-diagram-05.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/13-agent-loop-diagram-05.architecture.json)

- **组成**：9 个节点
- **关系**：源图 10 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：SessionPrompt.prepare() → inbox 入队（session_inbox） · SessionRunner.drain() → nextPromotable() 出队 → runStep() · SessionStep.attempt() 内 llm.stream() + 工具 fiber，终态 durable 结算

### 6.2 外层 drain() — durable 工作推进

**位置** — `sources/opencode/packages/core/src/session/runner/llm.ts:54`

```typescript
const drain = Effect.fn("SessionRunner.drain")(function* (input) {
  // 空闲起步：无 force/continuation 时，先看 inbox 是否有可提升输入
  const pending = yield* SessionInbox.nextPromotable(db, sessionID, "input")
  if (!pending) return DrainResult.Complete()

  while (true) {  // llm.ts:188 — Step 主循环
    const next = yield* advanceToStep()      // 处理 move/compaction/新输入，或返回 Complete/Moved/Reloaded
    if (next._tag !== "Ready") return next
    continuing = yield* runStep(next.context, step)  // 单步采样 + 工具
    step++
    force = false
    entering = false
  }
})
```

`drain` 的前置检查与推进规则全部落在 durable 状态上：

- `SessionInbox.nextPromotable()`（`session/inbox.ts:407`）从 SQLite 取下一条可提升输入；`SessionInbox.promote()`（`session/inbox.ts:496`）把输入提升为可见消息并触发标题生成。
- `RunCoordinator`（`session/run-coordinator.ts:14`）把每个 session 的执行**单飞化**：不同 session 并发、同一 session 串行，doorbell 机制保证 drain 刚决定结束时新入队的工作还能再唤醒一轮。
- `SessionStore.claim()`（`session/store.ts:205`）把"这个 session 有一个 turn 在执行"写成 durable 的执行 claim——crash 后按残留 claim 恢复 resume 计数。

**关键设计差异**：OpenCode 每次 drain 都通过 `context.load()` 从 SQLite 重建上下文投影，而不是在内存累积 messages。这意味着：

- ✅ 任意时刻 crash 后可以 resume（inbox、claim、消息都是 durable 的）
- ✅ 外部观察者可以实时查询对话状态
- ❌ 每轮迭代有额外的 DB 读取开销

### 6.3 内层 runStep() — Step 编排与重试

**位置** — `sources/opencode/packages/core/src/session/runner/llm.ts:206`

`runStep()` 持有自己的 `while (true)`（`llm.ts:213`），负责单个 Step 的完整生命周期：

```typescript
const runStep = Effect.fn("SessionRunner.runStep")(function* (first, step) {
  while (true) {
    const loaded = initial ?? (yield* prepareContext(sessionID).pipe(Effect.flatMap(context.load)))

    // 每步前先尝试 auto compaction（llm.ts:217）
    const compacted = yield* compaction.compact({ reason: "auto", context: loaded })
    if (compacted.status === "failed") return yield* new StepFailedError({ error: compacted.error })
    if (compacted.status === "completed") { continue }  // 压缩后重载上下文再来

    // agent 步数上限：达到后注入 MAX_STEPS_PROMPT 并关闭 toolChoice（llm.ts:223-243）
    const stepLimitReached = loaded.agent.info.steps !== undefined && step >= loaded.agent.info.steps
    const prepared = yield* context.request.primary({
      /* system / messages / tools … toolChoice: stepLimitReached ? "none" : undefined */
    })

    const outcome = yield* steps.attempt({ ... /* 流消费 + 工具 fiber */ })
    const completed = yield* SessionStep.Outcome.$match(outcome, {
      Completed: (o) => Effect.succeed(o.needsContinuation),   // 无需续行时退出 Step 循环
      Retry: (o) => retry.wait({ decision: o.decision, error: o.error, ... }),  // 退避后重试本步
      Continue: /* 流不完整时注入 synthetic 消息继续 */,
      Compacted: /* overflow 压缩后重试 */,
      RecoverFull: /* 全量恢复 */,
    })
    /* completed 为 true 时返回 drain，继续下一 Step */
  }
})
```

`needsContinuation` 的判定在事件 publisher 中（`session/runner/publish-llm-event.ts:619-622`）：只要存在未被 provider 执行的工具调用，下一步就必须继续——这是工具结果回注的闭合点。

### 6.4 SessionStep.attempt() — 流消费 + 工具 fiber 派发

**位置** — `sources/opencode/packages/core/src/session/runner/step.ts:77`

```typescript
const attempt = Effect.fn("SessionStep.attempt")(function* (input) {
  const toolRuns: Array<{ call: ToolCall; fiber: Fiber<...> }> = []
  const executeTool = (call: ToolCall) => input.prepared.executeTool({ ... })  // 权限检查内嵌其中

  const providerStream = llm.stream(input.prepared.request, input.prepared.options).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        yield* publisher.publish(event)                       // Bus 推送
        if (event.type !== "tool-call" || event.providerExecuted) return
        toolRuns.push({                                       // step.ts:127-137
          call: event,
          fiber: yield* Effect.forkScoped(/* executeTool + truncate + settle */),
        })
      }),
    ),
  )
  /* 不可中断区：等待流与工具 fiber 终态，做 durable 结算 */
})
```

**关键设计**：工具调用的 fiber 在**模型还在流式输出时**就被 `Effect.forkScoped` 派发（`step.ts:127-137`），并行执行；同时 provider 与 tool fiber 各自保持事件顺序，终态统一由 publisher 结算为 durable 事件。取消时 `interruptTools` 一次性中断所有工具 fiber。权限检查内嵌在 `prepared.executeTool` 的工具 context 中，拒绝以 `Permission.DeclinedError` 结算。

### 6.5 SQLite 持久化与 durable inbox

**Schema** — `sources/opencode/packages/core/src/session/sql.ts`

![SQLite 持久化](diagrams/13-agent-loop-sqlite.svg)

**SQLite 持久化** — [交互版](diagrams/13-agent-loop-sqlite.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/13-agent-loop-sqlite.architecture.json)

- **组成**：6 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：四张 durable 表（session/sql.ts） · 末节点：外键 session_id → session_v2.id（级联删除）

**写入时机**：

| 操作 | 触发函数 | 写入内容 |
| :------| :----------| :----------|
| 用户输入就绪 | `SessionPrompt.prepare()`（`session/prompt.ts:29`） | `session_pending`（含 delivery: steer/queue） |
| 输入提升为消息 | `SessionInbox.promote()`（`session/inbox.ts:496`） | `session_message` |
| 执行开始 | `SessionStore.claim()`（`session/store.ts:205`） | 执行 claim（恢复意图） |
| Step 流式增量 | `publisher.publish()` | **仅 Bus 推送，不写 DB** |
| Step/工具终态 | `SessionStep.attempt()` 结算 | `session_message` + durable 事件投影 |

注意流式增量只通过 Bus 推送，Step 终态才落库——这是 OpenCode 在性能和持久性之间的折中。

### 6.6 Bus 事件系统

**位置** — `sources/opencode/packages/core/src/bus.ts:140`（事件定义在 `sources/opencode/packages/schema/src/event.ts`）

```typescript
export interface Interface {
  readonly publish: <D extends Event.Definition>(
    def: D, properties: z.output<D["properties"]>
  ) => Effect.Effect<void>
  readonly publishAll: <const I extends ...>(inputs: I) => Effect.Effect<void>
}
```

Bus 是 OpenCode 的**观察者层**——TUI、server/SSE、外部 SDK 都通过订阅 Bus 事件获取实时更新。core 内部代码通过 Effect 服务拿到的 `publish()` 发布 typed 事件，事件 schema 统一放在 `packages/schema/src/event.ts`。这使得 Agent Loop 的状态对外部可见，而不需要轮询数据库。

### 6.7 重试策略

**位置** — `sources/opencode/packages/core/src/session/runner/retry.ts`

```typescript
// 重试调度：指数退避与固定间隔取较小者（retry.ts:46）
Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")])

// provider 要求的 retry-after 有 15 分钟上限，防止异常服务把会话挂死（retry.ts:32）
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

// timeout 类错误最多重试 3 次（retry.ts:60）
const MAX_TIMEOUT_RETRIES = 3
```

`SessionRunnerRetry.decide()`（`retry.ts:96`）依据错误类型与 hook 结果给出重试决策，`wait()`（`retry.ts:97`）负责退避等待。

**特殊处理**：上下文溢出（`isContextOverflowFailure`，`step.ts:119`）不进入普通重试，而是触发 `compaction.compact({ reason: "overflow" })`（`llm.ts:236-243`），压缩成功后以 `Compacted` outcome 重试本步。

### 6.8 关键函数清单

| 函数 | 文件:行 | 职责 |
| :--- | :---------| :------|
| `SessionPrompt.prepare()` | `session/prompt.ts:29` | 用户输入编译 + `session.prompt` hook |
| `SessionRunner.drain()` | `session/runner/llm.ts:54` | durable 工作推进主循环 |
| `runStep()` | `session/runner/llm.ts:206` | Step 编排（auto 压缩、步数上限、attempt） |
| `SessionStep.attempt()` | `session/runner/step.ts:77` | 流消费 + 工具 fiber 派发 |
| `needsContinuation` 判定 | `session/runner/publish-llm-event.ts:619` | 是否需要下一 Step |
| `SessionRunnerRetry.decide()` | `session/runner/retry.ts:96` | 重试决策 |
| `SessionCompaction.compact()` | `session/compaction.ts:205` | auto/manual/overflow 上下文压缩 |
| `SessionInbox.nextPromotable()` | `session/inbox.ts:407` | inbox 出队 |
| `SessionInbox.promote()` | `session/inbox.ts:496` | 输入提升为可见消息 |
| `SessionStore.claim()` | `session/store.ts:205` | 执行 claim（crash 恢复意图） |
| `RunCoordinator` | `session/run-coordinator.ts:14` | 单飞执行 + doorbell |
| `SessionDiff.turn()` | `session/diff.ts:38` | turn 范围文件 diff |

---

## 7. 核心维度横向对比

### 7.1 循环结构对比

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 循环层数 | 1 层 `while(true)` | 4 层嵌套 | 3 层生成器 + UI 续行 | 2 层 `while(true)`（drain + runStep） |
| 循环条件 | 无条件，显式 `return` | 通道 `recv()` + `needs_follow_up` | 生成器 `yield*` + `submitQuery` | inbox 可提升输入 + `needsContinuation` |
| 状态承载 | `State` 内存对象 | `Session` + `ContextManager` | 事件流 + hook 状态 | SQLite（inbox/claim/消息）+ Bus |
| 主函数行数 | ~1500 行 | ~500 行/层 | ~200 行/层 | drain ~140 行 + runStep ~90 行 + attempt ~250 行 |

### 7.2 工具结果回注对比

| 工程 | 回注位置 | 回注方式 | 代码引用 |
| :------| :----------| :----------| :----------|
| Claude Code | `query.ts:1721-1730` continue site | 拼接到 `state.messages` 数组 | 内存态直接拼接 |
| Codex | `session/turn.rs:424` loop continue | `sess.record_conversation_items()` 写入 history（`session/mod.rs:3467`） | 通过 ContextManager |
| Gemini CLI | `useGeminiStream.ts:2189` | `submitQuery(toolResults, {isContinuation})` | 重新进入 sendMessageStream |
| OpenCode | `runStep()` outcome 匹配后回到 drain | 工具终态 durable 结算，下一 Step 重载投影历史 | `publish-llm-event.ts:619` + `runner/llm.ts:188` |

### 7.3 工具并发控制对比

| 工程 | 并发策略 | 并发决策方 | 最大并发 | 代码引用 |
| :------| :----------| :------------| :----------| :----------|
| Claude Code | 分批：连续只读合批并发 | **客户端** `isConcurrencySafe()` 判断 | `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=10` | `toolOrchestration.ts:91-119` |
| Codex | RwLock：读锁共享/写锁互斥 | **客户端** `tool_supports_parallel()` | 无硬限制（锁自然排序） | `tools/parallel.rs:205-208` |
| Gemini CLI | 默认并行，`wait_for_previous` 控制串行 | **模型端** 通过工具参数 | 无硬限制 | `scheduler.ts:577-594` |
| OpenCode | 每个 tool-call 事件 fork 一个 fiber，流内并行 | **运行时**（provider 执行的工具除外） | 无硬限制（fiber 自然并发） | `runner/step.ts:127-137` |

### 7.4 错误恢复对比

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 重试策略 | `withRetry` + fallback 模型 | 指数退避 + 传输降级 | 生成器级 Retry 事件 | `SessionRunnerRetry`（退避取小 + timeout 上限 3 次） |
| Context 溢出 | 三级压缩（micro/auto/reactive） | `run_auto_compact` + `ContextWindowExceeded` | `tryCompressChat()` + token masking | `compact({reason:"overflow"})` 后重试本步 |
| Max Tokens | 3 次恢复重试（注入 meta 消息） | 无专门处理 | 无专门处理 | 无专门处理 |
| 传输降级 | 无 | WebSocket → HTTPS | 无 | 无 |
| 模型降级 | `FallbackTriggeredError` → fallback model | 无 | 模型路由 + stickiness | 无 |

### 7.5 Loop Detection 对比

| 工程 | 检测机制 | 响应策略 | 代码引用 |
| :------| :----------| :----------| :----------|
| Claude Code | 无内置 loop detection | 依赖 maxTurns 硬限制 | `query.ts:1708-1714` |
| Codex | 无内置 loop detection | 依赖 token 限制 | `session/turn.rs:547-609` |
| Gemini CLI | `loopDetector` 模式匹配 | 两级：反馈恢复 → 强制终止 | `client.ts:761-863` |
| OpenCode | 无内置 loop detection | 依赖 agent 步数上限兜底 | `runner/llm.ts:223-243` |

### 7.6 上下文压缩对比

| 工程 | 压缩层级 | 触发方式 | 压缩粒度 | 代码引用 |
| :------| :----------| :----------| :----------| :----------|
| Claude Code | 4 级（snip/micro/auto/reactive） | 每轮(micro) / 阈值(auto) / 错误(reactive) | 消息级摘要 | `query.ts:403-535, 1123-1260` |
| Codex | 2 级（pre-sampling / auto） | 采样前 / token 达阈值 | 远程或内联 compact | `session/turn.rs:183, 1434` |
| Gemini CLI | 2 级（compress / mask） | token 估算前 / 大输出 | 聊天压缩 + 输出遮罩 | `client.ts:665-713` |
| OpenCode | 3 触发（auto/manual/overflow） | Step 前 / 用户手动 / 上下文溢出 | 摘要 agent 生成 summary，旧消息降级 | `compaction.ts:205` |

---

## 8. 选型决策矩阵

### 8.1 按业务场景推荐

| 业务场景 | 推荐工程 | 理由 |
| :----------| :----------| :------|
| **低延迟交互式编码** | Claude Code | 单核 loop 无跨层跳转，工具结果直接在内存拼接回注，路径最短 |
| **企业级安全合规** | Codex | 四层分治有天然的控制点插入位置；RwLock 并发 + 异步审批通道 |
| **复杂交互式 TUI 产品** | Gemini CLI | 闭环在 UI hook 层闭合，确认框/提示/重试/loop detection 呈现自然 |
| **长时持久化任务** | OpenCode | SQLite durable state，crash recovery 无损；Bus 系统支持外部观察 |
| **多 provider 兼容** | OpenCode | `@opencode/ai` 抽象层，`llm.stream()` 统一适配所有 provider |
| **流式推理工具流水线** | Claude Code / Codex | 两者都支持模型流式输出期间提前执行工具 |
| **可审计/可回放** | OpenCode | 所有状态写入 SQLite，天然支持 event replay |
| **嵌入其他产品** | Codex | core 层与 UI 完全解耦；通道式通信，可替换前端 |

### 8.2 工程权衡

| 维度 | 最强者 | 代价 |
| :------| :--------| :------|
| 回路最短 | Claude Code | 主循环 ~1500 行，所有横切关注点耦合在同一函数 |
| 分层最清晰 | Codex | 4 层调用栈深（`session/` 树的多文件链路），调试时需要理解每层职责边界 |
| 可插桩最灵活 | Gemini CLI | 闭环跨 core/CLI 两个包，不能独立于 UI 层运行 core |
| 持久性最强 | OpenCode | 每轮迭代都从 SQLite 重建历史，DB I/O 在关键路径上 |
| 错误恢复最完善 | Claude Code | 三级压缩 + fallback 模型 + max_tokens 恢复，但复杂度高 |
| 并发控制最优雅 | Codex | RwLock 模式简洁，但需要每个工具正确声明 `supports_parallel` |

---

## 9. 结论

四种 Agent Loop 代表了四种不同的工程哲学：

- **Claude Code** — **单内核聚合**：把一切塞进一个 `while(true)`，换取最短执行路径和最直接的状态控制。适合对延迟敏感、由 Anthropic 官方维护的单模型场景
- **Codex** — **控制器分层**：四层职责清晰分离，每层只处理一种控制维度（事件分发 / Turn 编排 / 重试容错 / 流消费）。适合需要在多个控制点插入策略的企业场景
- **Gemini CLI** — **事件驱动跨层**：闭环由 core 和 UI 共同持有，事件通过异步生成器流动。适合 TUI 交互丰富、需要灵活插桩的产品场景
- **OpenCode** — **持久化优先**：loop 以 SQLite 为状态中心，每次迭代重建上下文。适合需要 crash recovery、event replay 和对接多 provider 的场景

选型时，先明确你的核心诉求在上述四个象限中的哪一个，再顺着对应的代码路径评估集成成本。

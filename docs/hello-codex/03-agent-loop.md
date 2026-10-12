---
title: "核心执行循环：Agent 决策链、Prompt 构建、LLM 调用与流式响应处理"
---
# 核心执行循环：Agent 决策链、Prompt 构建、LLM 调用与流式响应处理

主向导对应章节：`核心执行循环`

**目录**

- [三层嵌套循环总览](#三层嵌套循环总览)
- [第一层：submission_loop（会话事件分发器）](#第一层submission_loop会话事件分发器)
- [第二层：run_turn（回合执行控制器）](#第二层run_turn回合执行控制器)
- [第三层：run_sampling_request（LLM 编排与重试）](#第三层run_sampling_requestllm-编排与重试)
- [第四层：try_run_sampling_request（流式响应循环）](#第四层try_run_sampling_request流式响应循环)
- [传输层：WebSocket vs HTTPS](#传输层websocket-vs-https)
- [上下文管理](#上下文管理)
- [核心数据结构](#核心数据结构)
- [并发模型](#并发模型)

---

## 三层嵌套循环总览

Codex 的 Agent 执行由四层嵌套函数驱动：

| 层级 | 函数 | 文件:行号 | 职责 |
| --- | --- | --- | --- |
| 会话层 | `submission_loop()` | `session/handlers.rs:439` | 接收并分发所有 Op（TurnInput、Interrupt、Shutdown 等）|
| 回合层 | `run_turn()` | `session/turn.rs:163` | 单轮执行控制，含循环重试 |
| 采样层 | `run_sampling_request()` | `session/turn.rs:1603` | LLM 编排与重试 |
| 流式层 | `try_run_sampling_request()` | `session/turn.rs:2512` | 流式响应消费与工具调度 |

![三层嵌套循环总览](diagrams/03-agent-loop-diagram-01.svg)

**三层嵌套循环总览** — [交互版](diagrams/03-agent-loop-diagram-01.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-agent-loop-diagram-01.sequence.json)

- **组成**：画布 10 个参与方 · 源图共 13 个参与方，其余见正文
- **关系**：源图 9 条消息 · 画布展示前 5 条主链消息，其余列在要点
- **要点**：runturn 自调用：预采样: 插件/技能/上下文 · runsamplingrequest 自调用：加载工具 + 构建 Prompt · 未上画布的调用：ResponseEvent

## 第一层：submission_loop（会话事件分发器）

**位置**：`sources/codex/codex-rs/core/src/session/handlers.rs:439`

submission_loop 是每个会话的单线程事件消费者。它通过 bounded channel（容量 512，`SUBMISSION_CHANNEL_CAPACITY`，`session/mod.rs:515`）接收 `Submission`：

```rust
pub(crate) struct Submission {
    pub id: String,                      // 唯一提交 ID
    pub op: Op,                          // 操作枚举（20+ 种）
    pub turn_extension_init: Option<ExtensionDataInit>,
    pub trace: Option<W3cTraceContext>,  // W3C/OpenTelemetry 追踪
    pub parent_turn_id: Option<String>,
    pub root_turn_id: Option<String>,
    pub residency_guard: Option<OwnedRwLockReadGuard<()>>,
}
```

主循环在 `tokio::select!` 中同时监听关闭信号、`rx_sub.recv()` 与 mailbox 更新，取到提交后逐一处理，不做批处理。操作类型包括 `TurnInput`、`Interrupt`、`ExecApproval`、`DynamicToolResponse`、`Shutdown` 等 20+ 种（`Op` 枚举定义在 `protocol/src/protocol.rs:576`）。

要先澄清一个边界：**submission_loop 不是 WebSocket/HTTP server 的监听循环**。监听连接的是 app-server 传输层，在 `sources/codex/codex-rs/app-server/src/lib.rs` 里按 `stdio` 或 `WebSocket` 启动连接接入；submission_loop 只负责消费已经进入 core 的 `Submission` 队列。

### TUI 请求如何进入 submission_loop

默认 TUI 把用户输入，先经过 app-server 抽象层，再由 app-server 把请求翻译成 `Op::TurnInput` 送入 core。

默认路径是 **Embedded/InProcess**，只有显式 `--remote` 时才会走 remote WebSocket app-server（`sources/codex/codex-rs/tui/src/lib.rs:321`；`sources/codex/codex-rs/tui/src/lib.rs:553`）。

![TUI 请求如何进入 submissionloop](diagrams/03-agent-loop-tui-submissionloop.svg)

**TUI 请求如何进入 submissionloop** — [交互版](diagrams/03-agent-loop-tui-submissionloop.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-agent-loop-tui-submissionloop.sequence.json)

- **组成**：6 个参与方
- **关系**：源图 5 条消息
- **要点**：app-server/messageprocessor.rs 自调用：turnstart() -> submitcoreop() · core::submissionloop 自调用：recv() -> match Op::TurnInput

### 关键代码文件与方法

| 层次 | 文件 | 关键方法 | 作用 |
| --- | --- | --- | --- |
| TUI 事件入口 | `sources/codex/codex-rs/tui/src/app/thread_routing.rs` | `submit_active_thread_op()`（475）、`submit_thread_op()`（500）、`try_submit_active_thread_op_via_app_server()`（659） | 决定一个 `AppCommand` 是本地处理，还是经 app-server 提交 |
| TUI RPC 包装 | `sources/codex/codex-rs/tui/src/app_server_session.rs` | `turn_start()`（1414） | 把用户输入包装成 `ClientRequest::TurnStart` 发给 app-server client |
| TUI 模式选择 | `sources/codex/codex-rs/tui/src/lib.rs` | `start_app_server()`（553）、`AppServerTarget::Embedded/Remote`（321） | 默认走 embedded in-process app-server；只有 `--remote` 才连远端 WebSocket |
| app-server 请求处理 | `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs` | `turn_start()`（175）、`submit_core_op()`（492） | 把 `turn/start` 映射成 `Op::TurnInput`，并提交给目标线程 |
| core 提交入口 | `sources/codex/codex-rs/core/src/codex_thread.rs`、`sources/codex/codex-rs/core/src/session/mod.rs` | `submit_with_trace()`（391）、`submit_with_id()`（session/mod.rs:1034） | 生成 `Submission`，经 `tx_sub.send(...)` 放入线程队列 |
| core 消费循环 | `sources/codex/codex-rs/core/src/session/handlers.rs` | `submission_loop()`（439） | 从 `rx_sub.recv().await` 取出提交，按 `Op` 分发；`Op::TurnInput`（541）进入回合执行 |

因此，`submission_loop` 更准确的定位是：**线程级 Op 队列消费者**。WebSocket/stdio 负责把外部请求送到 app-server，app-server 再把它变成 `Submission` 丢进这里；它本身不直接监听网络端口。

## 第二层：run_turn（回合执行控制器）

**位置**：`sources/codex/codex-rs/core/src/session/turn.rs:163`

`run_turn` 是单轮执行的核心控制器，分为**预采样准备**和**回合循环**两个阶段。

### 上下文与记忆管理核心数据结构

#### ContextManager（`context_manager/history.rs:93`）

```rust
pub(crate) struct ContextManager {
    /// 按时间顺序：最旧 → 最新（Arc 共享，读路径避免深拷贝）
    items: Arc<Vec<ResponseItemEnvelope>>,
    /// 压缩 / rollback 等历史重写时递增
    history_version: u64,
    token_info: Option<TokenUsageInfo>,
    /// 参考上下文快照，用于 diff 和生成模型可见的设置更新项
    reference_context_item: Option<TurnContextItem>,
}
```

**关键不变量**：

- `reference_context_item` 为 `None` 时，下一轮会注入完整初始上下文
- `reference_context_item` 存在时，只追加 diff 项，避免重复注入

---

### 预采样准备（`session/turn.rs:171-401`）

在正式调用 LLM 之前，Codex 需要完成一系列准备工作。插件 / 技能 / 连接器 / 注入项的加载统一由 `build_skills_and_plugins()` 完成（`session/turn.rs:1030`）：

#### 1. 上下文压缩检查（`session/turn.rs:183`）

```rust
if run_pre_sampling_compact(&sess, &turn_context).await.is_err() {
    return None;
}
```

**压缩触发逻辑**（`session/turn.rs:1303`）：

```rust
async fn run_pre_sampling_compact(sess, turn_context) -> CodexResult<()> {
    // 1. 模型切换时压缩旧模型上下文
    maybe_run_previous_model_inline_compact(...).await?;

    // 2. 检查是否达到 auto_compact_limit
    let total_usage_tokens = sess.get_total_token_usage().await;
    let auto_compact_limit = turn_context.model_info.auto_compact_token_limit()?;
    if total_usage_tokens >= auto_compact_limit {
        run_auto_compact(sess, turn_context, DoNotInject).await?;
    }
}
```

#### 2. 上下文压缩流程（`core/src/compact.rs`，`build_compaction_replacement_history()` 位于 :80）

压缩是将长对话历史转换为摘要的核心机制：

```
历史记录 → 循环调用 LLM 生成摘要 → 替换为摘要
```

**详细步骤**：

1. **创建压缩标记**：`TurnItem::ContextCompaction`
2. **克隆历史**：`history = sess.clone_history().await`
3. **记录用户输入**：追加到历史
4. **循环调用 LLM**：
   - 调用 `drain_to_completed()` 直到成功
   - 若 `ContextWindowExceeded` 且 `turn_input_len > 1`：从头移除最旧项（保留最近消息），继续重试
5. **构建压缩后历史**：
   - 收集用户消息 + 生成摘要：`format!("{SUMMARY_PREFIX}\n{summary_suffix}")`
   - 决定是否注入初始上下文（`BeforeLastUserMessage` 或 `DoNotInject`）
6. **替换历史**：

   ```rust
   sess.replace_compacted_history(new_history, reference_context_item, compacted_item).await;
   ```

**压缩触发场景**：

- 预采样检查：token 用量超过 `auto_compact_limit`
- 轮内检查：token 用量超过 `auto_compact_limit` 且 `needs_follow_up == true`

#### 3. 记录上下文更新（`session/turn.rs:283`）

```rust
sess.record_context_updates_and_set_reference_context_item(turn_context.as_ref()).await;
```

**作用**：建立或更新参考上下文基线

```rust
// session/mod.rs:4626
pub(crate) async fn record_context_updates_and_set_reference_context_item(&self, turn_context) {
    let reference_context_item = state.reference_context_item();

    // 参考上下文为空 → 首次注入完整初始上下文
    let should_inject_full_context = reference_context_item.is_none();

    let context_items = if should_inject_full_context {
        self.build_initial_context_with_world_state(turn_context).await  // 从 AGENTS.md 等层级读取（session/mod.rs:4211）
    } else {
        // 后续轮次：只追加 diff 项，最小化 token 开销
        self.build_settings_update_items(reference_context_item.as_ref(), turn_context).await
    };

    // 记录并更新基线
    self.record_conversation_items(turn_context, &context_items).await;
    state.set_reference_context_item(Some(turn_context_item));
}
```

**初始上下文构建**（`build_initial_context_with_world_state`，`session/mod.rs:4211`）：

- 从 `AGENTS.md` 等层级读取基础指令
- 注入当前 `TurnContext` 的完整设置项（模型信息、工具配置等）

#### 4. 加载插件（`build_skills_and_plugins()`，`session/turn.rs:1030`）

```rust
let loaded_plugins = sess.services.plugins_manager.plugins_for_config(&turn_context.config);
let mentioned_plugins = collect_explicit_plugin_mentions(&input, loaded_plugins.capability_summaries());
```

- 从插件管理器获取当前会话已加载的插件
- 从用户输入中解析 `plugin://` 格式的显式引用

#### 5. 加载 MCP 工具

```rust
let mcp_tools = if turn_context.apps_enabled() || !mentioned_plugins.is_empty() {
    sess.services.mcp_connection_manager.read().await.list_all_tools()
} else {
    HashMap::new()
};
```

当应用功能启用或存在显式插件引用时，列出所有可用 MCP 工具。

#### 6. 收集可用连接器

```rust
let available_connectors = if turn_context.apps_enabled() {
    connectors::merge_plugin_apps_with_accessible(loaded_plugins.effective_apps(), ...)
} else {
    Vec::new()
};
```

合并插件提供的应用与可访问的 MCP 工具。

#### 7. 解析技能引用

```rust
let skill_name_counts_lower = build_skill_name_counts(&outcome.skills, &outcome.disabled_paths).1;
let mentioned_skills = collect_explicit_skill_mentions(&input, &outcome.skills, ...);
```

从用户输入中解析 `skill://` 格式的技能 mention。

#### 8. 处理技能依赖

- `maybe_prompt_and_install_mcp_dependencies()`（`core/src/mcp_skill_dependencies.rs:40`）检查并提示安装 MCP 依赖

#### 9. 构建技能注入

```rust
let SkillInjections { items: skill_items, warnings } = build_skill_injections(...).await;
for message in skill_warnings {
    sess.send_event(&turn_context, EventMsg::Warning(...)).await;
}
```

核心函数 `build_skill_injections()` 根据提及的技能生成技能注入内容。

#### 10. 构建插件注入

```rust
let plugin_items = build_plugin_injections(&mentioned_plugins, &mcp_tools, &available_connectors);
```

将提及的插件和 MCP 工具转换为可注入的对话项。

#### 11. 处理显式启用的连接器

```rust
explicitly_enabled_connectors.extend(collect_explicit_app_ids_from_skill_items(
    &skill_items, &available_connectors, &skill_name_counts_lower,
));
```

#### 12. 运行 Session Start Hooks（`session/turn.rs:322`；定义在 `core/src/hook_runtime.rs:128`）

```rust
if run_pending_session_start_hooks(&sess, &turn_context).await {
    return None;
}
```

执行待处理的会话启动钩子，可能终止本轮。

#### 13. 记录用户 Prompt（`session/turn.rs:366`；`run_hooks_and_record_inputs()` 位于 :864）

```rust
let user_prompt_submit_outcome = run_user_prompt_submit_hooks(...).await;
if user_prompt_submit_outcome.should_stop {
    record_additional_contexts(...);
    return None;
}
sess.record_user_prompt_and_emit_turn_item(...).await;
```

#### 14. 追踪分析事件（`track_turn_resolved_config_analytics()`）

```rust
sess.services.analytics_events_client.track_app_mentioned(...);
sess.services.analytics_events_client.track_plugin_used(...);
```

#### 15. 合并连接器选择（`session/turn.rs:387`）

```rust
sess.merge_connector_selection(explicitly_enabled_connectors.clone()).await;
```

#### 16. 记录对话项（`session/turn.rs:397`）

```rust
if !skill_items.is_empty() { sess.record_conversation_items(&turn_context, &skill_items).await; }
if !plugin_items.is_empty() { sess.record_conversation_items(&turn_context, &plugin_items).await; }
```

**历史写入流程**（`session/mod.rs:3467`）：

```rust
pub(crate) async fn record_conversation_items(&self, turn_context, items) {
    self.record_into_history(items, turn_context).await;    // 写入 ContextManager
    self.persist_rollout_response_items(items).await;     // 持久化到 rollout
    self.send_raw_response_items(turn_context, items).await; // 推送 UI
}
```

**写入 ContextManager**（`context_manager/history.rs:504`）：

```rust
pub(crate) fn record_items<I>(&mut self, items: I, policy: TruncationPolicy) {
    for item in items {
        // 只保留 API 消息（is_api_message 过滤在 record_item_with_metadata 内，history.rs:558）
        let processed = self.record_item_with_metadata(item, None, policy);  // 截断处理
        self.items.push(processed);
    }
}
```

#### 17. 创建客户端会话（`session/turn.rs:174`）

```rust
let mut client_session = prewarmed_client_session.unwrap_or_else(|| sess.services.model_client.new_session());
```

---

### 回合循环（`session/turn.rs:424` 起）

```rust
loop {
    // 1. 处理待处理输入
    let pending_input = sess.get_pending_input().await;

    // 2. 构造 Prompt 输入
    let sampling_request_input = sess.clone_history().await.for_prompt(...);

    // 3. 调用采样请求
    match run_sampling_request(...).await {
        Ok(result) => {
            if result.needs_follow_up { continue; } else { break; }
        }
        Err(...) => break,
    }

    // 4. 可能的 auto-compact
    if token_limit_reached && needs_follow_up {
        run_auto_compact(...).await?;
        continue;
    }
}
```

#### 待处理输入检查（`session/turn.rs:428-434`）

```rust
let pending_input = sess.get_pending_input().await;
for pending_input_item in pending_input {
    match inspect_pending_input(&sess, &turn_context, pending_input_item).await {
        PendingInputHookDisposition::Accepted(pending_input) => { ... }
        PendingInputHookDisposition::Blocked { additional_contexts } => {
            // 重新排队或中断
        }
    }
}
```

处理用户在模型运行期间通过 UI 提交的消息，可能被 hook 阻止或重新排队。

#### Prompt 输入构造（`session/turn.rs:524-527`）

```rust
let sampling_request_input = sess.clone_history().await
    .for_prompt(&turn_context.model_info.input_modalities);
```

**历史归一化**（`history.rs:600`）：

```rust
pub(crate) fn for_prompt(mut self, input_modalities) -> Vec<ResponseItem> {
    self.normalize_history(input_modalities);  // 修复 call/output 对、剥离图片
    self.items
}
```

**normalize_history 保证**：

1. 每个 call 有对应的 output
2. 每个 output 有对应的 call
3. 当模型不支持图片时，从消息和工具输出中剥离图片

#### 轮结束条件

**`needs_follow_up` 为 true 时继续循环**：

1. 工具调用需要后续处理（执行结果待返回）
2. 存在待处理的用户输入（`sess.input_queue.has_pending_input()`，`session/input_queue.rs:438`）

**返回值**：`Option<String>` — 最后一条 agent 消息文本，或 None（被 hook 中断）。

---

### 上下文管理关键流程图

![上下文管理关键流程图](diagrams/03-agent-loop-diagram-03.svg)

**上下文管理关键流程图** — [交互版](diagrams/03-agent-loop-diagram-03.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-agent-loop-diagram-03.architecture.json)

- **组成**：画布 14 个节点 · 源图共 27 个节点，其余见正文
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：用户输入 · 末节点：runpendingsessionstarthooks()…

## 第三层：run_sampling_request（LLM 编排与重试）

**位置**：`sources/codex/codex-rs/core/src/session/turn.rs:1603`

### 核心序列

1. **获取基础指令**（`session/turn.rs:1620`）：`sess.get_prompt_base_instructions()` 读取层级的 `AGENTS.md`，受字节预算限制
2. **创建工具运行时**（`session/turn.rs:1623`）：`ToolCallRuntime::new()`（工具集在更早的 `capture_step_context_with_required_mcp_servers()` 中组装完成）
3. **启动 Code Mode Worker**（`session/turn.rs:1630`）：`code_mode_service.start_turn_worker()`
4. **重试循环**（`session/turn.rs:1638`）：每轮构建 Prompt 并调用 `try_run_sampling_request()`，错误交给 `handle_response_stream_error()`

### Prompt 构建（`session/turn.rs:1562`）

```rust
pub(crate) fn build_prompt(
    input: Vec<ResponseItem>,          // 对话历史
    step_context: &StepContext,        // 步骤级快照（turn + tool_router + settings）
    base_instructions: BaseInstructions,
    incremental_tools: bool,           // 增量工具窗口时由服务端补发工具声明
) -> Prompt {
    let turn_context = &step_context.turn;
    Prompt {
        input,
        tools: if incremental_tools { Arc::default() }
               else { step_context.tool_router.model_visible_specs() },
        parallel_tool_calls: true,
        base_instructions,          // incremental_tools 时由 Responses API 增量下发
        output_schema: turn_context.final_output_json_schema.clone(),
        ...
    }
}
```

**关键细节**：延迟启用的动态工具不会塞进模型可见工具列表 —— `core/src/tools/registry.rs:81` 的 `is_third_party_tool()` 标记 MCP/app 与客户端动态工具（built-in 同名也不抢占），动态工具的执行处理在 `core/src/tools/handlers/dynamic.rs`，模型可见性由 `ToolRouter::model_visible_specs()` 统一裁决。

### 重试循环（`session/turn.rs:1638` 起；重试决策在 `core/src/responses_retry.rs:57`）

```rust
let mut retry_state = ResponsesStreamRetryState::default();  // turn.rs:1634
loop {
    // 构建本轮 Prompt 并调用 try_run_sampling_request(...)
    match try_run_sampling_request(...).await {
        Ok(output) => return Ok(output),
        Err(CodexErrorDetails::ContextWindowExceeded) => return Err(...),
        Err(CodexErrorDetails::UsageLimitReached(e)) => return Err(...),
        Err(err) => err,
    };

    // 重试与降级决策收敛到 responses_retry.rs 的 handle_response_stream_error()（turn.rs:1705 调用）
    handle_response_stream_error(&mut retry_state, max_retries, err, client_session, ...).await??;
}
```

**重试策略**（`responses_retry.rs:57`，`handle_response_stream_error()`）：

1. 调用 `try_run_sampling_request()`
2. 若 `ContextWindowExceeded` 或 `UsageLimitReached`：直接返回错误
3. `CodexErr::retry_delay(retry_count)`（`protocol/src/error.rs:397`）返回 `None` 即不可重试的终态错误：直接返回错误
4. 若可重试且 `retries >= max_retries`：尝试 WebSocket 到 HTTPS 回退（`try_switch_fallback_transport()`，`core/src/client.rs:2296`；回退分支在 `responses_retry.rs:121`），重置计数器继续
5. 若可重试且 `retries < max_retries`：优先使用 server-provided delay（`retry_after`），否则指数退避 `200ms * 2^retries`（±10% 抖动，`async-utils/src/backoff.rs:12`）
6. 若开启 `UnboundedConnectionRetries` 特性且是 `ConnectionFailed`：按 5s 起步、最长 60s 的连接重试节奏无限等待网络恢复（`responses_retry.rs:96` 起）

## 第四层：try_run_sampling_request（流式响应循环）

**位置**：`sources/codex/codex-rs/core/src/session/turn.rs:2512`

### 核心流程

1. **发起流式请求**（`session/turn.rs:2563`）：`client_session.stream(prompt, ...)`
2. **初始化状态**（`session/turn.rs:2579-2601`）：
   - `in_flight`：并发工具调用队列（`FuturesOrdered`）
   - `needs_follow_up`：控制回合循环是否继续
   - `active_item`：当前正在流式传输的消息
   - `plan_mode_state`：Plan Mode 协作模式的状态
3. **流式事件循环**（`session/turn.rs:2603` 起）：逐个处理 `ResponseEvent`

### 流式事件处理（`session/turn.rs:2603` 起的事件循环）

```rust
loop {
    let event = stream.next().await?;
    match event {
        // 响应已创建
        ResponseEvent::Created => {}

        // 新增输出项：处理非工具调用的内容
        ResponseEvent::OutputItemAdded(item) => {
            if let Some(turn_item) = handle_non_tool_response_item(...).await {
                sess.emit_turn_item_started(&turn_context, &turn_item).await;
                active_item = Some(turn_item);
            }
        }

        // 工具调用完成：触发工具执行
        ResponseEvent::OutputItemDone(item) => {
            let output_result = handle_output_item_done(&mut ctx, item, previously_active_item).await?;
            if let Some(tool_future) = output_result.tool_future {
                in_flight.push_back(tool_future);  // 加入并发队列
            }
            needs_follow_up |= output_result.needs_follow_up;
        }

        // 推理摘要增量（o4-mini 等模型）
        ResponseEvent::ReasoningSummaryDelta { delta, summary_index } => {
            sess.send_event(&turn_context, EventMsg::ReasoningContentDelta(event)).await;
        }

        // 速率限制更新
        ResponseEvent::RateLimits(snapshot) => {
            sess.update_rate_limits(&turn_context, snapshot).await;
        }

        // 响应完成：返回结果
        ResponseEvent::Completed { response_id, token_usage } => {
            sess.update_token_usage_info(&turn_context, token_usage.as_ref()).await;
            needs_follow_up |= sess.has_pending_input().await;
            break Ok(SamplingRequestResult { needs_follow_up, last_agent_message });
        }
    }
}
```

### 关键状态追踪

| 变量 | 类型 | 用途 |
| --- | --- | --- |
| `in_flight` | `FuturesOrdered<...>` | 并发工具调用队列（有序） |
| `active_item` | `Option<TurnItem>` | 当前正在流式传输的消息 |
| `needs_follow_up` | `bool` | 控制回合循环是否继续 |
| `plan_mode_state` | `Option<PlanModeStreamState>` | Plan Mode 协作模式状态 |

### 收尾处理（`session/turn.rs:3164` 起）

```rust
// 1. 排空所有在飞的工具调用（drain_in_flight 定义在 turn.rs:2459）
drain_in_flight(&mut in_flight, sess.clone(), &step_context).await?;

// 2. 可能的 turn diff 发射（turn.rs:3185）
if should_emit_turn_diff {
    let unified_diff = turn_diff_tracker.lock().await.get_unified_diff();
    sess.send_event(&turn_context, EventMsg::TurnDiff(TurnDiffEvent { unified_diff })).await;
}
```

## 传输层：WebSocket vs HTTPS

### 传输选择（`client.rs:2237`）

```rust
pub async fn stream(...) -> Result<ResponseStream> {
    if self.client.responses_websocket_enabled() {
        match self.stream_responses_websocket(...).await? {
            WebsocketStreamOutcome::Stream(s) => return Ok(s),
            WebsocketStreamOutcome::FallbackToHttp => {
                self.try_switch_fallback_transport(...);
            }
        }
    }
    self.stream_responses_api(...).await  // HTTPS 回退
}
```

### WebSocket 路径（`client.rs:1853`）

- **延迟连接**：首次请求时打开，turn 内缓存复用
- **跨重试复用**：同一 turn 内的重试共享 WebSocket 连接
- **增量请求**：通过 `previous_response_id` 支持增量
- **Sticky routing**：`x-codex-turn-state` header 保证路由一致性
- **超时**：provider-specific（默认 10s）

### HTTPS 路径（`client.rs:1662`）

- 标准 HTTP POST + SSE 流式
- 认证恢复循环（401 时刷新 token）
- 压缩：ChatGPT 认证使用 Zstd

### 关键不变量

- **每轮新建 `ModelClientSession`**：确保 sticky routing token 不跨轮复用
- **WebSocket 会话 turn 内缓存、turn 边界丢弃**
- **WebSocket 到 HTTPS 回退是会话级一次性操作**（`AtomicBool` 保证单次激活）

## 上下文管理

### ContextManager（`context_manager/history.rs:93`）

```rust
pub(crate) struct ContextManager {
    items: Arc<Vec<ResponseItemEnvelope>>,  // 最旧到最新（Arc 共享快照）
    token_info: Option<TokenUsageInfo>,
    reference_context_item: Option<TurnContextItem>,
}
```

关键方法：

| 方法 | 用途 |
| --- | --- |
| `record_items()` | 追加并过滤 items（:504）|
| `for_prompt()` | 归一化并返回 prompt 所需的历史（:600）|
| `estimate_token_count()` | 基于字节的 token 估算 |

### 历史流转

1. `sess.clone_history().await` 得到 ContextManager
2. `history.for_prompt(&input_modalities)` 得到 `Vec<ResponseItem>`
3. `build_prompt(history, tools, ...)` 得到 Prompt
4. 流式响应
5. 工具输出记录，进入下一轮历史

## 核心数据结构

### TurnContext（`session/turn_context.rs:321`）

每轮不可变设置，约 40 个字段：

- `sub_id`, `model_info`, `reasoning_effort`, `collaboration_mode`
- `approval_policy`, `sandbox_policy`, `network_sandbox_policy`
- `tools_config`, `features`, `turn_metadata_state`
- `personality`, `final_output_json_schema`

### ActiveTurn（`state/turn.rs:30`）

```rust
pub(crate) struct ActiveTurn {
    pub(crate) task: Option<RunningTask>,
    pub(crate) turn_state: Arc<Mutex<TurnState>>,
}
```

TurnState 包含：

- `pending_approvals` — 待审批的工具调用
- `pending_request_permissions` — 待请求的权限
- `pending_user_input` — 待用户输入
- `pending_elicitations` — 待补全的 elicit 响应
- `pending_dynamic_tools` — 待动态工具响应
- `pending_input: TurnInputQueue` — 待处理输入
- `mailbox_delivery_phase` — 控制邮箱消息加入当前轮还是下一轮
- `tool_calls: u64` — 本轮工具调用计数
- `token_usage_at_turn_start` — 轮开始时的 token 用量

### SamplingRequestResult（`session/turn.rs:1869`）

```rust
struct SamplingRequestResult {
    needs_follow_up: bool,
    last_agent_message: Option<String>,
}
```

### Prompt Cache

- Prompt cache key 设为对话 ID，跨轮复用缓存
- 启用 OpenAI prompt caching 特性

## 并发模型

| 维度 | 策略 |
| --- | --- |
| Agent 循环 | **单线程**：每个 session 的所有操作在单个 Tokio task 上顺序执行 |
| 工具调用 | **轮内并发**：`FuturesOrdered` 隐式等待结果，保持有序并发 |
| 多会话 | **无同步**：每个 session 独立 Tokio task |

### RwLock 并发控制模型

`codex-rs/core/src/tools/parallel.rs` 使用 `RwLock<()>` 实现工具级并发控制，比 Claude Code 的预分批策略更细粒度：

```rust
pub(crate) struct ToolCallRuntime {
    router: Arc<ToolRouter>,
    session: Arc<Session>,
    turn_context: Arc<TurnContext>,
    tracker: SharedTurnDiffTracker,
    parallel_execution: Arc<RwLock<()>>,  // 读写锁控制并发
}
```

**执行策略**（`parallel.rs:206-208`）：

```rust
let _guard = if supports_parallel {
    Either::Left(lock.read().await)   // 读锁 → 允许多工具并行
} else {
    Either::Right(lock.write().await) // 写锁 → 互斥执行
};
```

- **只读工具**（如文件读取、搜索）：获取读锁（共享），多个可同时执行
- **写入工具**（如文件编辑、命令执行）：获取写锁（互斥），等待所有读锁释放后独占

这比 Claude Code 的 `partitionToolCalls()` 分批策略更优雅：不需要预先对工具序列分组，锁竞争自然实现排序。

### FuturesOrdered 流水线

`try_run_sampling_request()` 中的工具派发使用 `FuturesOrdered`（`session/turn.rs:2579`），保证：

1. 工具在模型流式输出期间就开始执行（不等响应完成）
2. 结果按派发顺序收集（确保历史记录一致性）
3. 通过 `drain_in_flight()`（`session/turn.rs:3164` 调用，定义于 :2459）在响应完成后排空所有待完成工具

### needs_follow_up 追踪流

`needs_follow_up` 是决定 turn 循环继续或退出的核心标志，其设置点分散在多个层：

| 设置位置 | 代码行 | 触发条件 |
| :----------| :--------| :----------|
| 工具调用派发 | `session/turn.rs:2774` | `handle_output_item_done()` 返回含工具 future |
| 待处理输入 | `session/turn.rs:563` | `sess.input_queue.has_pending_input().await` 为 true |
| 轮循环判断 | `session/turn.rs:656` | `!needs_follow_up` → break |
| Token 超限 | `session/turn.rs:574`、:608 | `token_limit_reached && needs_follow_up` → auto compact 后 continue |

### 审批系统与异步中断

Codex 独特之处在于审批不在 loop 内部轮询，而是通过 `submission_loop` 的 `Op` 通道异步注入：

| 审批类型 | Op 变体 | 代码位置 | 机制 |
| :----------| :---------| :----------| :------|
| 命令执行审批 | `Op::ExecApproval` | `session/handlers.rs:638` | `approval_store` 查找 → 解除阻塞 |
| Patch 审批 | `Op::PatchApproval` | `session/handlers.rs:646` | `ReviewDecision` 路由 → apply/reject/review |

这种设计让审批请求可以在 turn 运行期间随时到达，不需要 loop 主动检查。

### 传输层降级

`run_sampling_request()` 实现了 WebSocket → HTTPS 的传输降级（降级决策在 `core/src/responses_retry.rs` 的 `handle_response_stream_error()`，由 `session/turn.rs:1705` 调用）：

```rust
// responses_retry.rs:121（turn.rs:1705 调用）
if retry_state.retries >= max_retries
    && client_session.try_switch_fallback_transport(...) {
    retry_state.retries = 0;  // 重置重试计数
    return Ok(());            // 回到外层循环，继续走 HTTPS
}
```

这是四个工程中唯一实现了传输层降级的，确保网络条件不佳时仍能完成请求。

---

## 关键函数清单

| 函数/类型 | 文件 | 行号 | 职责 |
| :----------| :------| :------| :------|
| `submission_loop()` | `codex-rs/core/src/session/handlers.rs` | 439 | 第一层：会话事件分发器，单线程顺序处理所有 `Op::TurnInput` |
| `run_turn()` | `codex-rs/core/src/session/turn.rs` | 163 | 第二层：单轮控制器，token 预算检查 + 循环终止判断 |
| `run_sampling_request()` | `codex-rs/core/src/session/turn.rs` | 1603 | 第三层：LLM 调用编排与重试，构造完整 streaming 请求 |
| `try_run_sampling_request()` | `codex-rs/core/src/session/turn.rs` | 2512 | 第四层：消费流式响应，通过 `FuturesOrdered` 并发调度工具 |
| `TurnContext` | `codex-rs/core/src/session/turn_context.rs` | 321 | 单轮不可变设置（~40字段）：model、approval_policy、sandbox_policy 等 |
| `ActiveTurn` | `codex-rs/core/src/state/turn.rs` | 30 | 单轮可变状态：pending tools、approvals、token 计数、mailbox phase |
| `SamplingRequestResult` | `codex-rs/core/src/session/turn.rs` | 1869 | 工具执行结果聚合，决定下一轮是否继续的 `needs_follow_up` 标志 |

---

## 代码质量评估

**优点**

- **四层嵌套分层清晰**：`submission_loop` → `run_turn` → `run_sampling_request` → `try_run_sampling_request`，各层职责边界明确，`submission_loop` 只做事件分发，流式消费只在最内层。
- **单线程 + 轮内并发**：每个 session 的主循环单线程顺序执行，消除会话级别的竞态；工具调用通过 `FuturesOrdered` 实现轮内有序并发，兼顾安全与性能。
- **token 预算双保险**：`run_turn` 在采样前检查 `auto_compact_limit`，`try_run_sampling_request` 在流处理后再次检查，避免无限膨胀。
- **Prompt Cache 对话复用**：以对话 ID 为 cache key，跨轮复用 OpenAI prompt cache，减少重复 token 消耗。

**风险与改进点**

- **四层嵌套调用栈深**：一次请求要穿越四层函数，调试和错误追踪需要跨多个抽象层级，日志定位成本较高。
- **`needs_follow_up` 单标志位**：下一轮是否继续推理完全由 `bool needs_follow_up` 决定，没有携带结构化的"退出原因"，复杂决策逻辑难以扩展。
- **并发工具结果缺乏超时保护**：`FuturesOrdered` 会一直等待最慢的工具，如果某个工具挂起，整个 turn 会阻塞直到外层 cancel 触发。

## 源码锚点：Codex Loop 是 core submission 到 sampling 的四层闭环

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/core/src/session/handlers.rs:439` | `submission_loop()` 消费 core submission 队列 | 对应 Claude `query()`、OpenCode `loop()` |
| `sources/codex/codex-rs/core/src/session/turn.rs:163` | `run_turn()` 单轮控制器 | 对应 Gemini `processTurn()` |
| `sources/codex/codex-rs/core/src/session/turn.rs:1603` | `run_sampling_request()` 组装并发起模型请求 | 对应 OpenCode `LLM.stream()` 调用前 |
| `sources/codex/codex-rs/core/src/session/turn.rs:2512` | `try_run_sampling_request()` 消费 streaming 响应并调度工具 | 对应 Gemini `Turn.run()` |
| `sources/codex/codex-rs/tui/src/app/thread_routing.rs:500` | TUI 把用户操作转成 thread op | 说明 UI 不是直接进入模型 |
| `sources/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:492` | app-server 将请求提交到 core | 连接 SDK/transport 章节 |

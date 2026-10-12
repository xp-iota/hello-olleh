---
title: "工具调用机制：工具注册、权限控制、执行闭环与结果回传"
---
# 工具调用机制：工具注册、权限控制、执行闭环与结果回传

主向导对应章节：`工具调用机制`

**目录**

- [工具系统目录结构](#工具系统目录结构)
- [工具注册机制](#工具注册机制)
- [工具调用生命周期（4 阶段）](#工具调用生命周期4-阶段)
- [权限与审批模型](#权限与审批模型)
- [沙箱类型](#沙箱类型)
- [网络审批系统](#网络审批系统)
- [内建工具类型（30+）](#内建工具类型30)
- [工具输出与结果回传](#工具输出与结果回传)
- [并行工具执行](#并行工具执行)
- [Hooks 集成](#hooks-集成)
- [完整调用链总结](#完整调用链总结)

---

## 工具系统目录结构

![工具系统目录结构](diagrams/05-tool-system-diagram.svg)

**工具系统目录结构** — [交互版](diagrams/05-tool-system-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-tool-system-diagram.architecture.json)

- **组成**：画布 14 个节点 · 源图共 24 个节点，其余见正文
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：codex-rs/core/src/tools/ · 末节点：mcp.rs # MCP 工具分发

## 工具注册机制

### 入口：spec_plan 的注册管线

**位置**：`sources/codex/codex-rs/core/src/tools/spec_plan.rs`

注册过程：

1. **构建核心工具注册表**：`build_core_tool_registry()`（`spec_plan.rs:295`）创建内建工具的 handler（shell、unified exec、apply_patch、mcp、mcp_resource、plan、request_permissions、request_user_input、tool_search、dynamic、test_sync、sleep、request_plugin_install、multi-agent V1/V2 等）并装入 `ToolRegistry`（`core/src/tools/registry.rs:301`）
2. **并入外部来源工具**：`append_source_tools()`（`spec_plan.rs:323`）把 MCP/app 等第三方工具并入注册表 —— 内建工具走 `register_trusted()`（`registry.rs:340`），外部工具走 `register_external()`（`registry.rs:380`），同名时内建工具不被外部工具抢占
3. **工具规范**：`ToolSpec` 类型（`sources/codex/codex-rs/tools/src/tool_spec.rs:22`）序列化为 OpenAI Responses API 的合法 "Tool" JSON
4. **收口**：`finalize_tool_router()`（`spec_plan.rs:370`）与 `build_tool_router()`（`spec_plan.rs:123`）产出 `ToolRouter`，模型可见工具列表由 `build_model_visible_specs()`（`spec_plan.rs:614`）统一裁决

### 工具来源

| 来源 | 注册方式 | 示例 |
| --- | --- | --- |
| 内建工具 | `build_core_tool_registry()` 静态注册 | shell, apply_patch, plan |
| MCP 工具 | `McpConnectionSet` 动态发现 | `mcp__server__tool` |
| 动态工具 | 运行时注册 | DynamicToolSpec |
| App/Connector | 经 MCP 层代理 | ChatGPT Apps |

## 工具调用生命周期（4 阶段）

![工具调用生命周期（4 阶段）](diagrams/05-tool-system-4.svg)

**工具调用生命周期（4 阶段）** — [交互版](diagrams/05-tool-system-4.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-tool-system-4.architecture.json)

- **组成**：6 个节点
- **关系**：源图 5 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：模型输出 / ResponseItem → Phase 1: 解析 / ToolRoute… · Phase 1: 解析 / ToolRoute… → Phase 2: 路由 / ToolRoute… · Phase 2: 路由 / ToolRoute… → Phase 3: 注册表分发 / Too…

### Phase 1：解析模型输出为 ToolCall

**函数**：`ToolRouter::build_tool_call()`（`router.rs:246`）

- **输入**：模型返回的 `ResponseItem`
- **输出**：`ToolCall { tool_name, call_id, truncation_policy, source, environments, payload }`（`tools/src/tool_call.rs:147`）
- **Payload 类型**（3 种，`tools/src/tool_payload.rs:7`）：

```rust
pub enum ToolPayload {
    Function { arguments: String },           // JSON 参数
    ToolSearch { arguments: SearchToolCallParams },
    Custom { input: String },                 // 任意格式
}
```

### Phase 2：构建 ToolInvocation 并路由

**函数**：`ToolRouter::dispatch_tool_call_with_code_mode_result()`（`router.rs:302`）

- 创建 `ToolInvocation`（`core/src/tools/context.rs:70`，包含 session、step context、tracker、payload）
- 调用 `self.registry.dispatch_any_with_state(invocation, call_state)`（`registry.rs:533`）

### Phase 3：注册表分发

**函数**：`ToolRegistry::dispatch_any_with_state()`（`registry.rs:533`）

执行步骤：

1. **Handler 查找**（找不到则报错）
2. **Pre-tool-use hooks**（`run_pre_tool_use_hooks()`，`hook_runtime.rs:188`；可阻断执行）
3. **Mutating 检查**（变异工具门控）
4. **Handler 执行**（含遥测与 dispatch trace）
5. **Post-tool-use hooks**（`run_post_tool_use_hooks()`，`hook_runtime.rs:297`；可修改输出）

### Phase 4：编排执行（ToolOrchestrator）

**函数**：`ToolOrchestrator::run()`（`orchestrator.rs:125`）

三阶段流程：

#### 阶段 A：审批检查（`orchestrator.rs:140` 起；`request_approval()` 在 :220）

```rust
let requirement = tool.exec_approval_requirement(req)
    .unwrap_or_else(|| default_exec_approval_requirement(approval_policy, &file_system_sandbox_policy));

match &requirement {
    ExecApprovalRequirement::Skip { .. } => { /* 无需审批 */ },
    ExecApprovalRequirement::Forbidden { reason } => {
        return Err(ToolError::Rejected(reason.clone()));
    },
    ExecApprovalRequirement::NeedsApproval { reason, .. } => {
        let action = tool.approval_action(req, &tool_ctx.call_id)?;
        // 构造 ApprovalContext（含 Guardian review 上下文与取消 token）
        tool_ctx.session.request_approval(action, approval_ctx).await?;
    },
}
```

#### 阶段 B：首次沙箱尝试（`sandbox_manager.select_initial()` 调用在 :340；`run_attempt()` 在 :381）

```rust
let initial_sandbox = if sandbox_requested && !executor_managed_process_sandbox {
    sandbox_manager.select_initial(
        initial_permissions,
        sandbox_preference,
        windows_sandbox_type,
        managed_network_active,
    )
};
let (first_result, first_deferred_network_approval) =
    Self::run_attempt(tool, req, tool_ctx, &initial_attempt, network_approval_spec).await;
```

#### 阶段 C：沙箱拒绝升级（`escalate_on_failure()` 判断在 :426；升级审批在 :510）

```rust
Err(ToolError::Codex(err)) => {
    let CodexErrorDetails::Sandbox(SandboxErr::Denied { output, network_policy_decision }) = err.details()
    else { /* 非沙箱拒绝错误：直接返回 */ };
    if !tool.escalate_on_failure() { return Err(...); }
    // 沙箱拒绝且允许升级时，重新走审批（retry_reason 标注升级原因）
    tool_ctx.session.request_approval(action, escalation_ctx).await;
    // 重选沙箱（unsandboxed_allowed 时退回 SandboxType::None）后重试
    Self::run_attempt(tool, req, tool_ctx, &retry_attempt, network_approval_spec).await
}
```

## 权限与审批模型

### 审批策略枚举

```rust
enum AskForApproval {
    UnlessTrusted,                     // 非受信项目：除非 exec policy 放行，一律询问
    OnRequest,                         // 默认：受限文件系统沙箱时询问
    Granular(GranularApprovalConfig),  // 细粒度控制各类审批开关
    Never,                             // 从不询问，失败直接回传模型
}
```

（`protocol/src/protocol.rs:1002`；`OnRequest` 为默认值。）

### 审批缓存（`sandboxing.rs:71`）

```rust
pub(crate) async fn with_cached_approval<K, F, Fut>(
    services: &SessionServices,
    tool_name: &str,
    keys: Vec<K>,
    fetch: F,
) -> ReviewDecision
```

- 检查所有 key 是否已在本会话中获批
- 若全部已批准，跳过重复提示
- 缓存粒度：per-key（序列化为 JSON 的类型擦除 HashMap）

### 审批决定类型

| 类型 | 含义 |
| --- | --- |
| `Approved` | 单次批准 |
| `ApprovedForSession` | 会话内批准（缓存） |
| `ApprovedExecpolicyAmendment` | 批准并持久化 execpolicy 修正 |
| `ApprovedMcpPolicyAmendment` | 批准并修正 MCP 工具策略 |
| `Denied` | 拒绝 |
| `TimedOut` | 自动审批超时 |
| `Abort` | 拒绝并中止后续动作 |
| `NetworkPolicyAmendment` | 网络策略修正 |

### 默认审批判定（`sandboxing.rs:195`）

```rust
pub fn default_exec_approval_requirement(
    policy: AskForApproval,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
) -> ExecApprovalRequirement {
    let needs_approval = match policy {
        Never | OnFailure => false,
        OnRequest | Granular(_) => matches!(fs_policy.kind, Restricted),
        UnlessTrusted => true,
    };
    // ...
}
```

## 沙箱类型

| 沙箱类型 | 平台 | 实现 |
| --- | --- | --- |
| `None` | 全平台 | 无隔离 |
| `MacosSeatbelt` | macOS | `/usr/bin/sandbox-exec` + SBPL 策略文件 |
| `LinuxSeccomp` | Linux | bubblewrap + seccomp + landlock |
| `WindowsRestrictedToken` | Windows | Job objects + restricted tokens |

沙箱选择逻辑（`sandboxing/src/manager.rs:310` 的 `select_initial()`）基于四个输入：

1. `permission_profile`：ReadOnly / WorkspaceWrite / DangerFullAccess 等文件系统权限
2. `pref`（`SandboxablePreference`）：Auto / Prefer / Require / Forbid
3. `windows_sandbox_type`：Windows 平台沙箱类型
4. `has_managed_network_requirements`：是否有受管网络要求

## 网络审批系统

**位置**：`network_approval.rs`（约 1,250 行）

网络审批由 `NetworkApprovalSpec`（`network_approval.rs:56`）描述，持有 `NetworkProxy`、触发来源（`GuardianNetworkAccessTrigger`）、工具名、环境 ID 与权限 profile；审批既可同步完成，也可挂起为 `DeferredNetworkApproval`（`network_approval.rs:68`，携带 registration ID 与 cancellation token），在工具执行期间由外层补交决定。

网络审批缓存按 `(host, protocol, port)` 三元组存储：

```rust
struct HostApprovalKey {
    host: String,
    protocol: &'static str,  // "http", "https", "socks5-tcp", "socks5-udp"
    port: u16,
}
```

## 内建工具类型

| 分类 | 工具 | 说明 |
| --- | --- | --- |
| 执行 | shell, unified_exec, apply_patch | 命令执行、高级执行、补丁应用 |
| 文件 | view_image | 图像查看（只读） |
| 搜索 | tool_search | 工具搜索 |
| 权限 | request_permissions, request_user_input | 请求权限、请求用户输入 |
| MCP | mcp, mcp_resource | MCP 工具分发、MCP 资源访问 |
| 多代理 | multi_agents V1/V2 | 多代理协作 |
| 上下文 | get_context_remaining, new_context_window | 查询/重开上下文窗口 |
| 其他 | plan, dynamic, test_sync, sleep, request_plugin_install, current_time, wait_for_environment, send_message_to_user_async, extension_tools | 规划、动态工具、测试同步、等待与消息回传等 |

## 工具输出与结果回传

### ToolOutput trait（`tools/src/tool_output.rs:12`）

工具输出统一实现 `ToolOutput` trait，核心方法：

```rust
pub trait ToolOutput: Send {
    fn log_output(&self) -> String;            // 日志用有损摘要（遥测字节上限由 logger 持有）
    fn success_for_logging(&self) -> bool;
    fn set_handler_duration_ms(&mut self, _handler_duration_ms: u64) {}
    fn contains_external_context(&self) -> bool { false }
    fn fallback_token_limit_override(&self) -> Option<usize> { None }
    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem;
    fn post_tool_use_id(&self, call_id: &str) -> String { call_id.to_string() }
    fn post_tool_use_input(&self, _payload: &ToolPayload) -> Option<JsonValue> { None }
    fn post_tool_use_response(&self, _call_id: &str, _payload: &ToolPayload) -> Option<JsonValue> { None }
    fn code_mode_result(&self, payload: &ToolPayload) -> JsonValue { ... }
    fn tool_result_metadata(&self) -> Option<&JsonValue> { None }
}
```

要点：`log_output` 只是诊断摘要而非权威结果；`post_tool_use_*` 三个方法把输出适配成 `PostToolUse` hook 的稳定契约；`fallback_token_limit_override` 让各工具在自身截断之后覆盖 history 的兜底 token 上限。

### 输出格式化

shell 类工具输出统一走 `format_exec_output_for_model()`（`core/src/tools/mod.rs:101`），自由格式：

```
Exit code: 0
Wall time: 1.23 seconds
Total output lines: 42
Output:
<text>
```

### 截断策略

`TruncationPolicy`（`protocol/src/protocol.rs:3392`）只有两种截断口径：

- `Bytes(usize)` — 按字节数截断
- `Tokens(usize)` — 按 token 数截断

## 并行工具执行

**位置**：`core/src/tools/parallel.rs`

```rust
pub(crate) struct ToolCallRuntime {
    session: Arc<Session>,
    step_context: StepContext,
    tracker: SharedTurnDiffTracker,
    parallel_execution: Arc<RwLock<()>>,  // 同步点
}
```

锁策略：

```rust
let _guard = if supports_parallel {
    Either::Left(lock.read().await)    // 多读者并行
} else {
    Either::Right(lock.write().await)  // 独占锁串行
};
```

取消：`CancellationToken` + `tokio::select!`

## Hooks 集成

| Hook 类型 | 触发时机 | 能力 |
| --- | --- | --- |
| PreToolUse（`core/src/hook_runtime.rs:188` 的 `run_pre_tool_use_hooks()`） | Handler 执行前 | 可阻断执行或改写输入，接收稳定的 hook 契约 |
| PostToolUse（`core/src/hook_runtime.rs:297` 的 `run_post_tool_use_hooks()`） | 工具成功产出后 | 可修改或拒绝输出，接收 `post_tool_use_response` JSON |

## 完整调用链总结

```
模型输出 (ResponseItem)
         |
ToolRouter::build_tool_call()  ->  ToolCall
         |
ToolRouter::dispatch_tool_call_with_code_mode_result()  ->  ToolInvocation
         |
ToolRegistry::dispatch_any_with_state()
  | :-- Lookup handler
  | :-- PreToolUse hooks (can block / rewrite input)
  | :-- Handler::handle() execution
  +-- PostToolUse hooks (can modify output)
         |
ToolOrchestrator::run()
  | :-- Phase A: Approval check
  | :-- Phase B: First sandbox attempt
  +-- Phase C: Escalate on denial
         |
SandboxAttempt  ->  Execution (Shell, MCP, etc.)
         |
ToolOutput implementations
         |
Format for Model (format_exec_output_for_model)
         |
ResponseInputItem (回传给模型)
```

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `build_core_tool_registry()` / `finalize_tool_router()` | `codex-rs/core/src/tools/spec_plan.rs:295` / `:370` | 注册内建工具并装配 `ToolRouter`（内置 + Dynamic + MCP）|
| `ToolRegistry::register_trusted()` / `register_external()` | `codex-rs/core/src/tools/registry.rs:340` / `:380` | 内建工具与外部（MCP/dynamic）工具的注册入口 |
| `ToolRouter::build_tool_call()` | `codex-rs/core/src/tools/router.rs:246` | 把模型输出解析成 `ToolCall`（含 `ToolPayload` 三变体）|
| `ToolRegistry::dispatch_any_with_state()` | `codex-rs/core/src/tools/registry.rs:533` | 统一分发入口：查 handler → Pre hooks → 执行 → Post hooks |
| `ToolOrchestrator::run()` | `codex-rs/core/src/tools/orchestrator.rs:125` | 审批（Phase A）→ 首次沙箱执行（Phase B）→ 拒绝升级（Phase C）|
| `ExecApprovalRequirement` | `codex-rs/core/src/tools/sandboxing.rs:153` | 命令审批需求类型（Never / IfNeeded 等）|
| `FuturesOrdered::push_back()` | （tokio，用于 `core/src/session/turn.rs:2579`） | 工具并发执行队列入口，保证有序结果收集 |
| `format_exec_output_for_model()` | `codex-rs/core/src/tools/mod.rs:101` | 将 shell 类输出格式化为模型可消费的自由格式文本 |

---

## 代码质量评估

**优点**

- **四阶段生命周期清晰**：注册 → 调用决策（审批）→ 沙箱隔离执行 → 结果格式化，每阶段职责单一，可独立测试。
- **多层沙箱可组合**：`SandboxType::None`、macOS Seatbelt、Linux seccomp/landlock、Windows restricted token 四级隔离按需启用，安全策略从宽松到严格均有覆盖。
- **`FuturesOrdered` 并发有序**：工具并发执行，但结果按请求顺序收集，保证回传给模型的 `ResponseInputItem` 顺序一致。
- **网络审批独立体系**：对外向网络请求设置独立的 `NetworkApprovalSpec` 策略，与本地文件操作审批解耦。

**风险与改进点**

- **内置工具超 30 种**：工具种类多，统一的 `ToolRegistry` 维护所有类型，若没有清晰的分组/分文件管理，未来扩展可能产生命名冲突。
- **沙箱能力依赖宿主 OS**：macOS Seatbelt 和 Linux seccomp 无法在对方平台使用，跨平台测试覆盖较难统一。
- **工具输出 token 预算分散**：截断口径（`TruncationPolicy` 的 Bytes/Tokens）与 `fallback_token_limit_override` 分散在各工具实现里，没有全局统一的输出 token 预算文档。
- **Dynamic tools 延迟加载**：`DynamicTool` 在工具调用时才解析 schema，若远程 MCP server 不可用，错误只在运行时暴露而非启动时。

## Codex 工具治理以 approval/sandbox 为中心

Codex 工具系统的横向价值在于把 built-in、MCP、dynamic tools、network 和 patch 操作收束到同一套 Rust orchestration。

| 层级 | Codex 侧对象 | 横向对比 |
| --- | --- | --- |
| 工具声明 | tool specs / dynamic tools | 对应 Claude/Gemini/OpenCode registry |
| 执行编排 | `tools/orchestrator.rs` | 对应 Claude `runTools()`、Gemini Scheduler |
| 审批沙箱 | `tools/sandboxing.rs` | Codex 安全核心 |
| 输出归一 | ToolOutput / truncation | 对应 OpenCode durable part |

## 工具治理统一矩阵

| 工具族 | 是否可并发 | 审批入口 | 沙箱边界 | 输出归一/截断 |
| --- | --- | --- | --- | --- |
| Shell / exec | 由 turn/orchestrator 调度，结果按顺序回收 | `create_exec_approval_requirement_for_command()` | unified exec 进入平台 sandbox | handler 输出转成 tool result，再回注模型输入 |
| Patch / file edit | 与其他工具同走 orchestrator | 文件写入/工作区策略决定是否询问 | workspace / sandbox policy 约束 | diff/错误摘要作为结构化结果 |
| MCP / dynamic tools | schema 暴露后作为普通工具候选 | 仍进入 approval policy | 远程 server 自身 + Codex tool policy | MCP result 归一到 Codex tool output |
| Network / fetch | 可作为工具调用的一类被调度 | network ask 独立于本地 exec | 网络策略独立于文件沙箱 | 响应体需要裁剪后进入上下文 |
| Multi-agent tools | spawn/wait/send/close 走 handler | 操作类型决定是否需要确认 | 子 agent 继承或覆盖 sandbox/approval | 子 agent 消息压成 tool result |

源码锚点上，`sources/codex/codex-rs/core/src/tools/orchestrator.rs:125` 的 `ToolOrchestrator::run()` 接收审批与沙箱策略，`sources/codex/codex-rs/core/src/tools/orchestrator.rs:164` 在执行前计算审批需求，`sources/codex/codex-rs/core/src/exec_policy.rs:316` 的 `create_exec_approval_requirement_for_command()` 判断命令审批需求，`sources/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:509` 的 `impl CoreToolRuntime for ExecCommandHandler` 连接 shell 执行与 sandbox。这个矩阵是横向比较的最小口径：声明、审批、隔离、输出四步必须同时看。

## 源码锚点：工具治理要同时看 Router、Orchestrator、Approval

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/tools/src/tool_spec.rs:22` | tool spec 类型定义入口 | 对应其他项目的工具 schema |
| `sources/codex/codex-rs/core/src/tools/context.rs:70` | `ToolInvocation` 统一调用上下文 | 对应 Claude `ToolUseContext` |
| `sources/codex/codex-rs/core/src/tools/orchestrator.rs:125` | orchestrator 接收审批策略和沙箱策略 | Codex 工具治理核心 |
| `sources/codex/codex-rs/core/src/tools/orchestrator.rs:164` | 工具执行前先走 approval | 对应 Gemini PolicyEngine / OpenCode Permission |
| `sources/codex/codex-rs/core/src/exec_policy.rs:316` | `create_exec_approval_requirement_for_command()` | 判断命令是否需要审批 |
| `sources/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:509` | unified exec handler 执行入口（`impl CoreToolRuntime for ExecCommandHandler`） | 连接 sandbox 与 shell 执行 |

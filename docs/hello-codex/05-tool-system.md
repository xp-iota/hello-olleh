---
layout: content
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

```
codex-rs/core/src/tools/
├── mod.rs                 # 模块导出 & 输出格式化
├── spec.rs                # 工具注册 & handler 实例化
├── registry.rs            # Handler 存储 & 分发（652 行）
├── router.rs              # ToolCall 构建 & 路由（254 行）
├── context.rs             # 调用载荷 & 上下文类型（17 KB）
├── orchestrator.rs        # 审批 + 沙箱 + 重试流程（16 KB）
├── sandboxing.rs          # 审批/沙箱 trait（13 KB）
├── network_approval.rs    # 网络访问审批（22 KB）
├── parallel.rs            # 并行执行协调
├── events.rs              # 工具事件发射
├── handlers/              # 30+ handler 实现
│   ├── shell.rs           # Shell 执行
│   ├── mcp.rs             # MCP 工具分发
│   ├── apply_patch.rs     # 文件 patch
│   ├── unified_exec.rs    # 高级执行
│   ├── dynamic.rs         # 动态工具
│   ├── js_repl.rs         # JavaScript REPL
│   ├── multi_agents_v2.rs # 多代理管理
│   └── [20+ 其他]
└── runtimes/              # 运行时实现
    ├── shell.rs           # Shell 运行时（审批/沙箱）
    ├── apply_patch.rs     # Patch 运行时
    └── unified_exec.rs    # 统一执行运行时
```

## 工具注册机制

### 入口：build_specs_with_discoverable_tools()

**位置**：`sources/codex/codex-rs/tools/src/tool_spec.rs:17-133`

注册过程：

1. **调用 `build_tool_registry_plan()`**（codex_tools crate）：生成工具规范，按 `ToolHandlerKind` 分类
2. **创建 Handler 实例**（Arc 包装）：Shell、UnifiedExec、ApplyPatch、Mcp、McpResource、JsRepl、CodeModeExecute/Wait、ListDir、ViewImage、Plan、RequestPermissions、RequestUserInput、ToolSearch、ToolSuggest、DynamicTool、TestSync、MultiAgent V1/V2、AgentJob
3. **注册 Handler**：

```rust
for handler in plan.handlers {
    match handler.kind {
        ToolHandlerKind::Shell => builder.register_handler(name, handler),
        ToolHandlerKind::Mcp => builder.register_handler(name, handler),
        // ... 30+ 变体 ...
    }
}
```

1. **返回** `ToolRegistryBuilder`，包含累积的 specs 和 handlers

### 工具来源

| 来源 | 注册方式 | 示例 |
| --- | --- | --- |
| 内建工具 | `build_tool_registry_plan()` 静态注册 | shell, apply_patch, list_dir |
| MCP 工具 | `McpConnectionManager` 动态发现 | `mcp__server__tool` |
| 动态工具 | 运行时注册 | DynamicToolSpec |
| App/Connector | 经 MCP 层代理 | ChatGPT Apps |

## 工具调用生命周期（4 阶段）

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    A["模型输出<br/>ResponseItem"] --> B["Phase 1: 解析<br/>ToolRouter::build_tool_call()"]
    B --> C["Phase 2: 路由<br/>ToolRouter::dispatch_tool_call_*()"]
    C --> D["Phase 3: 注册表分发<br/>ToolRegistry::dispatch_any()"]
    D --> E["Phase 4: 编排执行<br/>ToolOrchestrator::run()"]
    E --> F["结果回传<br/>ResponseInputItem"]
```

### Phase 1：解析模型输出为 ToolCall

**函数**：`ToolRouter::build_tool_call()`（`router.rs:116-211`）

- **输入**：模型返回的 `ResponseItem`
- **输出**：`ToolCall { tool_name, tool_namespace, call_id, payload }`
- **Payload 类型**（5 种）：

```rust
enum ToolPayload {
    Function { arguments: String },           // JSON 参数
    ToolSearch { arguments: SearchToolCallParams },
    Custom { input: String },                 // 任意格式
    LocalShell { params: ShellToolCallParams },
    Mcp { server: String, tool: String, raw_arguments: String },
}
```

### Phase 2：构建 ToolInvocation 并路由

**函数**：`ToolRouter::dispatch_tool_call_with_code_mode_result()`（`router.rs:214-250`）

- 创建 `ToolInvocation`（包含 session、turn、tracker、payload）
- 检查 `js_repl_tools_only` 限制
- 调用 `self.registry.dispatch_any(invocation)`

### Phase 3：注册表分发

**函数**：`ToolRegistry::dispatch_any()`（`registry.rs:213-437`）

执行步骤：

1. **Handler 查找**（找不到则报错）
2. **Kind 验证**（payload 类型检查）
3. **Pre-tool-use hooks**（可阻断执行）
4. **Mutating 检查**（变异工具门控）
5. **Handler 执行**（含遥测）
6. **Post-tool-use hooks**（可修改输出）
7. **AfterToolUse hooks**（兼容旧版）

### Phase 4：编排执行（ToolOrchestrator）

**函数**：`ToolOrchestrator::run()`（`orchestrator.rs:101-370+`）

三阶段流程：

#### 阶段 A：审批检查（行 119-172）

```rust
let requirement = tool.exec_approval_requirement(req)
    .unwrap_or_else(|| default_exec_approval_requirement(...));

match requirement {
    ExecApprovalRequirement::Skip { bypass_sandbox, .. } => {
        // 无需审批
    },
    ExecApprovalRequirement::Forbidden { reason } => {
        return Err(ToolError::Rejected(reason));
    },
    ExecApprovalRequirement::NeedsApproval { reason, .. } => {
        let decision = tool.start_approval_async(req, ctx).await;
        // 处理 Approved / Denied / Abort / ApprovedForSession
    },
}
```

#### 阶段 B：首次沙箱尝试（行 174-225）

```rust
let initial_sandbox = self.sandbox.select_initial(
    &turn_ctx.file_system_sandbox_policy,
    turn_ctx.network_sandbox_policy,
    tool.sandbox_preference(),
    turn_ctx.windows_sandbox_level,
    has_managed_network_requirements,
);
let (first_result, deferred_network) = Self::run_attempt(...).await;
```

#### 阶段 C：沙箱拒绝升级（行 227-370）

```rust
if first_result.is_sandbox_denied() && tool.escalate_on_failure() {
    // 重新请求审批（无沙箱执行）
    let decision = tool.start_approval_async(req, escalation_ctx).await;
    // 若获批，以 SandboxType::None 重试
    Self::run_attempt(tool, req, tool_ctx, &escalated_attempt, ...).await
}
```

## 权限与审批模型

### 审批策略枚举

```rust
enum AskForApproval {
    Never,                          // 从不询问
    OnFailure,                      // 沙箱拒绝时询问
    OnRequest,                      // 受限文件系统时询问
    Granular(GranularApprovalConfig),  // 细粒度控制
    UnlessTrusted,                  // 总是询问
}
```

### 审批缓存（`sandboxing.rs:70-116`）

```rust
pub async fn with_cached_approval<K, F, Fut>(
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
| `ApprovedExecpolicyAmendment` | 策略修正批准 |
| `Denied` | 拒绝 |
| `Abort` | 中止 |
| `NetworkPolicyAmendment` | 网络策略修正 |

### 默认审批判定（`sandboxing.rs:171-207`）

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

沙箱选择逻辑（`manager.rs:138-165`）基于三个输入：

1. `file_system_sandbox_policy`：ReadOnly / WorkspaceWrite / FullAccess
2. `network_sandbox_policy`：Enabled / Restricted / Disabled
3. `tool.sandbox_preference()`：Auto / Prefer / Require / Forbid

## 网络审批系统

**位置**：`network_approval.rs`（22 KB）

```rust
enum NetworkApprovalMode { Immediate, Deferred }

struct NetworkApprovalSpec {
    pub network: Option<NetworkProxy>,
    pub mode: NetworkApprovalMode,
}
```

网络审批缓存按 `(host, protocol, port)` 三元组存储：

```rust
struct HostApprovalKey {
    host: String,
    protocol: &'static str,  // "http", "https", "socks5-tcp", "socks5-udp"
    port: u16,
}
```

## 内建工具类型（30+）

| 分类 | 工具 | 说明 |
| --- | --- | --- |
| 执行 | Shell, UnifiedExec, ApplyPatch | 命令执行、高级执行、补丁应用 |
| 文件 | ListDir, ViewImage | 目录列出、图像查看（只读） |
| 代码 | JsRepl, CodeModeExecute/Wait | JavaScript REPL、代码模式 |
| 搜索 | ToolSearch, ToolSuggest | 工具搜索、工具建议 |
| 权限 | RequestPermissions, RequestUserInput | 请求权限、请求用户输入 |
| MCP | McpHandler, McpResourceHandler | MCP 工具分发、MCP 资源访问 |
| 多代理 | V1 (Spawn/Close/Send/Wait), V2 (改进版) | 多代理协作 |
| 其他 | Plan, DynamicTool, TestSync, AgentJobs | 规划、动态工具、测试同步、批量任务 |

## 工具输出与结果回传

### ToolOutput trait（`context.rs:80-94`）

```rust
pub trait ToolOutput: Send {
    fn log_preview(&self) -> String;
    fn success_for_logging(&self) -> bool;
    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem;
    fn post_tool_use_response(&self, call_id: &str, payload: &ToolPayload) -> Option<JsonValue>;
    fn code_mode_result(&self, payload: &ToolPayload) -> JsonValue;
}
```

### 输出格式化

**结构化格式**（`mod.rs:30-67`）：

```json
{
  "output": "<text>",
  "metadata": {
    "exit_code": 0,
    "duration_seconds": 1.23
  }
}
```

**自由格式**（`mod.rs:69-94`）：

```
Exit code: 0
Wall time: 1.23 seconds
Total output lines: 42
Output:
<text>
```

### 截断策略

- `Lines(usize)` — 按行数截断
- `Tokens(usize)` — 按 token 数截断
- `Bytes(usize)` — 按字节数截断

### 遥测限制

- `TELEMETRY_PREVIEW_MAX_BYTES`: 2 KiB
- `TELEMETRY_PREVIEW_MAX_LINES`: 64

## 并行工具执行

**位置**：`parallel.rs`

```rust
pub struct ToolCallRuntime {
    router: Arc<ToolRouter>,
    session: Arc<Session>,
    turn_context: Arc<TurnContext>,
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
| Pre-tool-use | Handler 执行前 | 可阻断执行，接收命令字符串 |
| Post-tool-use | 成功执行后 | 可修改输出或停止，接收 tool_response JSON |
| AfterToolUse | 旧版兼容 | 可中止操作 |

## 完整调用链总结

```
模型输出 (ResponseItem)
         |
ToolRouter::build_tool_call()  ->  ToolCall
         |
ToolRouter::dispatch_tool_call_with_code_mode_result()  ->  ToolInvocation
         |
ToolRegistry::dispatch_any()
  | :-- Lookup handler
  | :-- Validate kind
  | :-- Pre-hooks (can block)
  | :-- is_mutating() check
  | :-- Handler::handle() execution
  | :-- Post-hooks (can modify)
  +-- AfterToolUse hooks
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
Format for Model (Structured / Freeform)
         |
ResponseInputItem (回传给模型)
```

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `ToolRegistry` | `codex-rs/core/src/agent/registry.rs` | 注册和查询所有工具（内置 + Dynamic + MCP）|
| `ToolCall::execute()` | `codex-rs/core/src/...` | 工具执行入口：sandbox 包装 + policy 检查 |
| `SandboxPolicy` | `codex-rs/core/src/...` | 沙箱策略枚举：None / Workspace-only / Docker / Seatbelt |
| `AskForApproval` | `codex-rs/core/src/...` | 审批模式枚举：Never / OnFailure / Always / Auto |
| `resolve_command_approval()` | `codex-rs/core/src/...` | 根据 policy + sandbox 状态决定是否需要用户确认 |
| `FuturesOrdered::push_back()` | （tokio） | 工具并发执行队列入口，保证有序结果收集 |
| `before_tool` hook | `codex-rs/core/src/...` | 工具执行前拦截点 |
| `after_tool` hook | `codex-rs/core/src/...` | 工具执行后拦截点 |
| `format_tool_output()` | `codex-rs/core/src/...` | 将工具输出转换为模型可消费的 `ResponseInputItem` |

---

## 代码质量评估

**优点**

- **四阶段生命周期清晰**：注册 → 调用决策（审批）→ 沙箱隔离执行 → 结果格式化，每阶段职责单一，可独立测试。
- **多层沙箱可组合**：None、Workspace-only、macOS Seatbelt、Linux seccomp/Docker 四级隔离按需启用，安全策略从宽松到严格均有覆盖。
- **`FuturesOrdered` 并发有序**：工具并发执行，但结果按请求顺序收集，保证回传给模型的 `ResponseInputItem` 顺序一致。
- **网络审批独立体系**：对外向网络请求设置独立的 `NetworkAsk` 策略，与本地文件操作审批解耦。

**风险与改进点**

- **内置工具超 30 种**：工具种类多，统一的 `ToolRegistry` 维护所有类型，若没有清晰的分组/分文件管理，未来扩展可能产生命名冲突。
- **沙箱能力依赖宿主 OS**：macOS Seatbelt 和 Linux seccomp 无法在对方平台使用，跨平台测试覆盖较难统一。
- **工具输出 token 无上限**：文档未明确工具输出的 token 预算上限，超大输出可能撑爆上下文窗口。
- **Dynamic tools 延迟加载**：`DynamicTool` 在工具调用时才解析 schema，若远程 MCP server 不可用，错误只在运行时暴露而非启动时。

## 横向对齐补强：Codex 工具治理以 approval/sandbox 为中心

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

源码锚点上，`sources/codex/codex-rs/core/src/tools/orchestrator.rs:111` 接收 approval 与 sandbox policy，`sources/codex/codex-rs/core/src/tools/orchestrator.rs:122` 在执行前处理 approval，`sources/codex/codex-rs/core/src/exec_policy.rs:234` 判断命令审批需求，`sources/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:184` 连接 shell 执行与 sandbox。这个矩阵是横向比较的最小口径：声明、审批、隔离、输出四步必须同时看。

## 源码锚点补强：工具治理要同时看 Router、Orchestrator、Approval

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/tools/src/tool_spec.rs:17` | tool spec 类型定义入口 | 对应其他项目的工具 schema |
| `sources/codex/codex-rs/core/src/tools/context.rs:41` | `ToolInvocation` 统一调用上下文 | 对应 Claude `ToolUseContext` |
| `sources/codex/codex-rs/core/src/tools/orchestrator.rs:111` | orchestrator 接收审批策略和沙箱策略 | Codex 工具治理核心 |
| `sources/codex/codex-rs/core/src/tools/orchestrator.rs:122` | 工具执行前先走 approval | 对应 Gemini PolicyEngine / OpenCode Permission |
| `sources/codex/codex-rs/core/src/exec_policy.rs:234` | `create_exec_approval_requirement_for_command()` | 判断命令是否需要审批 |
| `sources/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:184` | unified exec handler 执行入口 | 连接 sandbox 与 shell 执行 |

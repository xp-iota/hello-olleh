---
layout: content
title: "Hooks 与生命周期：Codex 的事件拦截与扩展点"
---
# Hooks 与生命周期：Codex 的事件拦截与扩展点

本文分析 Codex 的生命周期事件体系与 Hook 扩展机制。

**目录**

- [1. Codex 生命周期概览](#1-codex-生命周期概览)
- [2. Op 事件总线](#2-op-事件总线)
- [3. 可扩展的拦截点](#3-可扩展的拦截点)
- [4. 与 Claude Code Hooks 的对比](#4-与-claude-code-hooks-的对比)

---

## 1. Codex 生命周期概览

Codex 的执行生命周期由 `submission_loop` 统一编排，关键阶段如下：

```
进程启动
  → config 加载 & MCP 工具发现
  → ThreadManager 初始化
  → TUI/非交互模式选择
  → submission_loop 进入
      → 接收 Op::UserInput
      → run_turn()
          → run_sampling_request()
          → 工具执行
          → 结果写回
      → 循环等待下一个 Op
  → Op::Shutdown → 清理退出
```

## 2. Op 事件总线

Codex 用 `Op` 枚举作为生命周期事件的统一载体：

```rust
// codex-rs/core/src/codex.rs
pub enum Op {
    UserInput(String),
    ToolResult { call_id: String, result: ToolOutput },
    Interrupt,
    Shutdown,
    McpToolsReady(Vec<Tool>),
    ChildAgentResult(ChildAgentResult),
}
```

`submission_loop` 对每个 Op 分派处理，这是 Codex 的核心事件驱动点。

## 3. 可扩展的拦截点

### 3.1 工具调用前后

通过 `ToolRouter` 的包装层可以注入前后处理逻辑：

```rust
// 工具执行前：权限审批
let approved = approval_handler.check(&tool_call)?;
if !approved { return ToolOutput::denied(); }

// 工具执行
let result = tool.execute(input).await?;

// 工具执行后：结果审计/日志
audit_log.record(&tool_call, &result);
```

### 3.2 Turn 边界

每个 `run_turn()` 结束时触发 memories 提取和 Thread 状态持久化：

```rust
// run_turn 结束后
if config.memories.enabled {
    let mems = extract_memories(&turn_rollout).await;
    thread.add_memories(mems);
}
thread.persist().await?;
```

### 3.3 会话边界

`Op::Shutdown` 触发时执行清理：

```rust
Op::Shutdown => {
    thread_manager.flush_all().await;
    mcp_clients.close_all().await;
    break;
}
```

## 4. 与 Claude Code Hooks 的对比

| 特性 | Codex | Claude Code |
| :------| :-------| :-------------|
| **Hook 注册方式** | 代码级（Rust trait）| 配置级（settings.json hooks 字段）|
| **触发事件** | Op 枚举 | PreToolCall / PostToolCall / 等 |
| **用户可配置** | 否（需修改源码）| 是（JSON 配置）|
| **执行位置** | 同进程 | Shell 命令（独立进程）|

Codex 的生命周期拦截是代码层面的扩展点，适合二次开发；Claude Code 的 Hooks 则是配置驱动的用户扩展。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `HookRunner::run_before()` | `codex-rs/core/src/hook.rs` | 执行工具调用前置钩子：验证权限或修改参数 |
| `HookRunner::run_after()` | `codex-rs/core/src/hook.rs` | 执行工具调用后置钩子：审计日志、结果转换 |
| `LifecycleHook` enum | `codex-rs/core/src/hook.rs` | 钩子类型枚举：BeforeTool / AfterTool / SessionStart / SessionEnd |
| `HookConfig` | `codex-rs/core/src/config.rs` | config.toml 中钩子命令配置：trigger → command 映射 |
| `SessionLifecycle::on_start()` | `codex-rs/core/src/lifecycle.rs` | session 启动时触发：初始化沙盒、加载 skill、建立 LSP |
| `SessionLifecycle::on_end()` | `codex-rs/core/src/lifecycle.rs` | session 结束时触发：持久化历史、清理沙盒、关闭 LSP |

---

## 代码质量评估

**优点**

- **明确的四类生命周期点**：BeforeTool/AfterTool/SessionStart/SessionEnd 覆盖了用户最常需要介入的关键节点，不过多不过少。
- **外部命令钩子可编程**：钩子执行外部可执行文件，用户无需修改 codex 源码即可扩展生命周期行为。
- **Session 启动/关闭资源管理清晰**：start/end 钩子保证沙盒和 LSP 的生命周期与 session 对齐，无泄漏风险。

**风险与改进点**

- **钩子执行无超时限制**：钩子命令执行时间无上限，长时间阻塞的钩子会导致整个 session 暂停。
- **钩子失败策略不明确**：前置钩子失败时是继续执行还是中止工具调用，策略未文档化，用户需测试才知道行为。
- **无钩子间通信机制**：多个钩子按顺序执行，后置钩子无法获取前置钩子的输出，限制了复杂钩子链的实现。

## 横向对齐补强：Codex Hooks 是 turn 控制面，不是 plugin runtime

Codex hooks 的核心价值是插入 session/turn/tool 生命周期，而不是提供 OpenCode 那种任意 runtime hook。

| Hook 面 | Codex 侧位置 | 横向对比 |
| --- | --- | --- |
| user prompt submit | turn 前置 | 对应 Claude hooks、OpenCode chat.message |
| session start | turn/session 初始化 | 对应 project bootstrap |
| stop/continuation | turn 结束控制 | Claude stop hook 类似 |
| permission hook | shell escalation | Codex 安全特色 |

## Hook 失败、输出与持久化边界

Codex 的 hook 生命周期分成两类：运行时治理 hook 和 app-server 可见 hook 事件。

| 维度 | 源码锚点 | 结论 |
| --- | --- | --- |
| Hook 事件进入 turn 流 | `sources/codex/codex-rs/core/src/session/turn.rs:530` | hook 开始事件可作为 `EventMsg::HookStarted` 发出 |
| Hook 事件过滤 | `sources/codex/codex-rs/core/src/session/turn.rs:1547` | `HookStarted` / `HookCompleted` 属于特殊事件类型，和普通模型输出区分 |
| app-server 投影 | `sources/codex/codex-rs/app-server/src/bespoke_event_handling.rs:1590` | `HookStarted` 转换成 app-server notification |
| 完成事件投影 | `sources/codex/codex-rs/app-server/src/bespoke_event_handling.rs:1602` | `HookCompleted` 同样作为通知给外部宿主 |
| hook prompt 持久化 | `sources/codex/codex-rs/app-server/src/bespoke_event_handling.rs:2215` | hook prompt message 可被解析成 `ThreadItem::HookPrompt` |
| Permission hook | `sources/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs:409` | shell escalation 先跑 `run_permission_request_hooks()`，可直接 allow、deny 或继续 prompt |

失败策略上，permission hook 不只是“记录一个事件”：它能短路后续交互审批。`sources/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs:418`、`sources/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs:425` 对 hook decision 做分支，失败或拒绝会改变 shell 执行路径。输出是否进入 prompt 要看事件类型：hook notification 面向宿主可见性，hook prompt item 才会进入 thread item 语义。

### 与其他项目的边界

Codex hook 更靠近 runtime 治理和 app-server protocol，不像 OpenCode plugin hook 那样是第三方扩展主入口，也不像 Gemini `HookSystem` 那样集中暴露 before/after model/tool API。因此本章应写成：**permission/runtime lifecycle 信号 + app-server 可见事件 + thread item 的少量持久化形态**。

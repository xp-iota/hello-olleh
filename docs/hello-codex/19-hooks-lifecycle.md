---
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

![Codex 生命周期概览](diagrams/19-hooks-lifecycle-codex.svg)

**Codex 生命周期概览** — [交互版](diagrams/19-hooks-lifecycle-codex.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/19-hooks-lifecycle-codex.architecture.json)

- **组成**：13 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：进程启动 · 末节点：清理退出

## 2. Op 事件总线

Codex 用 `Op` 枚举作为生命周期事件的统一载体（定义在 `codex-protocol/src/protocol.rs:576`，分发在 `core/src/session/handlers.rs:439` 的 `submission_loop()`）：

```rust
// codex-protocol/src/protocol.rs
pub enum Op {
    Interrupt,
    TurnInput {
        request: Box<TurnInputRequest>,
        mode: TurnInputMode,
        reply: oneshot::Sender<CodexResult<TurnInputSubmission>>,
    },
    RecoverTurn { /* ... */ },
    ExecApproval { id, turn_id, decision },
    PatchApproval { id, decision },
    Shutdown,
    // ... 更多 Op 变体
}
```

`Op::TurnInput` 在 `session/handlers.rs:541` 解构后分派给 `turn_input::handle`（`:550`）。`submission_loop` 对每个 Op 分派处理，这是 Codex 的核心事件驱动点。

## 3. 可扩展的拦截点

### 3.1 工具调用前后

`core/src/tools/registry.rs` 在工具执行链路中插入前后钩子（`run_pre_tool_use_hooks` 在 `:610`，`run_post_tool_use_hooks` 在 `:726`）：

```rust
// 工具执行前：权限审批（hook_runtime.rs:188）
let pre = run_pre_tool_use_hooks(...).await;

// 工具执行

// 工具执行后：审计/结果转换（hook_runtime.rs:297）
run_post_tool_use_hooks(...).await;
```

### 3.2 Turn 边界

每个 `run_turn()` 收尾时触发 turn stop hooks（`core/src/hook_runtime.rs:392` 的 `run_turn_stop_hooks()`）：

```rust
// core/src/session/turn.rs —— turn 收尾时
let stop_outcome = run_turn_stop_hooks(
    &sess, &step_context, stop_hook_active, last_agent_message,
).await;
// stop_outcome.should_block 时，构建 hook prompt 消息并送回当前 turn
```

`run_turn_stop_hooks` 按 session 来源区分目标：普通 turn 走 `Stop`，线程派生的子 agent turn 走 `SubagentStop`，memory consolidation 内部 turn 走 `MemoryConsolidation`。Stop hook 可以阻塞收尾并注入 continuation（`session/turn.rs:667` 起：memory consolidation turn 被 Stop hook 拒绝时直接报 `InvalidRequest`，不再回灌循环；普通 turn 则把 hook prompt 消息记入 thread item 后继续）。

memories 的当前实现是独立的 `codex-memories-write` crate（存储布局在 `memories/write/src/lib.rs:118`，两阶段/合并提示模板在 `memories/write/templates/memories/`），由 `Feature::MemoryTool` 与 `MemoriesConfig`（`core/src/config/mod.rs:963`，门控见 `:4200`）启用，作为内部 session 运行而不是内嵌在 turn 收尾里。

### 3.3 会话边界

`Op::Shutdown` 触发时执行清理：

```rust
// core/src/session/handlers.rs:696
Op::Shutdown => shutdown(&sess, sub.id.clone()).await,
```

`shutdown()`（`session/handlers.rs:349`）先经 `shutdown_session_runtime()`（`:290`）终止任务、hook 与子进程，再优雅 flush 并关闭 thread 持久化，最后发出 `EventMsg::ShutdownComplete` 并让 `submission_loop` 退出。

## 4. 与 Claude Code Hooks 的对比

| 特性 | Codex | Claude Code |
| :------| :-------| :-------------|
| **Hook 注册方式** | 配置级（`HooksConfig` 的 trigger → command 映射，`hooks/src/registry.rs:42`）| 配置级（settings.json hooks 字段）|
| **触发事件** | session start/end、pre/post tool use、turn stop、permission request | PreToolCall / PostToolCall / 等 |
| **用户可配置** | 是（外部命令，需通过 hook trust 校验）| 是（JSON 配置）|
| **执行位置** | 独立进程（外部命令）| Shell 命令（独立进程）|

两边都是配置驱动的用户扩展；Codex 的差别在于事件面直接绑定 session/turn/tool 生命周期，并且 hook 事件会同时投影为 app-server 通知与 thread item。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `run_pre_tool_use_hooks()` | `codex-rs/core/src/hook_runtime.rs:188` | 执行工具调用前置钩子：验证权限或修改参数 |
| `run_post_tool_use_hooks()` | `codex-rs/core/src/hook_runtime.rs:297` | 执行工具调用后置钩子：审计日志、结果转换 |
| `run_pending_session_start_hooks()` | `codex-rs/core/src/hook_runtime.rs:128` | session 启动时触发：初始化环境、加载 skill |
| `run_session_end_hooks()` | `codex-rs/core/src/hook_runtime.rs:471` | session 结束时触发：持久化历史、清理资源 |
| `run_turn_stop_hooks()` | `codex-rs/core/src/hook_runtime.rs:392` | turn 结束时触发：stop/after-agent 语义的 hook 入口 |
| `HooksConfig` | `codex-rs/hooks` crate（`hooks/src/registry.rs:42`） | hook 声明与配置：trigger → command 映射 |

---

## 代码质量评估

**优点**

- **明确的多类生命周期点**：pre/post tool use、session start/end、turn stop、permission request（`core/src/hook_runtime.rs` 中对应的 `run_*_hooks()` 入口）覆盖了用户最常需要介入的关键节点，不过多也不过少。
- **外部命令钩子可编程**：钩子执行外部可执行文件，用户无需修改 codex 源码即可扩展生命周期行为。
- **Session 启动/关闭资源管理清晰**：start/end 钩子保证沙盒和 LSP 的生命周期与 session 对齐，无泄漏风险。

**风险与改进点**

- **钩子执行无超时限制**：钩子命令执行时间无上限，长时间阻塞的钩子会导致整个 session 暂停。
- **钩子失败策略不明确**：前置钩子失败时是继续执行还是中止工具调用，策略未文档化，用户需测试才知道行为。
- **无钩子间通信机制**：多个钩子按顺序执行，后置钩子无法获取前置钩子的输出，限制了复杂钩子链的实现。

## Codex Hooks 是 turn 控制面，不是 plugin runtime

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
| Hook 事件进入 turn 流 | `sources/codex/codex-rs/core/src/hook_runtime.rs:880` | `emit_hook_started_events()` 将 hook 开始事件作为 `EventMsg::HookStarted` 发出 |
| Hook 事件过滤 | `sources/codex/codex-rs/core/src/session/turn.rs:2158` | `HookStarted` / `HookCompleted` 属于特殊事件类型，和普通模型输出区分 |
| app-server 投影 | `sources/codex/codex-rs/app-server/src/bespoke_event_handling.rs:1144` | `HookStarted` 转换成 app-server notification |
| 完成事件投影 | `sources/codex/codex-rs/app-server/src/bespoke_event_handling.rs:1154` | `HookCompleted` 同样作为通知给外部宿主 |
| hook prompt 持久化 | `sources/codex/codex-rs/app-server-protocol/src/protocol/v2/item.rs:246` | hook prompt message 可被解析成 `ThreadItem::HookPrompt` |
| Permission hook | `sources/codex/codex-rs/core/src/hook_runtime.rs:258`（由 `tools/approvals.rs:508` 调用） | shell escalation 前先跑 `run_permission_request_hooks()`，可直接 allow、deny 或继续 prompt |

失败策略上，permission hook 不只是“记录一个事件”：它能短路后续交互审批。`tools/approvals.rs:508` 对 hook decision 做分支，失败或拒绝会改变 shell 执行路径。输出是否进入 prompt 要看事件类型：hook notification 面向宿主可见性，hook prompt item 才会进入 thread item 语义。

### 与其他项目的边界

Codex hook 更靠近 runtime 治理和 app-server protocol，不像 OpenCode plugin hook 那样是第三方扩展主入口，也不像 Gemini `HookSystem` 那样集中暴露 before/after model/tool API。因此本章应写成：**permission/runtime lifecycle 信号 + app-server 可见事件 + thread item 的少量持久化形态**。

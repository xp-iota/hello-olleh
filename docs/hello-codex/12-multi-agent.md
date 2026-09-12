---
layout: content
title: "多代理与并行：Codex 的单代理架构与 child-agents 机制"
---
# 多代理与并行：Codex 的单代理架构与 child-agents 机制

本文分析 Codex 在多代理（Multi-Agent）方向的设计，包括其以单代理为核心的架构取向，以及通过 child-agents 实现任务分派的机制。

**目录**

- [1. 架构取向：单代理为主](#1-架构取向单代理为主)
- [2. Child-Agents 机制](#2-child-agents-机制)
- [3. 工具级并行](#3-工具级并行)
- [4. 与其他系统的对比](#4-与其他系统的对比)
- [5. 设计权衡](#5-设计权衡)

---

## 1. 架构取向：单代理为主

Codex 的核心设计围绕**单线程 Agent 执行循环**（`submission_loop` → `run_turn`）展开，强调：

- 执行的可预期性（Predictability）
- 状态管理的简洁性（Thread 作为统一边界）
- 调试的可追溯性（线程历史完整保留）

这与 Claude Code 的"子代理（subagents）"和 OpenCode 的"Subagent 工具"形成对比。

## 2. Child-Agents 机制

尽管以单代理为主，Codex 支持通过 **child-agents** 机制实现局部任务并行：

### 2.1 触发方式

模型可以通过特定 tool call 启动 child-agent：

```json
{
  "type": "tool_call",
  "name": "spawn_child_agent",
  "args": {
    "task": "分析并修复 src/auth 目录下的类型错误",
    "working_dir": "/path/to/project",
    "max_turns": 10
  }
}
```

### 2.2 执行隔离

每个 child-agent 运行在独立的 `Thread` 上下文中：

- 独立的历史记录（不共享父 agent 的对话历史）
- 独立的工具权限（继承父 agent 的 approval policy）
- 独立的沙箱隔离（如果启用）

### 2.3 结果回收

child-agent 执行结束后，其结果（`final_response`）以 `tool_result` 形式回传给父 agent：

```rust
// codex-rs/core/src/codex.rs
fn handle_child_agent_result(
    parent_thread: &mut Thread,
    child_result: ChildAgentResult,
) {
    parent_thread.add_tool_result(
        child_result.tool_call_id,
        child_result.final_response,
    );
}
```

## 3. 工具级并行

对于不需要子代理的场景，Codex 支持**单轮内多工具并行**：

```rust
// codex-rs/core/src/codex.rs
async fn execute_tool_calls(
    tool_calls: Vec<ToolCall>,
) -> Vec<ToolResult> {
    // 并行执行同一轮的多个工具调用
    join_all(tool_calls.iter().map(|tc| self.execute_single(tc))).await
}
```

同一模型响应中的多个 tool_call 可以并发执行，适合：

- 同时读取多个文件
- 同时搜索多个目录
- 同时运行多个独立的 shell 命令

## 4. 与其他系统的对比

| 特性 | Codex | Claude Code | Gemini CLI | OpenCode |
| :------| :-------| :-------------| :-----------| :---------|
| **多代理模式** | Child-agents（可选） | Sub-agents（内置） | 本地/远程子代理 | Subagent 工具 |
| **并行方式** | 单轮多工具并行 | Task 后台并行 | 子代理 + 工具并行 | 多工具并行 |
| **代理间通信** | Thread 结果传递 | 消息传递 | tool result / 进度事件回传 | Bus 事件 |
| **隔离边界** | Thread（独立状态） | Session（独立）| 独立 agent context | Instance |
| **主要使用场景** | 大规模代码任务分解 | 后台长任务 | 卸载长任务、远程代理协作 | 结构化任务编排 |

## 5. 设计权衡

**Codex 为什么以单代理为主**：

1. **状态一致性**：多代理协调引入竞争条件风险
2. **调试友好**：单线程执行路径更易追踪问题
3. **资源可控**：避免并发代理争用 token 预算
4. **Rust 安全**：Rust 类型系统保障单线程逻辑的内存安全

**child-agents 的适用场景**：

- 明确可分解的子任务（如"独立分析每个模块"）
- 需要隔离执行（一个 child 失败不影响父 agent）
- 任务结果之间无强依赖关系

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `ChildAgent` / `CodexAgent` | `codex-rs/core/src/agents/` | Child agent 定义：独立 tool set、独立 context、受限权限 |
| `FuturesOrdered` (工具级并行) | `codex-rs/core/src/codex.rs:7176` | 在 `try_run_sampling_request()` 中并发执行多个工具调用 |
| `submission_loop()` | `codex-rs/core/src/codex.rs:4289` | 主会话事件分发器：单线程顺序，防止多代理竞态 |
| `ThreadManager::fork_thread()` | `codex-rs/core/src/thread_manager.rs:598` | Fork 创建子线程（独立快照），支持并行子任务 |
| `SandboxPolicy` | `codex-rs/core/src/sandboxing/` | 子代理沙箱约束：防止子代理越权访问父代理资源 |

---

## 代码质量评估

**优点**

- **单代理为主设计减少协调复杂度**：工具级并发（`FuturesOrdered`）在单线程内解决大多数并行需求，不引入跨代理状态同步问题。
- **工具级并行有序**：`FuturesOrdered` 保持工具结果的提交顺序，避免乱序结果导致的 context 不一致。
- **子代理沙箱隔离**：子代理的 `SandboxPolicy` 独立于父代理，防止子代理操作泄漏到父代理的工作区或 SQLite。

**风险与改进点**

- **Child-Agent 的通信仅靠 `submission_loop` 消息**：子代理与父代理通过消息传递通信，复杂协作（如子代理查询父代理状态）无直接支持。
- **Fork 后无合并原语**：Fork 用于创建并行分支，但 fork thread 的结果如何合并回主线程无显式机制，需要手动在工具结果层面处理。
- **无动态代理创建**：Child-Agent 类型在编译时确定，运行时无法动态注册新的 agent 类型，限制了 plugin 扩展多代理能力。

## 横向对齐补强：Codex 多代理不是 UI 级任务列表

Codex 的多代理能力应放在工具系统和 session runtime 之间理解：子代理通过工具 handler 创建或驱动新的 agent thread，结果再以事件和 thread item 的方式回到父会话。

| 维度 | Codex 实现入口 | 对齐说明 |
| --- | --- | --- |
| 子代理控制 | `sources/codex/codex-rs/core/src/agent/control.rs` | 创建 agent thread 并提交初始 prompt |
| 多代理工具 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents*` | `spawn`、`send_input`、message tool 等是模型可调用的协作面 |
| Review 线程 | `sources/codex/codex-rs/core/src/session/review.rs` | 代码 review 走专用 prompt 和独立 thread |
| 状态继承 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_common.rs` | 复用父 turn 的模型、compact prompt 和部分配置 |
| 结果回传 | `sources/codex/codex-rs/core/src/session/turn.rs` | 子任务结果最终仍落回 turn loop 事件流 |

横向看，Codex 比 Gemini 的 A2A/agent manager 更靠近核心 runtime，比 Claude 的 `AgentTool` 更强调 typed thread/session 边界，比 OpenCode 的 `task` 工具更依赖 Rust 侧工具 handler 的状态复制。

## 源码补强：`spawn_agent` 的真实闭环

Codex 的多代理不是 UI 旁路功能，而是工具 handler 驱动的新 thread 生命周期。

| 阶段 | 源码位置 | 说明 |
| --- | --- | --- |
| 参数进入 handler | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:69` | handler 先基于父 turn 的 base instructions 构造子 agent config |
| 继承与覆盖配置 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_common.rs:203` | `build_agent_spawn_config()` 把父 base instructions 写入子 config |
| 运行时覆盖 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_common.rs:256` | 将当前 turn 的 cwd、approval、sandbox、模型等运行时字段应用到子 agent |
| spawn 执行 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:114` | 通过 `agent_control.spawn_agent_with_metadata()` 创建子线程 |
| fork 约束 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:236` | v2 明确拒绝 `fork_context` 参数，改用 `fork_turns` 语义 |
| 结果回传 | `sources/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:30` | spawn 结果以 tool output response item 回到父 turn |

### 状态继承边界

子 agent 继承的是可复制的 runtime 配置，而不是父 agent 的全部内存状态。`build_agent_spawn_config()` 会保留 base instructions，但 resume 类路径会清空 base instructions（`sources/codex/codex-rs/core/src/tools/handlers/multi_agents_common.rs:219`），避免把父 turn 的临时上下文错误套到已存在子线程。这个设计让多代理更像“受控 thread spawn”，而不是共享堆内存的协程。

### 与普通工具并发的区别

同一轮多个普通工具可以用 `FuturesOrdered`/runtime 并发处理；多代理则创建可持续存在的 agent thread，后续还可 list、send input、wait、close。前者优化单 turn 吞吐，后者用于任务分解和隔离。文档阅读时应把两者分开，否则会误以为 child-agent 只是“更重的 tool call”。

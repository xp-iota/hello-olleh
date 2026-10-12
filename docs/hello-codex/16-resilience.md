---
title: "Codex 韧性机制：重试策略、错误归一化与恢复路径"
---
# Codex 韧性机制：重试策略、错误归一化与恢复路径

本文档分析 Codex 的韧性系统，涵盖错误处理、重试策略与恢复机制。

**目录**

- [1. 韧性在 Codex 里的定位](#1-韧性在-codex-里的定位)
- [2. 统一错误类型体系](#2-统一错误类型体系)
- [3. 重试策略](#3-重试策略)
- [4. Sandbox 隔离机制](#4-sandbox-隔离机制)
- [5. 与 OpenCode 的韧性对比](#5-与-opencode-的韧性对比)
- [6. 当前限制](#6-当前限制)
- [7. 关键源码锚点](#7-关键源码锚点)
- [8. 总结](#8-总结)

---

## 1. 韧性在 Codex 里的定位

Codex 的韧性机制可以概括为一套“把失败继续收束回线程状态”的系统：

1. **错误归一化**：统一错误类型体系
2. **重试策略**：智能退避而非盲目重试
3. **上下文溢出处理**：pre-turn / auto / remote compaction，而不是直接终止
4. **Sandbox 隔离**：安全执行边界

---

## 2. 统一错误类型体系

### 2.1 CodexErr 与 CodexErrorDetails

`protocol/src/error.rs` 定义了外层错误结构 `CodexErr`（`sources/codex/codex-rs/protocol/src/error.rs:77`，携带 details、server retry advice 和 agent context）与 40+ 变体的语义枚举 `CodexErrorDetails`（`sources/codex/codex-rs/protocol/src/error.rs:90`）：

| 分类 | 变体 | 含义 |
| --- | --- | --- |
| **连接/流** | `Stream(String)` | SSE 流断连（session loop 视为瞬态错误并自动重试）|
| | `ConnectionFailed` | 网络连接失败 |
| | `ResponseStreamFailed` | SSE 流失败 |
| | `Timeout` / `RequestTimeout` | 超时 |
| **模型/配额** | `ContextWindowExceeded` | 上下文窗口溢出 |
| | `UsageLimitReached` | 用量限制 |
| | `QuotaExceeded` | 配额耗尽 |
| | `ServerOverloaded` | 服务端过载 |
| **认证** | `RefreshTokenFailed` | Token 刷新失败 |
| **沙箱** | `Sandbox(SandboxErr)` | 沙箱错误 |
| **线程** | `ThreadNotFound` | 线程未找到 |
| | `AgentLimitReached` | Agent 数量上限 |
| **流程控制** | `TurnAborted` | 回合被中止 |
| | `Interrupted` | 被用户中断 |

### 2.2 错误归一化的价值

![错误归一化的价值](diagrams/16-resilience-diagram.svg)

**错误归一化的价值** — [交互版](diagrams/16-resilience-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/16-resilience-diagram.architecture.json)

- **组成**：4 个节点
- **关系**：源图 3 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：Provider错误 → fromError 映射 · fromError 映射 → CodexErr 统一错误 · CodexErr 统一错误 → processor 分支策略

1. provider、网络、系统调用错误先被规约进统一语义
2. processor 后续只需要按错误类别做策略分支

---

## 3. 重试策略

### 3.1 可重试 vs 不可重试

`CodexErr::retry_delay()`（`sources/codex/codex-rs/protocol/src/error.rs:397`）用返回值区分两类错误：`None` 表示终态错误，`Some(delay)` 表示可重试。

**不可重试**（返回 `None`）：

| 变体 | 原因 |
| --- | --- |
| `TurnAborted`, `Interrupted` | 用户主动中止 |
| `Fatal`, `InvalidRequest`, `InvalidPrompt` | 逻辑错误 |
| `ContextWindowExceeded` | 需要压缩而非重试 |
| `UsageLimitReached`, `UsageNotIncluded`, `QuotaExceeded` | 配额问题 |
| `Sandbox(*)` | 安全策略 |
| `RefreshTokenFailed` | 认证失败 |
| `ThreadNotFound`, `AgentLimitReached` | 线程/代理资源问题 |

**可重试**（返回 `Some(delay)`）：

| 变体 | 原因 |
| --- | --- |
| `Stream(*)` | 网络断连，session loop 自动重试 |
| `Timeout`, `RequestTimeout` | 超时可恢复 |
| `UnexpectedStatus` | HTTP 暂时异常 |
| `ResponseStreamFailed` | SSE 流暂时中断 |
| `ConnectionFailed` | 网络暂时不可达 |
| `InternalServerError`, `InternalAgentDied` | 服务端/内部暂时异常 |
| `ServerOverloaded`, `RetryLimit(*)` | 只采用 server 给出的 retry 建议延迟 |
| `Io`, `Json`, `TokioJoin` | 基础设施错误，按退避重试 |

### 3.2 智能退避

Codex 不是固定 `2s -> 4s -> 8s`，而是尊重 provider 头信息：

1. `Retry-After` 头（秒数或 HTTP 日期格式，`sources/codex/codex-rs/http-client/src/retry_after.rs:25`）
2. 指数退避加抖动（兜底，`sources/codex/codex-rs/async-utils/src/backoff.rs:12`）

重试预算由调用方控制：流式请求的上限来自 provider 配置的 `stream_max_retries()`（`sources/codex/codex-rs/core/src/session/turn.rs:1633`）。

---

## 4. Sandbox 隔离机制

### 4.1 SandboxErr 类型

```rust
pub enum SandboxErr {
    Denied { output, network_policy_decision },
    SeccompInstall(seccompiler::Error),      // Linux only
    SeccompBackend,
    Timeout { output },
    Signal(i32),
    LandlockRestrict,
}
```

### 4.2 平台特定实现

| 平台 | 沙箱机制 |
| --- | --- |
| macOS | Seatbelt |
| Linux | Seccomp/Landlock |
| Windows | Restricted Token |

---

## 5. 与 OpenCode 的韧性对比

### 5.1 主要差异

| 特性 | Codex | OpenCode |
| --- | --- | --- |
| 错误归一化 | CodexErr + CodexErrorDetails 枚举 | MessageV2 错误类型 |
| 重试策略 | retry_delay() 分级 + server advice | retryable() + delay() |
| Context Overflow | 触发 manual / pre-turn / auto / remote compaction | 软溢出/硬溢出双路径 |
| Revert | 无 | Snapshot + history 清理 |
| Permission | 工具级审批 | 独立 Permission 系统 |
| doom_loop | 无 | 连续同工具触发 |

### 5.2 对比时要注意的边界

如果只看“是否有 compaction”，两者其实都实现了上下文超限后的自愈；差别主要在于：

1. **Codex** 把 compaction 更紧地嵌进 turn 执行和 rollout 重建。
2. **OpenCode** 把 revert、permission、question 等阻塞分支做成了更显式的独立状态机。
3. **Codex** 的强项在统一错误语义、provider 重试和沙箱升级路径。

---

## 6. 当前限制

### 6.1 Codex 缺少的机制

| 能力 | OpenCode 有 | Codex 状态 |
| --- | --- | --- |
| Compaction | 完整 | 已实现：manual / pre-turn / auto / remote compaction |
| Revert | 文件快照 + history | 没有 OpenCode 那样独立的 snapshot/revert 子系统 |
| Question 机制 | 完整 | 没有对等的独立澄清状态机，更多通过工具/协议能力收束 |
| doom_loop | 三次同工具检测 | 未看到与 OpenCode 对等的显式 doom_loop 防护 |

### 6.2 建议增强

1. **补强可观测性**：把 compaction 触发原因和恢复结果暴露得更直观。
2. **增加显式回滚能力**：如果要追平 OpenCode，仍需要独立的 snapshot / revert 设计。
3. **补齐交互式阻塞语义**：把澄清、取消和恢复路径做得更可见。

---

## 7. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| 错误定义 | `protocol/src/error.rs:90` | `CodexErrorDetails` 枚举与外层 `CodexErr` 结构 |
| 重试判断 | `protocol/src/error.rs:397` | `retry_delay()` 区分终态错误与可重试错误 |
| Sandbox | `tools/sandboxing.rs` | 沙箱隔离实现 |
| 线程管理 | `core/src/thread_manager.rs` | ThreadManager |

---

## 8. 总结

Codex 的韧性机制并不只停留在“重试 + 沙箱”：

1. **错误归一化**：40+ 变体的统一错误类型体系
2. **重试策略**：基于 `retry_delay()` 的分级重试与 server retry advice
3. **上下文自愈**：已经具备 compaction 路径
4. **Sandbox 隔离**：平台特定的沙箱实现

与 OpenCode 相比，差距主要在显式 revert、question 和更完整的交互式阻塞状态机，而不是 compaction 本身。对于本地代理场景，当前架构已经具备较强的恢复能力。

---

> 关联阅读：[07-error-security.md](./07-error-security.md) 了解错误处理与沙箱边界的更多细节。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `CodexErr::retry_delay()` | `codex-rs/protocol/src/error.rs:397` | 错误分级：终态返回 `None`，可重试返回 server 建议延迟或指数退避 |
| `backoff()` | `codex-rs/async-utils/src/backoff.rs:12` | 带抖动的指数退避兜底 |
| `RetryAfter` | `codex-rs/http-client/src/retry_after.rs:18` | 解析 `Retry-After` 头（秒数或 HTTP 日期）并保留截止时刻 |
| `ResponsesStreamRetryState` | `codex-rs/core/src/responses_retry.rs:32` | 流式响应重试状态机，配合 provider 的 `stream_max_retries()` 预算 |
| `run_auto_compact()` | `codex-rs/core/src/session/turn.rs:1434` | 上下文超限触发 compaction 自愈 |
| `SandboxManager` | `codex-rs/sandboxing/src/manager.rs:310` | `select_initial()` 选择平台沙箱实现，`transform()` 生成具体执行约束 |

---

## 代码质量评估

**优点**

- **错误分级集中且类型化**：`retry_delay()` 一个 match 就表达了“哪些错误是终态、哪些值得重试”，调用方不再各自实现重试判断。
- **server retry advice 一等公民**：`RetryAfter` 捕获一次截止时刻并在错误传递时不重置，避免多层重试叠加放大延迟。
- **流式重试与传输回退解耦**：`ResponsesStreamRetryState` 处理流中断重试，WebSocket→HTTPS 回退由 client 层独立处理，两层互不干扰。

**风险与改进点**

- **流式重试预算不可由用户配置**：`stream_max_retries()` 来自 provider info，高延迟环境无法通过 config.toml 调整。
- **`Io`/`Json` 等基础错误一律可重试**：宽口径可能放大无效重试，本地磁盘故障时仍会按退避反复尝试。
- **崩溃恢复依赖 rollout 完整性**：进程崩溃后靠 rollout reconstruction 重建，写入中断的 rollout 片段会让 resume 边界变复杂。

## Codex 韧性覆盖 client、turn 和 rollout 三层

Codex 韧性不只包括 LLM retry，也包括 sandbox fallback、compact 和 rollout reconstruction。

| 层级 | Codex 侧机制 | 横向对比 |
| --- | --- | --- |
| Client | retry/backoff/transport fallback | 对应 Gemini/OpenCode provider retry |
| Turn | compact、needs_follow_up、cancel token | 对应 Claude query state |
| Tools | sandbox retry / approval escalation | Codex 强项 |
| Rollout | 历史持久化与重建，崩溃后 resume | 对应 OpenCode durable session |

## 异常后的继续、重开与回滚边界

| 异常类型 | 同一 turn 是否继续 | 是否需要新 turn | 文件是否可回滚 | 说明 |
| --- | --- | --- | --- | --- |
| Provider transient error | 可重试后继续 | 达到最大重试后需要新 turn/用户介入 | 不涉及 | client retry/backoff 处理 transport 抖动 |
| Tool command failure | 可继续，作为 tool result 反馈模型 | 若失败导致规划失效，可由模型新 turn 重试 | 取决于命令是否改写文件 | 失败是模型可见事实，不等于 runtime 崩溃 |
| Sandbox denial | 通常继续，等待审批升级或策略调整 | 用户改变 policy 后可能新 turn | denial 前通常无文件写入 | Codex 的审批/沙箱是韧性核心 |
| Process panic/crash | 当前 turn 中断 | 需要 resume/replay 重建 | 依赖 rollout 已持久化的历史 | 运行中 future/cancel token 不恢复 |
| Partial file edit | 不应假定继续 | 建议新 turn 先检查 diff | 无自动 undo；`TurnDiffTracker` 记录本轮文件变更供检查 | 回滚能力和恢复能力要分开写 |
| Context overflow | compact 后可继续 | compact 失败时需要新 turn 或缩短输入 | 不涉及 | 属于上下文韧性而非 transport 韧性 |

这张表给横向对比一个明确口径：Claude/Gemini/OpenCode 多数只恢复会话或工具结果，Codex 同样不能恢复运行中的 pending approval、cancel token 或外部进程句柄，崩溃后的恢复面以 rollout 持久化记录为边界。

---
title: "Agent 循环：TurnState 状态机与 Runner 迭代"
---
# Agent 循环：TurnState 状态机与 Runner 迭代

> 基于 `sources/nanobot/nanobot/agent/loop.py` 与 `sources/nanobot/nanobot/agent/runner.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 两层职责划分](#1-两层职责划分)
- [2. TurnState 状态机](#2-turnstate-状态机)
- [3. AgentRunSpec：一次执行的全部输入](#3-agentrunspec一次执行的全部输入)
- [4. Runner 迭代语义](#4-runner-迭代语义)
- [5. 注入与收尾](#5-注入与收尾)

---

## 1. 两层职责划分

- `AgentLoop`（loop.py）：渠道侧回合编排。每个入站消息构造一个 `TurnContext`（msg、session_key、state、turn_id），沿状态机推进；它持有 `SessionManager`、`ContextBuilder`、`ToolRegistry`、`SubagentManager`、`AutoCompact`、cron/trigger 协调器。
- `AgentRunner`（runner.py）：模型侧迭代引擎。无状态（`__init__` 不存配置），所有输入打包在 `AgentRunSpec` 里传入 `run()`，产出 `AgentRunResult`（final_content、messages、tools_used、usage、stop_reason、tool_events、had_injections）。

## 2. TurnState 状态机

`TurnState` 枚举定义了回合的八个阶段：

| 状态 | 语义 |
| --- | --- |
| `RESTORE` | 恢复会话（JSONL 历史读入、合法性修剪） |
| `COMPACT` | AutoCompact 检查/执行历史压缩 |
| `COMMAND` | 内联 slash 命令分发（`_dispatch_command_inline`） |
| `BUILD` | ContextBuilder 组装 system prompt 与 messages |
| `RUN` | 调用 `AgentRunner.run(spec)` |
| `SAVE` | 回合结果写回 JSONL 会话 |
| `RESPOND` | 构造 OutboundMessage 回投渠道 |
| `DONE` | 收尾（含 deferred automation turn 的发布） |

每次状态迁移记录一条 `StateTraceEntry`（state、started_at、duration_ms、event、error），回合结束可回放耗时分布——这是 nanobot 的内建 profiling。`TurnKind` 区分 `USER` 与 `SYSTEM`（cron/trigger/heartbeat）回合。

## 3. AgentRunSpec：一次执行的全部输入

`AgentRunSpec`（`@dataclass(slots=True)`）把 runner 需要的一切显式化：

| 字段 | 语义 |
| --- | --- |
| `initial_messages` / `tools` / `runtime` | 初始消息、工具注册表、LLMRuntime（模型+上下文窗口） |
| `max_iterations` / `max_tool_result_chars` | 迭代上限与单条工具结果字符预算 |
| `concurrent_tools` / `fail_on_tool_error` | 工具并发与错误传播策略 |
| `error_message` / `max_iterations_message` | 兜底文案（默认 "Sorry, I encountered an error calling the AI model."） |
| `provider_retry_mode` / `llm_timeout_s` / `retry_wait_callback` | provider 重试模式、超时、重试等待回调 |
| `injection_callback` / `checkpoint_callback` / `progress_callback` | 回合中注入、检查点与进度回调 |
| `goal_active_predicate` / `goal_continue_message` | goal 模式的存续判定与续跑消息 |
| `finalize_on_max_iterations` | 触达上限时是否让模型收尾（默认 True） |

## 4. Runner 迭代语义

`_run_core` 的循环：构造请求 kwargs（`_build_request_kwargs`）-> `_request_model`（支持流式 delta、thinking、provider 工具事件回调）-> 若模型返回 tool calls 则 `_execute_tools`（可选并发）-> 工具结果回流 -> 下一次迭代，直到无 tool call 或触达 `max_iterations`。

两个值得注意的容错：

- `_drop_malformed_tool_calls` + `_malformed_tool_call_retry_messages`：模型产出畸形 tool call 时，不是直接失败，而是丢弃并生成一条纠正消息让模型重试；
- `_usage_or_estimate` / `_estimate_response_usage`：provider 不回报 usage 时按字符估算，保证 token 统计不中断。

## 5. 注入与收尾

- **注入（injection）**：`injection_callback` 让外部（如渠道新消息、automation）在回合进行中插入补充消息。每回合最多 `_MAX_INJECTIONS_PER_TURN = 3` 条、最多 `_MAX_INJECTION_CYCLES = 5` 轮抽取（`_drain_injections` / `_try_drain_injections`），超出的部分直接丢弃并计数，防止注入风暴让回合永不结束。
- **最大迭代收尾**：触达 `max_iterations` 且 `finalize_on_max_iterations=True` 时，`_try_finalize_after_max_iterations` 追加收尾指令让模型基于已有结果给出最终回复；失败则回退 `_max_iterations_fallback` 文案。
- **goal 模式**：`goal_active_predicate` 为真时，模型停下后 runner 会注入 `_build_goal_continue_message` 让它继续，直到目标达成或预算耗尽（`_budget_exhausted_finalization_messages`）。

## 源码锚点

- [`sources/nanobot/nanobot/agent/loop.py`](../../sources/nanobot/nanobot/agent/loop.py)：TurnState、TurnContext、AgentLoop
- [`sources/nanobot/nanobot/agent/runner.py`](../../sources/nanobot/nanobot/agent/runner.py)：AgentRunSpec、AgentRunResult、AgentRunner
- [`sources/nanobot/nanobot/agent/context.py`](../../sources/nanobot/nanobot/agent/context.py)：BUILD 阶段的 ContextBuilder

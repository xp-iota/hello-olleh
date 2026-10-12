---
title: "可观测性：日志、运行时事件与 token 统计"
---
# 可观测性：日志、运行时事件与 token 统计

> 基于 `sources/nanobot/nanobot/bus/runtime_events.py`、`sources/nanobot/nanobot/cli/commands.py` 与 `sources/nanobot/nanobot/llm_usage/store.py` 中的 nanobot `v0.3.5` 源码校对。

**目录**

- [1. 日志面](#1-日志面)
- [2. 运行时事件总线](#2-运行时事件总线)
- [3. 回合内 trace](#3-回合内-trace)
- [4. token 与 usage 统计](#4-token-与-usage-统计)
- [5. 外部观测接入](#5-外部观测接入)

---

## 1. 日志面

nanobot 用 loguru 做结构化日志。CLI 侧 `_set_nanobot_logs(enabled)` 控制日志开关，避免交互模式被日志刷屏；日志目录经 `config/paths.py` 的 `get_logs_dir()` 解析到实例数据目录下。渠道加载失败等异常路径统一 `logger.warning` 而不中断启动。

## 2. 运行时事件总线

`bus/runtime_events.py` 定义一组运行时事件（`SessionTurnStarted`、`UserInputAccepted`、`TurnRuntimeAdmitted`、`TurnRunStatusChanged`、`TurnCompleted`、`SessionTurnPersisted`、`GoalStateChanged`、`RuntimeModelChanged`）与 `RuntimeEventPublisher`：运行时的状态变更（模型切换、preset 变更、runtime 选择、回合起止）以事件形式发布，WebUI 等观察者订阅。AgentLoop 持有 `runtime_event_publisher`，`_publish_runtime_selection(...)` 在模型/preset 变化时广播。

## 3. 回合内 trace

每个回合的七个阶段由 `_run_turn_stage` 逐段执行并计时，完成与失败都留下 `[turn ...] Stage ... in ...ms` 的 debug 日志。回合结束可回放：哪个阶段耗时、哪里报错一目了然——这是定位"agent 卡住"类问题的第一手数据（见 [03-agent-loop.md](./03-agent-loop.md) §2）。

## 4. token 与 usage 统计

- runner 在每次模型响应后累计 usage；provider 不回报时 `_usage_or_estimate` / `_estimate_response_usage` 按字符估算，保证统计连续；
- `AgentRunResult.usage` 把整回合的 token 带回给调用方；
- usage 聚合与展示数据由 `llm_usage/` 包完成：`store.py` 的 `LLMUsageStore` 做 SQLite 聚合（`SUM(total_tokens)`），`models.py` 定义 `LLMCallRecord`，`context.py` 以 contextvar 标记 usage 来源；WebUI 的 `metadata.py` / `transcript.py` 承载会话级展示。

## 5. 外部观测接入

- **Langfuse**：设置 `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` 后，OpenAI 兼容 provider 经 langfuse 的 `AsyncOpenAI` 包装把 LLM 调用上报到 Langfuse（见 `docs/configuration.md`）；
- **WebSocket 日志**：`webui/websocket_logging.py` 把日志流推到浏览器；
- **health 端点**：gateway `:18790` 与 API `/health` 供外部探活。

## 源码锚点

- [`sources/nanobot/nanobot/bus/runtime_events.py`](../../sources/nanobot/nanobot/bus/runtime_events.py)：运行时事件
- [`sources/nanobot/nanobot/agent/loop.py`](../../sources/nanobot/nanobot/agent/loop.py)：TurnContext 与回合阶段计时
- [`sources/nanobot/nanobot/llm_usage/store.py`](../../sources/nanobot/nanobot/llm_usage/store.py)：token 统计聚合
- [`sources/nanobot/nanobot/webui/websocket_logging.py`](../../sources/nanobot/nanobot/webui/websocket_logging.py)：日志推送

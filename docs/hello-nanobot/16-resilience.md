---
title: "韧性机制：fallback provider、取消与注入上限"
---
# 韧性机制：fallback provider、取消与注入上限

> 基于 `sources/nanobot/nanobot/providers/fallback_provider.py`、`sources/nanobot/nanobot/agent/runner.py` 与 `sources/nanobot/nanobot/agent/loop.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. FallbackProvider](#1-fallbackprovider)
- [2. 重试与超时](#2-重试与超时)
- [3. 取消语义](#3-取消语义)
- [4. 回合内自愈](#4-回合内自愈)
- [5. 进程级韧性](#5-进程级韧性)

---

## 1. FallbackProvider

`providers/fallback_provider.py` 的 `FallbackProvider` 包装主 provider 与备用 provider：

- `chat` / `chat_stream` 先走主 provider，失败经 `_try_with_fallback` 切到备用；
- `_primary_available()` 快速判定主路是否可用，避免每次都先失败一次；
- 流式路径用 `_tracking_delta` 跟踪已流出的增量，切换时保证用户侧流不重复、不断裂；
- `set_fallback_model_observer(...)`（`FallbackModelObserver`）让外部观测"当前实际在用哪个模型"；`generation` 属性透传生成参数。

配置侧有对应的 `InlineFallbackConfig`（config/schema.py）。

## 2. 重试与超时

- `AgentRunSpec.provider_retry_mode`（默认 `"standard"`）选择 provider 重试策略；`llm_timeout_s` 设单次年模型请求超时；`retry_wait_callback` 让 UI 能展示"正在等待重试"；
- MCP 侧 `_is_transient` / `_is_session_terminated` 区分可重试与会话终结（见 [24-mcp-system.md](./24-mcp-system.md)）；
- provider 不回报 usage 时用估算兜底（`_usage_or_estimate`），防止统计中断。

## 3. 取消语义

- `/stop` 命令 -> `AgentLoop._cancel_active_tasks(session_key)` 取消该会话的在途回合任务；
- 级联：`SubagentManager.cancel_by_session(session_key)` 停掉该会话的子代理；
- 会话级（而非全局）取消是多渠道常驻进程的关键性质：一个渠道的用户按停不影响其他会话。

## 4. 回合内自愈

| 症状 | 机制 |
| --- | --- |
| 畸形 tool call | 丢弃 + 纠正消息重试（`_drop_malformed_tool_calls`） |
| 孤儿/缺失 tool result | ContextGovernor 丢弃/回填（`drop_orphan_tool_results` / `backfill_missing_tool_results`） |
| 注入风暴 | `_MAX_INJECTIONS_PER_TURN=3`、`_MAX_INJECTION_CYCLES=5` 硬上限 |
| 触达迭代上限 | `_try_finalize_after_max_iterations` 让模型收尾；失败回退兜底文案 |
| 模型报错 | `error_message` 兜底回复，回合不崩 |

## 5. 进程级韧性

- 信号处理：`_install_gateway_shutdown_handlers` 注册 SIGTERM/SIGINT，关停时 flush 会话（`SessionManager.flush_all`）；
- 会话保存走 tmp+替换，崩溃最多损失最后一条消息；
- `_restore_terminal` 保证交互模式异常退出时终端状态恢复；
- 渠道/插件加载失败降级为 warning，不阻塞启动。

## 源码锚点

- [`sources/nanobot/nanobot/providers/fallback_provider.py`](../../sources/nanobot/nanobot/providers/fallback_provider.py)：FallbackProvider
- [`sources/nanobot/nanobot/agent/runner.py`](../../sources/nanobot/nanobot/agent/runner.py)：重试、注入上限与收尾
- [`sources/nanobot/nanobot/agent/loop.py`](../../sources/nanobot/nanobot/agent/loop.py)：取消与关停

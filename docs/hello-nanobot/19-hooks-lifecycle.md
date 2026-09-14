---
title: "Hooks 生命周期：AgentHook 与 CompositeHook"
---
# Hooks 生命周期：AgentHook 与 CompositeHook

> 基于 `sources/nanobot/nanobot/agent/hook.py` 与 `sources/nanobot/nanobot/agent/hooks/` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. Hook 契约](#1-hook-契约)
- [2. 回调点清单](#2-回调点清单)
- [3. CompositeHook 与容错](#3-compositehook-与容错)
- [4. 生产级用法](#4-生产级用法)

---

## 1. Hook 契约

`agent/hook.py` 的 `AgentHook` 是挂进 `AgentRunner` 生命周期 observer 基类（`AgentRunSpec.hook`）。构造参数 `reraise: bool = False` 控制 hook 自身异常是否上抛；`wants_streaming()` 声明是否需要流式回调（不需要的 hook 不付流式成本）。上下文对象分三级：`AgentRunHookContext`（整次执行）、`AgentHookContext`（迭代级）、`AgentTurnHookContext`（回合级，配合 `AgentTurnHookFactory` / `turn_hooks.py` 的 `build_agent_turn_hook`）。

## 2. 回调点清单

| 回调 | 时机 |
| --- | --- |
| `before_run` / `after_run` / `on_error` / `on_finally` | 整次 run 的进入、正常结束、异常、收尾 |
| `before_iteration` / `after_iteration` | 每次模型迭代前后 |
| `on_stream(delta)` / `on_stream_end(resuming=...)` | 流式增量与流结束（resuming 标记是否为续接） |
| `on_provider_tool_event` | provider 侧工具事件（如服务端工具） |
| `before_execute_tools` / `before_execute_tool` / `after_execute_tool` / `on_execute_tool_error` | 工具执行前后与单工具错误 |
| `emit_reasoning` / `emit_reasoning_end` | 推理（thinking）内容 |
| `finalize_content(context, content)` | 唯一有返回值的回调：可改写最终回复文本 |

## 3. CompositeHook 与容错

`CompositeHook(hooks)` 把多个 hook 合成一个：`_for_each_hook_safe` 逐个调用并隔离单 hook 异常（默认不中断其他 hook），`wants_streaming` 取或。runner 只持有一个 hook 引用，多订阅者场景都走 Composite——订阅者彼此无感知。

## 4. 生产级用法

| 用法 | 实现 |
| --- | --- |
| SDK 流式 | `sdk/streaming.py` 的 `SDKStreamingHook`：把迭代/流事件转成 `StreamEvent`（见 [15-sdk-transport.md](./15-sdk-transport.md)） |
| 子代理状态 | `subagent.py` 的 `_SubagentHook`：跟踪 `SubagentStatus`（见 [12-multi-agent.md](./12-multi-agent.md)） |
| 文件活动跟踪 | `agent/hooks/file_edit_activity.py` |
| 进度展示 | `agent/progress_hook.py` + CLI 进度行 |

hook 是 nanobot 扩展"回合内行为"的首选机制：比改 runner 安全，比工具插件更靠近生命周期。

## 源码锚点

- [`sources/nanobot/nanobot/agent/hook.py`](../../sources/nanobot/nanobot/agent/hook.py)：AgentHook/CompositeHook
- [`sources/nanobot/nanobot/agent/turn_hooks.py`](../../sources/nanobot/nanobot/agent/turn_hooks.py)：回合级 hook 工厂
- [`sources/nanobot/nanobot/agent/hooks/`](../../sources/nanobot/nanobot/agent/hooks)：内建 hook 实现

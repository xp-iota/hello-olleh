---
title: "多代理：SubagentManager 与 spawn 工具"
---
# 多代理：SubagentManager 与 spawn 工具

> 基于 `sources/nanobot/nanobot/agent/subagent.py` 与 `sources/nanobot/nanobot/agent/tools/spawn.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 多代理形态](#1-多代理形态)
- [2. spawn：模型驱动的派生](#2-spawn模型驱动的派生)
- [3. 生命周期与状态](#3-生命周期与状态)
- [4. 结果宣告与取消](#4-结果宣告与取消)

---

## 1. 多代理形态

nanobot 没有持久化的"agent 目录"或代理间协议（对照 OpenCode 的 agent catalog）；多代理就是**主 agent 经 `spawn` 工具派生一次性子代理**：子代理拿到独立的 `AgentRunner` 执行、自己的工具子集与迭代预算，跑完后结果作为工具结果回流主回合。子代理的 system prompt 用 `templates/agent/subagent_system.md`。

## 2. spawn：模型驱动的派生

`tools/spawn.py` 是注册进 ToolRegistry 的工具，模型像调其他工具一样调用它。`SubagentManager.spawn(...)` 的关键步骤：

- `_subagent_tools_config()` 决定子代理可见的工具配置（默认收窄，不给 spawn 本身，防止无限派生）；
- `_build_tools(...)` 构造子代理的 ToolRegistry；
- `_compat_spawn_runtime()` 复用或降级当前的 LLMRuntime；`set_provider(...)` 允许运行时切换 provider；
- `AgentLoop._sync_subagent_runtime_limits()` 把主循环的运行时上限同步给子代理管理器。

也支持代码内直接派生：`run_inline(...)` 不经工具调用直接跑一个子代理。

## 3. 生命周期与状态

- `SubagentStatus` 跟踪子代理状态；`_SubagentHook`（AgentHook 实现）挂进子代理的 runner：`before_execute_tools` / `after_iteration` 更新状态，让外部（WebUI、进度回调）能看到子代理推进；
- 子代理会话是内部会话（`_is_internal_session`），不参与 AutoCompact 与 Dream；
- 派生并发受主循环限制管理。

## 4. 结果宣告与取消

- `_announce_result(...)` 用 `templates/agent/subagent_announce.md` 把子代理结果包装成宣告消息，回流主回合；
- `cancel_by_session(session_key)` 按会话键取消该会话派生的全部子代理——`/stop` 命令或用户取消时会级联停掉在途子代理（见 [23-input-command-queue.md](./23-input-command-queue.md)）。

## 源码锚点

- [`sources/nanobot/nanobot/agent/subagent.py`](../../sources/nanobot/nanobot/agent/subagent.py)：SubagentManager
- [`sources/nanobot/nanobot/agent/tools/spawn.py`](../../sources/nanobot/nanobot/agent/tools/spawn.py)：spawn 工具
- [`sources/nanobot/nanobot/templates/agent/subagent_system.md`](../../sources/nanobot/nanobot/templates/agent/subagent_system.md)：子代理系统提示

---
title: "输入队列：MessageBus 准入与命令路由"
---
# 输入队列：MessageBus 准入与命令路由

> 基于 `sources/nanobot/nanobot/bus/queue.py`、`sources/nanobot/nanobot/command/router.py` 与 `sources/nanobot/nanobot/command/builtin.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 入站准入](#1-入站准入)
- [2. 命令判定与路由](#2-命令判定与路由)
- [3. 内建命令清单](#3-内建命令清单)
- [4. 自动化回合的入队](#4-自动化回合的入队)

---

## 1. 入站准入

所有输入统一经 `MessageBus.publish_inbound(InboundMessage)` 入队：渠道轮询/webhook 收到的消息、CLI 输入、cron 触发都走同一队列。`AgentLoop` 消费后先 `_effective_session_key(msg)` 定会话键，再 `_persist_user_message_early(...)`——**用户消息在回合开始前就落 JSONL**，回合中途崩溃也不丢用户输入（对照 OpenCode 的 inbox 先持久化语义，只是载体从 event log 换成消息行）。

## 2. 命令判定与路由

`command/router.py` 的 `CommandRouter`：

- 注册面三档：`priority(cmd, handler)`（最优先，如 `/stop`）、`exact(cmd, handler)`、`prefix(pfx, handler)`；
- 判定：`normalize_command_text` 归一化文本；`is_priority` 优先拦截（即使在回合进行中也能打断）；`is_dispatchable_command` 决定一条入站消息走命令还是走模型回合；
- 分发：`dispatch_priority(ctx)` 先于 `dispatch(ctx)` 被 `AgentLoop._dispatch_command_inline` 调用（回合的 COMMAND 状态）；`CommandContext` 携带 loop、会话、消息与渠道上下文。

## 3. 内建命令清单

`builtin.py` 的 `BUILTIN_COMMAND_SPECS` + `register_builtin_commands(router)`：

| 命令 | 作用 |
| --- | --- |
| `/stop` / `/restart` | 取消在途回合（级联子代理）/ 重启 |
| `/new` / `/history` | 清会话 / 查看历史 |
| `/status` | 检视运行时状态 |
| `/model` | 查看与切换模型 preset |
| `/dream` / `/dream_log` / `/dream_restore` / `/dream_prompt` / `/evaluator_prompt` | Dream 记忆整合全流程 |
| `/goal` | goal 模式管理 |
| `/skill` | skill 查看与加载 |
| `/trigger` | 触发本地 automation |
| `/pairing` | 渠道配对确认 |
| `/help` | `build_help_text` 从 specs 生成帮助；`builtin_command_palette` 供 UI 展示 |

## 4. 自动化回合的入队

cron 与 local triggers 不经 MessageBus 入站队列，而是走专用入口：`AgentLoop.submit_cron_turn(msg)` / `submit_local_trigger_turn(msg)`（TurnKind.SYSTEM）。回合结束后 `_publish_next_deferred_automation_turn(session_key)` 发布排队的后续自动化回合；`pending_cron_job_ids_for_session` / `pending_local_trigger_ids_for_session` 供 `/stop` 与检视查询。自动化模板见 `templates/agent/cron_reminder.md`。

## 源码锚点

- [`sources/nanobot/nanobot/bus/queue.py`](../../sources/nanobot/nanobot/bus/queue.py)：MessageBus
- [`sources/nanobot/nanobot/command/router.py`](../../sources/nanobot/nanobot/command/router.py)：CommandRouter
- [`sources/nanobot/nanobot/command/builtin.py`](../../sources/nanobot/nanobot/command/builtin.py)：内建命令
- [`sources/nanobot/docs/chat-commands.md`](../../sources/nanobot/docs/chat-commands.md)：上游命令文档

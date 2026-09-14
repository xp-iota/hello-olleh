---
title: "会话恢复：JSONL 重放、fork 与容错"
---
# 会话恢复：JSONL 重放、fork 与容错

> 基于 `sources/nanobot/nanobot/session/manager.py` 与 `sources/nanobot/nanobot/webui/forking.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 恢复模型](#1-恢复模型)
- [2. 加载路径与迁移](#2-加载路径与迁移)
- [3. fork：从某条用户消息分叉](#3-fork从某条用户消息分叉)
- [4. 损坏恢复](#4-损坏恢复)
- [5. 与其他 CLI 的对照](#5-与其他-cli-的对照)

---

## 1. 恢复模型

nanobot 的会话恢复是"重放 JSONL"：每条消息一行追加写，恢复就是把文件读回来重建 `Session.messages`。没有独立的事件日志与 projection 层（对照 OpenCode v2 的 durable event log）——JSONL 本身就是全部真相。恢复发生在回合的 `RESTORE` 状态（见 [03-agent-loop.md](./03-agent-loop.md)）。

## 2. 加载路径与迁移

`SessionManager` 的加载决策：

1. `_resolve_session_path(key, migrate=...)` 依次尝试当前命名（`_get_session_path`）与两个历史命名（`_get_legacy_lossy_path`、`_get_legacy_session_path`），命中旧格式时透明迁移；
2. `_load(key)` 读文件并重建 Session；失败进入 `_repair`；
3. `get_or_create(key)` 是入口：缓存命中直接返回，否则加载或新建。

会话键来自 `InboundMessage.session_key`（`{channel}:{chat_id}` 或 override），所以"恢复"天然跨进程：gateway 重启后，下一条消息自动接回同一 JSONL。

## 3. fork：从某条用户消息分叉

`SessionManager.fork_session_before_user_index(...)` 支持从历史的某个用户消息位置分叉出新会话——WebUI 的 `webui/forking.py` 把这个能力暴露为"从这里重开对话"。配合 `retain_recent_legal_suffix`，分叉点会被调整到合法边界（不切断 tool call/result 对）。

## 4. 损坏恢复

| 损坏形态 | 处理 |
| --- | --- |
| JSONL 末行半截（崩溃时正在写） | `_repair` 截掉坏行 |
| 保存冲突 | 写 `<key>.jsonl.tmp` 再原子替换，可选 `fsync` |
| 历史含非法序列 | `get_history` 回放时清洗（`_sanitize_assistant_replay_text`），`retain_recent_legal_suffix` 修剪 |
| 关停时未落盘 | `_install_gateway_shutdown_handlers` 里 `flush_all()` |

## 5. 与其他 CLI 的对照

| 维度 | nanobot | OpenCode v2 | Codex |
| --- | --- | --- | --- |
| 载体 | JSONL 消息日志 | durable event log + projection | rollout 文件 |
| 恢复 | 全量重放 + 窗口裁剪 | 事件回放 + 水位线 | rollout 重放 |
| 分叉 | `fork_session_before_user_index` | fork 会话 API | fork |
| 损坏处理 | `_repair` 截尾重建 | claim 协调 + reconciliate | — |

nanobot 的取舍：实现最简、人肉可读（JSONL 可以直接打开看），代价是没有跨进程写协调——它假设单实例 owning 一份数据目录。

## 源码锚点

- [`sources/nanobot/nanobot/session/manager.py`](../../sources/nanobot/nanobot/session/manager.py)：加载、迁移、fork、修复
- [`sources/nanobot/nanobot/webui/forking.py`](../../sources/nanobot/nanobot/webui/forking.py)：WebUI 分叉入口
- [`sources/nanobot/docs/concepts.md`](../../sources/nanobot/docs/concepts.md)：上游概念说明

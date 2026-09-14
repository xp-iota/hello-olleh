---
title: "状态、会话与记忆：JSONL、MemoryStore 与 Dream"
---
# 状态、会话与记忆：JSONL、MemoryStore 与 Dream

> 基于 `sources/nanobot/nanobot/session/manager.py`、`sources/nanobot/nanobot/agent/memory.py` 与 `sources/nanobot/nanobot/agent/autocompact.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 三个层次](#1-三个层次)
- [2. Session：JSONL 追加日志](#2-sessionjsonl-追加日志)
- [3. SessionManager：键编码与容错加载](#3-sessionmanager键编码与容错加载)
- [4. MemoryStore 与 Dream](#4-memorystore-与-dream)
- [5. AutoCompact：闲置压缩](#5-autocompact闲置压缩)

---

## 1. 三个层次

nanobot 的状态分三层，全部落在文件系统，没有数据库：

| 层 | 载体 | 生命周期 |
| --- | --- | --- |
| 会话历史 | `sessions/<key>.jsonl`（每行一条消息） | 随会话累积，按上下文窗口回放与压缩 |
| 长期记忆 | 工作区 `memory/` 下的 Markdown（MEMORY.md 等）+ git | 跨会话，Dream 整合 |
| 身份文件 | 工作区 `SOUL.md` / `USER.md` / `AGENTS.md` / `HEARTBEAT.md` | 用户可手改，进 system prompt |

## 2. Session：JSONL 追加日志

`Session`（manager.py L130）是消息列表加元数据：`add_message(role, content, **kwargs)` 追加；`get_history(...)` 按当前上下文窗口回放，`replay_max_messages_for_context(context_window_tokens)` 决定回放条数上限，`_sanitize_assistant_replay_text` 清洗回放文本。两个修剪原语：

- `retain_recent_legal_suffix(...)`：只保留尾部"合法"的消息序列（例如不孤立 tool result）；
- `enforce_file_cap(...)`：文件超上限时经 `set_file_cap_archiver` 注册的 archiver 归档旧段。

## 3. SessionManager：键编码与容错加载

- 会话键（`channel:chat_id` 或 override）经 `_storage_key` 编码为文件名，`_decode_storage_key` 可逆；`_get_legacy_lossy_path` / `_get_legacy_session_path` 处理两个历史版本的命名，`_resolve_session_path(migrate=True)` 在加载时透明迁移。
- 加载走 `_load` -> 失败进 `_repair`（截掉坏行重建）；保存走 `save(session, fsync=False)`：先写 `<key>.jsonl.tmp` 再替换，可选 fsync。
- 内存侧 `_remember` / `_cached` 做会话缓存，`flush_all()` 在关停时落盘。

## 4. MemoryStore 与 Dream

`MemoryStore`（memory.py L46）以工作区为根：

- 读写 `read_memory`/`write_memory`/`read_soul`/`read_user`；`get_memory_context()` 把记忆拼成注入 prompt 的上下文块；
- 历史追加 `append_history(...)` 带单调 cursor（`_next_cursor`），`read_unprocessed_history(since_cursor)` 供整合器增量消费；`_maybe_migrate_legacy_history` 把旧版纯文本历史切块迁移；
- `git` 属性暴露 `GitStore`——记忆目录用 git 做版本化，Dream 整合可以回滚；
- `Consolidator` 与 `Dream`（同文件）是"做梦"机制：在闲置时把未处理历史整合进长期记忆，对应模板 `templates/agent/dream.md`、`consolidator_archive.md`、`evaluator.md`，对应命令 `/dream`、`/dream_log`、`/dream_restore`（见 [23-input-command-queue.md](./23-input-command-queue.md)）。

## 5. AutoCompact：闲置压缩

`AutoCompact`（autocompact.py）与 OpenCode 的"溢出即压"不同，它按**闲置时间**触发：

- `check_expired(...)` 找出超过空闲阈值且尾部可压缩（`_has_compactable_idle_tail`）的会话；
- `_archive(...)` 用 `Consolidator` 把旧段归档进记忆；
- `prepare_session(session, key)` 在回合的 COMPACT 状态被调用，返回（可能已压缩的会话, 压缩说明），压缩摘要按 `_format_summary` 带上最后活跃时间。

内部会话（`_is_internal_session`，如 dream/子代理会话）永不自动压缩。

## 源码锚点

- [`sources/nanobot/nanobot/session/manager.py`](../../sources/nanobot/nanobot/session/manager.py)：Session 与 SessionManager
- [`sources/nanobot/nanobot/agent/memory.py`](../../sources/nanobot/nanobot/agent/memory.py)：MemoryStore、Consolidator、Dream
- [`sources/nanobot/nanobot/agent/autocompact.py`](../../sources/nanobot/nanobot/agent/autocompact.py)：AutoCompact
- [`sources/nanobot/docs/memory.md`](../../sources/nanobot/docs/memory.md)：上游记忆机制说明

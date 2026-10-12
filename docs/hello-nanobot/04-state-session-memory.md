---
title: "状态、会话与记忆：JSONL、MemoryStore 与 Dream"
---
# 状态、会话与记忆：JSONL、MemoryStore 与 Dream

> 基于 `sources/nanobot/nanobot/session/manager.py`、`sources/nanobot/nanobot/agent/memory.py` 与 `sources/nanobot/nanobot/agent/autocompact.py` 中的 nanobot `v0.3.5` 源码校对。

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

`Session`（manager.py）是消息列表加元数据：`add_message(role, content, **kwargs)` 追加；`get_history(...)` 回放近期可投喂消息——`last_archived` 水位之前的前缀已被 summary checkpoint 取代，回放从水位后恢复，`find_legal_message_start` 丢弃队首孤立的 tool result，`_sanitize_assistant_replay_text` 清洗回放文本。

## 3. SessionManager：键编码与容错加载

- 会话键（`channel:chat_id` 或 override）经 `_storage_key` 编码为防碰撞的文件名，`_decode_storage_key` 可逆；`_get_legacy_lossy_path` / `_get_legacy_session_path` 对应两个历史版本的命名，加载时按新路径优先、旧命名回退的顺序透明迁移。
- 加载走 `_load` -> 失败进 `_repair`（截掉坏行重建）；保存走 `save(session, fsync=False)`：先写随机后缀的临时文件再原子替换，可选 fsync。
- 内存侧 `_remember` / `_cached` 做会话缓存，`flush_all()` 在关停时落盘。

## 4. MemoryStore 与 Dream

`MemoryStore`（memory.py）以工作区为根：

- 读写 `read_memory`/`write_memory`/`read_soul`/`read_user`；`get_memory_context()` 把记忆拼成注入 prompt 的上下文块；
- 历史追加 `append_history(...)` 带单调 cursor（`_next_cursor`），`read_unprocessed_history(since_cursor)` 供整合器增量消费；`_maybe_migrate_legacy_history` 把旧版纯文本历史切块迁移；
- `git` 属性暴露 `GitStore`（`utils/gitstore.py`）——记忆目录用 git 做版本化，Dream 整合可以回滚；
- 「做梦」机制：`Consolidator`（memory.py）把未处理历史整合进长期记忆；`/dream` 系列命令经 `MemoryStore.build_dream_prompt()` 等 dream 方法驱动 dream 回合（内部会话键 `dream:` 前缀），对应模板 `templates/agent/dream.md`、`consolidator_archive.md`、`evaluator.md`，命令 `/dream`、`/dream-log`、`/dream-restore`（见 [23-input-command-queue.md](./23-input-command-queue.md)）。

## 5. AutoCompact：闲置压缩

`AutoCompact`（autocompact.py）与 OpenCode 的"溢出即压"不同，它按**闲置时间**触发：

- `check_expired(...)` 为超过空闲 TTL、仍有未归档消息（`_has_unarchived_messages`）且没有在途回合的会话调度后台归档；解析不到合法模型的会话跳过（可经 `/model` 恢复）；
- `_archive(key, runtime)` 经 `Consolidator.compact_idle_session(...)` 把旧段归档为 summary checkpoint；
- `prepare_session(session, key)` 在回合的 compact 阶段被调用，返回（会话, 压缩摘要）：热路径取进程内 `_summaries` 缓存，冷路径经 `session_summary_from_metadata` 从会话元数据恢复摘要。

内部会话（`_is_internal_session`，`dream:` 前缀）永不自动压缩。

## 源码锚点

- [`sources/nanobot/nanobot/session/manager.py`](../../sources/nanobot/nanobot/session/manager.py)：Session 与 SessionManager
- [`sources/nanobot/nanobot/agent/memory.py`](../../sources/nanobot/nanobot/agent/memory.py)：MemoryStore、Consolidator、Dream
- [`sources/nanobot/nanobot/agent/autocompact.py`](../../sources/nanobot/nanobot/agent/autocompact.py)：AutoCompact
- [`sources/nanobot/docs/memory.md`](../../sources/nanobot/docs/memory.md)：上游记忆机制说明

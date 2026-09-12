---
layout: content
title: "Codex GhostSnapshot 机制：Git 快照、Undo 恢复与 Compaction 存活"
---
# Codex GhostSnapshot 机制：Git 快照、Undo 恢复与 Compaction 存活

> 本章分析 Codex 独有的 GhostSnapshot 机制。GhostSnapshot 在 03-agent-loop 中被简要提及，本章完整展开其生命周期、与 Undo 的关系、以及在 Compaction 中如何保持幸存。

**目录**

- [1. GhostSnapshot 是什么](#1-ghostsnapshot-是什么)
- [2. 任务生命周期](#2-任务生命周期)
- [3. Git 提交机制](#3-git-提交机制)
- [4. 与 Compaction 的关系：幸存机制](#4-与-compaction-的关系幸存机制)
- [5. 与 Undo 系统的关系](#5-与-undo-系统的关系)
- [6. 配置项](#6-配置项)
- [7. 关键源码锚点](#7-关键源码锚点)

---

## 1. GhostSnapshot 是什么

**定位**：Codex 在每次工具执行前，对当前工作目录创建一个轻量级 Git 提交（"ghost commit"），作为可选的 Undo 还原点。

这使 Codex 支持"撤销到上一个干净状态"的能力——当工具执行破坏了工作目录时，用户可以触发 Undo，Codex 执行 `git checkout <ghost_commit>` 将文件恢复到快照状态。

### 与普通 Git 提交的区别

| 维度 | 普通 git commit | GhostSnapshot commit |
| :------| :---------------| :---------------------|
| 创建时机 | 开发者手动 | 每次工具执行前自动 |
| 提交信息 | 用户写 | `"ghost-snapshot-<timestamp>"` |
| 标签 | 无 | 特殊 marker（`GhostSnapshot` in history）|
| 是否可见 | 是（`git log`）| 不可见（不在正常历史中）|
| 清理时机 | 永不自动 | compaction 后通过 undo.rs 清理 |

### 在对话历史中的表示

GhostSnapshot 以 `ResponseItem::GhostSnapshot` 存入 ConversationHistory：

```rust
ResponseItem::GhostSnapshot {
    ghost_commit: GhostSnapshotData {  // 包含 git commit hash 等元数据
        commit_hash: String,
        created_at: i64,
        working_directory: String,
    }
}
```

---

## 2. 任务生命周期

**位置**：`codex-rs/core/src/tasks/ghost_snapshot.rs`

`GhostSnapshotTask` 实现 `SessionTask` trait（与普通 task tool 一样的接口）：

```rust
pub(crate) struct GhostSnapshotTask {
    token: Token,
}

impl SessionTask for GhostSnapshotTask {
    fn kind(&self) -> TaskKind { TaskKind::Regular }
    fn span_name(&self) -> &'static str { "session_task.ghost_snapshot" }
    async fn run(self, session, ctx, input, cancellation) -> Option<String> { ... }
}
```

### 启动时机

在 `run_turn` 的预采样准备阶段（`run_turn` 行 5792）：

```rust
sess.maybe_start_ghost_snapshot(
    Arc::clone(&turn_context),
    cancellation_token.child_token()
).await;
```

`maybe_start_ghost_snapshot()` 是懒启动——检查配置后才实际创建任务。

### 4 分钟警告机制

GhostSnapshot 如果运行超过 240 秒，会向用户发送 warning：

```
"Repository snapshot is taking longer than expected.
Large untracked or ignored files can slow snapshots;
consider adding large files or directories to .gitignore
or disabling `undo` in your config."
```

这说明 GhostSnapshot 遍历未跟踪文件时，如果存在大量未跟踪的大文件（比如 `node_modules`），可能非常慢。警告帮助用户发现问题。

---

## 3. Git 提交机制

**位置**：`codex_git_utils::create_ghost_commit_with_report`

核心流程：

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TD
    A["开始 ghost_snapshot 任务"] --> B["扫描工作目录"]
    B --> C{"发现未跟踪大文件?"}
    C -->|是 (>ignore_large_untracked_files)| D["跳过该文件"]
    C -->|否| E["git add <file>"]
    D --> F{"发现大未跟踪目录?"}
    F -->|是 (>ignore_large_untracked_dirs)| G["跳过整个目录"]
    F -->|否| H["git add <directory>"]
    E --> I["git commit -m 'ghost-snapshot-<timestamp>'"]
    H --> I
    I --> J["生成 GhostSnapshotReport"]
    J --> K["ResponseItem::GhostSnapshot 写入历史"]
    K --> L["向 session 发送 warning（如有）"]
```

### GhostSnapshotReport

任务返回的 `GhostSnapshotReport` 包含：

```rust
pub struct GhostSnapshotReport {
    pub commit_hash: String,
    pub ignored_untracked_files: Vec<FileInfo>,   // 超过阈值被跳过的文件
    pub large_untracked_dirs: Vec<DirInfo>,        // 超过阈值被跳过的目录
    pub snapshot_duration_ms: u64,
}
```

### 与 Git 的交互方式

Codex 使用 `codex_git_utils` crate 的 `create_ghost_commit_with_report` 函数，直接调用 Git 命令：

```rust
// 创建 ghost commit
CreateGhostCommitOptions::new(&repo_path)
    .ghost_snapshot(ghost_snapshot_config)
    .create()
```

使用的是 `--allow-empty`（允许空提交）和 `--no-verify`（跳过 hooks）。

---

## 4. 与 Compaction 的关系：幸存机制

**位置**：`codex-rs/core/src/compact.rs:207-212`

Compaction（上下文压缩）将长对话历史替换为摘要，但 GhostSnapshot 有特殊的"幸存"待遇：

```rust
// compact.rs:207-212
// 在构建压缩后历史时，保留所有 GhostSnapshot
let ghost_snapshots: Vec<ResponseItem> = history_items
    .iter()
    .filter(|item| matches!(item, ResponseItem::GhostSnapshot { .. }))
    .cloned()
    .collect();
new_history.extend(ghost_snapshots);
```

### 为什么 GhostSnapshot 必须在 Compaction 中幸存？

1. **Undo 依赖性**：如果 compaction 删除了旧的 GhostSnapshot，用户就无法 undo 到 compaction 之前的文件状态
2. **可审计性**：即使对话被压缩，用户仍然能看到"在哪里创建过快照"
3. **工作目录连续性**：Codex 不知道 compaction 后用户是否会触发 Undo，所以保守地保留所有快照

### Compaction 中的 token 消耗

GhostSnapshot 作为 `ResponseItem` 存在历史中，也会计入 token 使用量。但由于 GhostSnapshot 包含的是纯元数据（commit hash + timestamp），单个条目 token 开销很小，远小于工具输出或消息内容。

---

## 5. 与 Undo 系统的关系

**位置**：`codex-rs/core/src/tasks/undo.rs`

Undo 系统消费 GhostSnapshot 历史：

```rust
// undo.rs:84
match item {
    ResponseItem::GhostSnapshot { ghost_commit } => {
        // 从历史中获取最近的 ghost commit
        latest_ghost_snapshot = Some(ghost_commit.clone());
    }
    _ => {}
}
```

Undo 的恢复流程：

```
用户触发 /undo
    ↓
从历史中找到最近的 ResponseItem::GhostSnapshot
    ↓
RestoreGhostCommitOptions::new(&repo_path)
    .ghost_snapshot(ghost_snapshot_config)
    .restore(commit_hash)
    ↓
git checkout <ghost_commit_hash>
    ↓
工作目录恢复到快照状态
    ↓
将本次 Undo 记录为新的 GhostSnapshot
```

### 清理策略

当 compaction 发生后，旧 GhostSnapshot 可能会积累。undo.rs 在每次 Undo 时清理比当前 ghost commit 更旧的 snapshot commits（通过 `git branch -D` 或 `git reset --hard` 到最新 snapshot）。

---

## 6. 配置项

**位置**：`codex-rs/core/src/config/mod.rs`

```toml
# codex.toml 或 config.toml
[ghost_snapshot]
# 是否启用（默认 true）
enabled = true

# 是否发送警告（默认 true）
disable_warnings = false

# 单文件大小阈值（字节），超过则跳过（默认 10MB）
ignore_large_untracked_files = 10485760

# 目录内文件数量阈值，超过则跳过整个目录（默认 1000）
ignore_large_untracked_dirs = 1000
```

### disable_warnings 的使用场景

在大型 monorepo 中，`node_modules`、`vendor/` 等大目录持续触发警告，影响用户体验。通过设置 `disable_warnings = true` 静默 GhostSnapshot。

---

## 7. 关键源码锚点

| 文件 | 行号 | 职责 |
| :------| :------| :------|
| `core/src/tasks/ghost_snapshot.rs` | 全文（233 行）| GhostSnapshotTask 定义、Git 提交逻辑、warning 机制 |
| `core/src/tasks/undo.rs` | 84-100 | Undo 如何消费 GhostSnapshot |
| `core/src/compact.rs` | 207-212 | Compaction 中 GhostSnapshot 幸存逻辑 |
| `core/src/codex.rs` | 5792 | `maybe_start_ghost_snapshot()` 启动点 |
| `core/src/config/mod.rs` | 1342, 1602 | GhostSnapshotConfig 和 GhostSnapshotToml |
| `codex_git_utils::create_ghost_commit_with_report` | crate 内部 | Git 命令编排 |

---

*文档版本: 1.0*
*分析日期: 2026-04-08*

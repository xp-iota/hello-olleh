# Hermes Sessions 清理手记

> 记录一次完整的 hermes sessions 数据库清空过程：从 112 条会话压缩到 0 条，数据库从 49.3 MB 瘦身到 0.1 MB。

## 1. 背景

`hermes` CLI（`D:\garden\anaconda3\Scripts\hermes.exe` v0.16.0）内置 SQLite 会话存储，
每次 `chat` / `list` / `delete` 等调用都会在 `state.db` 中写入一行 session 记录。

经过几个月的使用，本机累积：

| 指标 | 值 |
|---|---|
| Total sessions | **112** |
| Total messages | 1139 |
| cli 来源 | 35 sessions |
| Database size | **49.3 MB** |

`hermes sessions list` 一次只返回最近 20 条，按 `started_at DESC` 分页。
`list` 命令本身也会创建一条新的 cli session —— 这就是为什么需要循环清理。

## 2. 子命令勘察

```bash
hermes sessions --help
# 子命令：list / export / delete / prune / optimize / repair / stats / rename / browse
```

关键子命令：

| 子命令 | 作用 |
|---|---|
| `list` | 列出最近 20 条 session |
| `delete <id>` | 按 ID 删一条（支持 `--yes`） |
| `prune --older-than N` | 按年龄清理（默认 90 天） |
| `optimize` | FTS5 merge + VACUUM，回收磁盘 |
| `repair` | 修复 `state.db` 让隐藏 session 重新可见 |
| `stats` | 总数 + 来源分布 + 数据库大小 |

`prune` 无法精确删全部，`delete` 一次一条 —— 需要脚本化。

## 3. 一行命令的核心

`hermes sessions list` 输出格式（固定列宽，最后一列就是 ID）：

```
Title                            Preview                                  Last Active   ID
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
—                                work kanban task t_8d1f31ae              1m ago        20260619_151721_6045f5
```

提取 ID 的关键：

- **跳过前 2 行**：表头 + 分隔线
- **排除分隔线**：`!/^─/` 防止 `─...` 行被当成 ID
- **`$NF` 取最后一列**：session ID

```bash
hermes sessions list | awk 'NR>2 && !/^─/ {print $NF}' | xargs -I {} hermes sessions delete --yes {}
```

## 4. 第一轮：可见的 20 条

```bash
hermes sessions list | awk 'NR>2 && !/^─/ {print $NF}' | xargs -I {} hermes sessions delete --yes {}
```

输出 21 条 `Deleted session ...`（其中 1 条是 `list` 命令自身刚创建的 cli session）。

## 5. 第二轮：分页里藏着的更老 session

`list` 只显示最近 20 条，再跑一次发现还有一批从 5 月到 6 月初的会话。
继续同一条命令，再删 21 条。

此时仍残留 5 条 `list` 看不到的"幽灵 session"。

## 6. 循环兜底

因为 `list` 每次都创建一条 cli session，无法事先知道剩余多少轮，
用 `while` 循环到列表为空：

```bash
while hermes sessions list 2>/dev/null | awk 'NR>2 && !/^─/ {print $NF}' | grep -q .; do
  hermes sessions list 2>/dev/null | awk 'NR>2 && !/^─/ {print $NF}' \
    | xargs -I {} hermes sessions delete --yes {}
done
```

这一轮一次性干掉 ~80 条 4 月/5 月的旧 session，包括 4 条 acp 来源的。
（任务后台跑了几十秒，输出 100+ 行 `Deleted session ...`。）

## 7. 隐藏的 5 条：list 看不到，stats 看得到

`list` 显示 *No sessions found*，但 `stats` 仍然显示：

```
Total sessions: 5
Total messages: 23
  cli: 1 sessions
```

这些是"隐藏 session" —— 来源是 `acp`（4 条）和 `cli`（1 条），
可能是 `hermes sessions list` 自身刚写入、或来自 Hermes Desktop 的 ACP 连接。

`repair` 报告 *no repair needed*，`list` 仍然为空。
直接读 SQLite 拿到全部 ID：

```bash
sqlite3 "C:/Users/feuye/AppData/Local/hermes/state.db" \
  "SELECT id, source FROM sessions;"
```

得到：

```
ae9faab6-623a-445f-bbeb-c6d7f655d30e | acp
20260519_225805_3fee85            | cli
04837e85-44df-4622-9270-32fd045e27c7 | acp
7368013e-fe42-4bbf-a608-01893162fcc0 | acp
9fa0d66e-e420-4d37-9622-48a3d9ef25d6 | acp
```

`hermes sessions delete --yes <id>` 对隐藏 ID 也生效 —— 一条命令批量清掉：

```bash
for sid in ae9faab6-... 20260519_225805_3fee85 04837e85-... 7368013e-... 9fa0d66e-...; do
  hermes sessions delete --yes "$sid"
done
```

## 8. VACUUM 回收磁盘

```bash
hermes sessions optimize
# Optimized 2 FTS index(es).
# Database size: 49.3 MB -> 0.1 MB (reclaimed 49.2 MB)
```

## 9. 最终状态

```
$ hermes sessions list
No sessions found.

$ hermes sessions stats
Total sessions: 0
Total messages: 0
Database size: 0.1 MB
```

| 阶段 | Sessions | Messages | DB Size |
|---|---:|---:|---:|
| 初始 | 112 | 1139 | 49.3 MB |
| 列表可见删除后 | 5 | 23 | 49.3 MB |
| 隐藏 session 删除后 | 0 | 0 | 0.5 MB |
| VACUUM 后 | 0 | 0 | **0.1 MB** |

## 10. 经验总结

1. **`list` 一次只显示 20 条**，按 `started_at DESC` 排序 —— 想全删必须循环。
2. **`list` 自身会创建 cli session**，所以最后一轮总会多出 1 条，无害。
3. **存在 `list` 不可见的隐藏 session**（acp / 部分 cli 来源），
   `stats` 才是真相来源；清理完务必用 `stats` 而非 `list` 验证。
4. **`prune --older-than` 不够用**：只能按年龄，且默认 90 天；要"全清"必须按 ID 删。
5. **`optimize` 必须最后跑**：VACUUM 才能把已删除行真正释放回文件系统。
6. **一行命令的核心**：
   ```bash
   hermes sessions list | awk 'NR>2 && !/^─/ {print $NF}' \
     | xargs -I {} hermes sessions delete --yes {}
   ```
   包到 `while ... grep -q .` 循环里就能彻底清空。

## 11. 复现脚本

```bash
# 全清 hermes sessions（含隐藏 acp/cli）+ VACUUM
while hermes sessions list 2>/dev/null | awk 'NR>2 && !/^─/ {print $NF}' | grep -q .; do
  hermes sessions list 2>/dev/null | awk 'NR>2 && !/^─/ {print $NF}' \
    | xargs -I {} hermes sessions delete --yes {}
done

# 兜底：清理隐藏的 acp/cli session（来自 stats 报告）
sqlite3 "C:/Users/feuye/AppData/Local/hermes/state.db" \
  "SELECT id FROM sessions;" \
  | while read -r sid; do
      [ -n "$sid" ] && hermes sessions delete --yes "$sid"
    done

# 回收磁盘
hermes sessions optimize
hermes sessions stats   # 确认 Total sessions: 0
```

---
title: "状态、会话、记忆：Gateway 持有的双 SQLite 与带出处门控的记忆分层"
---
# 状态、会话、记忆：Gateway 持有的双 SQLite 与带出处门控的记忆分层

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是常驻本机的个人 AI 助理网关：Gateway 是唯一的状态所有者，CLI/TUI/Control UI/20+ 消息通道都只是客户端。

**目录**

- [1. 状态归属：Gateway 与双 SQLite 库](#1-状态归属gateway-与双-sqlite-库)
- [2. 会话：session key、SessionManager 与 transcript](#2-会话session-keysessionmanager-与-transcript)
- [3. 会话状态感知：信号日志与 watcher](#3-会话状态感知信号日志与-watcher)
- [4. 记忆：五层模型与写入门控](#4-记忆五层模型与写入门控)
- [5. transcript、备份与加密存储](#5-transcript备份与加密存储)

---

## 1. 状态归属：Gateway 与双 SQLite 库

与 pi 的"每个 CLI 进话自带 JSONL"不同，openclaw 的所有会话状态由 Gateway 进程持有，UI 客户端只向 Gateway 查询（`docs/concepts/session.md`）。状态分两套 SQLite 库，schema 版本号在 `package.json` 的 `openclaw.schemaVersions` 中声明（`package.json:6`），运行期由 `src/state/openclaw-schema-versions.ts` 解析：

| 数据库 | 路径 | schema 版本 | 内容 |
| --- | --- | --- | --- |
| 共享 state 库 | `~/.openclaw/state/openclaw.sqlite`（`openclaw-state-db.paths.ts:32`） | state 20（`openclaw-state-db-contract.ts:23`） | cron、subagent registry、delivery queue、session 信号日志、user profile、fleet cell |
| per-agent 库 | `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite` | agent 24（`openclaw-agent-db-contract.ts:27`） | 会话行、transcript、auth profile、pending inputs、模型注册 |

每个库把 schema 版本写在两处：SQLite `PRAGMA user_version` 和 `schema_meta` 行（含 `app_version`），迁移**前向 only**——打开旧库时自动迁移，遇到比运行版本新的库直接拒绝（见 [10-session-resume.md](./10-session-resume.md) §6）。底层统一走 `node:sqlite`（Node 24 内建），`node-sqlite.mjs` 用一段自包含探针在启动时验证 text/blob/json 往返正确性，避免运行期才暴露方言问题。

## 2. 会话：session key、SessionManager 与 transcript

会话由 **session key** 寻址，形状为 `agent:<agentId>:<mainKey|group peer|subagent:uuid>`，解析/构造在 `src/routing/session-key.ts` 与 `src/sessions/session-key-utils.ts`（导出 `parseAgentSessionKey`、`isSubagentSessionKey`、`isCronSessionKey` 等）。路由默认值：DM 全部折叠进 `agent:<agentId>:main` 主会话，群组按群隔离，cron 每次运行开新会话；`session.dmScope` 可改为 per-peer/per-channel-peer 隔离。incognito 会话（key 带 `incognito-` 段）只存进程内存，24 小时或 Gateway 重启即销毁。

transcript 不是 JSONL 而是存进 per-agent 库的表结构，由 `SessionManager`（`src/agents/sessions/session-manager.ts:106`，`extends SessionManagerBranching`）管理；文件头注释明说"Session tree manager backed by an explicit SQLite transcript identity"，codec/存储/分支被拆进 `session-manager-branching.ts` 等内聚模块，支持分支重写（`session-accessor.sqlite-branch-rewrite`）与上下文版本锚点。会话行带三个独立时间戳：`sessionStartedAt`（daily reset 依据）、`lastInteractionAt`（idle 依据）、`updatedAt`（仅列表/修剪用）。压缩（compaction）在接近上下文窗口时自动触发，切分点保持 tool call 与 `toolResult` 成对，压缩前还会自动提醒 agent 把未落盘的内容写进记忆文件（`docs/concepts/compaction.md`）。

## 3. 会话状态感知：信号日志与 watcher

多个会话常围绕同一问题工作（父代理委派、人直接进 worker 会话），openclaw 用一套"durable 信号日志 + watcher 游标 + 对账"机制让会话感知他人的干预（`docs/concepts/session-state.md`）：

- **信号日志**：被关注会话发生实质变化时向共享 state 库追加一条 typed 事件（`session_state_events` 表，`openclaw-state-schema.sql:312`；记录类型 `SessionStateEventRecord` 见 `session-state-events.types.ts:3`，kind 含 `created`/`human_direct_message`/`goal_changed`/`child_spawned`/`run_completed`/`compacted` 等），只带元数据与一行摘要，不带消息内容。保留期 30 天、5 万行（`session-state-events.kernel.ts:75-76`）。
- **watcher**：父会话在 spawn 子会话时自动播种游标（`session_watch_cursors` 表，`openclaw-state-schema.sql:347`）；`sessions_send watch: true` 可显式关注。通知是**反垃圾**设计：每个 watcher/target 只挂一条 pending 通知，游标冻结在通知位，排空时才推进并只对交错的新事件再开一条。
- **对账**：通知文本直接给出下一步——`session_status sessionKey "..." changesSince 12` 返回该版本之后的 typed 事件（≤200 条），`historyGap: true` 表示版本早于保留历史，需整段刷新。

会话的 `stateVersion` 就是其日志最高序号，重剪后仍单调。

## 4. 记忆：五层模型与写入门控

openclaw 有一个与 pi"无内建记忆"完全相反的、内建且默认开启的记忆系统（Memory Core 插件，架构见 `docs/concepts/memory-architecture.md`）：

| 层 | 载体 | 写入者 | 注入 |
| --- | --- | --- | --- |
| Instructions | `AGENTS.md` 等指令文件 | 仅人 | 会话启动时始终注入 |
| Curated core | `MEMORY.md`、`USER.md` | dreaming 巩固/用户直述 | 启动时（出处合格前提下），按预算 |
| Episodic | `memory/YYYY-MM-DD.md` 日记、transcript | agent 工作中、flush、transcript ingestion | 仅按需检索 |
| Prospective | standing intents（SQLite）、cron | `intent` 工具 | 触发命中时 |
| Review | `DREAMS.md`、dreaming 报告 | dreaming 各阶段 | 永不注入，供人审阅 |

核心安全设计是**出处（provenance）写在 SQLite 列里而非正文里**：origin class 是封闭集合 `owner`/`agent`/`untrusted`/`system`，由分类代码写入（`src/memory/memory-artifact-provenance.ts`），模型无法通过散文伪造；`untrusted`/`system` 出处的内容被结构性挡在 curated core 和自动注入之外——"写路径即安全边界"，而非事后检测投毒。长期记忆的唯一主写入者是 **dreaming** 后台巩固：确定性 gate（按召回频率等信号排序、排除不合格出处）→ 有界模型巩固 → 乐观并发替换 `MEMORY.md`（替换前复查内容 hash，冲突则回退 append-only；pre-image 与变更摘要落 `DREAMS.md`）。召回分两条 lane：lane 1 零模型调用（bootstrap 注入 + 带重要性/trigger 注释的混合检索 + 触发词注入，上限每轮 3 条且仅限 curated 层），lane 2 是 escalation 子代理，仅在"出现回忆意图且 lane 1 无强命中"时跑。`USER.md` 单独承载用户偏好，条目是祈使句指令、原地 supersede；standing intents 则干脆"编译出模型"——时间型转 cron、事件型进 SQLite 表走确定性 prefilter（`src/memory-host-sdk/` 提供记忆插件宿主侧的 dreaming/事件存储接口）。根文件名规范化在 `src/memory/root-memory-files.ts:6`（canonical `MEMORY.md`，legacy 小写 `memory.md` 排除扫描）。

## 5. transcript、备份与加密存储

会话维护（`session.maintenance`）用"年龄 + 条目上限 + 磁盘预算"三层淘汰：默认 `pruneAfter: "30d"`、`maxEntries: 5000`，超限先归档最旧的普通会话而不是删 transcript；被 pin 的根会话、活动工作、durable 外部会话指针受保护；磁盘预算清理会被"未完成的 WAL checkpoint"阻塞并记录 `deferredReason`。归档 transcript 与 JSONL 导出由 `src/transcripts/store.ts` 落盘到 `~/.openclaw/agents/<agentId>/sessions/`（带 sha256 摘要与导出 manifest），语音转写捕获在 `src/transcripts/capture.ts`。备份有两条路：`src/snapshot/` 把会话冷备份编码进本地 git 仓库（`git-backup-codec.ts`）；命名存储位置（`src/storage/`）则支持外置盘，对象流经 `OCSTOR1` 格式加密（scrypt 派生主密钥 + 每 object 独立密钥的 AES-256-GCM 分段，`encryption.ts`）后才交给 provider，且位置必须显式 `openclaw storage init`（写入 `openclaw-storage.json` 标记）——空挂载点不会静默变成系统盘上的存储。多代理如何共享或隔离这套状态见 [12-multi-agent.md](./12-multi-agent.md)。

## 源码锚点

- [`sources/openclaw/src/state/openclaw-state-db-contract.ts`](../../sources/openclaw/src/state/openclaw-state-db-contract.ts)：state schema 版本 20（`:23`）与共享库契约
- [`sources/openclaw/src/state/openclaw-agent-db-contract.ts`](../../sources/openclaw/src/state/openclaw-agent-db-contract.ts)：agent schema 版本 24（`:27`）与 per-agent 库契约
- [`sources/openclaw/src/state/openclaw-schema-versions.ts`](../../sources/openclaw/src/state/openclaw-schema-versions.ts)：从 package.json 解析 schemaVersions（含 schema-1 legacy 契约）
- [`sources/openclaw/src/agents/sessions/session-manager.ts`](../../sources/openclaw/src/agents/sessions/session-manager.ts)：SQLite transcript 身份之上的 SessionManager（`:106`）
- [`sources/openclaw/src/sessions/session-state-events.kernel.ts`](../../sources/openclaw/src/sessions/session-state-events.kernel.ts)：信号日志内核与 30 天/5 万行保留（`:75-76`）
- [`sources/openclaw/src/state/openclaw-state-schema.sql`](../../sources/openclaw/src/state/openclaw-state-schema.sql)：`session_state_events`（`:312`）与 `session_watch_cursors`（`:347`）
- [`sources/openclaw/src/memory/root-memory-files.ts`](../../sources/openclaw/src/memory/root-memory-files.ts)：MEMORY.md 根文件规范化（`:6`）
- [`sources/openclaw/src/memory/memory-artifact-provenance.ts`](../../sources/openclaw/src/memory/memory-artifact-provenance.ts)：记忆出处元数据
- [`sources/openclaw/src/transcripts/store.ts`](../../sources/openclaw/src/transcripts/store.ts)：transcript 归档/导出存储
- [`sources/openclaw/src/storage/encryption.ts`](../../sources/openclaw/src/storage/encryption.ts)：OCSTOR1 加密格式
- [`sources/openclaw/src/snapshot/git-backup.ts`](../../sources/openclaw/src/snapshot/git-backup.ts)：会话冷备份进本地 git 仓库
- [`sources/openclaw/docs/concepts/memory-architecture.md`](../../sources/openclaw/docs/concepts/memory-architecture.md)：记忆分层、provenance 与两条召回 lane 的权威文档
- [`sources/openclaw/docs/concepts/session-state.md`](../../sources/openclaw/docs/concepts/session-state.md)：会话状态感知协议
- [`sources/openclaw/node-sqlite.mjs`](../../sources/openclaw/node-sqlite.mjs)：node:sqlite 能力自检探针

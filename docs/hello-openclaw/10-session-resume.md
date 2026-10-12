---
title: "会话恢复：三道中断标记、三次重派预算与前向 only 的 schema 护栏"
---
# 会话恢复：三道中断标记、三次重派预算与前向 only 的 schema 护栏

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。Gateway 常驻本机，重启是常态而非异常：openclaw 把"重启不打断工作"做成了默认开启的自动恢复路径。

**目录**

- [1. 什么落在磁盘上](#1-什么落在磁盘上)
- [2. 中断检测：admission、shutdown、startup 三道标记](#2-中断检测admissionshutdownstartup-三道标记)
- [3. 自动续跑：合成消息与三次预算](#3-自动续跑合成消息与三次预算)
- [4. 优雅重启：drain 预算与服务管理器](#4-优雅重启drain-预算与服务管理器)
- [5. 子代理与 Control UI 输入的恢复](#5-子代理与-control-ui-输入的恢复)
- [6. schema 迁移：前向 only 与升级护栏](#6-schema-迁移前向-only-与升级护栏)

---

## 1. 什么落在磁盘上

与 pi 的"JSONL 会话重放"不同，openclaw 的恢复单位不是会话文件而是 **Gateway 进程内被中断的轮次**。官方清单（`docs/gateway/restart-recovery.md`）：会话历史（per-agent SQLite）原样保留；Control UI 已接受的跟进（per-agent SQLite 的 pending inputs 表 `session_pending_inputs`，`openclaw-agent-pending-inputs-schema.ts:6`）在浏览器重连后按回执去重重提；被中断的主会话轮次在启动几秒后自动续跑；subagent 运行记录在共享 state 库中落盘，启动时结算；出站投递队列、cron 计划、agent 请求的重启 sentinel 全在 SQLite。唯一不可恢复的是 Gateway 终端 PTY——它属于进程内存。

## 2. 中断检测：admission、shutdown、startup 三道标记

哪轮"没跑完"由三个互补机制共同判定：

| 时机 | 动作 |
| --- | --- |
| 轮次 admission 时 | 普通文本轮在模型执行前，于**单个 SQLite 事务**里追加用户消息、标记 session running、记录 recovery delivery claim——Control UI 在返回 `started` 确认之前完成 |
| shutdown drain 时 | 每个仍有活动 run 的会话在 run 被 abort 之前盖上 recovery 标记 |
| startup 时 | 扫描会话库中仍声称 running 但在新进程中无存活 owner 的行——兜住硬崩溃与 kill，同时清理陈旧 transcript 锁文件 |

标记与续跑的实现集中在 `src/agents/main-session-recovery/`：模块入口 `main-session-restart-recovery.ts` 导出 `markRestartAbortedMainSessions` / `markStartupOrphanedMainSessionsForRecovery` 与 `recoverRestartAbortedMainSessions`；恢复状态与 checkpoint 分别在 `main-session-recovery-store.ts`、`main-session-restart-recovery-checkpoint.ts`。

## 3. 自动续跑：合成消息与三次预算

启动几秒后，Gateway 给每个被标记的会话重派一条**合成系统消息**，告诉 agent 上一轮被重启打断、从既有 transcript 继续；若最终回复已生成但未投递，则附上文本让 agent 只做投递而不重做工作。续跑前的关键防护是对 transcript 尾部**分类**：悬空的 tool call 从下一个 provider payload 中丢弃，副作用不明的状态用 restart-safe 工具续跑（Full Access 会话保留原工具面，由模型自行核对结果），只读 Code Mode 的中断轮次可整体重构并被强制限定在审计过的只读工具集内——恢复从不自动重放被中断的外部调用，也不把缺失结果当作成功。

每个被中断周期有**持久的三次重派预算**（跨重启保留）：派发前扣费，Gateway 在受理前明确拒绝时退费，派发后结果不明则保留扣费以防重放；真正的 backend 轮次一旦开跑预算即刷新。预算耗尽后会话被 tombstone 而非无限循环，此后从通道发消息只会收到简短的恢复提醒。所有重试复用同一个持久派发标识，连接失败不会造成同一恢复跑两遍。恢复日志走 `main-session-restart-recovery` subsystem（`src/gateway/session-lifecycle-state.ts:32`），指标经 Prometheus 导出。主机睡眠/进程冻结则在约 30 秒内被检测（`src/gateway/host-thaw-recovery.ts`），空闲后重建通道连接。

## 4. 优雅重启：drain 预算与服务管理器

主动重启不立即杀工作：Gateway 先停止受理新工作，等活动轮次与后台任务收尾，预算分配固化在 `gateway-shutdown-budget.mjs`：drain 上限 315 秒（`:3`）+ 末段写入/清理保留 10 秒 + supervisor 退出余量 5 秒。更精细的是它会**读服务管理器的实际停止时限**并动态收缩预算：systemd 下读当前 unit 的有效 `TimeoutStopUSec`（要求 `KillMode=mixed`，否则停止信号会直接打断 drain 中的子进程）；macOS launchd 下用 `launchctl print` 读**已加载** job 的 `ExitTimeOut`（默认安装的 20 秒 job 名义上是 5 秒 drain / 10 秒清理 / 5 秒余量）。三平台的服务生命周期由 `src/daemon/` 承载：`launchd.ts`（plist/label/bootout-bootstrap）、`schtasks-install.ts`（Windows 计划任务）、`restart-storm.ts` 等防重启风暴。crash-loop breaker 是另一道安全阀：5 分钟内 3 次不干净启动就抑制通道自动启动（控制面照常起），避免崩溃的 Gateway 自我放大。

## 5. 子代理与 Control UI 输入的恢复

- **子代理**：registry 持久化在共享 state 库，启动时把"仍标 running 但无存活 run"的旧子会话行在一个事务里改记 `interrupted`；被中断的子运行**不会被自动重启**，父代理收到中断清单（截断到前 32 个）并自行决定：用 `sessions_send` 在保留会话里跟进、验收已完成部分、或自己收尾。协调器逻辑在 `src/agents/subagents/registry/subagent-registry-restart-recovery.ts`，恢复提示词在 `src/agents/subagents/subagent-restart-recovery-prompt.ts`。
- **Control UI 输入**：浏览器端把已接受的文本/附件留在 outbox 直到 Gateway 确认 transcript 消费；重连后先查回执再经正常认证与会话 admission 重提，绝不复用旧队列与旧执行权限。降级到旧版会拒绝同 ID 重试以避免重复执行（多代理委派场景见 [12-multi-agent.md](./12-multi-agent.md)）。
- **agent 请求的重启**：agent 自己触发重启（改配置/升级）时先写 **restart sentinel** 进 SQLite，启动后按原通道原线程回报结果并派发一次 continuation 轮次；升级 sentinel 还带 `stats.runId` 把 detached updater 关联到持久的 `update_runs` 记录。sentinel 的 typed SQLite 列是权威，`payload_json` 仅作 replay/调试影子（`src/gateway/server-startup-restart-sentinel.ts` 在 ready 之后调度 sentinel wake）。

## 6. schema 迁移：前向 only 与升级护栏

恢复的前提是数据库可读，所以 schema 契约（`docs/reference/database-schemas/versioning.md`）本身就是恢复机制的一部分：每个库把版本写在 `PRAGMA user_version` 与 `schema_meta` 行；打开旧库走前向迁移，遇到**更新**的 `user_version` 直接拒绝并报 `newer schema version`。启动时 Gateway 校验所有注册库，Linux 下遇到新 schema 以退出码 78 退出（避免 systemd 反复重启），macOS 则 park 掉 LaunchAgent 阻止 `KeepAlive` 重试。变更可以在不加版本号的前提下共存，条件是降级读者依然安全——例如新增表，或在既有表上加一列**裸的可空 STRICT 类型**（无默认值/NOT NULL/约束）。升级器同样拒绝声明 schema 支持早于磁盘库的目标；自动回滚只在配置内容与 `user_version` 都未变时才允许，"状态已迁移"是硬边界——这正是 [04-state-session-memory.md](./04-state-session-memory.md) §1 双库版本化的用途。

## 源码锚点

- [`sources/openclaw/src/agents/main-session-recovery/main-session-restart-recovery.ts`](../../sources/openclaw/src/agents/main-session-recovery/main-session-restart-recovery.ts)：主会话重启恢复模块入口
- [`sources/openclaw/src/agents/main-session-recovery/main-session-recovery-store.ts`](../../sources/openclaw/src/agents/main-session-recovery/main-session-recovery-store.ts)：恢复标记与状态的持久存储
- [`sources/openclaw/src/agents/agent-command-restart-recovery.ts`](../../sources/openclaw/src/agents/agent-command-restart-recovery.ts)：恢复轮次的宿主投递约束还原
- [`sources/openclaw/src/gateway/server-startup-restart-sentinel.ts`](../../sources/openclaw/src/gateway/server-startup-restart-sentinel.ts)：ready 后的 restart sentinel 调度
- [`sources/openclaw/src/state/openclaw-agent-pending-inputs-schema.ts`](../../sources/openclaw/src/state/openclaw-agent-pending-inputs-schema.ts)：Control UI pending inputs 表（`:6`）
- [`sources/openclaw/src/agents/subagents/registry/subagent-registry-restart-recovery.ts`](../../sources/openclaw/src/agents/subagents/registry/subagent-registry-restart-recovery.ts)：子代理注册表的启动结算
- [`sources/openclaw/gateway-shutdown-budget.mjs`](../../sources/openclaw/gateway-shutdown-budget.mjs)：drain/保留/余量的共享停止预算（`:3` 起）
- [`sources/openclaw/src/daemon/launchd.ts`](../../sources/openclaw/src/daemon/launchd.ts)：macOS launchd 服务生命周期
- [`sources/openclaw/src/daemon/schtasks-install.ts`](../../sources/openclaw/src/daemon/schtasks-install.ts)：Windows 计划任务安装
- [`sources/openclaw/src/gateway/host-thaw-recovery.ts`](../../sources/openclaw/src/gateway/host-thaw-recovery.ts)：主机睡眠/冻结后的通道重建
- [`sources/openclaw/docs/gateway/restart-recovery.md`](../../sources/openclaw/docs/gateway/restart-recovery.md)：重启恢复的权威行为文档
- [`sources/openclaw/docs/reference/database-schemas/versioning.md`](../../sources/openclaw/docs/reference/database-schemas/versioning.md)：schema 版本化契约与降级规则

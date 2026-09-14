---
title: "调试指南：debug 命令、日志开关与录制仿真"
---
# 调试指南：debug 命令、日志开关与录制仿真

> 基于 `sources/opencode/packages/cli/src/commands/handlers/debug/`、`packages/cli/src/` 与 `packages/http-recorder/`、`packages/simulation/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 调试面总览](#1-调试面总览)
- [2. debug 子命令](#2-debug-子命令)
- [3. 日志与画像](#3-日志与画像)
- [4. 录制与仿真](#4-录制与仿真)
- [5. 常见问题定位路径](#5-常见问题定位路径)

---

## 1. 调试面总览

v2 的调试入口分四层：**debug 子命令**（检视目录与配置解析）、**日志开关**（进程级诊断）、**进程画像**（heap/CPU）、**录制与仿真**（provider 交互可重放）。配合 durable 事件回放（[10-session-resume.md](./10-session-resume.md)），大多数问题可以在不重跑会话的情况下定位。

## 2. debug 子命令

`packages/cli/src/commands/handlers/debug/` 提供三个检视入口：

| 命令 | 用途 |
| --- | --- |
| `opencode debug agents` | 检视 agent 目录的解析结果（哪些 agent 生效、来自哪层配置/插件） |
| `opencode debug config` | 检视生效配置（发现 -> 归一化 -> 变换后的终态） |
| `opencode debug paths` | 检视路径解析（全局目录、工作区、存储位置） |

这三者对应配置管线的三类常见疑问："agent 从哪来"、"配置生效了什么"、"文件落在哪"。

## 3. 日志与画像

- `--print-logs`：把日志打到 stderr；server 日志需要 `--standalone`（私有 server）才能直接观测，默认后台 service 的日志在 service 进程侧。
- `heap.ts` / `cpu-profile.ts`：堆快照与 CPU profile 采集。
- 事件日志器把 `agent.updated` / `catalog.updated` / `command.updated` / `config.updated` 桥接进日志，配合 `--print-logs` 观察配置与目录变更（见 [09-observability.md](./09-observability.md) §3）。

## 4. 录制与仿真

- `packages/http-recorder`：录制 HTTP 交互（典型用途：固定 provider 的线上响应）。
- `packages/simulation` 与 `protocol/src/simulation.ts`：以录制/构造的响应驱动协议级仿真，让重试、incomplete stream、溢出 compaction 等韧性路径可以在测试里确定性触发。

## 5. 常见问题定位路径

| 症状 | 首选路径 |
| --- | --- |
| 会话行为异常 | `sessions.log(follow: true)` 回放 durable 事件；检查 inbox 准入与投递边界 |
| 工具不生效 | `debug agents` + `debug config` 确认目录解析；检查 Scope 注册覆盖（[05-tool-system.md](./05-tool-system.md) §3） |
| provider 被拒 | 区分配置（`providers`）与授权（`experimental.policies`），见 [07-error-security.md](./07-error-security.md) §3 |
| TUI 不更新 | 检查事件馈送连接是否溢出（4 096 帧上限），见 [08-performance.md](./08-performance.md) §2 |
| 崩溃后状态异常 | 看执行 claim 与孤儿 reconciliate 记录，见 [10-session-resume.md](./10-session-resume.md) |

## 源码锚点

- [`sources/opencode/packages/cli/src/commands/handlers/debug/`](../../sources/opencode/packages/cli/src/commands/handlers/debug)：debug 子命令 handler
- [`sources/opencode/packages/cli/src/heap.ts`](../../sources/opencode/packages/cli/src/heap.ts)、[`cpu-profile.ts`](../../sources/opencode/packages/cli/src/cpu-profile.ts)：进程画像
- [`sources/opencode/packages/http-recorder/`](../../sources/opencode/packages/http-recorder)、[`packages/simulation/`](../../sources/opencode/packages/simulation)：录制与仿真

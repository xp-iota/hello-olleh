---
title: "启动链路：CLI 入口、命令树分发与宿主启动"
---
# 启动链路：CLI 入口、命令树分发与宿主启动

> 基于 `sources/opencode/packages/cli/` 与 `sources/opencode/packages/tui/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 入口总览](#1-入口总览)
- [2. CLI 入口：`packages/cli/src/index.ts`](#2-cli-入口packagesclisrcindexts)
- [3. 命令树与全局 Flag](#3-命令树与全局-flag)
- [4. 后台 service 连接策略](#4-后台-service-连接策略)
- [5. TUI 宿主启动](#5-tui-宿主启动)
- [6. 启动链路全景](#6-启动链路全景)

---

## 1. 入口总览

OpenCode v2 的用户侧入口集中在 `packages/cli`，默认命令启动 TUI 并连接后台 service；`run`（非交互）、`mini`、`acp`、`api` 等子命令复用同一命令树。CLI 本身不承载运行时：runtime 在 Core/Server 里，CLI 只是宿主进程。

## 2. CLI 入口：`packages/cli/src/index.ts`

入口是 Bun 脚本（`#!/usr/bin/env bun`），启动顺序：

1. **ssh-askpass 子进程分支**：若 `OPENCODE_SSH_ASKPASS_PORT` 存在，直接运行 askpass 并退出——这是给 SSH 凭据弹窗用的辅助进程，与主流程完全隔离。
2. **构建懒加载命令表**：`Runtime.handlers(Commands, {...})` 把每个命令映射到动态 `import()`，handler 模块只在命令命中时才加载（`$` 默认、`upgrade`、`auth.*`、`debug.*`、`mcp.*`、`plugin.*`、`run`、`mini`、`pair`、`session.*` 等）。
3. **装配基础设施层**：`NodeRuntime` / `NodeServices`（Effect platform-node）、`Observability`、`Updater`、`Heap`、`CpuProfile`、`Config`、`Npm`、`Global`、`AppProcess`、`LayerNode`。
4. 版本常量 `OPENCODE_VERSION` / `OPENCODE_CHANNEL` / `OPENCODE_ARTIFACT` / `OPENCODE_LOCAL` 决定更新通道与构建形态。

## 3. 命令树与全局 Flag

`packages/cli/src/commands/commands.ts` 用 Effect `unstable/cli` 的 `Spec.make` 声明整棵树：

| 命令 | 作用 |
| --- | --- |
| 根命令 `opencode [directory]` | 启动 TUI；`--continue/-c` 续上次会话，`--session/-s` 指定会话，`--prompt` 预填输入 |
| `run` | 非交互执行（`run/noninteractive.ts`），适合脚本 |
| `mini` | 迷你宿主（`mini-host.ts`） |
| `acp` | 以 ACP（Agent Client Protocol）服务运行，接入 IDE |
| `api` / `stats` / `models` / `pair` | API 信息、用量统计、模型清单、配对 |
| `auth list/login/logout/switch` | 凭据管理 |
| `mcp list/add/auth/logout` | MCP server 管理与 OAuth |
| `plugin list/add/check/update/remove` | 插件生命周期 |
| `session list/delete/...` | 会话管理 |
| `debug agents/config/paths` | 调试检视（见 [25-debugging.md](./25-debugging.md)） |
| `upgrade`（别名 `update`）/ `uninstall` | 自更新与卸载 |

全局 flag：

| Flag | 语义 |
| --- | --- |
| `--print-logs` | 日志打到 stderr（server 日志需配合 `--standalone`） |
| `--standalone` | 不连后台 service，改用私有 server |
| `--server <url>` | 连接指定 server URL 而非后台 service |
| `--auto` | 自动批准未显式拒绝的权限 |
| `--yolo`（隐藏）、`--dangerously-skip-permissions` | 跳过权限确认的高危开关 |

## 4. 后台 service 连接策略

默认路径下 CLI 不内嵌 server，而是连接一个**后台常驻 service**：

- `packages/client/src/service-contender.ts`、`service.ts`、`service-timing.ts`、`service-version.ts` 负责发现/竞争/接管后台 service 进程；
- `packages/cli/src/server-process.ts` 负责拉起私有 server 进程（`--standalone` 或未命中后台 service 时）；
- 该策略让多个 CLI/TUI/Desktop 宿主共享同一 runtime，会话执行的所有权仍在 server 进程内（见 [03-agent-loop.md](./03-agent-loop.md) 的进程内所有权）。

## 5. TUI 宿主启动

TUI 是独立包 `packages/tui`，基于 `@opentui/solid`（SolidJS 渲染终端 UI）：

- `src/index.tsx` 引导渲染器，`src/app.tsx` 装配 context provider 树（clipboard、log、exit、epilogue、route 等）；
- TUI 通过 `@opencode/client`（`OpenCode` / `Service`）连接 server，自身不执行 agent 逻辑；
- `packages/cli/src/run/` 下并存 `run.ts`（非交互）与 `ui.ts`（交互 UI 启动），`v1.ts` 保留旧路径兼容。

REPL 交互细节见 [20-repl-and-state.md](./20-repl-and-state.md)。

## 6. 启动链路全景

```text
opencode [directory]
  -> cli/index.ts（ssh-askpass 分支 | 懒加载命令表 | Effect 基础设施层）
    -> commands.ts 命令树解析（全局 flag：--standalone / --server / --auto ...）
      -> handlers/default：连接后台 service（client/service-contender）
         或 server-process.ts 拉起私有 server
        -> tui/index.tsx + app.tsx（@opentui/solid 渲染，经 @opencode/client 订阅事件）
          -> server 端 Core 装配（Location 服务、catalog、插件、Session facade）
```

## 源码锚点

- [`sources/opencode/packages/cli/src/index.ts`](../../sources/opencode/packages/cli/src/index.ts)：入口与懒加载命令表
- [`sources/opencode/packages/cli/src/commands/commands.ts`](../../sources/opencode/packages/cli/src/commands/commands.ts)：命令树与全局 flag
- [`sources/opencode/packages/cli/src/server-process.ts`](../../sources/opencode/packages/cli/src/server-process.ts)：私有 server 拉起
- [`sources/opencode/packages/client/src/service-contender.ts`](../../sources/opencode/packages/client/src/service-contender.ts)：后台 service 竞争
- [`sources/opencode/packages/tui/src/app.tsx`](../../sources/opencode/packages/tui/src/app.tsx)：TUI 装配根

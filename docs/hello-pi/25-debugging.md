---
title: "调试指南：/debug、crash 记录与可观测运行面"
---
# 调试指南：/debug、crash 记录与可观测运行面

> 基于 `sources/pi/packages/coding-agent/src/core/crash-log.ts`、`bug-report.ts`、`config.ts` 与根 `pi-test.sh` / `test.sh` 校对（pi `v1.1.0`）。

**目录**

- [1. 调试面总览](#1-调试面总览)
- [2. /debug 与调试日志](#2-debug-与调试日志)
- [3. crash 记录与 /bug 报告](#3-crash-记录与-bug-报告)
- [4. RPC/JSON 模式作为可观测运行面](#4-rpcjson-模式作为可观测运行面)
- [5. 扩展开发调试：热重载](#5-扩展开发调试热重载)
- [6. 从源码运行与测试](#6-从源码运行与测试)
- [7. 常见问题定位路径](#7-常见问题定位路径)

---

## 1. 调试面总览

pi 没有常驻日志框架；可观测性拆在几个面上：**按需快照**（`/debug` 写渲染态转储）、**崩溃记录**（`crash-log.ts` → `crashes.json`）、**打包报告**（`/bug` → zip）、**结构化事件流**（`--mode json` / `--mode rpc`，见 [21-bridge-system.md](./21-bridge-system.md) §2）。会话本身是 JSONL 文件（`PI_SESSION_FILE` 环境变量在每条 shell 命令里可见），多数问题可直接开文件检查。

## 2. /debug 与调试日志

交互模式内 `/debug`（`handleDebugCommand()`，`interactive-mode.ts:6941`）把当时全部渲染行（含 visible width 的转储）与 agent 消息 JSONL 写入调试日志；路径由 `getDebugLogPath()`（`config.ts:654`）决定：`~/.pi/agent/pi-debug.log`。这是排查"界面渲染错乱 / 行宽溢出"类问题的一手材料。注意 pi 没有常规滚动日志：稳定态不写日志，只有显式触发才落盘。

## 3. crash 记录与 /bug 报告

- **crash-log.ts**：未捕获异常与 fatal error 写入 agent 目录的 `crashes.json`（`CrashRecord`：timestamp / version / kind / message / stack / sessionFile / cwd），保留最近 5 条、7 天过期；启动时可检查并提示。
- **`/bug`**（`slash-commands.ts:28`，`handleBugCommand()` `:6622`）：调用 `core/bug-report.ts` 的 `reportBug()`，把会话（含 `pi.bug-report` 自定义 entry）与调试信息打包成 `pi-bug-report-<id>.zip`（`:279`），供用户带描述上报给开发者。

## 4. RPC/JSON 模式作为可观测运行面

自动化排障首选非交互模式（`docs/cli-integration.md`）：

- `--mode json` / `pi -p --mode json`：`json-event.ts` 的 `JsonAgentSessionEvent` 事件流（去掉累积 partial、保留 usage 与 tool id），适合录制与回放分析；
- `--mode rpc`：40 余个 JSONL 命令（`get_state`、`get_tree`、`get_messages`、`get_session_stats`…）构成机器可观测面，宿主可实时探询状态。

## 5. 扩展开发调试：热重载

扩展经 jiti 加载（[19-hooks-lifecycle.md](./19-hooks-lifecycle.md) §4）。改完扩展代码后交互内跑 `/reload`（`slash-commands.ts:42`）：它调用 `clearExtensionCache()`（`loader.ts:138`）清掉按 cwd 缓存的扩展模块再重新加载，同时重载 keybindings / skills / prompts / themes / 上下文文件——不需要重启进程。扩展内的 handler 异常由 `ExtensionRunner` 捕获并作为事件反馈，不会带崩整个会话。

## 6. 从源码运行与测试

- **`pi-test.sh`**（另有 `.bat` / `.ps1`）：从源码 checkout 运行 pi——`node --import <source-resolver.ts 的 file URL>` 启动 `packages/coding-agent/src/experimental/cli.ts`；`--no-env` 会 unset 全部 provider API key 与云凭据（走"无凭据"路径复现问题）。
- **`test.sh`**：在隔离的临时 HOME、`env -i` 清空环境、`PI_NO_LOCAL_LLM=1` 下跑 `npm test`（各包 `vitest --run`），无 API key 时需要真实 LLM 的测试跳过——CI 与本地都能全量跑。
- **`pi-rpc`**：独立 bin 入口 `src/rpc-entry.ts`（`process.title = "pi-rpc"`），强制 `--mode rpc`，专供宿主以子进程方式嵌入并调试 RPC 集成。
- **环境变量**（`docs/environment-variables.md`）：`PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` / `PI_PACKAGE_DIR` 改路径布局（Nix/Guix 场景），`PI_OFFLINE` 关掉全部自动网络（含目录刷新），`PI_SKIP_VERSION_CHECK` 关掉 pi.dev 版本请求；每条 shell 工具命令还会收到 `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL` 等 `PI_*` 变量，脚本可据此自查状态。

## 7. 常见问题定位路径

| 症状 | 首选路径 |
| --- | --- |
| 界面渲染错乱 | `/debug` 转储（`pi-debug.log`）比对 visible width；终端能力检测 |
| 启动即崩 | `~/.pi/agent/crashes.json` 查 `CrashRecord`；`/bug` 打包复现 |
| 扩展不生效 | `/reload`（`clearExtensionCache`）；`~/.pi/agent/extensions/` 与 `.pi/extensions/` 发现顺序、project trust |
| 工具"不存在" | 工具 exposure（`"codemode"` 的 MCP 工具模型直调不到，见 [24-mcp-system.md](./24-mcp-system.md) §5）；allow/deny 列表 `+name`/`-name` |
| 会话/分支异常 | 直接读 `PI_SESSION_FILE` JSONL；`get_tree` RPC 命令查分支结构 |
| 自动化集成问题 | `--mode json` 录事件流；`pi-rpc` 子进程 + `get_state` 探询 |
| 改了配置没反应 | 多数配置文件 `/reload` 即可；keybindings.json / themes 有专门热重载 |

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/crash-log.ts`](../../sources/pi/packages/coding-agent/src/core/crash-log.ts)：crash 记录（crashes.json）
- [`sources/pi/packages/coding-agent/src/core/bug-report.ts`](../../sources/pi/packages/coding-agent/src/core/bug-report.ts)：/bug 打包
- [`sources/pi/packages/coding-agent/src/config.ts`](../../sources/pi/packages/coding-agent/src/config.ts)：`getDebugLogPath()` 与 agent 目录布局
- [`sources/pi/packages/coding-agent/src/core/extensions/loader.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/loader.ts)：`clearExtensionCache()` 热重载
- [`sources/pi/pi-test.sh`](../../sources/pi/pi-test.sh)：源码运行包装（`--no-env` 清凭据）
- [`sources/pi/packages/coding-agent/docs/environment-variables.md`](../../sources/pi/packages/coding-agent/docs/environment-variables.md)：全部 `PI_*` 环境变量

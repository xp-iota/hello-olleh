---
title: "启动链路：从 openclaw.mjs 到常驻 Gateway"
---
# 启动链路：从 openclaw.mjs 到常驻 Gateway

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。注意一个容易搞错的细节：`package.json` 的 `bin` 不指向 TypeScript 源码，而是 752 行的纯 JS 守门人 `openclaw.mjs`——runtime 版本门、Node 宿主接管、compile-cache respawn 全发生在这里。

**目录**

- [1. 四跳入口链](#1-四跳入口链)
- [2. respawn 计划与托管 Node 宿主](#2-respawn-计划与托管-node-宿主)
- [3. Gateway 启动序列](#3-gateway-启动序列)
- [4. 守护进程化与平台服务](#4-守护进程化与平台服务)
- [5. `~/.openclaw/` 目录布局](#5-openclaw-目录布局)

---

## 1. 四跳入口链

`package.json` 的 `bin: { openclaw: "openclaw.mjs" }`。一次 CLI 调用要穿四层，每层都在为下一层"修好运行环境"：

1. **`openclaw.mjs`（launcher）**：先用 `node-sqlite.mjs` 的自包含探针验证 `node:sqlite` 可用，再做版本门——`SUPPORTED_NODE_RANGE = ">=24.16.0 <25, or >=26.1.0"`（`openclaw.mjs:35`）；不合格时 `ensureSupportedRuntimeVersion` 可现场经 `recoverNodeRuntime` 装一个受管 Node 再 respawn 自己（`openclaw.mjs:655`）。
2. **launcher 短路路径**：`browser extension native-host` 是固定工件短路（`openclaw.mjs:630-635`，fail-closed）；`--version`/裸 `--help`/预计算命令 help 走零加载快路径；`compile-cache` 目录不对时 respawn（`:117/:140`）；最后才 `tryImport("./dist/entry.js")`（`:743`）。
3. **`src/entry.ts`**：先过 `isMainModule` 守卫——bundler 可能把 entry 当共享依赖 import，没有这个守卫会起出第二个 Gateway 撞锁崩进程（`src/entry.ts:118-129` 的注释）。之后 `normalizeEnv`、`assertSupportedRuntime`、`runNodeHostLauncher` 接管（`:155-160`）、compile-cache 启用（`:176-179`）、`ensureCliRespawnReady`（`:190-209`）。
4. **`runMainOrRootHelp`（`src/entry.ts:363`）**：native-hook relay 与两类 help fast path 之后，`import("./cli/run-main.js")` 把 argv 交给 Commander（`runCli` 定义在 `src/cli/run-main.ts:775`）。

## 2. respawn 计划与托管 Node 宿主

`src/entry.respawn.ts` 的 `buildCliRespawnPlan`（`:76`）决定是否把 CLI 原地重生一遍：注入启动 TLS 需要的 `NODE_EXTRA_CA_CERTS`（`:126-141`）、补 `--disable-warning=ExperimentalWarning`（`:144-151`）、Windows 补 `--stack-size=8192`（`:22`，Windows 栈默认装不下调用深度）。父进程经 `runRespawnChildWithSignalBridge`（`src/process/respawn-child-runner.ts`）桥接信号后不再继续跑 CLI。托管 Node 宿主则是另一层：`node-host-launcher.mjs` 只对 `node run` / `connect` 两种调用接管（`:78-80`），管理的 runtime 带 12 小时重启间隔与 5 分钟就绪超时（`:25-26`）。

## 3. Gateway 启动序列

`gateway run` 子命令在 `src/cli/run-main.ts:168-178` 注册，进入 `runGatewayCommand`（`src/cli/gateway-cli/run.ts:1032`）后核心是 `runGatewayLoop`（`src/cli/gateway-cli/run-loop.ts:65`）：

1. `process.title` 改为 `openclaw-gateway`——macOS/BSD 的进程检查读 title，给锁读者一个可核验身份（`run-loop.ts:81-83`）。
2. 预载 `lifecycle.runtime` 图谱再装信号处理器，防止原地更新轮换 dist chunk 后 late import 失败（`:88`）。
3. `acquireGatewayLock`（`:98`，foreground/supervised 两种 listener 模式），并用一个 `MessageChannel` port 把事件循环钉住——Node 的信号监听不保留 event loop（`:108-109`）。
4. `startGatewayServer`（`src/gateway/server.ts:23`，默认端口 18789）懒加载完整服务端；Linux 上额外起一个 spawn broker 进程域来隔离 stdio socket 转移（`server.ts:124-137`）。
5. 启动失败不是直接退出：`createGatewayRestartRecovery`（`src/cli/gateway-cli/run-loop-startup.ts:27`）先跑一次自动 triage，成功则重试启动一次，失败则**保活进程等手动修复**（提示 `openclaw doctor --fix`），因为外部 supervisor（launchd/systemd）的崩溃重启比保活更危险（crash-loop breaker，见 [16-resilience.md](./16-resilience.md)）。
6. 起来之后 `src/gateway/boot.ts` 的 `runBootOnce` 在一次性临时会话里跑工作区 `BOOT.md` 自检，结束即删会话。

## 4. 守护进程化与平台服务

常驻靠平台服务管理器三选一：`src/daemon/service.ts:87` 的 `startGatewayService` 统一封装 launchd（macOS，`src/daemon/launchd.ts`）、systemd（Linux）、schtasks/服务（Windows），先读状态、算 repair issues、start 后复查退出码。外部 CLI 反复 `gateway restart` 会触发 restart-storm 告警（10 分钟窗口 3 次即警，`src/daemon/restart-storm.ts:7-8`）。运行中的 Gateway 收到 `SIGUSR2` 走**进程内重启**：`prepareGatewayRestartIteration`（`run-loop-startup.ts:154`）轮换 agent event 生命周期代、abort 并排空 cron、重置 command-queue lanes——上一代中断的任务不能永久堵住新代的排空。

## 5. `~/.openclaw/` 目录布局

状态根默认 `~/.openclaw`（`OPENCLAW_STATE_DIR` 可覆盖），布局来自 `docs/openclaw-agent-runtime.md`：

| 路径 | 内容 |
| --- | --- |
| `openclaw.json` | 配置 |
| `state/openclaw.sqlite` | 共享运行时状态库（cron、delivery queue、信号日志） |
| `agents/<agentId>/agent/openclaw-agent.sqlite` | per-agent 会话、transcript、auth profile |
| `agents/<agentId>/sessions/`、`workspace/` | 会话历史与默认工作区（多 agent 用 `workspace-<agentId>`） |
| `credentials/` | provider/通道凭据（auth profile store 之外） |

## 源码锚点

- [`sources/openclaw/openclaw.mjs`](../../sources/openclaw/openclaw.mjs)：launcher：runtime 版本门、短路路径、dist/entry.js 导入
- [`sources/openclaw/src/entry.ts`](../../sources/openclaw/src/entry.ts)：isMainModule 守卫、respawn 编排、`runMainOrRootHelp`
- [`sources/openclaw/src/entry.respawn.ts`](../../sources/openclaw/src/entry.respawn.ts)：`buildCliRespawnPlan` 与 CLI 重生计划
- [`sources/openclaw/node-host-launcher.mjs`](../../sources/openclaw/node-host-launcher.mjs)：托管 Node 宿主接管（node run / connect）
- [`sources/openclaw/src/cli/gateway-cli/run-loop.ts`](../../sources/openclaw/src/cli/gateway-cli/run-loop.ts)：`runGatewayLoop`：锁、信号、drain、更新接力
- [`sources/openclaw/src/gateway/server.ts`](../../sources/openclaw/src/gateway/server.ts)：`startGatewayServer` 懒加载与 Linux spawn broker
- [`sources/openclaw/src/daemon/service.ts`](../../sources/openclaw/src/daemon/service.ts)：launchd/systemd/schtasks 三平台服务适配
- [`sources/openclaw/docs/openclaw-agent-runtime.md`](../../sources/openclaw/docs/openclaw-agent-runtime.md)：`~/.openclaw/` 布局与开发工作流

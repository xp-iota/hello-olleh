---
title: "错误与安全：无权限系统、trust 门控与供应链加固"
---
# 错误与安全：无权限系统、trust 门控与供应链加固

> 基于 `sources/pi/` 快照（pi v1.1.0），对照 `docs/security.md`、`docs/containerization.md` 与 agent-loop 错误路径校对。

**目录**

- [1. 安全模型：模型输出不可信](#1-安全模型模型输出不可信)
- [2. project trust](#2-project-trust)
- [3. 扩展错误处理](#3-扩展错误处理)
- [4. 错误路径](#4-错误路径)
- [5. 供应链加固](#5-供应链加固)

---

## 1. 安全模型：模型输出不可信

pi **没有内建权限系统**。`docs/security.md` 开宗明义：把模型生成的命令与代码当作不可信输入；pi 以启动它的操作系统用户的全部权限读写和执行文件，且**不在每次工具调用前请求批准**；扩展、包安装器、语言服务器等子进程继承同样的权限。文档同时明确："Watching the transcript, using project trust, and reviewing changes do not create a security boundary"——观察与信任都不构成安全边界，真正的边界是操作系统/虚拟化隔离。

`docs/containerization.md` 给出三种推荐运行方式：

| 方式 | pi 跑在哪 | 隔离范围 | 适合 |
| --- | --- | --- | --- |
| Plain Docker | 容器内 | pi 全进程、内建工具、`!` 命令、扩展 | 最简单的本地容器边界 |
| OpenShell | 本地/远程沙箱 | 文件系统、进程、网络、凭证策略 | 策略化隔离 |
| Gondolin 扩展 | 宿主机 | 仅内建工具与 `!` 命令进 micro-VM，宿主界面保留 | 工具级隔离（宿主扩展不在此边界内） |

## 2. project trust

trust 是 pi 唯一的启动期门控，实现在 `src/core/trust-manager.ts`（trust store 存于 agent dir）与 `src/cli/project-trust.ts`（首启询问）。发现下列项目资源时，pi 要求一次明确的信任决定：`.pi/settings.json`、`.pi/mcp.json`、`.pi/extensions`、`.pi/skills`、`.pi/prompts`、`.pi/themes`、`.pi/SYSTEM.md` / `.pi/APPEND_SYSTEM.md`、以及项目及祖先目录的 `.agents/skills`。拒绝信任即跳过这些资源（`.pi/extensions` 因此是 trust-gated，见 [06-extension-mcp.md](./06-extension-mcp.md)）。

文档同时说明两个诚实的缺口：其一，项目 `sessionDir` 设置在 trust 判定**之前**就被读取；其二，`AGENTS.md` / `AGENTS.override.md` / `CLAUDE.md` 等上下文文件**无论是否信任都会加载**——所以"目录里的指令永远要当不可信输入对待"。

## 3. 扩展错误处理

`ExtensionRunner`（`src/core/extensions/runner.ts`）是所有扩展事件的单一分发点，错误隔离在这里完成：

- 事件 handler 抛出的错误被捕获后经 `emitError()` 汇报给 `ExtensionErrorListener`，**不会中断 agent 循环或污染 provider 响应**；`docs/extensions.md` 对 provider 流事件（`before_provider_request` / `provider_stream_event` 等）同样保证 "Handler errors are reported without changing the provider response"；
- runner 还维护命令/快捷键/flag 注册表与 `session_start` / `session_shutdown` 生命周期，检测到无人接手的 MCP server 注册时通过 `reportUnhandledMcpServers()` 发出诊断；
- 扩展在工厂函数里被禁止启动进程/socket/watcher——某些加载路径只加载不启会话（`docs/extensions.md`）。

进程级兜底在 `src/core/crash-log.ts`：`recordCrash()` 以 best-effort 把崩溃记录（含 `findExtensionStackMatches()` 的扩展栈匹配）追加到 `~/.pi/agent/crashes.json`，详见 [09-observability.md](./09-observability.md)。

## 4. 错误路径

内核循环（`packages/agent/src/agent-loop.ts`）把错误当作 stop reason 处理而非异常：

- **短路**：`stopReason` 为 `error` 或 `aborted` 时，本回合立即以 `turn_end` + `agent_end` 结束，不再执行任何工具调用（`agent-loop.ts` 的 `runLoop` 内）；
- **截断防护**：`stopReason === "length"`（输出被截断）时，模型已产出的工具调用**全部判失败**——`failToolCallsFromTruncatedMessage()` 给每个调用回一条带重发提示的错误结果，而不是去执行可能残缺的 JSON 参数；
- **overflow 识别**：`packages/ai/src/utils/overflow.ts` 的 `isContextOverflow()` 用 **25 条** provider 专属正则（`OVERFLOW_PATTERNS`）识别各家"prompt too long"的报错文案，另加两类静默 overflow 检测（z.ai 用量超窗、Xiaomi MiMo 的零输出截断），并有 `NON_OVERFLOW_PATTERNS` 排除误报——识别为 overflow 后才触发压缩/重试路径（见 [08-performance.md](./08-performance.md) 与 compaction 相关章节）。

## 5. 供应链加固

pi 是编码 CLI 里少见的把依赖安全写进 CI 的项目（根 `package.json` 的 `check` 门禁）：

- **精确 pin**：所有外部直接依赖精确到补丁版本（`.npmrc` 设 `save-exact=true`；workspace 内部 `@earendil-works/*` 依赖保持 caret），`scripts/check-pinned-deps.mjs` 强制校验；`.npmrc` 同时设 `min-release-age=2`，npm 解析时跳过发布不足 2 天的版本，规避"投毒当天发布"攻击；
- **install-lock**：`packages/coding-agent/install-lock/` 是一个只为固定传递依赖而生的私有包（`@earendil-works/pi-coding-agent-install`），其 `package-lock.json` 由 `scripts/generate-coding-agent-install-lock.mjs` 从根 lockfile 生成，CI 以 `--check` 比对；生成器内置**生命周期脚本 allowlist**（`allowedInstallScriptPackages`，仅 `@google/genai`、`esbuild`、`protobufjs` 三个精确版本），任何不在名单内却带 install 脚本的依赖直接报错，名单过期条目同样报错；
- **无脚本安装**：文档化安装命令统一 `npm install --ignore-scripts` / `npm ci --ignore-scripts`；pre-commit 钩子拦截误提交的 lockfile（需 `PI_ALLOW_LOCKFILE_CHANGE=1` 显式放行）。

这与 nanobot/Gemini CLI 依赖 `npm` 默认行为形成对照：pi 假设的是"模型本身不可信之外，**npm 生态也不可信任**"。

## 源码锚点

- [`sources/pi/packages/coding-agent/docs/security.md`](../../sources/pi/packages/coding-agent/docs/security.md)：安全模型与 project trust 官方陈述
- [`sources/pi/packages/coding-agent/src/core/trust-manager.ts`](../../sources/pi/packages/coding-agent/src/core/trust-manager.ts)：trust store
- [`sources/pi/packages/agent/src/agent-loop.ts`](../../sources/pi/packages/agent/src/agent-loop.ts)：error/aborted 短路与截断工具调用失败
- [`sources/pi/packages/ai/src/utils/overflow.ts`](../../sources/pi/packages/ai/src/utils/overflow.ts)：overflow 正则库
- [`sources/pi/scripts/generate-coding-agent-install-lock.mjs`](../../sources/pi/scripts/generate-coding-agent-install-lock.mjs)：install-lock 与生命周期脚本 allowlist

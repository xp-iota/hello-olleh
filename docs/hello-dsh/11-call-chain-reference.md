---
title: "关键调用链速查"
---
# 关键调用链速查

> **本篇回答**：全系列的索引——四条核心调用链 + 两条补充链、事件全表、逐包符号表、配置速查、症状 → 分册路由。
> **路径缩写**：`P/` = `packages/`，`AL/` = `P/core/agent-loop/src/`，`AG/` = `P/core/agent/src/`，`S/` = `P/core/session/src/`，`T/` = `P/core/tools/src/`，`SP/` = `P/core/system-prompt/src/`，`SC/` = `P/core/scope/src/`，`AB/` = `P/boot/app-boot/src/`，`L/` = `P/llm/llm/src/`，`V/` = `vendor/cordis/src/`。行号对应快照 `38a6a5c9`（dsh-v0.2.2-rc.3）。
>
> 🧭 **本篇导览**：11.1 四条核心调用链与两条补充链 → 11.2–11.5 事件全表、核心服务与抽象类方法数 → 11.6–11.8 逐包符号表、vendor cordis 行号对照与配置速查 → 11.9–11.10 上游一手文档与症状路由。
>
> 📎 **来源**：本篇对应初版第 25 篇；仅调整篇号与章节号，继续作为全系列速查索引。rc.3 重新核对了全部事件面与核心符号，行号以 `38a6a5c9` 为准。

## 11.1 四条核心调用链

### 链 1：`dsh web` → 插件树就绪

![链 1：dsh web 到插件树就绪](diagrams/11-boot-chain.svg)

**链 1：dsh web 到插件树就绪** — [交互版](diagrams/11-boot-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/11-boot-chain.architecture.json)

> ⚠️ 该图绘制于 0.1.5 基线；rc.3 的 `boot()` 在 `AB/index.ts:1220`（文件 1286 行），profile 模板治理改由 `@deepseek-ai/dsh-official-bundles` 接管。

- **六步就到插件树就绪**：前三步解析命令行与 profile · 中间两步叠加 patch 层 · 最后一步交给 cordis Loader
- **关键源码位置**：parseCmdline 在 `P/boot/cmdline` · loadProfile 与 composeEntries 在 `AB/profile.ts`（composeEntries 在 `:755`）· mountRootInclude 在 `AB/index.ts:758` · boot 在 `:1220`
- **详细展开**：profile 与 bundle 的关系见 05 篇 § 5.2 · 四层叠加顺序见 05 篇 § 5.3 · profile 模板与 bundle 退役见 05 篇 § 5.4 · 启动失败处理见 05 篇 § 5.9

详见 [05 篇](05-startup-and-cordis-runtime.md)。

### 链 2：用户输入 → 模型回答

| 步骤 | 位置 |
|---|---|
| HTTP/WS 入口 | `P/host/webserver`（862 行）→ `P/api` 的控制器族（session/job/settings/terminal/workspace 等，9 包） |
| 找/建 Agent | `ctx.agents`（`AG/index.ts:246`，`class AgentRegistry`） |
| 输入进 Inbox | `Agent.followup/steer/inject`（`AG/runtime-types.ts`）→ `AL/agent.ts` |
| 唤醒驱动 | `wakeDriver()`（`AL/agent.ts:235`） |
| **turn 循环** | `turn()`（`AL/agent.ts:333`），外层 `while (await this.turn()) {}`（`:276`） |
| append `turn/start` | `AL/agent.ts`（事件定义 `S/types.ts:294`） |
| **claim + 拦截** | `preStep()`（`AL/agent.ts:289`）→ `inbox.claim()`（`AL/inbox.ts:108`）→ `agent/pre-step` waterfall（`AG/runtime-types.ts:351`，payload 带 `modelSelection`） |
| **step** | `step()`（`AL/agent.ts:441`） |
| 渲染提示 | `assemble()`（`SP/index.ts:621`）→ `renderPrompt()`（`:297`） |
| 投影历史 | `session.deriveMessages()`（`S/index.ts`） |
| 组装请求 | `buildRequest()`（`AL/agent.ts:662`）→ `agent/request` waterfall（`AG/runtime-types.ts:374`） |
| **调模型** | `preparedCall?.stream() ?? ctx.llm.stream()` → `LlmRuntime`（`L/index.ts:369`）→ `llm/stream` waterfall（`:76`） |
| 流式记账 | 内存聚合（`L/assistant-stream.ts`）→ `assistant/attempt` 一条持久事件（`AL/agent.ts:528-535`，事件定义 `S/types.ts:363`） |
| 错误可重试 | `agent/request-error` waterfall（`AG/runtime-types.ts:390`） |
| append `assistant/message` | `S/types.ts:349`（携带 `sourceEventSeqs`） |
| **执行工具** | `T/batch.ts` 的 `executeToolBatch()`（`:50`）→ `runGroup()`（`:117`） |
| append `step/end` | `S/types.ts:307` |
| turn 收尾 | `agent/turn-stopping` serial（`AG/runtime-types.ts:418`）→ append `turn/end`（`S/types.ts:303`） |

详见 [06 篇](06-agent-loop-and-session-log.md)。

### 链 3：一次工具调用

![链 3：一次工具调用](diagrams/11-tool-call-chain.svg)

**链 3：一次工具调用** — [交互版](diagrams/11-tool-call-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/11-tool-call-chain.architecture.json)

> ⚠️ 该图绘制于 0.1.5 基线（`AL/tool-calls.ts`）；rc.3 的调度在 `T/batch.ts`，执行器在 `T/executor.ts` 选择 native / PTC。

- **参数解析是容错的**：`parseArguments()`（`T/batch.ts:99`）在 JSON 解析失败时保留原文 · 于是模型的轻微格式错误不会直接崩
- **身份从上下文取**：工具签名里没有 agent 参数 · `requireInitiator()` 从执行上下文取 · 缺失即报错，见 08 篇 § 8.28
- **三段 waterfall 是扩展点**：审批挂在 `tools/pre-execute`（`T/events.ts:18`）· 超时与重试挂在 `tools/execute`（`:29`）· 结果改写挂在 `tools/post-execute`（`:41`）
- **两种执行器**：`ToolsService.execute()`（`T/index.ts:375`）按 agent 选 native 或 PTC 执行器；两者共用同一套 waterfall

详见 [07 篇](07-request-pipeline-llm-tools-and-prompts.md)。

### 链 4：压缩上下文

| 步骤 | 位置 |
|---|---|
| 触发 | `compactIfNeeded`（`P/compaction/compaction/src/index.ts:136`）/ `compactNow`（`:162`）/ `compactRegion`（`:187`） |
| 生成摘要 | provider（`compaction-basic` 1745 行）通常调 LLM；`compaction-image-offload` 负责图片外置 |
| **append 替换事件** | `session.append('assistant/message', 摘要, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: [...] })` |
| 校验 | `surfaceManager.validateNext(event)`—— `sourceEventSeqs` 必须覆盖全部被遮蔽节点 |
| 投影失效 | `replaceGeneration` 变 → `deriveMessages()` 全量重建 |
| 通知 | rc.3 不再发 `agent/session-start`；`agent/created` 的 payload 带 `source: 'compact'`（`AG/runtime-types.ts:291`、`SessionStartSource` 在 `:152`） |

💡 **日志一行未删** —— 这是 append-only + 表面机制的核心红利（[06 § 6.15](06-agent-loop-and-session-log.md)、[08 § 8.34](08-execution-services.md)）。

### 补充链 5：会话格式迁移（v0 → v4）

| 步骤 | 位置 |
|---|---|
| 版本常量 | `SESSION_FORMAT_VERSION = 4`（`S/types.ts:90`） |
| 读取 | 按 `session.vN.jsonl` 的**最高代**选择文件（`snapshots/AGENTS.md` 的同一规则） |
| 相邻迁移 | `packages/session/session-format-v0-to-v1` … `v3-to-v4` 五个迁移包 |
| 目录 | `session-format-catalog` + `docs/session-format-status.md` |
| 一次性组合 | 相邻迁移链按需组合，不移动/覆盖已提交的代 |
| 回放 | `snapshots/` 四类固定数据（acp/sdk/session/web） |

详见 [06 § 6.21](06-agent-loop-and-session-log.md)。

### 补充链 6：热替换（HMR / registry.replace）

| 步骤 | 位置 |
|---|---|
| 事务入口 | `ctx.hmr.reconcile(callback)`（`P/hmr/src/index.ts:286`） |
| 组件发现 | `_discover()`（`:404`）→ 并查集分区 `_partition()`（`:360`） |
| 缓存驱逐 | `sweep()` / `invalidateResolution()`（`P/hmr/src/runtime/`） |
| 原位替换 | `ctx.registry.replace(component, replacement)`（`:734`）→ `fiber._replace()`（cordis `fiber.ts:401`） |
| 级联 | `_revision++` 使依赖者 epoch 变化并重载（Fiber 身份不变） |

详见 [cordis 08 HMR](../hello-cordis/08-hmr.md) 与 [05 § 5.15](05-startup-and-cordis-runtime.md)。

## 11.2 事件全表

### `agent/*`（12 个，`AG/runtime-types.ts:291-430`）

| 事件 | 行号 | 模式 | 用途 |
|---|---|---|---|
| `agent/created` | 291 | emit | payload 带 `source: SessionStartSource`（替代已删除的 `agent/session-start`） |
| `agent/disposed` | 300 | emit | |
| `agent/status` | 310 | emit | idle ↔ running |
| `agent/inbox/inserted` | 318 | emit | |
| `agent/inbox/claimed` | 329 | emit | |
| `agent/inbox/discarded` | 337 | emit | |
| **`agent/pre-step`** | **351** | **waterfall** | 决定模型看到什么（payload 含 `modelSelection`） |
| **`agent/request`** | **374** | **waterfall**（deprecated 钩子） | 改写 `LlmCallConfig` |
| **`agent/request-error`** | **390** | **waterfall** | 返回 `{ kind: 'retry' }` |
| **`agent/assistant-stream`** | **400** | emit | 实时流分片（rc.3 新增） |
| **`agent/turn-stopping`** | **418** | **serial**（无 next） | 可延续 turn |
| `agent/error` | 430 | emit | |

另有持久事件 `agent/inbox/spliced`（`AG/types.ts`）。

### `tools/*`（3 个 waterfall，`T/events.ts`）

| 事件 | 行号 |
|---|---|
| `tools/pre-execute` | 18 |
| `tools/execute` | 29 |
| `tools/post-execute` | 41 |
| PTC 子调用日志 | `tool/code-dispatch`（在 `P/core/tool-executor-ptc`） |

### `fs/*`（4 个，`P/fs/fs/src/index.ts`）

| 事件 | 行号 | 模式 |
|---|---|---|
| `fs/write-intent` | 67 | waterfall |
| `fs/edit-intent` | 75 | waterfall |
| **`fs/delete-intent`** | **83** | waterfall（rc.3 新增） |
| `fs/observed` | 93 | emit |

### 其它

| 事件 | 位置 | 模式 |
|---|---|---|
| `llm/stream` | `L/index.ts:76` | waterfall |
| `system-prompt/assemble` | `SP/index.ts:31` | waterfall（payload 类型 `PromptPresentation`） |
| `system-prompt/change` | `SP/index.ts`（emit 于注册/卸载） | emit |
| `session/event` | `S/index.ts`（`collectSessionCallbacks`） | emit |

## 11.3 SessionEventMap 14 个核心事件

`S/types.ts:294` 起：

| 事件 | 行号 | 上表面 |
|---|---|---|
| `turn/start` | 294 | — |
| `turn/end` | 303 | — |
| `step/start` | 305 | — |
| `step/end` | 307 | — |
| **`user/message`** | **315** | ✅ |
| **`developer/message`** | **317** | ✅（rc.3 新增） |
| **`system/message`** | **338** | ✅（rc.3 新增） |
| **`assistant/message`** | **349** | ✅ |
| **`assistant/attempt`** | **363** | —（流分片记录，替代 `assistant/chunk`） |
| `tool/call` | 369 | — |
| **`tool/result`** | **383** | ✅ |
| `request/header` | 398 | — |
| `request/context` | 410 | — |
| `session/end-seed` | 435 | —（数据改为 `{ inherited?: true }`） |

相关类型：`SessionEventType`、**`SurfaceEventType`**（`447-452`，**5 种**：system/developer/user/assistant message + tool/result）、`SurfaceEvent`（`:455`）、**`SurfaceOp`**（`:478` 起）、`SurfaceIntent`（`:490`）。

💡 0.1.5 的 `assistant/chunk` 与 `todo/write` 已删除；上表面类型从 3 种扩为 **5 种**。

## 11.4 核心服务与 `ctx` 键

| `ctx` 键 | 类 | 位置 |
|---|---|---|
| `ctx.agents` | `AgentRegistry` | `AG/index.ts:246` |
| `ctx.agentLoop` | `AgentLoop`（实现 `AgentFactory`） | `AL/index.ts`（838 行） |
| `ctx.sessions` | `SessionStore` | `S/index.ts:1144` |
| `ctx.tools` | **`ToolsService`** | `T/index.ts:99` |
| `ctx.systemPrompt` | `SystemPrompt` | `SP/index.ts:436` |
| `ctx.llm` | `LlmRuntime` | `L/index.ts:369` |
| `ctx.fs` | `FileSystem`（abstract） | `P/fs/fs/src/index.ts:104` |
| `ctx.shell` | `ShellExecutor`（abstract） | `P/shell/shell/src/index.ts:64` |
| `ctx.subprocess` | `SubprocessRuntime`（abstract） | `P/subprocess/subprocess/src/index.ts:124` |
| `ctx.terminals` | `TerminalSessionService` | `P/terminal/terminal/src/index.ts:86` |
| `ctx.sandbox` | `SandboxProvider`（abstract） | `P/sandbox/sandbox/src/index.ts:207` |
| `ctx.compaction` | `CompactionEngine`（abstract） | `P/compaction/compaction/src/index.ts:119` |
| `ctx.ptcRuntime` | PTC 运行时 seam | `P/ptc-runtime/ptc-runtime/src/index.ts` |

## 11.5 抽象类的必需方法数

| 服务 | 抽象方法数 | 说明 |
|---|---|---|
| `LlmAdapter` | **1**（`stream`，`L/index.ts:317`） | 其余 4 个有默认实现 |
| `SandboxProvider` | **1**（`confine`，`SB/index.ts:225`） | |
| `ShellExecutor` | **2**（`resolve`/`execute`，`SH/index.ts:84`/`:93`） | run/start 已合并 |
| `SubprocessRuntime` | **4**（`resolveExecutable`/`terminalEnvironment`/`spawn`/`spawnTerminal`，`SP/index.ts:140`/`:151`/`:160`/`:169`） | rc.3 新增 `terminalEnvironment` |
| `CompactionEngine` | **3**（`compactIfNeeded`/`compactNow`/`compactRegion`，`CP/index.ts:136`/`:162`/`:187`） | |
| `FileSystem` | **15**（全部 abstract，`F/index.ts:149`-`:368`） | 新增 `readByteRange`、`patchText` |

💡 **必需方法数反映了"接入成本"**：接一个模型只要 1 个方法，接一个文件系统要 15 个；subprocess 从 3 涨到 4、shell 从 3 降到 2——接入成本谱在 rc.3 有明显重排。

## 11.6 逐包符号表（核心）

### `AL/agent.ts`（751 行）

| 符号 | 行号 |
|---|---|
| `type Phase` / `StepEndReason` / `PreparedStep` | 按符号名检索 |
| `requestProposal()` | 按符号名检索 |
| **`class ReactLoopAgent implements Agent`** | 按符号名检索 |
| `lastTurn` 从日志倒查 | 按符号名检索 |
| `get status()` / `setPhase()` | 按符号名检索 |
| `send()` / `followup()` / `steer()` / `inject()` | 按符号名检索 |
| `cancel()` / maintenance / `wakeDriver()` / `throwError()` | `wakeDriver()` = `:235` |
| **`preStep()`** | **289** |
| **`turn()`** | **333**（`while` 在 `:276`） |
| **`step()`** | **441** |
| **`buildRequest()`** | **662** |
| `assistant/attempt` append | **528-535** |

> `AL/inbox.ts` 现在是独立文件（232 行）：`class Inbox`、`claim()`（`:108`）、`splice()` 等。

### `AG/`（agent，`index.ts` 679 行，`runtime-types.ts` 432 行）

| 符号 | 位置 |
|---|---|
| `InboxTarget` / `agent/inbox/spliced` | `types.ts` |
| `AgentStatus` / `PreStepDecision` / `SessionStartSource` | `runtime-types.ts:50` / `:53` / `:152` |
| **`interface Agent`** | `runtime-types.ts:64` |
| `AgentFactory` | `index.ts` |
| **`class AgentRegistry`** | `index.ts:246` |
| `currentInitiator()` / `requireInitiator()` | 按符号名检索 |
| `setFactory()` / `register()` / **`enter()`** | 按符号名检索 |
| `isOwnedBy()` / `roots()` | 按符号名检索 |
| rc.3 新文件 | `archive-admission.ts`、`consumed-work.ts`、`model-selection.ts`（174 行）、`projection.ts` |

### `S/`（session，`index.ts` 1555 行）

| 符号 | 位置 |
|---|---|
| `SESSION_FORMAT_VERSION = 4` | `types.ts:90` |
| `adoptSessionEvent()` / `snapshotSessionEvent()` | `index.ts` |
| **`class Session`** | `index.ts:555` |
| **`append()`** | `index.ts`（含版本头校验 `:106-107`） |
| 重入检查 / `validateNext` | `index.ts` |
| `requestHeader()` / `requestContext()` | `index.ts` |
| **`deriveMessages()`** | `index.ts` |
| `SessionForkError` | `index.ts:1130` |
| **`class SessionStore`** | `index.ts:1144` |
| **`fork()`** | `S/fork.ts`（新文件） |

> `S/` 新文件：`fork.ts`、`seq-ranges.ts`、`tool-history.ts`；`chunk-rows.ts` / `invariant.ts` / `json.ts` 已删除。

### `T/`（tools，src 3784 行）

| 符号 | 行号 |
|---|---|
| 三段 waterfall | `T/events.ts:18` / `:29` / `:41` |
| **`ToolDefinition`** | `T/contracts.ts:27` |
| `ToolExecution` 家族 | `T/contracts.ts` / `T/pipeline.ts` |
| **`ToolRunContext`** / `deferContext()` / `concludeTurn()` | **`T/contracts.ts:245`** / `:252` / `:261` |
| `executionMode()` | `T/pipeline.ts:106` |
| **`class ToolsService`** | **`T/index.ts:99`** |
| `register()` / `schemas()` / `execute()` | `T/index.ts:128` / `:316` / `:375` |
| 批量调度 | `T/batch.ts:50`（`executeToolBatch`）、`:117`（`runGroup`） |

### `SP/`（system-prompt，单文件 699 行）

| 符号 | 行号 |
|---|---|
| `system-prompt/assemble` | 31 |
| `PromptSection`（含 `complete?`、`interpolate?`） | 53 |
| `PromptPresentation` / `PromptAssembly` | 125 / 132 |
| **`TOOL_ORDER_REST`** | **209** |
| `validateToolOrder()` / `orderTools()` | 215 / 233 |
| **`renderPrompt()`** | **297** |
| `renderContextSnapshot()` / `joinContextSections()` / `renderContextSections()` | 309 / 321 / 337 |
| **`class SystemPrompt`** | **436** |
| `section()` / `context()` / `suppressRuntimeContext()` | 按符号名检索 |
| **`assemble()`** | **621** |

### `SC/`（scope）

| 符号 | 位置 |
|---|---|
| `ScopeKey` / **`Scoped<T>`** | `index.ts` |
| `scopeChainOf()` / `createScope()` | `index.ts` |
| **`scopeTarget()`** / `carrierKeyOf()` | `index.ts` |
| `NamedEntries` / `AnonymousEntries` / **`ScopedLayers`** | `store.ts` |
| `chainLayers()` / `effect()` | `store.ts` |

### `AB/`（app-boot，`index.ts` 1286 行，`profile.ts` 762 行）

| 符号 | 位置 |
|---|---|
| `loadLayeredEnv()` / `loadOverlayPatches()` / `renderConfigDump()` | `index.ts` |
| **`mountRootInclude()`** | `index.ts:758` |
| `installFailLoud()` / `assertEntriesLoaded()` / `assertEntriesActivated()` | `index.ts` |
| **`boot()`** | **`index.ts:1220`** |
| `PROFILES_DIR` / `PROFILE_PATCH_FILENAME` | `profile.ts` |
| `initProfile()` / **`loadProfile()`** / **`composeEntries()`** | `profile.ts` / `:755` |
| profile 模板治理 | `P/util/official-bundles/src/bundles.ts`（`PROFILE_TEMPLATES` / `RETIRED_BUNDLES` / `INSTALLATION_OWNED_PROFILE_TUPLES`） |

### `L/`（llm，`index.ts` 1237 行）

| 符号 | 行号 |
|---|---|
| `llm/stream` | 76 |
| `assertUsableApiKey()` | 166 |
| **`abstract class LlmAdapter`** / `abstract stream()` | **223** / 317 |
| `providerInfo()` / `providerRetryPolicy()` / `listModels()` | 229 / 238 / 275 |
| `prepareCall()` | 305 |
| **`class LlmRuntime`** | **369** |
| `registerAdapter()` / `providerRetryPolicy()` | 416 / 683 |

## 11.7 vendor cordis 与上游的行号对照

见 [05 § 5.16](05-startup-and-cordis-runtime.md) 完整表。rc.3 的 vendor 是 **`@deepseek-ai/cordis` 4.1.0**（上游 cordis **4.0.0-rc.11**），`vendor/cordis/src` 2811 行（新增 `logger.ts` 276 行），`fiber.ts` 820 行。要点：

- **加固①②仍在原行号**：`effectInertia`（`V/fiber.ts:112`）、`runDisposable`（`:114`）、`emitPluginDisposed`（`:120`）。
- **加固③被重写**：0.1.5 的 `_config` / `_resolveConfig` 已不存在，改为 **`_configRevision` 代次机制**（`fiber.ts:210` 声明、`:656` reload 递增、`:791-800` update 竞态判定）。
- 上游符号行号（`FiberState`、`class Fiber`、`effect()`、`_refresh()`、`reflect` handler、`provide()`/`notify()`、`registry.plugin()`→`registry.use()`、`events.waterfall()`）全部按 cordis v4.0.0-rc.11 重取；逐项对照见 [hello-cordis 09](../hello-cordis/09-call-chain-reference.md)。

## 11.8 配置速查

| 项 | 值 / 位置 |
|---|---|
| 默认模型 | `deepseek-official` / **`deepseek-flash`**（`P/bundle/base/cordis.patch.yml:90-94`） |
| Web 默认地址 | `http://127.0.0.1:3080`（README） |
| Node 要求 | **`>=24.9.0`** |
| pnpm | **11.28.5** |
| 全部包版本 | **`0.2.2-rc.3`** |
| vendored cordis | **4.1.0**（上游 4.0.0-rc.11） |
| profile 目录 | `<home>/profiles/<name>/` |
| profile patch 文件名 | `cordis.patch.yml` |
| 默认 bundle | `['@deepseek-ai/dsh-base']` |
| profile 模板 | **`acp` / `web` / `headless` / `sdk` / `sdk-minimal`**（`P/util/official-bundles/src/bundles.ts`） |
| base patch 行数 | **99 条 `- id:`**（`P/bundle/base/cordis.patch.yml`） |
| fail-loud 认领窗口 | 2000 ms |
| bootstrap-only 前缀 | `['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']` |
| 全文搜索默认 | `openAt: 'never'`（`P/bundle/web-app/cordis.patch.yml`） |
| ~~`DSH_TOOLS_MODE`~~ | **已删除**；PTC 由执行器选择（`T/executor.ts`） |
| 覆盖率门禁 | 逐文件 100%，带**覆盖率分区模式**（`vitest.config.ts:429-437` + `scripts/coverage-partitions.ts`） |
| 会话格式版本 | **`SESSION_FORMAT_VERSION = 4`**（`S/types.ts:90`），v0→v4 迁移链 |

## 11.9 上游一手文档（优先读）

| 文档 | 内容 |
|---|---|
| **`docs/architecture.md`**（171 行） | **最重要**：cordis 底座、profile/bundle、core 包表、三类事件域、turn 流程、seam、"新行为放哪"扩展映射 |
| **`AGENTS.md`**（189 行；`CLAUDE.md` 为符号链接） | 仓库布局、命令清单、pre-release 立场（"Public APIs are pre-stable…committed generations"）、agent 操作规程 |
| `docs/cordis-primer.md` + `cordis-tutorial/`（24） + `cordis-api/`（16） | cordis 文档（**托管在 DSH 仓库**） |
| `docs/subsystems/`（138 篇 = 69 en + 69 zh） | 逐子系统契约 |
| `docs/cookbook/`（26 md） | 扩展指南 |
| **`docs/upgrade-guide/`** | 逐版本迁移指南（rc.3 新增） |
| `docs/session-format-status.md` | 会话格式各代状态 |
| `docs/event-producer-consumer.md` | 事件生产者/消费者全表 |
| `docs/capability-seams.md` | 能力接缝图谱 |
| `docs/tool-execution-pipeline.md` | 工具管线 |
| `docs/agent-lifecycle.md` | 生命周期时序图 |
| `docs/config-catalog.md` / `tool-catalog.md` / `persistence-catalog.md` | 生成的目录 |
| `docs/module-graph.md` / `graph-atlas.md` | 依赖图 |
| `docs/defensive-patterns/`（目录） | 防御式模式（fail-closed 等；rc.3 由单文件扩为目录） |
| `docs/testing.md` | 测试策略（"excessive tests are welcome"） |
| `docs/postmortem/`（10 md） | 事故复盘 |
| **`SAFETY.md`** / **`BENCHMARK.md`**（+ `benchmarks/`） | 安全承诺与基准套件（rc.3 新增的一手材料） |
| **`.agents/notes/implemented/architecture/`**（669 篇） | **"为什么这样设计"的最佳史料** |

## 11.10 症状 → 分册路由

| 症状 | 先看哪篇 |
|---|---|
| 不知道从哪读起 | [01](01-overview.md)、[02](02-codebase-map.md) |
| 不懂 cordis | 先读 [cordis 文档集](../hello-cordis/README.md)（03/04/05 必读） |
| 启动失败 / 想看实际插件树 | [05](05-startup-and-cordis-runtime.md)（`--dump-config`） |
| patch 不生效 | [05 § 5.3](05-startup-and-cordis-runtime.md)（整体替换语义） |
| profile 模板 / bundle 退役 | [05 § 5.4](05-startup-and-cordis-runtime.md)（official-bundles 治理） |
| cordis 行号对不上 | [05 § 5.16](05-startup-and-cordis-runtime.md)（vendor 对照表） |
| turn/step 行为疑问 | [06](06-agent-loop-and-session-log.md) |
| 想拦截模型看到的内容 | [06 § 6.5](06-agent-loop-and-session-log.md)（`agent/pre-step`） |
| 事件加了模型看不到 | [06 § 6.13](06-agent-loop-and-session-log.md)（只有 5 种上表面） |
| 会话历史/fork/持久化 | [06](06-agent-loop-and-session-log.md)、[09](09-host-runtime-and-storage.md) |
| 会话格式/迁移 | [06 § 6.21](06-agent-loop-and-session-log.md)、[11 § 11.1 链 5](#补充链-5会话格式迁移v0--v4) |
| 接新模型 | [07 § 7.2](07-request-pipeline-llm-tools-and-prompts.md)（只需 `stream()`） |
| 工具不执行 / 顺序不对 | [07](07-request-pipeline-llm-tools-and-prompts.md)（`T/batch.ts`） |
| PTC（原 Code Mode） | [07 § 7.15](07-request-pipeline-llm-tools-and-prompts.md) |
| 提示词组装 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| 想换某个能力的实现 | [03](03-capability-seams-and-services.md)（seam 全表） |
| 按 agent 隔离注册 | [03 § 3.5](03-capability-seams-and-services.md)（两级隔离） |
| 文件读写/编辑冲突 | [08](08-execution-services.md)（含 `fs/delete-intent`） |
| 命令执行 / SSH 远端世界 | [08](08-execution-services.md)（`packages/ssh/*`） |
| 沙箱不可用 / 审批 | [08](08-execution-services.md) |
| subagent / 委派 / Agent Team | [08](08-execution-services.md) |
| 上下文太长 | [08](08-execution-services.md)、[09 § 9.29](09-host-runtime-and-storage.md)（spill） |
| 加能力选哪条路 | [04 § 4.1](04-extensions-and-ecosystem.md) |
| MCP / ACP / 插件市场 | [04](04-extensions-and-ecosystem.md) |
| 前端 / Chat 节点 / 桌面端 | [09](09-host-runtime-and-storage.md) |
| API / 网关 / 控制器 / 端口 | [09](09-host-runtime-and-storage.md) |
| 后台任务 / 定时 / 目标（goal 续跑） | [09](09-host-runtime-and-storage.md)（选择表；goal 不再挂 turn-stopping） |
| 存储选哪种 | [09 § 9.27](09-host-runtime-and-storage.md) |
| RPC / schema / 代码生成 | [09](09-host-runtime-and-storage.md) |
| Python 驱动 | [04](04-extensions-and-ecosystem.md) |
| 覆盖率 / 测试 / CI / 基准 | [10](10-testing-and-engineering.md) |
| 插件热替换后依赖没重载 | [11 § 11.1 链 6](#补充链-6热替换hmr--registryreplace) + [cordis 08](../hello-cordis/08-hmr.md) |
| 想查某符号在哪 | 本篇 § 11.6 |

---

**上一篇** ← [10 测试与工程实践](10-testing-and-engineering.md) ｜ **返回** → [索引](README.md) ｜ **动手** → [配套工程 dsh-lab](../../dsh-lab/README.md)

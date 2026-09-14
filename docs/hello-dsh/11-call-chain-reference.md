---
title: "关键调用链速查"
---
# 关键调用链速查

> **本篇回答**：全系列的索引——四条核心调用链、事件全表、逐包符号表、配置速查、症状 → 分册路由。
> **路径缩写**：`P/` = `packages/`，`AL/` = `P/core/agent-loop/src/`，`AG/` = `P/core/agent/src/`，`S/` = `P/core/session/src/`，`T/` = `P/core/tools/src/`，`SP/` = `P/core/system-prompt/src/`，`SC/` = `P/core/scope/src/`，`AB/` = `P/boot/app-boot/src/`，`L/` = `P/llm/llm/src/`，`V/` = `vendor/cordis/src/`。行号对应快照 `fb2c4b9e`。
>
> 🧭 **本篇导览**：11.1 四条核心调用链 → 11.2–11.5 事件全表、核心服务与抽象类方法数 → 11.6–11.8 逐包符号表、vendor cordis 行号对照与配置速查 → 11.9–11.10 上游一手文档与症状路由。
>
> 📎 **来源**：本篇对应初版第 25 篇；仅调整篇号与章节号，继续作为全系列速查索引。

## 11.1 四条核心调用链

### 链 1：`dsh web` → 插件树就绪

![链 1：dsh web 到插件树就绪](diagrams/11-boot-chain.svg)

**链 1：dsh web 到插件树就绪** — [交互版](diagrams/11-boot-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/11-boot-chain.architecture.json)

- **六步就到插件树就绪**：前三步解析命令行与 profile · 中间两步叠加 patch 层 · 最后一步交给 cordis Loader
- **关键源码位置**：parseCmdline 在 P/boot/cmdline/src/index.ts:98 · loadProfile 与 composeEntries 在 AB/profile.ts · mountRootInclude 在 AB/index.ts:486
- **详细展开**：profile 与 bundle 的关系见 05 篇 § 5.2 · 四层叠加顺序见 05 篇 § 5.3 · 启动失败处理见 05 篇 § 5.9

详见 [05 篇](05-startup-and-cordis-runtime.md)。

### 链 2：用户输入 → 模型回答

| 步骤 | 位置 |
|---|---|
| HTTP/WS 入口 | `P/host/webserver`（325 行）→ `P/host/apiproxy`（8571） |
| 找/建 Agent | `ctx.agents`（`AG/index.ts:256`） |
| 输入进 Inbox | `Agent.followup/steer/inject`（`AG/runtime-types.ts:124/133/143`）→ `AL/agent.ts:122/126/130` |
| 唤醒驱动 | `wakeDriver()`（`AL/agent.ts:172`） |
| **turn 循环** | `turn()`（`AL/agent.ts:246`），外层 `while (await this.turn()) {}` |
| append `turn/start` | `AL/agent.ts:255` |
| **claim + 拦截** | `preStep()`（`:225`）→ `inbox.claim()`（`AG/inbox.ts:71`）→ `agent/pre-step` waterfall（`:235`） |
| append `step/start` + `user/message` | `AL/agent.ts:279` / `:283` |
| **step** | `step()`（`AL/agent.ts:332`） |
| 渲染提示 | `renderPrompt(assembly)`（`SP/index.ts:212`），assembly 来自 `assemble()`（`:467`） |
| 投影历史 | `session.deriveMessages()`（`S/index.ts:726`） |
| 组装请求 | `buildRequest()`（`AL/agent.ts:407`）→ `agent/request` waterfall（`:439`） |
| **调模型** | `preparedCall?.stream() ?? ctx.llm.stream()`（`AL/agent.ts:345`）→ `LlmRuntime.stream()`（`L/index.ts:913`）→ `llm/stream` waterfall（`:923`） |
| 逐 chunk 落日志 | `session.append('assistant/chunk', ...)`（`AL/agent.ts:349`） |
| 错误可重试 | `agent/request-error` waterfall（`AL/agent.ts:356`） |
| append `assistant/message` | `AL/agent.ts:381`（带 `sourceEventSeqs: chunkSeqs`，`:389`） |
| **执行工具** | `executeToolCalls()`（`AL/tool-calls.ts:59`） |
| append `step/end` | `AL/agent.ts:292` |
| turn 收尾 | `agent/turn-stopping` serial（`:296`）→ append `turn/end`（`:319`） |

详见 [06 篇](06-agent-loop-and-session-log.md)。

### 链 3：一次工具调用

![链 3：一次工具调用](diagrams/11-tool-call-chain.svg)

**链 3：一次工具调用** — [交互版](diagrams/11-tool-call-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/11-tool-call-chain.architecture.json)

- **参数解析是容错的**：parseArguments 在 JSON 解析失败时保留原文 · 于是模型的轻微格式错误不会直接崩 · 工具自己决定如何处理原始字符串
- **身份从上下文取**：工具签名里没有 agent 参数 · requireInitiator 从执行上下文取 · 缺失即报错，见 08 篇 § 8.28
- **三段 waterfall 是扩展点**：审批挂在 pre-execute · 超时与重试挂在 execute · 结果改写挂在 post-execute

详见 [07 篇](07-request-pipeline-llm-tools-and-prompts.md)。

### 链 4：压缩上下文

| 步骤 | 位置 |
|---|---|
| 触发 | `compactIfNeeded`（`P/compaction/compaction/src/index.ts:113`）/ `compactNow`（`:139`）/ `compactRegion`（`:164`） |
| 生成摘要 | provider（`compaction-basic` 1621 行）通常调 LLM |
| **append 替换事件** | `session.append('assistant/message', 摘要, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: [...] })` |
| 校验 | `surfaceManager.validateNext(event)`（`S/index.ts:634`）—— `sourceEventSeqs` 必须覆盖全部被遮蔽节点 |
| 投影失效 | `replaceGeneration` 变 → `deriveMessages()` 全量重建（`S/index.ts:730-734`） |
| 通知 | `agent/session-start` 带 `source: 'compact'`（`AG/runtime-types.ts:61`、`:217`） |

💡 **日志一行未删** —— 这是 append-only + 表面机制的核心红利（[06 § 6.15](06-agent-loop-and-session-log.md)、[08 § 8.34](08-execution-services.md)）。

## 11.2 事件全表

### `agent/*`（9 个，`AG/runtime-types.ts`）

| 事件 | 行号 | 模式 | 用途 |
|---|---|---|---|
| `agent/created` | 159 | emit | |
| `agent/disposed` | 168 | emit | |
| `agent/status` | 178 | emit | idle ↔ running |
| `agent/session-start` | 217 | emit | `source`: startup/resume/clear/compact |
| **`agent/pre-step`** | **231** | **waterfall** | 决定模型看到什么 |
| **`agent/request`** | **244** | **waterfall** | 改写 `LlmCallConfig` |
| **`agent/request-error`** | **260** | **waterfall** | 返回 `{ kind: 'retry' }` |
| **`agent/turn-stopping`** | **278** | **serial**（无 next） | 可延续 turn |
| `agent/error` | 290 | emit | |

另有 `agent/inbox/{inserted,discarded,claimed}`（`AL/agent.ts:88-91`）与持久事件 `agent/inbox/spliced`（`AG/types.ts:19`）。

### `tools/*`（3 个 waterfall，`T/index.ts`）

| 事件 | 行号 |
|---|---|
| `tools/pre-execute` | 152 |
| `tools/execute` | 163 |
| `tools/post-execute` | 175 |
| `tool/code-dispatch` 相关 | ~180 |

### `fs/*`（3 个，`P/fs/fs/src/index.ts`）

| 事件 | 行号 | 模式 |
|---|---|---|
| `fs/write-intent` | 58 | waterfall |
| `fs/edit-intent` | 66 | waterfall |
| `fs/observed` | 76 | emit |

### 其它

| 事件 | 位置 | 模式 |
|---|---|---|
| `llm/stream` | `L/index.ts:64` | waterfall |
| `system-prompt/assemble` | `SP/index.ts:31` | waterfall |
| `system-prompt/change` | `SP/index.ts`（emit 于注册/卸载） | emit |
| `session/event` | `S/index.ts:641`（`collectSessionCallbacks`） | emit |

## 11.3 SessionEventMap 13 个核心事件

`S/types.ts:236`：

| 事件 | 行号 | 上表面 |
|---|---|---|
| `turn/start` | 243 | — |
| `turn/end` | 252 | — |
| `step/start` | 254 | — |
| `step/end` | 256 | — |
| **`user/message`** | **264** | ✅ |
| `assistant/chunk` | 266 | — |
| **`assistant/message`** | **273** | ✅ |
| `tool/call` | 279 | — |
| **`tool/result`** | **291** | ✅ |
| `todo/write` | 299 | — |
| `request/header` | 304 | — |
| `request/context` | 309 | — |
| `session/end-seed` | 332 | — |

相关类型：`SessionEventType`（336）、`SurfaceEventType`（343）、`SurfaceEvent`（357）、**`SurfaceOp`**（**372**）、`SurfaceIntent`（380）。

## 11.4 核心服务与 `ctx` 键

| `ctx` 键 | 类 | 位置 |
|---|---|---|
| `ctx.agents` | `AgentRegistry` | `AG/index.ts:256` |
| `ctx.agentLoop` | `AgentLoop`（实现 `AgentFactory`） | `AL/index.ts:296` |
| `ctx.sessions` | `SessionStore` | `S/index.ts:792` |
| `ctx.tools` | `ToolRuntime` | `T/index.ts:787` |
| `ctx.systemPrompt` | `SystemPrompt` | `SP/index.ts:338` |
| `ctx.llm` | `LlmRuntime` | `L/index.ts:284` |
| `ctx.fs` | `FileSystem`（abstract） | `P/fs/fs/src/index.ts:86` |
| `ctx.shell` | `ShellExecutor`（abstract） | `P/shell/shell/src/index.ts:65` |
| `ctx.subprocess` | `SubprocessRuntime`（abstract） | `P/subprocess/subprocess/src/index.ts:102` |
| `ctx.terminals` | `TerminalSessionService` | `P/terminal/terminal/src/index.ts:105` |
| `ctx.sandbox` | `SandboxProvider`（abstract） | `P/sandbox/sandbox/src/index.ts:158` |
| `ctx.compaction` | `CompactionEngine`（abstract） | `P/compaction/compaction/src/index.ts:96` |

## 11.5 抽象类的必需方法数

| 服务 | 抽象方法数 | 说明 |
|---|---|---|
| `LlmAdapter` | **1**（`stream`，`L/index.ts:232`） | 其余 4 个有默认实现 |
| `SandboxProvider` | **1**（`confine`，`:175`） | |
| `ShellExecutor` | **3**（`resolve`/`run`/`start`，`:85`/`:93`/`:100`） | |
| `SubprocessRuntime` | **3**（`resolveExecutable`/`spawn`/`spawnTerminal`，`:118`/`:130`/`:139`） | |
| `CompactionEngine` | **3**（`compactIfNeeded`/`compactNow`/`compactRegion`，`:113`/`:139`/`:164`） | |
| `FileSystem` | **13**（全部 abstract，`:116`-`:243`） | 无默认实现 |

💡 **必需方法数反映了"接入成本"**：接一个模型只要 1 个方法，接一个文件系统要 13 个。

## 11.6 逐包符号表（核心）

### `AL/agent.ts`（496 行）

| 符号 | 行号 |
|---|---|
| `type Phase` / `StepEndReason` / `PreparedStep` | 38 / 48 / 50 |
| `requestProposal()` | 55 |
| **`class ReactLoopAgent implements Agent`** | **64** |
| `lastTurn` 从日志倒查 | 92 |
| `get status()` / `setPhase()` | 99 / 104 |
| `send()` / `followup()` / `steer()` / `inject()` | 113 / 122 / 126 / 130 |
| `cancel()` / maintenance / `wakeDriver()` / `throwError()` | 134 / 145 / 172 / 203 |
| **`preStep()`** | **225** |
| **`turn()`** | **246** |
| **`step()`** | **332** |
| **`buildRequest()`** | **407** |

### `AG/`（agent，1636 行）

| 符号 | 位置 |
|---|---|
| `InboxTarget` | `types.ts:10` |
| `agent/inbox/spliced` | `types.ts:19` |
| `AgentStatus` / `PreStepDecision` / `SessionStartSource` | `runtime-types.ts:50` / `:53` / `:61` |
| **`interface Agent`** | `runtime-types.ts:64` |
| `class Inbox` / `claim()` / `splice()` | `inbox.ts:25` / `:71` / `:139` |
| `agentCarrier()` / `agentEvents()` / `emitAgentEvent()` | `dispatch.ts:94` / `:107` / `:158` |
| `AgentFactory` | `index.ts:183` |
| **`class AgentRegistry`** | `index.ts:256` |
| `currentInitiator()` / `requireInitiator()` | `index.ts:309` / `:322` |
| `setFactory()` / `register()` / **`enter()`** | `index.ts:372` / `:450` / **`:474`** |
| `isOwnedBy()` / `roots()` | `index.ts:595` / `:613` |

### `S/`（session，3156 行）

| 符号 | 位置 |
|---|---|
| `adoptSessionEvent()` / `snapshotSessionEvent()` | `index.ts:167` / `:192` |
| **`class Session`** | `index.ts:425` |
| `firstLiveSeq` | `index.ts:472` |
| **`append()`** | `index.ts:604` |
| 重入检查 / `validateNext` | `index.ts:623` / `:634` |
| `requestHeader()` / `requestContext()` | `index.ts:670` / `:691` |
| **`deriveMessages()`** | `index.ts:726` |
| `SessionForkError` | `index.ts:779` |
| **`class SessionStore`** | `index.ts:792` |
| `create/prepare/enter/announce` | `index.ts:830`/`863`/`913`/`968` |
| **`fork()`** | `index.ts:1081` |

### `T/`（tools，5620 行）

| 符号 | 行号 |
|---|---|
| 三段 waterfall | 152 / 163 / 175 |
| `ToolOutputDefinition` / **`ToolDefinition`** / `execute()` | 212 / **222** / 235 |
| `ToolExecutionToken` / `ToolExecutionInput` / `ToolExecutionMode` | 307 / 314 / 344 |
| `CodeDispatchLog` / `ToolExecution` / `ToolDispatchExecution` | 357 / 379 / 391 |
| **`ToolRunContext`** / `deferContext()` / `concludeTurn()` | **404** / 411 / 420 |
| `ToolRuntimeScheduler` | 451 |
| **`class ToolRuntime`** | **787** |
| `register()` / `schemas()` / `executionMode()` / `execute()` | 1037 / 1234 / 1276 / 1342 |

### `SP/`（system-prompt，605 行）

| 符号 | 行号 |
|---|---|
| `system-prompt/assemble` | 31 |
| `PromptSection`（含 `complete?`） | 53（74） |
| `PromptAssembly` | 115 |
| `PERSONA_SECTION` / `PERSONA_ORDER` / **`TOOL_ORDER_REST`** | 128 / 131 / **140** |
| **`renderPrompt()`** | **212** |
| **`class SystemPrompt`** | **338** |
| `section()` / `context()` / `suppressRuntimeContext()` | 381 / 398 / 415 |
| **`assemble()`** | **467** |

### `SC/`（scope，561 行）

| 符号 | 位置 |
|---|---|
| `ScopeKey` / **`Scoped<T>`** | `index.ts:15` / **`:27`** |
| `scopeChainOf()` / `createScope()` | `index.ts:98` / `:137` |
| **`scopeTarget()`** / `carrierKeyOf()` | `index.ts:170` / `:201` |
| `NamedEntries` / `AnonymousEntries` / **`ScopedLayers`** | `store.ts:30` / `:114` / **`:159`** |
| `chainLayers()` / `effect()` | `store.ts:192` / `:226` |

### `AB/`（app-boot，829 + 420 行）

| 符号 | 位置 |
|---|---|
| `loadLayeredEnv()` | `index.ts:177` |
| `loadOverlayPatches()` | `index.ts:298` |
| `renderConfigDump()` | `index.ts:379` |
| **`mountRootInclude()`** | `index.ts:486` |
| `FAIL_LOUD_RELEASE_TIMEOUT_MS = 2000` | `index.ts:578` |
| `installFailLoud()` / `assertEntriesLoaded()` | `index.ts:609` / `:658` |
| `assertEntriesActivated()` | `index.ts:692` |
| **`boot()`** | `index.ts:757` |
| `PROFILES_DIR` / `PROFILE_PATCH_FILENAME` | `profile.ts:36` / `:39` |
| `initProfile()` / **`loadProfile()`** / **`composeEntries()`** | `profile.ts:152` / **`:371`** / **`:413`** |

### `L/`（llm，2625 行）

| 符号 | 行号 |
|---|---|
| `llm/stream` | 64 |
| `LlmError` / `PreparedLlmCall` | 83 / 155 |
| **`abstract class LlmAdapter`** / `abstract stream()` | **180** / 232 |
| **`class LlmRuntime`** | **284** |
| `resolveCallConfig()` / **`prepareCall()`** / **`stream()`** | 730 / **779** / **913** |

## 11.7 vendor cordis 与上游的行号对照

见 [05 § 5.16](05-startup-and-cordis-runtime.md) 完整表。要点：

| 符号 | 上游 | vendor |
|---|---|---|
| `FiberState` | 78 | **147** |
| `class Fiber` | 103 | **184** |
| `effect()` | 277 | **418** |
| `_refresh()` | 385 | **611** |
| `reflect` 的 `handler` | 62 | **135** |
| `provide()` / `notify()` | 175 / 205 | **277** / **314** |
| `registry.plugin()` | 193 | **316** |
| `events.waterfall()` | 117 | **234** |

vendor 独有（三处加固，[05 § 5.15](05-startup-and-cordis-runtime.md)）：`effectInertia`（`V/fiber.ts:112`）、`runDisposable`（`:114`）、`emitPluginDisposed`（`:120`）、`_config`（`:192`）、`_resolveConfig`（`:641`）。

## 11.8 配置速查

| 项 | 值 / 位置 |
|---|---|
| 默认模型 | `deepseek-official` / `deepseek-v4-flash`（`P/bundle/base/cordis.patch.yml`） |
| Web 默认地址 | `http://127.0.0.1:3080`（README） |
| Node 要求 | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11.7.0 |
| 全部包版本 | `0.1.5-rc.2` |
| profile 目录 | `<home>/profiles/<name>/`（`AB/profile.ts:36`） |
| profile patch 文件名 | `cordis.patch.yml`（`AB/profile.ts:39`） |
| 默认 bundle | `['@deepseek-ai/dsh-base']`（`AB/profile.ts:125`） |
| profile 模板 | `web` / `headless`（`AB/profile.ts:114`） |
| fail-loud 认领窗口 | 2000 ms（`AB/index.ts:578`） |
| bootstrap-only 前缀 | `['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']`（`AB/index.ts:117`） |
| 全文搜索默认 | `openAt: 'never'`（`P/bundle/web-app/cordis.patch.yml`） |
| Code Mode 开关（临时） | `DSH_TOOLS_MODE`（`native`/`code`/`both`） |
| 覆盖率门禁 | 逐文件 100%（`vitest.config.ts:273-279`） |
| 会话格式版本 | `SESSION_FORMAT_VERSION = 0`（无兼容承诺） |

## 11.9 上游一手文档（优先读）

| 文档 | 内容 |
|---|---|
| **`docs/architecture.md`**（129 行） | **最重要**：cordis 底座、profile/bundle、core 包表、三类事件域、turn 流程、seam、"新行为放哪"21 条映射 |
| **`AGENTS.md`** = `CLAUDE.md`（149 行） | 仓库布局、命令清单、pre-release 立场、agent 操作规程 |
| `docs/cordis-primer.md` + `cordis-tutorial/`（16） + `cordis-api/`（11） | cordis 文档（**托管在 DSH 仓库**） |
| `docs/subsystems/`（92 md） | 逐子系统契约 |
| `docs/cookbook/`（16 md） | 扩展指南 |
| `docs/event-producer-consumer.md` | 事件生产者/消费者全表 |
| `docs/capability-seams.md` | 能力接缝图谱 |
| `docs/tool-execution-pipeline.md` | 工具管线 |
| `docs/agent-lifecycle.md` | 生命周期时序图 |
| `docs/config-catalog.md` / `tool-catalog.md` / `persistence-catalog.md` | 生成的目录 |
| `docs/module-graph.md` / `graph-atlas.md` | 依赖图 |
| `docs/defensive-patterns.md` | 防御式模式（fail-closed 等） |
| `docs/testing.md` | 测试策略（"excessive tests are welcome"） |
| `docs/postmortem/`（10 md） | 事故复盘 |
| **`.agents/notes/implemented/architecture/`**（258 篇） | **"为什么这样设计"的最佳史料** |

## 11.10 症状 → 分册路由

| 症状 | 先看哪篇 |
|---|---|
| 不知道从哪读起 | [01](01-overview.md)、[02](02-codebase-map.md) |
| 不懂 cordis | 先读 [cordis 文档集](../hello-cordis/README.md)（03/04/05 必读） |
| 启动失败 / 想看实际插件树 | [05](05-startup-and-cordis-runtime.md)（`--dump-config`） |
| patch 不生效 | [05 § 5.3](05-startup-and-cordis-runtime.md)（整体替换语义） |
| cordis 行号对不上 | [05 § 5.16](05-startup-and-cordis-runtime.md)（vendor 对照表） |
| turn/step 行为疑问 | [06](06-agent-loop-and-session-log.md) |
| 想拦截模型看到的内容 | [06 § 6.5](06-agent-loop-and-session-log.md)（`agent/pre-step`） |
| 事件加了模型看不到 | [06 § 6.13](06-agent-loop-and-session-log.md)（只有 3 种上表面） |
| 会话历史/fork/持久化 | [06](06-agent-loop-and-session-log.md)、[09](09-host-runtime-and-storage.md) |
| 接新模型 | [07 § 7.2](07-request-pipeline-llm-tools-and-prompts.md)（只需 `stream()`） |
| 工具不执行 / 顺序不对 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| Code Mode | [07 § 7.15](07-request-pipeline-llm-tools-and-prompts.md) |
| 提示词组装 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| 想换某个能力的实现 | [03](03-capability-seams-and-services.md)（seam 全表） |
| 按 agent 隔离注册 | [03 § 3.5](03-capability-seams-and-services.md)（两级隔离） |
| 文件读写/编辑冲突 | [08](08-execution-services.md) |
| 命令执行 / 远端沙箱 | [08](08-execution-services.md) |
| 沙箱不可用 / 审批 | [08](08-execution-services.md) |
| subagent / 委派 | [08](08-execution-services.md) |
| 上下文太长 | [08](08-execution-services.md)、[09 § 9.29](09-host-runtime-and-storage.md)（spill） |
| 加能力选哪条路 | [04 § 4.1](04-extensions-and-ecosystem.md) |
| MCP / ACP | [04](04-extensions-and-ecosystem.md) |
| 前端 / Chat 节点 | [09](09-host-runtime-and-storage.md) |
| API / 网关 / 端口 | [09](09-host-runtime-and-storage.md) |
| 后台任务 / 定时 / 目标 | [09](09-host-runtime-and-storage.md)（选择表） |
| 存储选哪种 | [09 § 9.27](09-host-runtime-and-storage.md) |
| RPC / schema / 代码生成 | [09](09-host-runtime-and-storage.md) |
| Python 驱动 | [04](04-extensions-and-ecosystem.md) |
| 覆盖率 / 测试 / CI | [10](10-testing-and-engineering.md) |
| 想查某符号在哪 | 本篇 § 11.6 |

---

**上一篇** ← [10 测试与工程实践](10-testing-and-engineering.md) ｜ **返回** → [索引](README.md) ｜ **动手** → [配套示例工程](../../dsh-example/README.md)

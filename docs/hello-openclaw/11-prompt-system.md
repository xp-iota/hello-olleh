---
title: "Prompt 系统：缓存边界、双层组装与可插拔 context engine"
---
# Prompt 系统：缓存边界、双层组装与可插拔 context engine

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是开源的个人 AI 助理网关——Gateway 常驻本机作为控制面，20+ 消息通道与 Control UI/CLI/TUI 都只是客户端；本篇对照 `src/agents/system-prompt.ts`、`src/skills/loading/` 与 `src/context-engine/`。

**目录**

- [1. 三层组装：纯渲染器、config 门面与 runtime adapter](#1-三层组装纯渲染器config-门面与-runtime-adapter)
- [2. 缓存边界与 stable prefix](#2-缓存边界与-stable-prefix)
- [3. provider contribution 与 promptMode 三档](#3-provider-contribution-与-promptmode-三档)
- [4. Workspace bootstrap 注入](#4-workspace-bootstrap-注入)
- [5. skills 的懒广告与预算](#5-skills-的懒广告与预算)
- [6. context engine：可替换的上下文组装插槽](#6-context-engine可替换的上下文组装插槽)

---

## 1. 三层组装：纯渲染器、config 门面与 runtime adapter

`buildAgentSystemPrompt()`（`src/agents/system-prompt.ts:342`）是 system prompt 的**纯渲染器**：四十余个显式入参（toolNames、contextFiles、skillsPrompt、sandboxInfo、runtimeInfo……），自身不读全局 config。上层 `buildConfiguredAgentSystemPrompt()`（`src/agents/system-prompt-config.ts:30`）把 config 派生的旋钮——owner display、TTS hint、model alias 列表、memory citations、`fsWorkspaceOnly`——投影成这些入参再调渲染器；最外层由各 runtime adapter（embedded、CLI backend、compaction、export 预览）收集活的事实后调这个门面。这样"导出的 prompt"与"live run 的 prompt"天然对齐，而不必把所有 runtime 细节塞进一个巨型 builder。

渲染器内部把 prompt 组织成固定分节：`## Tooling`（含 "AGENTS.md Tools section guides usage; it never grants availability" 这句关键行——工具文档永远不等于工具授权，授权由 policy 决定，见 [05-tool-system.md](./05-tool-system.md)）、`## Execution Bias`（"Requested action with an available tool: do it. Tool policy and approvals gate risk; don't pre-refuse"——风险在运行时门控，而不是让模型预先自我审查）、`## Promised Work`、`## Care`、`## Runtime Context`、`## OpenClaw Control`、`## Documentation`、`## Sandbox`、`## Runtime` 等，每节按运行时能力（availableTools 集合）逐条裁剪。

## 2. 缓存边界与 stable prefix

整个 prompt 在物理上被切成两段，边界是字面注释 `<!-- OPENCLAW_CACHE_BOUNDARY -->`（`packages/ai/src/utils/system-prompt-cache-boundary.ts:3`）：

- **stable prefix**（`:674-904`）：identity 行、Tooling、Tool Call Style、Execution Bias、Care、Skills、Memory Recall、Workspace、Documentation、Sandbox 与注入的 Project Context 文件，全部在边界**之上**；不稳定的内容（时区/日期、owner 身份、channel 相关 guidance、当前 elevated 档位、Collapsible Details、Reactions）压到边界**之下**，使大块 workspace 上下文在跨 channel、跨会话间保持**字节级相同的前缀**，本地后端的前缀 KV cache 得以复用。
- stable prefix 本身还有一层 LRU：`cacheStablePromptPrefix()`（`:95`）以 `sha256(JSON.stringify(输入摘要))` 为键缓存整段渲染结果，上限 64 条（`SYSTEM_PROMPT_STABLE_PREFIX_CACHE_LIMIT`，`:91`），避免同一会话每轮重复拼接上千行。
- 另有一个 `<!-- OPENCLAW-RELOCATABLE-BOUNDARY -->`：只有 Runtime 事实（host/os/model/session）允许移到工具输出之后，防止 hook 注入的权限声明被错误降级。

时间处理是这套设计的教科书案例：`## Temporal Context`（日期 + 时区）被刻意放在边界之下的**第一位**（`:910` 附近注释写明 "day rollover is visible without invalidating the stable prefix"），精确时刻则交给 `session_status` 工具按需查询。

## 3. provider contribution 与 promptMode 三档

provider 插件不替换 OpenClaw 拥有的 prompt，而是通过 `ProviderSystemPromptContribution`（`src/agents/system-prompt-contribution.ts:16`）做三件事：替换三个命名核心节之一（`interaction_style`、`tool_call_style`、`execution_bias`）、在缓存边界之上注入 `stablePrefix`、在边界之下注入 `dynamicSuffix`。内置 GPT-5 家族的贡献（`src/agents/gpt5-prompt-overlay.ts`）就是范例：一个 `<persona_latch>`/`<execution_policy>`/`<tool_discipline>` 行为契约作为 stablePrefix，外加可选的 friendly `interaction_style` 覆盖——行为契约与语气分层，使 `personality: "off"` 只摘掉语气而保留行为约束。旧的 `before_prompt_build` hook 仍受支持，但被降级为兼容路径。

每个 run 还带一个内部 `promptMode`：`full` 全节；`minimal` 供 sub-agent 使用（去掉 Memory Recall、Model Aliases、Messaging、Silent Replies 等）；`none` 只剩一行 "You are a personal assistant running inside OpenClaw." 加模型身份行。Silent Replies（整条回复只发 `NO_REPLY`，`src/auto-reply/tokens.ts:6`）只发给连接外部消息通道的会话，sub-agent 与 Control UI 会话永远收不到——它们必须返回结果或继续干活。

## 4. Workspace bootstrap 注入

agent workspace 下的六个文件按生命周期分工注入（`docs/concepts/system-prompt.md` § Workspace bootstrap injection）：`AGENTS.md`（项目说明，其 `## Tools` 节还会指导工具用法）、`SOUL.md`（人格）、`IDENTITY.md`、`USER.md`（用户偏好）、`BOOTSTRAP.md`（仅全新 workspace）、`MEMORY.md`。截断预算由 `agents.defaults.bootstrapMaxChars`（默认 20000/文件）与 `bootstrapTotalMaxChars`（默认 60000）控制，超限必然注入一条"部分 bootstrap 文件被截断、请直接 read 原文件"的提示。sub-agent 会话只注入 `AGENTS.md`，其余全部过滤掉。

`BOOTSTRAP.md` 有独立的状态机：`buildAgentBootstrapSystemPromptSections()`（`:131`）渲染 `## Bootstrap Pending` 节——workspace 刚创建且 bootstrap 未完成时，首轮回复必须遵循 BOOTSTRAP.md 而不是发通用问候；`limited` 模式表示本次 run 无法安全完成 bootstrap，给出 next-step 指引。内部 hook 可经 `agent:bootstrap` 事件整体替换注入文件（例如换人格）。在原生 Codex harness 上，OpenClaw 不重复注入 stable workspace 文件（Codex 自己会加载执行目录的 `AGENTS.md`），`MEMORY.md` 也不逐轮粘贴，而是给一句"用 memory_search/memory_get 按需读"。

## 5. skills 的懒广告与预算

与 pi 同构的懒广告设计，但预算体系更完整。`formatSkillsForPromptCore()`（`src/skills/loading/skill-contract.ts:131`）渲染 `<available_skills>` XML 目录：每个 skill 只含 `name`、`description`、`location`（SKILL.md 的绝对路径）与可选 `location_note`，并附一句 "Read a skill's file at its listed location when the task matches its description"——完整 SKILL.md 永不进初始 prompt。没有 read 工具但有 `skills_search`/`skills_read` 时，prompt 里的指令随之换成专用工具（`src/agents/system-prompt-skills.ts:18`），找不到匹配时要求先搜索再自己实现。

预算在 `src/skills/loading/skill-prompt-limits.ts:9-10`：默认最多 150 个 skill、18000 字符，可全局或 per-agent 调整。超预算时的降级不是简单截断，而是**二分搜索压缩档位**（`largestFittingValue`）：从 full 目录降到 compact（description 压到 220 字符，`COMPACT_DESCRIPTION_MAX_CHARS`）再到只留 name+location 的最简档，并在目录前加一行 `⚠️ Skills truncated: included X of Y. Run openclaw skills check to audit.`。skill 身份（name/location）是下限，不可省略。这一族"省 prompt 字节"的机制与 [08-performance.md](./08-performance.md) 的缓存策略同属一条主线。

## 6. context engine：可替换的上下文组装插槽

OpenClaw 把"模型每轮看到什么"做成了插件插槽 `plugins.slots.contextEngine`。引擎在四个生命周期点参与（`docs/concepts/context-engine.md`）：`ingest`（消息入库）、`assemble`（run 前组装消息序列，可返回 `systemPromptAddition` 预挂在 system prompt 前）、`compact`（总结旧史）、`afterTurn`/`maintain`（维护）。`ownsCompaction: true` 的引擎接管压缩，宿主关闭内置 auto-compaction；`false` 则可调 `delegateCompactionToRuntime()` 复用内置压缩。

内置 `legacy` 引擎（`src/context-engine/legacy.ts`）四个钩子全是 pass-through——默认行为完全不变。失败隔离是这一插槽的安全底线：非 legacy 引擎缺失、契约校验失败或生命周期抛错时，`recordContextEngineQuarantine()`（`src/context-engine/registry-quarantine.ts:33`）把引擎在本 Gateway 进程内**隔离**并整体降级回 legacy，只记 first-failure 根因——助理不能因为一个第三方上下文引擎崩溃而沉默。选路本身由 `resolveEffectiveContextEngineId()`（`src/context-engine/registry-selection.ts:14`）决定：插件被禁用/卸载时回退默认槽位，卸载选中引擎时槽位自动重置回 `legacy`。

## 源码锚点

- [`sources/openclaw/src/agents/system-prompt.ts`](../../sources/openclaw/src/agents/system-prompt.ts)：纯渲染器、缓存边界与 stable prefix LRU
- [`sources/openclaw/src/agents/system-prompt-config.ts`](../../sources/openclaw/src/agents/system-prompt-config.ts)：config 旋钮门面
- [`sources/openclaw/packages/ai/src/utils/system-prompt-cache-boundary.ts`](../../sources/openclaw/packages/ai/src/utils/system-prompt-cache-boundary.ts)：边界注释常量
- [`sources/openclaw/src/agents/system-prompt-contribution.ts`](../../sources/openclaw/src/agents/system-prompt-contribution.ts)：provider 贡献的三通道契约
- [`sources/openclaw/src/skills/loading/skill-contract.ts`](../../sources/openclaw/src/skills/loading/skill-contract.ts)：`<available_skills>` XML 目录与 compact 档
- [`sources/openclaw/src/skills/loading/skill-prompt-limits.ts`](../../sources/openclaw/src/skills/loading/skill-prompt-limits.ts)：150/18000 预算与二分压缩
- [`sources/openclaw/src/context-engine/legacy.ts`](../../sources/openclaw/src/context-engine/legacy.ts)：默认 pass-through 引擎
- [`sources/openclaw/src/context-engine/registry-quarantine.ts`](../../sources/openclaw/src/context-engine/registry-quarantine.ts)：引擎隔离与 legacy 降级
- [`sources/openclaw/docs/concepts/system-prompt.md`](../../sources/openclaw/docs/concepts/system-prompt.md)：分节、promptMode 与 bootstrap 官方文档
- [`sources/openclaw/docs/concepts/context-engine.md`](../../sources/openclaw/docs/concepts/context-engine.md)：引擎生命周期官方文档

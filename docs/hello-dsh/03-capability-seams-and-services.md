---
title: "能力缝 Seam 与服务全景"
---
# 能力缝 Seam 与服务全景

> **本篇回答**：DSH 最重要的架构概念——seam（能力接缝）的三角色模型、`core/scope` 的两级隔离机制、以及"换一个 provider 改变整个产品"是怎么实现的。
> **路径缩写**：`P/` = `packages/`，`SC/` = `packages/core/scope/src/`。行号对应快照 `fb2c4b9e`。
>
> 🧭 **本篇导览**：3.1–3.2 三角色定义与 provider 替换 → 3.3–3.4 `e2b` 与 `subagent` 两个极端例子 → 3.5–3.7 两级隔离、`core/scope` API 与 capability 事件 → 3.8–3.10 seam 全表、"新行为放哪"与 `preset`。
>
> 📎 **来源**：本篇对应初版第 10 篇；仅调整篇号与章节号，主题内容保持为 seam 与服务全景。

## 3.1 seam 的三角色定义

> 📐 **配套可跑示例**：[`M03.1 · llm-adapter`](../../dsh-example/M03-inference-service-access/steps/01-llm-adapter.ts) 是三角色模型的最小实例 ——
> Definition 是真实包 `@deepseek-ai/dsh-llm` 导出的抽象类 `LlmAdapter`，Provider 是那个 `MockAdapter`，
> Consumer 是 agent-loop（示例里换成 `ctx.llm.stream(...)` 直接消费）；`npm run M03:real`
> 再用同一个循环消费真实 `minimax-m3` 路由，验证"换 provider 不换 Consumer"。
>
> ```ts
> class MockAdapter extends LlmAdapter {        // ← Provider
>   async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> { /* … */ }
> }
> ctx.llm.registerAdapter([config.routeName], new MockAdapter(config.reply))
> ```


`docs/architecture.md` 的原文：

> A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but **one role alone is not a seam**; adding a capability means designing all three.

![一个 seam 等于三个角色](diagrams/03-seam-roles.svg)

**一个 seam 等于三个角色** — [交互版](diagrams/03-seam-roles.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-seam-roles.architecture.json)

- **三者的依赖方向**：Provider 与 Consumer 都只依赖 Definition · 两者之间不互相 import · 因此换 Provider 不影响任何 Consumer
- **Definition 里放什么**：接口方法签名 · capability 事件的类型定义 · 不放任何具体实现或平台判断
- **为什么强制三角色**：少了 Definition 就无法替换实现 · 少了多个 Provider 就证明不了可替换 · 少了 Consumer 则能力对模型不可见

💡 **注意行数分布**：`fs` 定义包只有 503 行，而三个 consumer 加起来 3590 行、`fs-local` 1210 行。**定义包薄、实现与消费厚**是 seam 设计成功的标志——接口稳定，两侧独立演进。

## 3.2 为什么"换一个 provider 改变整个产品"

`docs/architecture.md`：

> Seams are why one provider swap changes the whole product. Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, **with no provider forks**.

![换两个 provider 就换掉整个执行世界](diagrams/03-two-worlds.svg)

**换两个 provider 就换掉整个执行世界** — [交互版](diagrams/03-two-worlds.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-two-worlds.architecture.json)

- **只换两个 provider**：fs 与 subprocess 是最底层的两个 seam · 上层 Bash、PTY、LSP 只依赖这两个接口 · 于是它们跟着切到远端，代码零改动
- **这就是 seam 的收益**：一次 provider 替换改变整个产品形态 · 不需要在每个上层包里做平台判断 · 本地与远端共用同一套工具实现
- **沙箱是第三个世界**：fs-sandbox 与 subprocess-sandbox 组成沙箱世界 · 三个世界的上层完全一致 · 切换只在配置层发生

💡 **"no provider forks"是关键收益**。传统做法是给远端场景写一套 `RemoteBashTool`；DSH 只换 `ctx.subprocess` 的 provider，`tool-bash` 一行不改。

💡 **`fs-sandbox` 只有 254 行**——它不是重新实现文件系统，而是**在 `fs-local` 基础上加沙箱约束**（大概是路径校验 + 委托）。同理 `bash-sandbox`（328）比 `bash-local`（363）还小。

## 3.3 `e2b` 组：一个完整的远端执行世界

`packages/e2b/`（6630 行）三个包：

| 包 | 角色 |
|---|---|
| `e2b` | 与 E2B 平台的连接 |
| `fs-e2b` | `ctx.fs` provider |
| `subprocess-e2b` | `ctx.subprocess` provider |

💡 **只要两个 provider 就搬走了整个执行世界**。这印证了 § 3.2 的说法。配套有 `.github/workflows/e2b-e2e.yml` 做端到端验证。

## 3.4 `subagent`：seam 的极端例子

`docs/architecture.md`：

> Subagent providers（上游 `docs/subsystems/subagent.md`）vary just as widely behind one interface, from a fresh child agent to a delegated turn in another product.

`packages/subagent/`（24466 行）**10 个包**：

![subagent 的六种 provider](diagrams/03-subagent-providers.svg)

**subagent 的六种 provider** — [交互版](diagrams/03-subagent-providers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-subagent-providers.architecture.json)

- **差异最大的一组 provider**：从进程内 fork 到委派给别家 CLI 都在同一接口下 · fork-in-process 复用当前会话状态 · claude-code 与 codex 则是完全外部的进程
- **Consumer 只有三个工具**：tool-subagent 负责创建 · tool-subagent-report 负责回报 · tool-subagent-control 负责查状态与取消
- **选型在配置层**：provider 由 profile 或 bundle 决定 · 模型不感知背后是哪种实现 · 这让同一套提示词能跨后端复用

详见 [08 篇](08-execution-services.md)。

## 3.5 两级隔离：cordis realm vs DSH scope

这是理解 DSH 隔离机制的关键。

![两级隔离机制](diagrams/03-two-level-isolation.svg)

**两级隔离机制** — [交互版](diagrams/03-two-level-isolation.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-two-level-isolation.architecture.json)

- **两级解决不同问题**：第一级解决「两组插件要用同名服务的不同实例」 · 第二级解决「同一进程内不同会话要有不同能力集」 · 前者在启动时定型，后者随会话变化
- **group 行是隔离的容器**：把 provider 与 consumer 一起放进一个 group · 该 group 声明 isolate realm · 于是这组包看到的是自己那份实现
- **给一个会话不同能力集**：官方文档的说法是 compose an agent preset · 实现上是那一行服务需要一个 isolate realm · 运行期再叠 scope 层做细粒度控制

## 3.6 `core/scope` 的 API

### `SC/index.ts`（204 行）

| 符号 | 行号 | 说明 |
|---|---|---|
| `ScopeKey = object` | 15 | **任意对象**都能当 scope 键（用身份而非值） |
| **`Scoped<T>`** | **27** | `object & { readonly [ScopedBrand]: T }` |
| `ScopeParentBinding` | 42 | 带 `rebind(parent)`（`:50`） |
| `bindScopeParent(key, parent)` | 72 | 建立父子关系 |
| `linkScopeParent(...)` | 76 | 内部 |
| `scopeParentOf(key)` | 89 | 取父 |
| **`scopeChainOf(key)`** | **98** | **取整条作用域链** |
| `Scope` 接口（含 `dispose()`） | 105 / 111 | |
| `CreateScopeOptions` | 124 | |
| **`createScope(ctx, key, options?)`** | **137** | |
| `scopeOf(ctx)` | 154 | 从 ctx 反查 scope |
| **`scopeTarget(base, key)`** | **170** | **造一个 `Scoped<T>` 载体** |
| `isScopeCarrier(value)` | 192 | 类型守卫 |
| `carrierKeyOf(value)` | 201 | 从载体取 scope key |

💡 **`scopeTarget(this, scope)` 是事件派发的关键**。[07 § 7.21](07-request-pipeline-llm-tools-and-prompts.md) 里 `assemble()` 调 waterfall 时传的就是它：

```ts
await this.ctx.waterfall(scopeTarget(this, scope), 'system-prompt/assemble', ...)
```

cordis 的 `waterfall(thisArg, name, ...)` 会用 `thisArg[Context.filter]` 过滤监听器（[cordis 06 § 6.2](../hello-cordis/06-event-system-and-waterfall.md)）——**`Scoped<T>` 载体携带了 scope 信息，从而实现"agent-scoped 监听器只收到那个 agent 的调用"**。

💡 **`ScopeKey = object` 用对象身份而非字符串**。这样 scope 键天然唯一、不会撞名，也不需要注册表分配 id。`Agent` 对象本身就可以当 ScopeKey。

### `SC/store.ts`（267 行）

三个可复用的容器：

![core/scope 的三个可复用容器](diagrams/03-scope-containers.svg)

**core/scope 的三个可复用容器** — [交互版](diagrams/03-scope-containers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-scope-containers.architecture.json)

- **共同点是都返回 disposer**：insert 与 append 都返回一个撤销函数 · 于是容器天然适配 cordis 的 effect 模型 · 插件卸载时登记的条目自动消失
- **同名遮蔽的用途**：NamedEntries 允许后注册的同名条目遮蔽先前的 · 撤销后自动恢复被遮蔽的那个 · 这是覆盖默认实现又能回滚的基础
- **三者的查询接口**：NamedEntries 提供 get / has / keys / entries / values · AnonymousEntries 只提供 values · 两者都有 isEmpty

💡 **`ScopedLayers.effect(...)`（`SC/store.ts:226`）把"往某层插入一项"包成 cordis effect**。所以作用域化注册也是可逆的——[07 § 7.25](07-request-pipeline-llm-tools-and-prompts.md) 里 `systemPrompt.section()` 就是这么实现的。

💡 **`scoped-events.generated.ts`（49 行）** 是脚本生成的——大概是把"哪些事件支持 scope 过滤"的清单生成出来，供运行时校验。改它要改生成器（[02 § 2.8](02-codebase-map.md)）。

## 3.7 capability 事件：给接缝挂策略

`docs/architecture.md` 的第三类事件域：

> **Capability events** attach policy and adapters to a seam (`fs/*`, `tools/*`, `telemetry/*`) without importing the loop.

![capability 事件让策略与主循环解耦](diagrams/03-capability-events.svg)

**capability 事件让策略与主循环解耦** — [交互版](diagrams/03-capability-events.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-capability-events.architecture.json)

- **不 import 主循环是关键约束**：策略包不依赖 agent-loop · 也不依赖任何具体 provider · 它只认 Definition 声明的事件类型
- **带来的两个自由度**：换 provider 时策略照旧生效 · 换主循环时策略也照旧生效 · 策略因此可以独立发布与复用
- **事件是能力的公共面**：Definition 同时声明接口与事件 · 事件属于契约的一部分，不是实现细节 · 这让观测与准入都能做成独立包

全仓的 `*-policy` 包：

| 包 | 组 | 行数 | 挂在哪个 seam |
|---|---|---|---|
| `sandbox-policy` | sandbox | 267 | `ctx.sandbox` |
| `fs-observation-policy` | fs | 189 | `fs/*` 事件 |
| `spill-policy` | spill | — | `ctx.spill` |
| `session-checkpoint-policy` | session | 113 | 会话落盘时机 |
| `timeout-policy` | guard | — | `tools/execute`（[07 § 7.11](07-request-pipeline-llm-tools-and-prompts.md)） |
| `gang-scheduling-*` | — | — | — |

## 3.8 全部 seam 一览

> 📐 **配套可跑示例**：下面这张表里的每个 seam 都有一个能真跑的最小 provider / consumer ——
> `ctx.llm` → [M03.1](../../dsh-example/M03-inference-service-access/steps/01-llm-adapter.ts)、`ctx.fs` / `ctx.subprocess` → [M07.1](../../dsh-example/M07-execution-backends/steps/01-fs-shell-side-effects.ts)、
> `ctx.shell` → [M07.2](../../dsh-example/M07-execution-backends/phases/02-shell-service.ts)、`ctx.sandbox` → [M07.3](../../dsh-example/M07-execution-backends/steps/03-sandbox-seam.ts)、
> `ctx.compaction` → [M02.3](../../dsh-example/M02-context-assembly-economics/steps/03-compaction-provider.ts)、`ctx.subagents` → [M08.1](../../dsh-example/M08-delegation-presets/steps/01-subagent-delegation.ts)、
> `ctx.jobs` → [M09.1](../../dsh-example/M09-long-running-orchestration/phases/01-jobs-background.ts)、`ctx.goals` → [M09.2](../../dsh-example/M09-long-running-orchestration/phases/02-goal-lifecycle.ts)、
> `ctx.settings` → [M11.1](../../dsh-example/M11-config-data-infrastructure/steps/01-settings-namespaces.ts)、`ctx.approval` → [M06.2](../../dsh-example/M06-human-in-the-loop/steps/02-approval-answerer.ts)。


按 `ctx` 键整理（来自 `docs/architecture.md` 的映射表 + 包结构）：

| `ctx` 键 | 定义包 | Provider | Consumer（`tool-*`） |
|---|---|---|---|
| `ctx.llm` | `llm/llm` | `llm-deepseek`、`llm-pi-ai` | （agent-loop 直接用） |
| `ctx.fs` | `fs/fs` | `fs-local`、`fs-sandbox`、`fs-e2b` | `tool-fs`、`tool-fs-search`、`tool-str-replace-editor` |
| `ctx.subprocess` | `subprocess/subprocess` | `subprocess-local`、`subprocess-e2b` | （被 shell / lsp 用） |
| `ctx.shell` | `shell/shell` | `bash-local`、`bash-sandbox`、`pwsh-local`、`pwsh-sandbox` | `tool-bash`、`tool-bash-persistent`、`tool-pwsh` |
| `ctx.terminals` | `terminal/terminal` | `terminal-bash` | `tool-terminal` |
| `ctx.sandbox` | `sandbox/sandbox` | `sandbox-local`、`sandbox-windows-acl` | （consumer 在 spawn 前包裹 argv） |
| `ctx.lsp` | `lsp/lsp` | `lsp-stdio` | `tool-lsp` |
| `ctx.storage` | `storage/storage` | `storage-json`、`storage-sqlite`、`storage-domain` | — |
| `ctx.jobs` | `jobs/jobs` | `jobs-local` | `tool-jobs` |
| `ctx.credentials` | `credentials/credentials` | `credentials-local` | — |
| `ctx.settings` | `settings/settings` | `settings-file` | — |
| `ctx.spill` | `spill/spill` | `spill-local` | — |
| `ctx.skills` | `skill/skill` | `skill-filesystem` | `tool-skill` |
| `ctx.goals` | `goal/goal` | `goal-round-driver` | `tool-goal` |
| `ctx.commands` | `interaction/commands` | — | `command-*`（3 个） |
| `ctx.agents` | `core/agent` | — | — |
| `ctx.agentLoop` | `core/agent-loop` | （实现 `AgentFactory`） | — |
| `ctx.tools` | `core/tools` | — | 全部 `tool-*` |
| `ctx.sessions` | `core/session` | `session-persistence-*` | — |
| `ctx.systemPrompt` | `core/system-prompt` | — | — |
| `ctx.sessionTitle` | `session/session-title` | 三个 title provider（**唯一**） | — |
| `ctx.attachments` | `attachment/attachment` | `attachment-local` | — |
| `ctx.workspace` | `workspace/workspace` | — | — |
| subagent | `subagent/subagent` | 6 种 | `tool-subagent*`（3 个） |
| compaction | `compaction/compaction` | `compaction-basic`、`compaction-tool-result-pruner` | `command-compact` |

💡 **`sandbox` 的 consumer 模式不同**：`docs/architecture.md` 说 "use a `ctx.sandbox` backend; **consumers wrap argv before spawning**"——沙箱不是拦截器，而是**由调用方主动包裹命令行**。这是刻意的：让"是否沙箱化"在调用点显式可见。

💡 **`sandbox-windows-acl` 有 2530 行**，是 sandbox 组最大的包（比 `sandbox-local` 655 行大 3.9 倍）。Windows 的 ACL 模型比 Unix 复杂得多。

## 3.9 "新行为放哪"：官方映射表

> 📐 **配套可跑示例**：[示例工程的能力索引](../../dsh-example/README.md) 就是按同一套"四条扩展路径"组织的 ——
> 按注册（01/02/04/10/15/16/23）· 按事件（03/06/07/09/13/17/19/20）· 按服务（05/11/12/14/25）· 按数据（08）。


`docs/architecture.md` 的表（21 条）是最权威的定位指南。摘录关键几条：

| 目标 | 机制 |
|---|---|
| 加模型提供方 | 在 `ctx.llm` 注册适配器 |
| 加模型可见能力 | 在 `ctx.tools` 注册；其 schema 自动进 prompt 组装 |
| **给一个会话不同的能力集** | **组一个 agent preset；那里的 service 行需要 `isolate` realm** |
| 加 shell 执行 | 注册 `ctx.shell` 后端；本地那个通过 `ctx.subprocess` spawn |
| 加持久终端执行 | 注册 `ctx.terminals` 后端 + `dsh-tool-terminal` |
| 加人类命令 | 在 `ctx.commands` 注册；**不经模型 turn** 派发 |
| 加后台工作 | 在 `ctx.jobs` 注册；`job_*` 工具收集或停止 |
| 加文件系统访问或策略 | 注册 `ctx.fs` provider 或监听 `fs/*` |
| 限制 spawn 的进程 | 用 `ctx.sandbox` 后端；consumer 在 spawn 前包裹 argv |
| 拦截请求/工具/turn | 用对应的 `agent/*` 或 `tools/*` 事件 |
| 加模型可见上下文 | 调 `agent.inject()`；落在下一个被采纳的请求里 |
| 加 UI 或编辑器集成 | 驱动 `ctx.agents`，从 `session/event` 渲染 |
| 加 Web Chat 节点 | 注册 `ConversationNodeDefinition` + keyed renderer |
| 加持久会话状态 | 扩展 `SessionEventMap`；从日志渲染与回放 |
| 生成会话标题 | 注册**唯一**的 `ctx.sessionTitle` provider |
| 管理同会话目标 | 用 `ctx.goals`；通过 `agent/*` 继续 |
| fork 活会话 | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| **把注册限定到一个 agent** | **用那个 agent 的 `agent.ctx`** |

## 3.10 `preset` 组：能力集的打包

`packages/preset/`（3794 行）：

| 包 | 作用 |
|---|---|
| `agent-presets` | agent 预设（能力集组合） |
| `persona` | 人格（对应 `PERSONA_SECTION`，[07 § 7.20](07-request-pipeline-llm-tools-and-prompts.md)） |

💡 **agent preset 是"给一个会话不同能力集"的载体**。它本质上是一段 cordis 配置（含 group 行 + `isolate` 声明），[05 § 5.6](05-startup-and-cordis-runtime.md) 提到的"workspace 外的 agent preset 无法按名字解析 group 包"就是这个场景。

---

**上一篇** ← [02 代码结构地图](02-codebase-map.md) ｜ **下一篇** → [04 扩展与生态](04-extensions-and-ecosystem.md)：Skill / hooks 桥接 / `tool-cordis` / MCP·ACP / Python SDK。

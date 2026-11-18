---
title: "能力缝 Seam 与服务全景"
---
# 能力缝 Seam 与服务全景

> **本篇回答**：DSH 最重要的架构概念——seam（能力接缝）的三角色模型、`core/scope` 的两级隔离机制、以及"换一个 provider 改变整个产品"是怎么实现的。
> **路径缩写**：`P/` = `packages/`，`SC/` = `packages/core/scope/src/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：3.1–3.2 三角色定义与 provider 替换 → 3.3–3.4 `ssh` 与 `subagent` 两个极端例子 → 3.5–3.7 两级隔离、`core/scope` API 与 capability 事件 → 3.8–3.10 seam 全表、"新行为放哪"与 `preset`。
>
> 📎 **来源**：本篇对应初版第 10 篇；仅调整篇号与章节号，主题内容保持为 seam 与服务全景。

## 3.1 seam 的三角色定义

> 📐 **配套可跑示例**：[M03 推理服务接入](../../dsh-lab/examples/dsh-llm-adapter-demo/README.md) 是三角色模型的实例 ——
> Definition 是真实包 `@deepseek-ai/dsh-llm` 导出的抽象类 `LlmAdapter`，Provider 是配套工程里**唯一自写**的
> `src/plugins/anthropic-compat/index.ts`（`AnthropicCompatAdapter`），Consumer 是 agent-loop；
> `npm run example:dsh-llm-adapter-demo` 用同一个循环消费 `anthropic-compat` 路由，验证"换 provider 不换 Consumer"。
>
> ```ts
> export default class AnthropicCompatAdapter extends LlmAdapter {   // ← Provider
>   async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { /* … */ }
> }
> ctx.llm.registerAdapter(['anthropic-compat'], new CountingAnthropicCompatAdapter(real))
> ```


`docs/architecture.md` 的原文：

> A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but **one role alone is not a seam**; adding a capability means designing all three ([capability graph](../../sources/deepseek-harness/docs/capability-seams.md)).

上游把整张能力图做成了生成文档：`docs/capability-seams.md`（由 `scripts/gen-doc-graphs.ts` 生成）逐个 `ctx` 键列出角色、owner、实现与直接消费方——§ 3.8 的全表就按它整理。

![一个 seam 等于三个角色](diagrams/03-seam-roles.svg)

**一个 seam 等于三个角色** — [交互版](diagrams/03-seam-roles.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-seam-roles.architecture.json)

- **三者的依赖方向**：Provider 与 Consumer 都只依赖 Definition · 两者之间不互相 import · 因此换 Provider 不影响任何 Consumer
- **Definition 里放什么**：接口方法签名 · capability 事件的类型定义 · 不放任何具体实现或平台判断
- **为什么强制三角色**：少了 Definition 就无法替换实现 · 少了多个 Provider 就证明不了可替换 · 少了 Consumer 则能力对模型不可见

💡 **注意行数分布**：`fs` 定义包只有 640 行，而直接消费 `ctx.fs` 的两个工具——`tool-fs`（2442 行）与 `tool-str-replace-editor`（537 行）——加起来 2979 行，`fs-local` 1399 行。**定义包薄、实现与消费厚**是 seam 设计成功的标志——接口稳定，两侧独立演进。第三个工具 `tool-fs-search`（1546 行）反而**不走 `ctx.fs`**：它用打包的 ripgrep 二进制走 `ctx.subprocess`，源码头注明说 "Spawn-backed, not a `ctx.fs` provider method"。

## 3.2 为什么"换一个 provider 改变整个产品"

`docs/architecture.md`：

> Seams are why one provider swap changes the whole product. Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, **with no provider forks**.

![换两个 provider 就换掉整个执行世界](diagrams/03-two-worlds.svg)

**换两个 provider 就换掉整个执行世界** — [交互版](diagrams/03-two-worlds.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-two-worlds.architecture.json)

- **本地与远端只差两个 provider**：fs 与 subprocess 是最底层的两个 seam · 上层 Bash、PTY、LSP 只依赖这两个接口 · 指向远端时它们整体跟过去，代码零改动
- **rc.3 的 ssh 远端换了三个 provider**：fs-ssh / subprocess-ssh / sandbox-ssh 骑在同一条 `ctx.ssh` 连接上（§ 3.3）· 连沙箱也一起搬到了远端
- **沙箱是第三个世界**：fs-sandbox 与沙箱化的 bash / 终端共享 `ctx.sandboxPolicy` · 三个世界的上层完全一致 · 切换只在配置层发生

💡 **"no provider forks"是关键收益**。传统做法是给远端场景写一套 `RemoteBashTool`；DSH 只换 `ctx.subprocess` 的 provider，`tool-bash` 一行不改。§ 3.3 的 ssh 组就是这个论证的现行例证。

💡 **`fs-sandbox` 只有 257 行**——它不是重新实现文件系统，而是**在 `fs-local` 基础上加沙箱约束**（大概是路径校验 + 委托）。同理 `bash-sandbox`（206）比 `bash-local`（404）还小。

## 3.3 `ssh` 组：一个完整的远端执行世界

0.1.5 时代的这个位置是 `e2b` 组；rc.3 把它整个删掉（`packages/e2b`、`fs-e2b`、`subprocess-e2b`、`e2b-e2e.yml` 全没了），由 `packages/ssh/` 接棒——远端执行世界不再依赖第三方沙箱平台，而是一条**自管的 OpenSSH 连接**。

`packages/ssh/`（src 合计 2052 行）五个包：

| 包 | src 行数 | 角色 |
|---|---|---|
| `ssh` | 1509 | `ctx.ssh`：共享 OpenSSH 连接、helper 身份与传输生命周期 |
| `fs-ssh` | 126 | `ctx.fs` provider（远端文件读写与受管原子变更） |
| `subprocess-ssh` | 345 | `ctx.subprocess` provider（远端进程、控制流与终端） |
| `sandbox-ssh` | 33 | `ctx.sandbox` provider（远端文件效果约束与执法事实） |
| `ssh-helper-runtime` | 39 | 私有 helper 可执行文件的载体（SEA 派发器，打包时内嵌 Node 与 PTC worker） |

💡 **现在要三个 provider 才搬走整个执行世界**——fs、subprocess 之外，**连沙箱也换到了远端**（`sandbox-ssh`）。这比 e2b 时代更进一步：三个 provider 全部骑在同一条 `ctx.ssh` 连接上（capability 图：`ctx.ssh` 的直接消费方恰好是这三个包），印证并强化了 § 3.2 的说法。

💡 **helper 是独立编译的产物**。helper 的 POSIX 端实现在 `ssh` 包里（`src/helper.ts` 289 行的 `runSshHelper`，导出面 `./helper`），由 `ssh-helper-runtime` 打包成单文件可执行程序——它的 `src/index.ts` 是 SEA 派发器，在打包环境里选择 helper 或内嵌的 worker 入口。`scripts/ssh-helper/`（artifact / native / probe / release）是构建与校验工具：`build-exe-for-ssh-helper.ts` + `.github/workflows/build-exe-for-ssh-helper.yml` 负责构建，`publish-ssh-helper.yml` 发布，`verify-ssh-helper-artifact.ts` / `verify-ssh-helper-ssh.ts` 验证。上游文档在 `docs/subsystems/ssh.md`。

## 3.4 `subagent`：seam 的极端例子

`docs/architecture.md`：

> Subagent providers（上游 `docs/subsystems/subagent.md`）vary just as widely behind one interface, from a fresh child agent to a delegated turn in another product.

`packages/subagent/`（src 合计 9900 行）**9 个包**——比 0.1.5 少了两个：`subagent-in-process-driver` 与 `tool-subagent-report` 都删除了：

| 包 | src 行数 | 角色 |
|---|---|---|
| **`subagent`** | **4955** | Service Definition（`ctx.subagents`：provider 与 continuation 服务） |
| `subagent-codex` | 1280 | 委派给 Codex |
| `subagent-claude-code` | 893 | 委派给 Claude Code |
| `subagent-acp` | 747 | 通过 ACP 协议委派 |
| `subagent-dsh-sdk` | 561 | 通过 DSH SDK 调另一个 dsh |
| `subagent-fork-in-process` | 83 | fork 当前会话 |
| `subagent-spawn-in-process` | 59 | 进程内新开一个 agent |
| `tool-subagent` | 949 | Consumer（创建 + 回报） |
| `tool-subagent-control` | 373 | Consumer（查状态与取消） |

![subagent 的六种 provider](diagrams/03-subagent-providers.svg)

**subagent 的六种 provider** — [交互版](diagrams/03-subagent-providers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-subagent-providers.architecture.json)

- **差异最大的一组 provider**：从进程内 fork / spawn（各 <100 行）到外部三大家族（claude-code 893 / codex 1280 / acp 747）再到 dsh-sdk（561）都在同一接口下 · fork-in-process 复用当前会话状态 · claude-code 与 codex 则是完全外部的进程
- **Consumer 只剩两个组内工具**：tool-subagent 负责创建（tool-subagent-report 已删除，回报并入激活结果与 continuation） · tool-subagent-control 负责查状态与取消 · experimental 的 tool-ralph 也消费这条 seam
- **选型在配置层**：provider 由 profile 或 bundle 决定 · 模型不感知背后是哪种实现 · 这让同一套提示词能跨后端复用

💡 **experimental 另有一条 `subagent-oar` / `tool-subagent-oar` 线**（406 + 108 行），不在组内。rc.3 还在 `packages/team/` 新增了 **Agent Team**（`ctx.agentTeams`，见 § 3.8）：持久共享任务板 + compare-and-set 任务所有权，是 subagent 之上的多代理协作层（`docs/subsystems/agent-team.md`）。

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
| `linkScopeParent(...)` | 54 | 内部（不再导出） |
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

（0.1.5 快照里这里还有一份脚本生成的 `scoped-events.generated.ts`（49 行）；rc.3 已把它随 `invariant.ts` 约定一起删除，scope 包只剩 `index.ts` + `store.ts` 两个文件。）

## 3.7 capability 事件：给接缝挂策略

`docs/architecture.md` 的第三类事件域：

> **Capability events** attach policy and adapters to a seam (`fs/*`, `tools/*`, `telemetry/*`) without importing the loop.

![capability 事件让策略与主循环解耦](diagrams/03-capability-events.svg)

**capability 事件让策略与主循环解耦** — [交互版](diagrams/03-capability-events.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-capability-events.architecture.json)

- **不 import 主循环是关键约束**：策略包不依赖 agent-loop · 也不依赖任何具体 provider · 它只认 Definition 声明的事件类型
- **带来的两个自由度**：换 provider 时策略照旧生效 · 换主循环时策略也照旧生效 · 策略因此可以独立发布与复用
- **事件是能力的公共面**：Definition 同时声明接口与事件 · 事件属于契约的一部分，不是实现细节 · 这让观测与准入都能做成独立包

全仓的 `*-policy` 包（`find packages -maxdepth 2 -type d -name '*policy*'` 实测 5 个）：

| 包 | 组 | 行数 | 挂在哪个 seam |
|---|---|---|---|
| `sandbox-policy` | sandbox | 328 | `ctx.sandboxPolicy`（沙箱模式的唯一权威） |
| `fs-observation-policy` | fs | 170 | `fs/*` 事件（capability 图标注为 companion plugin） |
| `spill-policy` | spill | 346 | `ctx.spillStore`（消费 `tools/post-execute` 决定何时溢写） |
| `session-checkpoint-policy` | session | 83 | 会话落盘时机 |
| `timeout-policy` | guard | 81 | `tools/execute`（[07 § 7.11](07-request-pipeline-llm-tools-and-prompts.md)） |

💡 **rc.3 的 policy 比 0.1.5 更"服务化"了**：`sandbox-policy` 从"`ctx.sandbox` 上的一个策略包"升格为独立服务 `ctx.sandboxPolicy` 的 owner——`bash-sandbox`、`fs-sandbox`、`terminal-bash` 都读它，"bash 与 fs 不能圈到不同的根"由这一处保证。`spill-policy`（346 行）也比定义包 `spill`（138 行）大——策略比接口厚，正是 capability 事件设计的本意。

## 3.8 全部 seam 一览

> 📐 **配套可跑示例**：下面这张表里的每个 seam 都有**真实发布包**提供的 provider，配套工程把它们装配起来就能跑 ——
> `ctx.llm` → [M03 · 自写 anthropic-compat](../../dsh-lab/examples/dsh-llm-adapter-demo/src/plugins/anthropic-compat/index.ts)、`ctx.fs` / `ctx.subprocess` → [M07.1](../../dsh-lab/examples/dsh-sandbox-demo/src/index.ts)、
> `ctx.shell` → [M07.2](../../dsh-lab/examples/dsh-sandbox-demo/src/index.ts)、`ctx.sandbox` → [M07.3](../../dsh-lab/examples/dsh-sandbox-demo/src/index.ts)、
> `ctx.compaction` → [M02.3](../../dsh-lab/examples/dsh-context-demo/src/index.ts)、`ctx.subagents` → [M08.1](../../dsh-lab/examples/dsh-subagent-demo/src/index.ts)、
> `ctx.jobs` → [M09.1 · 后台任务与输出环](../../dsh-lab/examples/dsh-jobs-demo/src/index.ts)、`ctx.goals` → [M09.2 · 目标生命周期](../../dsh-lab/examples/dsh-jobs-demo/src/index.ts)、
> `ctx.storage` → [M11.1 · 存储域与 schema 校验](../../dsh-lab/examples/dsh-storage-demo/src/index.ts)、`ctx.approval` → [M06.2 · 三种审批结果](../../dsh-lab/examples/dsh-hitl-demo/src/index.ts)。
>
> ⚠️ 两点与旧版示例不同：**其一**，配套工程不再"刻意留空再自己补 provider"——压缩、沙箱、溢写都直接用官方包（`dsh-compaction-basic`、`dsh-sandbox-local`、`dsh-spill-local`），自写的只剩 M03 那一个 provider 与安全护栏插件；**其二**，`ctx.settings` 在配套工程里**没有挂载**（`dsh-settings` 不在 `cordis.patch.yml` 的 89 条行里），所以它没有可跑对照。


按 `ctx` 键整理（以生成的 `docs/capability-seams.md` 为主，对照 `docs/architecture.md` 与包结构）。相比 0.1.5：`fs-e2b`/`subprocess-e2b` 换成 `*-ssh`，`settings-file`、`session-persistence-sqlite` 删除，新增一整批 seam（`ctx.ptcRuntime`、`ctx.ssh`、`ctx.agentTeams`、`ctx.web`、`ctx.officeKit`、`ctx.browserUse`/`ctx.computerUse` 等）：

| `ctx` 键 | 定义包 | Provider | Consumer（`tool-*`） |
|---|---|---|---|
| `ctx.llm` | `llm/llm` | `llm-deepseek`、`llm-pi-ai`（test-support 另有 `llm-replay`） | agent-loop、compaction-basic |
| `ctx.fs` | `fs/fs` | `fs-local`、`fs-sandbox`、`fs-ssh` | `tool-fs`、`tool-str-replace-editor` |
| `ctx.subprocess` | `subprocess/subprocess` | `subprocess-local`、`subprocess-ssh` | bash-local、bash-sandbox、terminal-bash、lsp-stdio、subagent-acp/codex/claude-code |
| `ctx.shell` | `shell/shell` | `bash-local`、`bash-sandbox`、`pwsh-local`、`pwsh-sandbox` | `tool-bash`、`tool-pwsh`、hooks 两个桥接器 |
| `ctx.terminals` | `terminal/terminal` | `terminal-bash`（experimental 另有 terminal-panel） | `tool-terminal`（已迁 experimental） |
| **`ctx.ssh`**（新） | `ssh/ssh` | —（core：连接本身） | fs-ssh、subprocess-ssh、sandbox-ssh |
| `ctx.sandbox` | `sandbox/sandbox` | `sandbox-local`、`sandbox-ssh` | （consumer 在 spawn 前包裹 argv） |
| `ctx.lsp` | `lsp/lsp` | `lsp-stdio` | `tool-lsp` |
| **`ctx.ptcRuntime`**（新） | `ptc-runtime/ptc-runtime` | `ptc-runtime-node`（experimental 另有 ptc-runtime-python） | tool-executor-ptc、workflow-ptc |
| `ctx.storage` | `storage/storage` | `storage-json`、`storage-sqlite` | storage-domain（→ `ctx.storageDomain`） |
| `ctx.jobs` | `jobs/jobs` | `jobs-local` | `tool-jobs`、tool-bash/pwsh/terminal |
| `ctx.credentials` | `credentials/credentials` | `credentials-local`（同组另有 `ctx.deepseekAccount`、`ctx.authorization`） | llm-deepseek、llm-pi-ai |
| `ctx.settings` | `settings/settings` | —（**settings-file 已删除**） | api-settings-controller |
| `ctx.spillStore` | `spill/spill` | `spill-local` | `spill-policy` |
| `ctx.skills` | `skill/skill` | `skill-filesystem`、`skill-office`（experimental 另有 skill-badge） | `tool-skill` |
| `ctx.goals` | `goal/goal` | —（goal-round-driver 是续跑驱动） | `tool-goal`、command-goal |
| `ctx.commands` | `interaction/commands` | — | `command-*` |
| `ctx.agents` | `core/agent` | — | — |
| `ctx.agentLoop` | `core/agent-loop` | — | — |
| `ctx.tools` | `core/tools` | —（执行器拆为 tool-executor-native / -ptc） | 全部 `tool-*` |
| `ctx.sessions` | `core/session` | —（持久化挪到 `ctx.sessionPersistence`） | — |
| **`ctx.sessionPersistence`**（新） | `session/session-persistence` | session-persistence-jsonl（**sqlite 已删除**） | agent-loop、session-query 等 |
| **`ctx.sessionQuery`**（新） | `session-query/session-query` | session-query-sqlite | session-reference、tool-session-query（experimental） |
| `ctx.systemPrompt` | `core/system-prompt` | — | — |
| `ctx.sessionTitle` | `session/session-title` | 组内 1 个（first-prompt-llm；`session-title-llm` 只是共享的生成策略库），experimental 另 1 个（all-prompts-llm）——同一时刻只允许**唯一一个** | — |
| `ctx.attachments` | `attachment/attachment` | `attachment-local` | `tool-fs`、llm-deepseek/pi-ai |
| `ctx.workspaceRegistry` | `workspace/workspace` | — | api-*-controller |
| `ctx.subagents` | `subagent/subagent` | 6 种（§ 3.4） | `tool-subagent`、`tool-subagent-control`（experimental tool-ralph） |
| `ctx.compaction` | `compaction/compaction` | `compaction-basic`（同组 compaction-tool-result-pruner、compaction-image-offload 各管一面） | —（无模型侧 compact 工具，仅 command-compact） |
| **`ctx.agentTeams`**（新） | `team/agent-team` | — | `tool-agent-team` |
| **`ctx.officeKit`**（新） | `document/office-kit` | — | `tool-office` |
| **`ctx.web`**（新） | `web/web` | `web-search-deepseek`、`web-deepseek-api`、`web-fetch-http` | `tool-web` |
| **`ctx.browserUse` / `ctx.computerUse`**（新） | `browser-use` / `computer-use` | 各自 experimental 驱动（playwright-mcp / chrome-devtools-mcp / stagehand-native；cua-driver-mcp / cua-driver-native） | provider 自带工具（**一次只允许一个 provider**） |
| **`ctx.sessionTelemetry`**（新） | `session/session-telemetry` | `session-telemetry-otel` | —（输出离开进程） |
| **`ctx.webhookRuntime`**（新） | `experimental/webhook` | `webhook-github` | —（把 webhook 投递变成普通 Session） |

💡 **`sandbox` 的 consumer 模式不同**：`docs/architecture.md` 说 "use a `ctx.sandbox` backend; **consumers wrap argv before spawning**"——沙箱不是拦截器，而是**由调用方主动包裹命令行**。这是刻意的：让"是否沙箱化"在调用点显式可见。

💡 **`sandbox-windows-acl` 有 2194 行**，是 sandbox 组最大的包（比 `sandbox-local` 686 行大 3.2 倍；定义包从 452 涨到 759 行）。Windows 的 ACL 模型比 Unix 复杂得多——它甚至还给 `ctx.skills` 注册了一个 provider（`src/acl-skill.ts:74`）。

💡 **`ctx.ptcRuntime` 是 0.1.5"Code Mode"的正式化**。`packages/ptc-runtime/ptc-runtime/src/index.ts:1` 的头注自称 "Service Definition for the PTC execution capability seam that runs one model-written program against host async bindings"——模型写代码调工具从 tools 包里的一坨实现（`code-mode.ts` 等）升格为独立 seam：定义在 `ptc-runtime`，Node 后端在 `ptc-runtime-node`，消费方是 `tool-executor-ptc`（`run_code` 工具）与 `workflow-ptc`（流程引擎，见 [09 § 9.22](09-host-runtime-and-storage.md)）。

### seam 的第四种形态：插件本身成为被管理对象

前三节看到的 seam 交易的都是**能力**（接口 + 实现 + 工具）。rc.3 把第四种东西也做成了服务：**插件生态自身**。`packages/boot/plugin-manager`（3877 行，`ctx.pluginManager`）管理当前 profile 的插件与 bundle 安装（CLI 的 `dsh plugin` 子命令，`apps/cli/src/args.ts:188`）；`packages/boot/plugin-market`（1858 行，`ctx.pluginMarket`）读校验用户配置的市场索引；`packages/util/plugin-market-index`（445 行）定义索引格式，`apps/plugin-market-generator`（1453 行）生成官方索引。模型侧有 `tool-plugin-manager`，前端有 `ui-plugin-manager` / `ui-plugin-market`。

💡 这解释了 `dsh-base` patch 的头两行插件行（`base/cordis.patch.yml:16-22`）：`tool-plugin-manager` 与 `plugin-manager` 都进了 base——**插件管理是 base 的一部分，不是可选附件**（`docs/architecture.md:29`："Base includes Plugin Manager for Web and agents"）。详见 [04 § 4.5](04-extensions-and-ecosystem.md)。

## 3.9 "新行为放哪"：官方映射表

> 📐 **配套可跑示例**：[配套工程的能力索引](../../dsh-lab/README.md) 就是按同一套"四条扩展路径"组织的 ——
> 按注册（M01 工具 · M02 提示 · M06 命令 · M08 预设 · M09 任务 · M11 配置）·
> 按事件（M01 管线 · M04 生命周期 · M05 投影 · M06 反馈 · M12 dispatch）·
> 按服务（M02 · M03 · M05 · M07 · M08 · M09 · M10 · M11）·
> 按数据（M10：`SKILL.md` 是能力数据包，注册、发现、渲染与注入彼此分离）。


`docs/architecture.md` 的表（20 条）是最权威的定位指南。摘录关键几条（其中 webhook 启动、持久化后端两行是 rc.3 新增；fork 一行的机制也换了）：

| 目标 | 机制 |
|---|---|
| 加模型提供方 | 在 `ctx.llm` 注册适配器 |
| 加模型可见能力 | 在 `ctx.tools` 注册；其 schema 自动进 prompt 组装 |
| **给一个会话不同的能力集** | **组一个 agent preset；那里的 service 行需要 `isolate` realm** |
| 加 shell 执行 | 注册 `ctx.shell` 后端；本地那个通过 `ctx.subprocess` spawn |
| 加持久终端执行 | 注册 `ctx.terminals` 后端 + `dsh-tool-terminal` |
| 加人类命令 | 在 `ctx.commands` 注册；**不经模型 turn** 派发 |
| 加后台工作 | 在 `ctx.jobs` 注册；`job_*` 工具读取或停止 |
| **从外部 webhook 启动会话**（新） | 在 `ctx.webhookRuntime` 注册可信规则并挂 provider 适配器 |
| 加文件系统访问或策略 | 注册 `ctx.fs` provider 或监听 `fs/*` |
| 限制 spawn 的进程 | 用 `ctx.sandbox` 后端；consumer 在 spawn 前包裹 argv |
| 拦截请求/工具/turn | 用对应的 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 能当场停掉一个 turn |
| 加模型可见上下文 | 调 `agent.inject()`；落在下一个被采纳的请求里 |
| 加 UI 或编辑器集成 | 驱动 `ctx.agents`，从 `session/event` 渲染 |
| 加 Web Chat 节点 | 注册 `ConversationNodeDefinition` + keyed renderer |
| 加持久会话状态 | 扩展 `SessionEventMap`；从日志渲染与回放 |
| **换会话存储后端**（新） | 实现 `SessionPersistence`（`create`/`open`/`stat`/`list`/`export`） |
| 生成会话标题 | 注册**唯一**的 `ctx.sessionTitle` provider |
| 管理同会话目标 | 用 `ctx.goals`；通过 `agent/*` 继续 |
| fork 活会话 | `ctx.agents.create({ sessionId, seed, inheritedEventCount, meta: { isSeeded: true } })`——只有 agent-loop 发布的会话会持久化 |
| **把注册限定到一个 agent** | **用那个 agent 的 `agent.ctx`** |

## 3.10 `preset` 组：能力集的打包

`packages/preset/`（src 合计 1187 行，比 0.1.5 的 3794 行瘦身——`agent-presets` 拆成了两个包）：

| 包 | src 行数 | 作用 |
|---|---|---|
| `agent-preset` | 30 | 声明式 preset 行：一个普通 cordis 插件，把配置注册进 `ctx.agentPresets` |
| `agent-preset-registry` | 1082 | `ctx.agentPresets` 的 owner：装载 YAML 声明的 preset 修订、绑定 agent 与冷读者、保留退役修订 |
| `persona` | 75 | 人格（对应 `PERSONA_SECTION`，[07 § 7.20](07-request-pipeline-llm-tools-and-prompts.md)） |

💡 **agent preset 是"给一个会话不同能力集"的载体**。rc.3 把它做成了带修订管理的正式机制：`agent-preset`（30 行）本身只是一个声明式插件——激活时把 `{ id, plugins }` 交给 registry，其余全在 `agent-preset-registry`。它本质上是一段 cordis 配置（含 group 行 + `isolate` 声明），[05 § 5.6](05-startup-and-cordis-runtime.md) 提到的"workspace 外的 agent preset 无法按名字解析 group 包"就是这个场景。

---

**上一篇** ← [02 代码结构地图](02-codebase-map.md) ｜ **下一篇** → [04 扩展与生态](04-extensions-and-ecosystem.md)：Skill / hooks 桥接 / `tool-cordis` / MCP·ACP / Python SDK。

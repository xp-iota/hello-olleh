---
title: "执行侧服务：文件、Shell、沙箱、子代理、压缩"
---
# 执行侧服务：文件、Shell、沙箱、子代理、压缩

> **本篇回答**：agent 真正"动手"的那几个 seam 各自的契约。按危险程度递增排开：`ctx.fs`（13 个抽象方法、三个 `fs/*` 意图事件、版本化乐观并发）→ `ctx.subprocess` / `ctx.shell` / `ctx.terminals` 三层分工 → `ctx.sandbox` 与审批链（`confine` 的三条不可违反规则、Landlock、fail-closed 全景）→ `ctx.subagents`（六种驱动、发起者追踪）→ `ctx.compaction`（三个入口、`surfaceOp: replace` 怎么做到不丢日志）。
> **路径缩写**：`P/` = `packages/`，`F/` = `packages/fs/fs/src/`，`SH/` = `packages/shell/shell/src/`，`SP/` = `packages/subprocess/subprocess/src/`，`TM/` = `packages/terminal/terminal/src/`，`SB/` = `packages/sandbox/sandbox/src/`，`AG/` = `packages/core/agent/src/`，`CP/` = `packages/compaction/compaction/src/`。行号对应快照 `fb2c4b9e`。
>
> 🧭 **本篇导览**：8.1–8.9 文件系统 → 8.10–8.16 子进程与 Shell → 8.17–8.25 沙箱、审批与防护 → 8.26–8.32 子代理 → 8.33–8.39 上下文压缩。
>

## 8.1 `fs` 组的 7 个包

| 包 | 行数 | 角色 |
|---|---|---|
| `tool-fs-search` | 1574 | Consumer（搜索） |
| `tool-fs` | 1463 | Consumer（读/写/列目录） |
| `fs-local` | 1210 | Provider（本地） |
| `tool-str-replace-editor` | 553 | Consumer（**字符串替换编辑器**） |
| **`fs`** | **503** | **Service Definition** |
| `fs-sandbox` | 254 | Provider（沙箱内） |
| `fs-observation-policy` | 189 | Policy（监听 `fs/observed`） |

另有 `e2b` 组的 `fs-e2b`（远端 provider）。

💡 **定义包 503 行，三个 consumer 3590 行**。这是健康的 seam 比例（[03 § 3.1](03-capability-seams-and-services.md)）。

## 8.2 `FileSystem` 抽象类：13 个抽象方法

> 📐 **配套可跑示例**：[`M07.1 · fs-shell-side-effects`](../../dsh-example/M07-execution-backends/impl/01-fs-shell-side-effects.ts) 的 `write_note` 工具只用
> `resolve` → `writeText` → `processPath` 三个口，就在真实 `LocalFileSystem`（`@deepseek-ai/dsh-fs-local`）上落了盘。


`F/index.ts:86`（`extends Service`）。**全部是 abstract**，没有默认实现——与 `LlmAdapter`（只有 1 个必需，[07 § 7.2](07-request-pipeline-llm-tools-and-prompts.md)）形成鲜明对比。

![ctx.fs 的路径解析四方法](diagrams/08-fs-path-api.svg)

**ctx.fs 的路径解析四方法** — [交互版](diagrams/08-fs-path-api.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-fs-path-api.architecture.json)

- **为什么不直接用字符串**：target 是受控对象，携带 provider 侧的内部表示 · 远端 provider 的真实路径与本地写法不同 · 于是路径转换必须显式经过接口
- **processPath 的用途**：把 target 转成能交给子进程的字符串 · 沙箱或容器里的路径可能被重映射 · shell 与 subprocess 都依赖它
- **contains 是安全原语**：沙箱 provider 用它做路径边界校验 · 避免通过相对路径逃出允许目录 · 判定由 provider 实现，不在调用方

💡 **`resolve()` 是唯一的入口**：其余方法（除 `lstat`）都收 `FsTarget` 而不是字符串。这让**路径校验只发生一次**，后续操作拿到的是已验证的句柄。沙箱 provider 在 `resolve` 里就能拒绝越界路径。

💡 **`readBytes` 的 `maxBytes` 是必需参数**（`:199`，注意签名里 `signal` 在前且可为 undefined，`maxBytes` 在后且必需）。这是刻意的 API 设计：**强迫调用方思考大小上限**，防止读入超大文件耗尽内存。

💡 **`processPath` 与 `fileUrl` 分开**是因为远端 provider（`fs-e2b`）里"给子进程的路径"与"本机 URL"完全不同。

💡 **`lstat` 收字符串而非 target**（`:168`）：因为 `lstat` 要检查的可能是**尚未通过 resolve 校验的路径**（如符号链接目标），不能要求先 resolve。

## 8.3 三个 `fs/*` 事件

`F/index.ts:44-77`（在 `declare module '@deepseek-ai/cordis'` 里）：

![fs 的两个意图事件与一个观察事件](diagrams/08-fs-events.svg)

**fs 的两个意图事件与一个观察事件** — [交互版](diagrams/08-fs-events.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-fs-events.architecture.json)

- **意图与观察的区别**：意图事件是 waterfall，可以拒绝或改写 · 观察事件是 emit，只用于通知 · 因此准入逻辑只能挂在意图事件上
- **版本贯穿三个事件**：观察时记录读到的版本 · 写与编辑时带上期望的版本 · 不匹配即判定为并发冲突
- **策略包不依赖 provider**：fs-observation-policy 只监听这三个事件 · 换 provider 后策略照旧生效 · 见 03 篇的 capability 事件一节

💡 **"意图"事件返回 `undefined` 的语义**：两个 intent 事件的返回类型都是 `X | undefined`。返回 `undefined` 大概表示"没有版本期望"（不做乐观并发检查），返回具体值则表示"要求文件当前版本必须是这个"。

## 8.4 版本化：`FsVersion` 与乐观并发

`F/types.ts` 的核心类型：

![乐观并发控制的版本模型](diagrams/08-fs-version.svg)

**乐观并发控制的版本模型** — [交互版](diagrams/08-fs-version.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-fs-version.architecture.json)

- **为什么把 absent 建模成状态**：「文件不存在」也需要参与版本比较 · 创建文件时期望的正是 absent · 否则无法区分创建与覆盖
- **不做静默覆盖**：版本不匹配一律拒绝写入 · 由调用方重读后决定如何合并 · 这是 fail-closed 在文件层的体现
- **版本实现可换**：内容哈希更准确但成本高 · 时间与大小组合更快但可能漏判 · provider 自行选择实现方式

`F/types.ts`（203 行）的其余类型：

| 类型 | 行号 | 说明 |
|---|---|---|
| `FsTarget` | 60 | 已解析的目标句柄 |
| `FsInfo` | 76 | `stat` 的结果 |
| `FsPathInfo` | 91 | `lstat` 的结果 |
| `FsDirEntry` | 104 | 目录项 |
| `FsWriteOutcome` | 128 | 写入结果 |
| `FsEditRequest` | 147 | 编辑请求 |
| `FsEditOutcome` | 157 | 编辑结果 |

💡 **`FsInfo` 与 `FsPathInfo` 分开**对应 `stat` 与 `lstat` 的语义差异（跟随符号链接 vs 不跟随）。

## 8.5 三个 provider

![fs 的三个 provider](diagrams/08-fs-providers.svg)

**fs 的三个 provider** — [交互版](diagrams/08-fs-providers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-fs-providers.architecture.json)

- **sandbox 是装饰器**：254 行说明它不做实际 IO · 只在 resolve 阶段加边界校验 · 其余方法透传给被装饰的 provider
- **e2b 只做映射**：13 个方法逐个对应远端 API · 关键差异在 processPath 返回容器内路径 · 于是子进程拿到的是容器视角的路径
- **三者对上层完全一致**：工具代码不感知在哪个 provider 上运行 · 切换只在配置层发生 · 这是 seam 的核心收益

## 8.6 三个编辑工具的分工

![三个编辑工具的分工](diagrams/08-fs-tools.svg)

**三个编辑工具的分工** — [交互版](diagrams/08-fs-tools.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-fs-tools.architecture.json)

- **为什么搜索最大**：需要遍历目录树并做匹配 · 还要处理结果截断与相关性排序 · 比单纯读写复杂得多
- **替换式编辑的好处**：模型不必输出整个文件内容 · 减少 token 消耗与出错概率 · 但要求旧串在文件中唯一
- **三者共享同一 seam**：都只依赖 ctx.fs 接口 · 因此在沙箱与远端环境下同样可用 · 版本校验由 Definition 层统一施加

💡 **`editText` 与 `writeText` 是两个不同的抽象方法**（`:243` vs `:222`），返回不同的 outcome 类型（`FsEditOutcome` vs `FsWriteOutcome`）。provider 可以对"精确编辑"做优化（只改动部分内容）而非全量重写。

## 8.7 `attachment` 组：文件作为附件

`packages/attachment/`（909 行）：`attachment` + `attachment-local`。

💡 **与 `fs` 的区别**：`fs` 是"agent 操作工作区文件"；`attachment` 是"用户上传/引用的文件"。前者受沙箱约束，后者是会话资源。前端有 `ui-attachment` 子包。

## 8.8 `workspace` 组

`packages/workspace/workspace`（2147 行）。

💡 **`ctx.workspace` 大概管"工作区根目录、项目边界"**。它与 `fs` 的分工：`workspace` 定义"哪里是项目"，`fs` 提供"怎么读写"。`web-app` patch 里的 persona 用 `{{cwd}}` 变量（[07 § 7.20](07-request-pipeline-llm-tools-and-prompts.md)）应该来自这里。前端有 `ui-workspace` 与 `ui-directory-picker-*` 子包。

---

> 📎 **以下承接原「12 Shell 终端与子进程」。**
> 本篇讲执行世界的三层：`ctx.subprocess`（最底层进程 spawn）、`ctx.shell`（一次性命令执行）、`ctx.terminals`（持久 PTY 会话）。以及为什么要分三层。
> 路径缩写：`P/` = `packages/`，`SH/` = `packages/shell/shell/src/`，`SP/` = `packages/subprocess/subprocess/src/`，`TM/` = `packages/terminal/terminal/src/`。行号对应快照 `fb2c4b9e`。

## 8.9 三层的分工

![执行侧三层的分工](diagrams/08-exec-three-layers.svg)

**执行侧三层的分工** — [交互版](diagrams/08-exec-three-layers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-exec-three-layers.architecture.json)

- **三层的状态性递增**：subprocess 无状态，一次一个进程 · shell 半状态，负责命令组装与环境 · terminals 全状态，会话可长期存活
- **terminals 按 Agent 归属**：所有方法的第一个参数都是 owner · 一个 agent 不能操作另一个的终端 · subagent 因此有独立的终端集合
- **后端可注册**：registerBackend 允许接入新的 PTY 实现 · terminal-bash 是默认后端 · 返回 disposer，符合 effect 模型

## 8.10 `SubprocessRuntime`：三个抽象方法

`SP/index.ts:102`：

| 方法 | 行号 | 返回 | 说明 |
|---|---|---|---|
| `resolveExecutable(...)` | 118 | — | 解析可执行文件（PATH 查找） |
| **`spawn(spec: SubprocessSpawnSpec)`** | **130** | `SubprocessHandle`（同步返回） | 普通子进程 |
| **`spawnTerminal(spec: SubprocessTerminalSpawnSpec)`** | **139** | `Promise<SubprocessTerminalHandle>` | **PTY 子进程** |

💡 **`spawn` 同步返回句柄，`spawnTerminal` 返回 Promise**。这个差异反映了 PTY 分配需要异步（伪终端设备的申请）。

💡 **`resolveExecutable` 单独一个方法**是因为远端 provider 里"这个命令存不存在"要走网络查询，不能靠本地 PATH。

💡 **`spawnTerminal` 在 subprocess 层而非 terminal 层**——PTY 的创建属于"执行世界"的能力，terminal 层只管会话管理。这样 `subprocess-e2b` 一实现，远端 PTY 就有了。

## 8.11 `ShellExecutor`：三个抽象方法

> 📐 **配套可跑示例**：[`M07.2 · run-and-start`](../../dsh-example/M07-execution-backends/scenes/02-run-and-start.ts) 把三个方法都跑了一遍 ——
> `resolve` 把 999999ms 的请求夹到实现上限（实测 600000）、`run` 对非零退出/超时/取消都 **resolve**、
> `start` 的 `readOutput()` 是消费性增量读。注意 `stdout`/`stderr` 是 `CollectedOutput`（`{ text, truncated }`）而不是裸字符串。


`SH/index.ts:65`。类注释（`:47`）："Abstract bash execution service. Subclass, implement the abstract methods, ..."

| 方法 | 行号 | 返回 | 说明 |
|---|---|---|---|
| **`resolve(request: ShellExecRequest)`** | **85** | `ShellExecSpec`（**同步**） | 把请求变成可执行规格 |
| `run(spec: ShellExecSpec)` | 93 | `Promise<ShellRunResult>` | **跑完拿结果** |
| `start(spec: ShellExecSpec)` | 100 | `ShellProcess`（同步） | **启动并返回进程句柄**（流式） |

![shell 把解析与执行分开](diagrams/08-shell-resolve-run.svg)

**shell 把解析与执行分开** — [交互版](diagrams/08-shell-resolve-run.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-shell-resolve-run.architecture.json)

- **resolve 必须无副作用**：它只做决策，不启动任何进程 · 因此可以被反复调用与检查 · 审批逻辑可以先看 spec 再决定放行
- **两种执行形态**：run 适合短命令，直接拿完整结果 · start 适合长命令，可流式读输出 · 两者共用同一个 spec
- **沙箱在中间插入**：拿到 spec 后可调 sandbox.confine 改写 argv · 改写后再交给 subprocess 执行 · 于是沙箱不需要理解 shell 语法

## 8.12 shell 组的 9 个包

| 包 | 行数 | 角色 |
|---|---|---|
| `tool-pwsh` | 620 | Consumer（PowerShell） |
| `tool-bash` | 554 | Consumer（一次性 bash） |
| `tool-bash-persistent` | 476 | Consumer（**持久 bash**） |
| `pwsh-local` | 472 | Provider |
| `bash-local` | 363 | Provider |
| **`shell`** | **350** | **Definition** |
| `pwsh-sandbox` | 339 | Provider |
| `bash-sandbox` | 328 | Provider |
| `shell-env` | 247 | 环境变量处理 |

![shell 的两个家族与三个消费者](diagrams/08-shell-families.svg)

**shell 的两个家族与三个消费者** — [交互版](diagrams/08-shell-families.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-shell-families.architecture.json)

- **每个家族都有 local 与 sandbox**：local 直接在宿主执行 · sandbox 版先经 confine 改写 argv · 两者对 ctx.shell 的调用方无差别
- **shell-env 单独成包**：环境变量组装逻辑与 shell 实现解耦 · 它负责过滤不应下传的变量 · 详见 § 8.16 的启动变量拦截
- **pwsh 更复杂的原因**：参数转义与引号规则与 bash 差异大 · 还要处理不同 PowerShell 版本 · 因此行数明显更多

💡 **PowerShell 是一等公民**（`pwsh-local` 472 行 > `bash-local` 363 行）。这说明 DSH 认真支持 Windows——配合 `sandbox-windows-acl`（2530 行，[08 篇](08-execution-services.md)）。

## 8.13 `TerminalSessionService`：持久会话

`TM/index.ts:105`（`super(ctx, 'terminals')`，`:116`）。**注意它不是 abstract class** —— 它是具体服务，通过 `registerBackend` 接受后端。

| 方法 | 行号 | 说明 |
|---|---|---|
| **`registerBackend(backend: TerminalBackend)`** | **125** | 注册后端，返回 disposer |
| `listBackends()` | 143 | 列出后端名 |
| **`hasOwnerActivity(owner: Agent)`** | **231** | 某 agent 是否有活动终端 |
| **`startSend(owner, id, request)`** | **243** | 发送输入，返回 `TerminalSendOperation` |
| **`read(owner, id, request = {})`** | **263** | 读输出（同步返回 `TerminalReadResult`） |
| `signal(owner, id, signal)` | 274 | 发信号（如 Ctrl-C） |
| `list(owner)` | 308 | 列出该 owner 的会话快照 |

![terminals 的 owner 归属与操作语义](diagrams/08-terminal-owner.svg)

**terminals 的 owner 归属与操作语义** — [交互版](diagrams/08-terminal-owner.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-terminal-owner.architecture.json)

- **为什么用显式参数**：终端会话是长期存活的资源 · 归属必须可查询、可枚举 · 显式参数比隐式 scope 更易审计
- **startSend 是可观察操作**：返回 operation 而非裸 Promise · 可以查询进度也可以取消 · 适合发送大段输入的场景
- **read 不阻塞**：同步返回已缓冲的输出 · 没有新输出时返回空 · 轮询由调用方决定节奏

💡 **`hasOwnerActivity(owner)`（`:231`）的用途**：在 turn 结束前检查"这个 agent 还有终端在活动吗"。如果有，可能需要延续 turn 或提醒模型（对应 `agent/turn-stopping`，[06 § 6.4](06-agent-loop-and-session-log.md)）。

💡 **`registerBackend` 而非 provider 模式**：终端后端与 `ctx.terminals` 是"多后端共存"的关系（`listBackends()` 返回数组），而 `ctx.fs` 是"单 provider"。**这是 seam 的另一种形态**（[03 § 3.8](03-capability-seams-and-services.md) 提到 `ctx.sessionTitle` 是"唯一 provider"，这里是"多后端"）。

## 8.14 `lsp` 组：建在 subprocess 上

`packages/lsp/`（5496 行）：

| 包 | 角色 |
|---|---|
| `lsp` | Definition（`ctx.lsp`） |
| `lsp-stdio` | Provider（**通过 stdio 与 language server 通信**） |
| `tool-lsp` | Consumer |

💡 **`lsp-stdio` 依赖 `ctx.subprocess`** —— 所以换成 E2B provider 后，**language server 会在远端启动**。这正是 `docs/architecture.md` 说的"pointing them at a remote sandbox moves Bash, PTY, and LSP with them"。

## 8.15 `code-runtime` 组：跑模型写的代码

`packages/code-runtime/`（3963 行）：

| 包 | 角色 |
|---|---|
| `code-runtime` | Definition |
| `code-runtime-worker-thread` | Provider（**Node worker thread**） |

💡 **用 worker thread 而非子进程**：Code Mode（[07 § 7.15](07-request-pipeline-llm-tools-and-prompts.md)）里模型写的代码要调 DSH 的工具，跑在 worker thread 里能共享内存中的工具注册表，比子进程 + IPC 简单得多。代价是隔离性弱（worker 崩溃可能影响主进程）。

## 8.16 环境变量的传递

关联 [05 § 5.8](05-startup-and-cordis-runtime.md) 的 `BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']`：

![子进程环境变量的拦截规则](diagrams/08-bootstrap-env-filter.svg)

**子进程环境变量的拦截规则** — [交互版](diagrams/08-bootstrap-env-filter.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-bootstrap-env-filter.architecture.json)

- **三类被拦截的前缀**：DSH 前缀会干扰子进程里的 dsh 启动 · DYLD 前缀能改变 macOS 动态库加载 · BASH_FUNC 前缀能注入 bash 函数
- **默认拦截而非默认放行**：白名单式判断，不确定就不传 · 避免宿主环境意外影响子进程行为 · 关联 05 篇 § 5.8
- **组装逻辑独立**：过滤之后由 shell-env 负责组装 · 它还处理路径与编码相关的变量 · 与 shell provider 解耦

---

> 📎 **以下承接原「13 沙箱与权限审批」。**
> 本篇讲两套互补的安全机制：**沙箱**（`ctx.sandbox` + Landlock/Windows ACL，进程级强制约束）与**审批**（`tools/pre-execute` gate + 权限预设，决策级人工确认）。核心是 fail-closed 原则。
> 路径缩写：`P/` = `packages/`，`SB/` = `packages/sandbox/sandbox/src/`。行号对应快照 `fb2c4b9e`。

## 8.17 两套机制的分工

![沙箱与审批是两套机制](diagrams/08-sandbox-vs-approval.svg)

**沙箱与审批是两套机制** — [交互版](diagrams/08-sandbox-vs-approval.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-sandbox-vs-approval.architecture.json)

- **沙箱不可绕过**：约束由内核或系统施加 · 即使进程有恶意也无法突破 · 但粒度较粗，只到文件系统级
- **审批粒度细但可绕过**：能针对具体工具与参数做判断 · 依赖 agent 走正常的工具调用路径 · 若绕开工具直接执行就失效
- **实践上要一起用**：沙箱兜住最坏情况 · 审批处理需要人判断的灰区 · 两者缺一都不完整

## 8.18 `SandboxProvider.confine()`：唯一的方法

> 📐 **配套可跑示例**：[`M07.3 · sandbox-seam`](../../dsh-example/M07-execution-backends/impl/03-sandbox-seam.ts) 提供两个后端演示两端 ——
> `WrapSandbox` 返回可强制执行的 argv，`RefuseSandbox` 对强制不了的模式抛 `SandboxUnavailableError`。
>
> ```ts
> export class RefuseSandbox extends SandboxProvider {
>   confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
>     if (policy.mode === 'read-only') return { /* 可强制执行的包装 */ }
>     throw new SandboxUnavailableError(policy.mode, '本后端只会 read-only')   // ← fail-closed
>   }
> }
> ```


`SB/index.ts:158-176`。类注释（`:152-157`）是全仓最重要的安全声明之一：

> Abstract process-sandbox service. `confine` must return **enforcing argv** or **fail closed** at wrap or runner-execution time; **silent unconfined passthrough is forbidden**. Functional probes arbitrate multi-runner chains and may be skipped for a sole candidate, whose own refusal remains the fail-closed end.

![confine 的参数与返回契约](diagrams/08-confine-contract.svg)

**confine 的参数与返回契约** — [交互版](diagrams/08-confine-contract.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-confine-contract.architecture.json)

- **为什么要精确 argv**：shell 字符串无法可靠地判断真正执行什么 · 精确 argv 让策略判断有确定输入 · 需要 shell 语义时显式传三元组
- **强制完整度是诚实的**：返回值会说明后端实际能达到的约束级别 · 调用方可据此决定是否继续 · 不假装所有平台都同等强
- **不代替调用方 spawn**：沙箱只做 argv 改写这一件事 · 进程创建仍由 subprocess 负责 · 职责边界清晰

💡 **"caller spawns the returned argv"是刻意的设计**（对照 [03 § 3.8](03-capability-seams-and-services.md)：`docs/architecture.md` 说 "consumers wrap argv before spawning"）。沙箱不是拦截器 —— **是否沙箱化在调用点显式可见**，代码审查时能直接看到哪些 spawn 没走 confine。

💡 **`policy` 是 per-call 参数**（`:170-171`：`carried per call`），不是全局配置。同一个 agent 的不同工具调用可以有不同的文件访问策略。

## 8.19 `landlock-run`：Linux 沙箱的实现

`native/landlock-run/`（288 K）是一个**独立发布的 npm 包族**：`@deepseek-ai/node-addon-landlock-run`。

![landlock-run 的自限后执行模式](diagrams/08-landlock-run.svg)

**landlock-run 的自限后执行模式** — [交互版](diagrams/08-landlock-run.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-landlock-run.architecture.json)

- **为什么用独立可执行文件**：Landlock 是进程自限的，必须在目标进程内施加 · 于是用一个小包装程序先自限再 exec · 这样调用方自己不受影响
- **发布形态是 node addon 包**：入口包是纯 JS，按平台选择二进制 · 静态链接 musl 以免依赖宿主 libc · 体积小便于随包分发
- **不做降级**：内核不支持或规则装载失败即退出 · 不会退回到无约束执行 · 这是全仓 fail-closed 的典型样例

💡 **"self-restrict-then-exec"解决了一个真实难题**：宿主进程（dsh 自己）不能被限制（它要读配置、写日志、访问网络），但子进程必须被限制。Landlock 的 ruleset 跨 `execve` 继承特性正好匹配 —— **用一个 300 行的 C 程序作为"降权跳板"**。

💡 **README 明确定位**："Built for agent harnesses and other hosts that need to run untrusted commands under a filesystem allow-list **without confining themselves**."

💡 **`probe` 报告 `unusable` 时消费方 fail closed** —— 这是 § 8.18 第 ③ 条规则的实际落地。**没有沙箱能力时宁可不执行，也不无约束执行。**

💡 **独立 LICENSE 文件**（`native/landlock-run/LICENSE`）说明它是可独立分发的组件，不只是内部工具。它在 `pnpm-workspace.yaml` 里也是独立的 workspace 成员（[02 § 2.1](02-codebase-map.md)）。

## 8.20 Windows：`sandbox-windows-acl`（2530 行）

sandbox 组四个包的行数对比：

| 包 | 行数 | 说明 |
|---|---|---|
| **`sandbox-windows-acl`** | **2530** | Windows ACL 实现 |
| `sandbox-local` | 655 | Linux（调 `landlock-run`） |
| `sandbox` | 452 | Definition |
| `sandbox-policy` | 267 | Policy |

💡 **Windows 实现是 Linux 的 3.9 倍**。原因：Linux 有 Landlock（内核提供的 allow-list 原语），Windows 需要**手工构造 ACL**（DACL/SACL、SID、继承标志、access mask）——没有等价的一次性 allow-list 机制。

💡 **`sandbox-local` 只有 655 行**是因为重活在那 300 行 C 里。它主要做：探测可用性、把 `SandboxPolicy` 翻译成 `grantArgs`、拼出 `[launcherPath, ...grantArgs, ...argv]`。

## 8.21 审批链：从 `ask` 到用户

> 📐 **配套可跑示例**：[`M06.2 · approval-answerer`](../../dsh-example/M06-human-in-the-loop/impl/02-approval-answerer.ts) 把四值 outcome 的三种局面都跑了一遍。
> 它还暴露了一条容易踩的不变量：`approval.request()` **必须在打开的 turn 内**
> （`approval/asked` + `approval/decided` 这对审计事件要被 turn 包住），所以示例用明确的指令让真实模型
> 让真实 agent-loop 在轮内派发，实测事件序列是 `tool/call → approval/asked → approval/decided → tool/result`。


![工具审批的参与方](diagrams/08-approval-flow.svg)

**工具审批的参与方** — [交互版](diagrams/08-approval-flow.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-approval-flow.architecture.json)

- **两级判定**：先查 permission-presets 的静态规则 · 命中即直接放行或拒绝，无需打扰用户 · 未命中才走 user-approval 询问
- **实测事件序列可验证**：让真实 agent-loop 在轮内派发即可观察 · 预设命中时不会出现询问事件 · 这是判断配置是否生效的最快方法
- **没有审批能力时**：pre-execute 返回 ask 会被当作 deny · 不会退回为静默放行 · 见 T/index.ts:145 的注释

`interaction` 组五个包：

| 包 | 行数 | 作用 |
|---|---|---|
| `commands` | 583 | `ctx.commands` —— **人类命令**（不经模型 turn） |
| `permission-presets` | 526 | 权限预设的持久化与匹配 |
| `user-approval` | 487 | 审批流程实现 |
| `user-questions` | 239 | `ctx.userQuestions`（在 `dsh-base` patch 里有一行） |
| `tool-ask-user` | 131 | **模型主动问用户的工具** |

前端对应：`ui-permission-presets`、`ui-user-questions`、`ui-commands`。

💡 **`ask` 无审批能力时降级为 deny 是 fail-closed 的又一处体现**。headless 模式（`dsh-headless` bundle，35 行 patch）大概不含 `user-approval`，所以需要审批的操作会被拒绝而不是卡住等待。

💡 **`commands` 与 `tool-ask-user` 方向相反**：前者是"人 → agent"（用户输命令，不走模型），后者是"agent → 人"（模型主动提问）。

## 8.22 `guard` 组：两个防护策略

`packages/guard/`（1021 行）：

| 包 | 行数 | 作用 |
|---|---|---|
| `repeat-tool-reminder` | 263 | **重复工具调用提醒** |
| `timeout-policy` | 111 | 超时（`tools/execute` wrapper，[07 § 7.11](07-request-pipeline-llm-tools-and-prompts.md)） |

💡 **`repeat-tool-reminder` 针对一个真实的 agent 失效模式**：模型反复调同一个工具（同样参数、同样结果）而不推进。它大概监听 `agent/pre-step` 或 `tools/post-execute`，检测到重复就往上下文里注入提醒。

💡 **`timeout-policy` 只有 111 行**但被 `ToolDefinition` 的注释明确点名（`T/index.ts:250`）：

> Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper)

即：`ToolDefinition` 声明超时值，但**强制它的是一个独立的 policy 包**。定义与执行分离。

## 8.23 fail-closed 原则在全仓的体现

![fail-closed 原则在全仓的四处体现](diagrams/08-fail-closed.svg)

**fail-closed 原则在全仓的四处体现** — [交互版](diagrams/08-fail-closed.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-fail-closed.architecture.json)

- **四处的共同结构**：都在能力缺失时选择拒绝而非降级 · 都把判断放在最早可判断的时刻 · 都给出明确的错误而非静默行为
- **为什么不做静默降级**：静默降级会让用户误以为约束仍在生效 · 安全能力的假象比没有更危险 · 显式失败可以被监控发现
- **延伸到 SDK 层**：Python runtime 拒绝无配置启动 · 便利层只能补默认值，不能跳过校验 · 见 04 篇的 SDK 契约

💡 **这是全仓一致的工程态度**。`docs/defensive-patterns.md`（上游文档）应该系统讲了这些模式。

## 8.24 `credentials` 组

`packages/credentials/`（1819 行）：`credentials` + `credentials-local`。

💡 **凭据与 LLM 分离**：`llm` 只负责校验拿到的 key 可用（`assertUsableApiKey`，[07 § 7.8](07-request-pipeline-llm-tools-and-prompts.md)），存取由 `ctx.credentials` 管。这样换存储后端（本地文件 → 系统钥匙串 → 远端 vault）不影响 llm 层。

## 8.25 `.github/workflows/sandbox.yml`

CI 里有专门的 sandbox workflow（[02 § 2.9](02-codebase-map.md) 的 15 个 workflow 之一），另有 `landlock-run.yml` 与 `landlock-run-release.yml`。

💡 **三个 workflow 专管沙箱**说明它被当作独立组件维护：构建（多平台二进制）、测试、发布。`native/landlock-run/test/` 有独立测试目录。

---

> 📎 **以下承接原「14 Subagent 与委派」。**
> 本篇讲 DSH 里最能体现 seam 威力的一处：同一个 subagent 接口后面能是"进程内新 agent"、"fork 当前会话"，也能是"Claude Code 的一次运行"或"Codex"。含发起者追踪、6 种驱动、3 个工具。
> 路径缩写：`P/` = `packages/`，`AG/` = `packages/core/agent/src/`。行号对应快照 `fb2c4b9e`。

## 8.26 组的构成（11 个包）

`packages/subagent/`，按 `src` 行数：

| 包 | src 行数 | 角色 |
|---|---|---|
| **`subagent`** | **4531** | Service Definition |
| `subagent-codex` | 705 | Provider（**委派给 Codex**） |
| `subagent-claude-code` | 604 | Provider（**委派给 Claude Code**） |
| `subagent-acp` | 587 | Provider（ACP 协议） |
| `tool-subagent` | 497 | Consumer（派发） |
| `subagent-in-process-driver` | 405 | Provider（进程内驱动） |
| `subagent-dsh-sdk` | 375 | Provider（通过 DSH SDK 调另一个 dsh） |
| `tool-subagent-control` | 342 | Consumer（控制） |
| `tool-subagent-report` | 172 | Consumer（回报） |
| `subagent-fork-in-process` | 124 | Provider（**fork 会话**） |
| `subagent-spawn-in-process` | 94 | Provider（进程内新建） |

💡 **定义包 4531 行，是全部 provider 之和（2894）的 1.6 倍**。与 `fs`（503 行定义 vs 1464 行 provider）相反。原因：subagent 的**生命周期编排**很复杂（创建、监控、取消、回报、清理），这些通用逻辑放在定义包里，provider 只做"怎么启动一个 agent"。

💡 **最小的两个 provider 只有 94 与 124 行**：
- `subagent-spawn-in-process`（94）：直接调 `ctx.agents` 的工厂建一个新 agent
- `subagent-fork-in-process`（124）：调 `ctx.sessions.fork(...)`（[06 § 6.19](06-agent-loop-and-session-log.md)）再建 agent

**因为 append-only 日志天然支持 fork，"分叉一个子 agent"只要 124 行。**

## 8.27 六种驱动的谱系

> 📐 **配套可跑示例**：[`M08.1 · subagent-delegation`](../../dsh-example/M08-delegation-presets/impl/01-subagent-delegation.ts) 写了第七种（一个离线的
> `local-reviewer`），并把它暴露成模型工具。注意 `start()` 返回的是**句柄**而不是结果：
> `{ id, localAgent, result: Promise<SubagentResult>, dispose() }` —— 正因如此
> `subagent/start` 与 `subagent/end` 才能分成两个事件。


![subagent 的进程内与外部两组实现](diagrams/08-subagent-groups.svg)

**subagent 的进程内与外部两组实现** — [交互版](diagrams/08-subagent-groups.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-subagent-groups.architecture.json)

- **驱动层被复用**：in-process-driver 同时被 spawn 与 fork 复用 · spawn 与 fork 各自只有百行左右 · 差别只在初始会话怎么来
- **fork 继承历史**：直接用 session.fork 拿到父会话的种子 · 于是子 agent 看得到之前的对话 · spawn 则是完全空白的会话
- **外部委派的共同点**：都要把 DSH 的任务语义翻译成对方的协议 · 都要把对方的产出翻译回 session 事件 · 因此代码量普遍高于进程内实现

💡 **`subagent-codex`（705）比 `subagent-claude-code`（604）大**。两者都要把 DSH 的 subagent 契约映射到对方的 CLI/API 上，差异来自对方的接口复杂度。

## 8.28 发起者追踪：`AgentRegistry` 的 initiator 机制

`AG/index.ts` 里有一组专门处理"谁触发了当前操作"的 API：

| 符号 | 行号 | 说明 |
|---|---|---|
| `InitiatorRun` 相关类型 | 223-241 | |
| **`currentInitiator()`** | **309** | 当前发起者（可能 undefined） |
| **`requireInitiator()`** | **322** | 必须有发起者，否则抛错 |
| `register(agent)` | 450 | 注册 agent |
| **`enter(agent, owner)`** | **474** | **进入 agent，带 owner** |
| `isOwnedBy(id, owner)` | 595 | 归属判定 |
| `roots()` | 613 | **根 agent 列表**（无 owner 的） |

![工具调用如何知道是哪个 agent](diagrams/08-initiator-tracking.svg)

**工具调用如何知道是哪个 agent** — [交互版](diagrams/08-initiator-tracking.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-initiator-tracking.architecture.json)

- **用执行上下文而非参数**：工具签名保持简洁，不带 agent · 上下文由 enter 在外层建立 · 于是任意深度的调用都能取到
- **require 而非 current**：缺失时直接报错，不返回空 · 因为无法归属的工具调用不该发生 · 这是 fail-closed 的又一处
- **owner 支撑 agent 树**：isOwnedBy 判断某 agent 是否属于某 owner · roots 列出没有 owner 的顶层 agent · subagent 层级因此可枚举

## 8.29 三个工具的分工

| 工具 | 行数 | 职责 |
|---|---|---|
| `tool-subagent` | 497 | **派发**：创建并启动一个 subagent |
| `tool-subagent-control` | 342 | **控制**：查询状态、取消、等待 |
| `tool-subagent-report` | 172 | **回报**：subagent 把结果交回父 agent |

![subagent 的创建、回报与控制](diagrams/08-subagent-flow.svg)

**subagent 的创建、回报与控制** — [交互版](diagrams/08-subagent-flow.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-subagent-flow.sequence.json)

- **父 agent 不等子 agent**：tool_result 只返回 subagent id 就立刻结束 · 父 agent 的 turn 可以继续推进 · 子 agent 的产出通过 inbox 异步汇入
- **provider 是可替换的缝**：fork-in-process 只是其中一种实现 · 同一套工具接口可以换成独立进程或远端 · subagent 服务负责选型，工具层不感知
- **三个工具各管一段**：tool-subagent 负责创建 · tool-subagent-report 负责子到父的回报 · tool-subagent-control 负责查状态与取消

💡 **`tool-subagent-report` 只有 172 行**——它的核心就是调 `exec.deferContext(报告消息)`。父 agent 在下一个 step 就能看到报告。**这是 `ToolRunContext.deferContext()`（`T/index.ts:411`）最重要的用例。**

💡 **`inject` 语义的呼应**（[06 § 6.2](06-agent-loop-and-session-log.md)）：报告用 `deferContext`（追加到 `next-step`，不唤醒），所以**父 agent 不会因为收到报告就白跑一个 step**——它等自己本来的下一步。

## 8.30 `agent-spine-demo`

`P/examples/agent-spine-demo/`（`packages/examples/` 组共 2858 行；注意它与顶层 `examples/` 目录不是同一处）。

💡 **名字里的 "spine"（脊柱）** 暗示这是演示"多 agent 编排骨架"的示例。另两个示例是 `acp-demo` 与 `jsonrpc-demo`。

## 8.31 与 `goal` 组的关系

`packages/goal/`（5786 行）四个包：`goal`、`goal-round-driver`、`command-goal`、`tool-goal`。

💡 **`ctx.goals` 与 subagent 是两种不同的"多步推进"机制**：
- **subagent**：派生一个**新的 agent**（新会话或 fork），独立跑
- **goal**：在**同一个会话**里管理一个目标，靠 `goal-round-driver` 在 `agent/turn-stopping` 里延续 turn（[06 § 6.4](06-agent-loop-and-session-log.md) ④）

`docs/architecture.md`："Manage a same-session objective → use `ctx.goals`; continue through `agent/*`"——**明确说是"同会话"**。

---

> 📎 **以下承接原「15 上下文压缩 Compaction」。**
> 本篇讲 DSH 怎么在不丢日志的前提下压缩模型上下文：`CompactionEngine` 的三个抽象方法、`surfaceOp: replace` 的落地、以及两个 provider 的策略差异。
> 路径缩写：`P/` = `packages/`，`CP/` = `packages/compaction/compaction/src/`。行号对应快照 `fb2c4b9e`。

## 8.32 组的构成（4 个包）

| 包 | src 行数 | 角色 |
|---|---|---|
| `compaction-basic` | 1621 | Provider（基础压缩） |
| **`compaction`** | **792** | Service Definition |
| `compaction-tool-result-pruner` | 331 | Provider（**工具结果裁剪**） |
| `command-compact` | 136 | Consumer（**人类命令** `/compact`） |

💡 **`command-compact` 是 `command-*` 而非 `tool-*`**——压缩由**人**触发，不经模型 turn（[08 § 8.21](08-execution-services.md)）。当然自动压缩走另一条路（§ 8.34）。

## 8.33 `CompactionEngine`：三个抽象方法

> 📐 **配套可跑示例**：[`M02.3 · compaction-provider`](../../dsh-example/M02-context-assembly-economics/impl/03-compaction-provider.ts) 是这个抽象类的最小 provider，
> 形状与 25 的沙箱后端同型：继承 → `static inject` / `static Config` → 构造里 `super(ctx)` 即挂到
> `ctx.compaction` → `export default`。**没有** `ctx.provide('compaction', engine)` 这种写法。


`CP/index.ts:96`（`super(ctx, 'compaction')`，`:98`）：

| 方法 | 行号 | 语义 |
|---|---|---|
| **`compactIfNeeded(...)`** | **113** | **按需**：判断是否需要压缩，需要才做 |
| **`compactNow(...)`** | **139** | **立即**：无条件压缩 |
| **`compactRegion(...)`** | **164** | **指定区间**：压缩表面上的某段 |

![压缩的三个入口](diagrams/08-compaction-entries.svg)

**压缩的三个入口** — [交互版](diagrams/08-compaction-entries.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-compaction-entries.architecture.json)

- **三种触发场景**：自动触发看 token 预算是否吃紧 · 手动触发由用户显式发起 · 精确触发由界面给出区间
- **出口只有一个**：无论哪个入口都归结为表面 replace · 日志永不删除，只是被遮蔽 · 于是压缩结果可以被审计
- **自动触发挂在 pre-step**：在模型调用之前检查并压缩 · 避免超出上下文窗口才发现 · 实现是一个普通的事件监听器

## 8.34 压缩怎么做到"不丢日志"

> 📐 **配套可跑示例**：[`M02.3 · fold-history`](../../dsh-example/M02-context-assembly-economics/scenes/03-fold-history.ts) 实测把 12 个 surface 节点折成 4 个
> （摘要 + 保留最近 3 条），返回的 `CompactionResult` 报出 `summarySeq` / `shadowedRange` / `shadowedSeqs` /
> `shadowedTokenCount` 这份可核对的账。两个真实约束：摘要只能以 `assistant/message` 进 surface，
> 且**必须带 model 来源**（消息本体要经 `createAssistantMessage` 铸造）。


这是 DSH 的一个关键设计，全靠 [06 § 6.15](06-agent-loop-and-session-log.md) 的表面机制。

![压缩前后的表面变化](diagrams/08-compaction-mechanics.svg)

**压缩前后的表面变化** — [交互版](diagrams/08-compaction-mechanics.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-compaction-mechanics.architecture.json)

- **日志一个字节都不动**：压缩只写入新事件，不修改旧事件 · 被遮蔽的节点仍然在日志里 · 因此可以回溯压缩前的完整历史
- **表面是唯一被改的东西**：replace 操作重写表面节点序列 · replaceGeneration 递增使投影缓存失效 · 下一次 deriveMessages 整体重建
- **全靠日志与表面分离**：这个设计见 06 篇 § 6.15 · 没有这层分离，压缩就只能删历史 · 删了就无法回放与审计

💡 **对比常见做法**：多数 agent 框架压缩时**直接改内存里的消息数组**，原始历史丢失。DSH 用"append 一个替换标记"实现，**日志永远是完整的事实来源**。

## 8.35 两个 provider 的策略差异

![两个压缩 provider 的策略差异](diagrams/08-compaction-providers.svg)

**两个压缩 provider 的策略差异** — [交互版](diagrams/08-compaction-providers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-compaction-providers.architecture.json)

- **成本差异明显**：basic 需要模型调用，有成本与延迟 · pruner 纯本地处理，便宜且快 · 因此优先用 pruner
- **工具输出占 token 大头**：搜索与读文件的结果通常最长 · 裁掉它们收益最高 · 且信息损失相对可控
- **两者可叠加**：都是标准的 compaction provider · 按顺序注册即形成分层策略 · 换掉任一个不影响另一个

💡 **工具输出通常是 token 消耗的大头**（一次 `grep` 或 `cat` 可能几千 token）。`compaction-tool-result-pruner` 用 331 行解决了大部分问题，比动辄调 LLM 的摘要便宜得多。**这个包的存在体现了对实际成本结构的理解。**

## 8.36 压缩与 `agent/session-start`

`SessionStartSource`（`AG/runtime-types.ts:61`）的四个值：

```
'startup' | 'resume' | 'clear' | 'compact'
```

💡 **`'compact'` 是其中一个** —— 压缩后会发一次 `agent/session-start`（`agent/session-start` 事件在 `AG/runtime-types.ts:217`），让观察者知道"上下文被重置过"。UI 可以据此显示分隔线。

💡 **四个来源的语义**：
- `startup`：进程启动
- `resume`：从持久化恢复
- `clear`：用户清空
- `compact`：压缩后

## 8.37 与 `spill` 组的关系

`packages/spill/`（1473 行）：`spill` + `spill-local` + `spill-policy`。

💡 **"spill"（溢出）与 compaction 是互补的**：
- **compaction**：把上下文变短（模型侧）
- **spill**：把大内容挪到外部存储，上下文里只留引用（存储侧）

典型场景：工具返回 10 MB 输出 → spill 到磁盘，上下文里放"内容已存到 X，可用工具读取"。这样既不撑爆上下文，内容也没丢。

## 8.38 与 `token-meter` 的关系

`P/llm/token-meter`（999 行）。

💡 **`compactIfNeeded` 需要知道"当前用了多少 token"** —— 这个数据由 `token-meter` 提供（它监听 `llm/stream`，[07 § 7.3](07-request-pipeline-llm-tools-and-prompts.md)）。压缩的触发阈值就是基于它的计量。

## 8.39 `session-checkpoint-policy`

`P/session/session-checkpoint-policy`（113 行）。

💡 **压缩后是落盘的好时机**（表面变了、投影重建了）。这个 policy 包大概就是在做这类判断。它只有 113 行，说明策略本身简单——复杂度在 `session-persistence`（2159 行）里。

---

**上一篇** ← [07 请求管线：LLM、工具与 SystemPrompt](07-request-pipeline-llm-tools-and-prompts.md) ｜ **下一篇** → [09 宿主与运行面：Web、网关、编排、存储、类型](09-host-runtime-and-storage.md)：前端、网关、五种编排、四条存储、类型系统。

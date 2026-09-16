# 第 08 课 · 委派与预设：注册了 provider，模型却还不会委派

> **本课任务**：先看清一件反直觉的事——装载 `ctx.subagents` **不会**让模型学会委派；然后手写一条
> 最小通路把委派暴露成模型可见工具，并用 `subagent/*` 事件证明它真的发生了；最后分清
> agentPreset / permissionPreset / modelSelection 三种预设各自管什么。
> **运行命令**：`cd dsh-example && npm run M08`
> **你将看到**：`local-reviewer` provider 注册成功、模型看到一个名为 `review_with_subagent` 的工具、
> 一次委派发出 `subagent/start` 与 `subagent/end` 两个事件；以及三行预设的真实结论
> （空 roster、未隔离 shell 被拒、模型路由白名单）。

前置：[第 00 课 · 跑起来](00-getting-started.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

M08 回答一个问题：**"模型能委派"这件事是怎么被装出来的？** 答案不是"装了 subagent 服务"，
而是"注册了一个模型看得见的工具"。围绕这条主线，本课把四层职责拆开：

| 层 | 回答的问题 | 本课对应实现 |
|---|---|---|
| **Provider** | 子代理"怎么跑"由谁实现？ | [`impl/01-subagent-delegation.ts`](../M08-delegation-presets/impl/01-subagent-delegation.ts) |
| **agentPreset** | 一个 Session 的插件组合从哪来？ | [`impl/02-agent-presets.ts`](../M08-delegation-presets/impl/02-agent-presets.ts) |
| **permissionPreset** | 允许哪些副作用？ | [`impl/03-permission-presets.ts`](../M08-delegation-presets/impl/03-permission-presets.ts) |
| **modelSelection** | 子任务能路由到哪个模型？ | [`impl/04-subagent-model-selection.ts`](../M08-delegation-presets/impl/04-subagent-model-selection.ts) |

四层全部独立：provider 只管"怎么跑"，preset 只管"装什么"，permission 只管"准不准"，
modelSelection 只管"用哪个模型"。**没有任何一层替你决定模型什么时候委派**——那是模型自己的调用决策。

```bash
cd dsh-example && npm run M08
```

---

## 2. 真实输出

```text
████ M08 · 委派与预设：Provider、组合、权限与模型选择 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M08.1 · 注册子代理 Provider，并显式包装成工具 ────
① 已注册子代理 provider: [ 'local-reviewer' ]
② 已注册模型可见工具: [ 'review_with_subagent' ]

----- 模型调用 review_with_subagent（触发一次委派）-----
[event] subagent/start → provider=local-reviewer child=local-reviewer-1 local=false
[event] subagent/end   → runId=fb8598d6-3018-415c-84e5-4a6b39a02e2f stopReason=completed
③ canonical value: {
  text: '【子代理·local-reviewer】已评审：「检查这个支付模块 diff」 → 结论：可合并，建议补边界测试。',
  childId: 'local-reviewer-1',
  stopReason: 'completed'
}
④ render 给模型看: 【子代理·local-reviewer】已评审：「检查这个支付模块 diff」 → 结论：可合并，建议补边界测试。
REAL_STAGE_OK M08.1 calls=1 ms=893 in=0 out=85 finish=stop

──── M08.2 · 装配不扫描用户目录的空 preset roster ────
agentPresets: { service: 'AgentPresets', configuredRoots: 0, discovered: 0 }
REAL_STAGE_OK M08.2 calls=1 ms=589 in=0 out=76 finish=stop

──── M08.3 · 拒绝未隔离 shell 的权限预设 ────
permissionPresets: {
  failLoud: true,
  reason: 'permission: the mounted bash executor does not confine (no sandboxMode) — presets bundle a sandbox mode, so composing this plugin over an unconfined executor is a misconfiguration'
}
REAL_STAGE_OK M08.3 calls=1 ms=470 in=0 out=97 finish=stop

──── M08.4 · 配置子代理精确模型路由 ────
subagentModelSelection: {
  enabled: true,
  allowedModels: [ { provider: 'anthropic-compat', model: 'fuyao-coding' } ]
}
REAL_STAGE_OK M08.4 calls=1 ms=346 in=0 out=51 finish=stop

REAL_MODULE_OK M08 stages=4 calls=4 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M08 stages=4 calls=4 failed=0`，且 M08.1 的
`REAL_STAGE_OK` 那行带 `calls=1`（每个 mechanism 阶段都先做了一次真实推理入口 probe）。
`runId` 是每次运行不同的随机值，别拿它做比对；`child=local-reviewer-1` 才是稳定的。

最短的自查命令（**不需要 `LLM_API_KEY`**，这条通路本身不调模型）：

```bash
cd dsh-example && node M08-delegation-presets/scenes/01-delegate-a-review.ts
```

`① / ② / ③ / ④` 四行应当与上面 M08.1 完全一致（除 `runId`）。

---

## 3. 三步通路：装载服务不等于模型会委派

这是本课最反直觉、也最该先记住的一条。

`ctx.subagents` **只是一个具名 provider 注册表**：它记着"哪些名字可用、每个名字怎么跑"。
它是**服务缝**，对模型**完全不可见**——agent 循环里也不存在"自动派子代理"这种逻辑。
所以"我装了 `dsh-subagent`"和"模型会委派"之间没有因果关系。

模型唯一能发起委派的通路只有三步，其中**只有第三步改变模型可见面**：

| 步骤 | 动作 | 模型看得见吗 |
|---|---|---|
| 1 | 装载 `dsh-subagent` → 注册表存在 | **看不见**（这只是服务就绪） |
| 2 | `registerProvider(...)` → 注册表里多一条"怎么跑" | **看不见**（只是让 `start()` 可用） |
| 3 | 注册一个**模型可见工具**，其 `execute` 里调 `ctx.subagents.start(...)` | **← 只有这一步改变模型看得见的东西** |

第三步之后的链路和第 01 课完全同构：模型在 turn 里看到工具 schema → 自己决定要不要调 →
agent 循环经 `ctx.tools.execute` 走到你插件的 `execute`。**委派没有特殊通道**，它就是一次普通工具调用。

[`impl/01-subagent-delegation.ts`](../M08-delegation-presets/impl/01-subagent-delegation.ts) 的开头
把这段原话写成了注释，值得逐字读一遍：

```ts
 *   1. 装载 `dsh-subagent` → 注册表存在（harness 已做，模型不可见）
 *   2. registerProvider(...) → 注册表里有一个"怎么跑"（本文件第 1 步，模型不可见）
 *   3. 注册一个**模型可见工具**，execute 里调 ctx.subagents.start(...)
 *      （本文件第 2 步 —— 只有这一步改变模型可见面；是否调用由模型自己决定，
 *       与调用任何普通工具是同一套机制）
```

第 2 节 M08.1 的 ①② 两行正是这三步的落点：`provider` 列表里有 `local-reviewer`，
**模型可见工具**列表里有 `review_with_subagent`。两行并列出现，但只有第二行是模型能感知的。

> **原理对照**：seam 的三角色（Service Definition / Provider / Consumer）见
> [03 § 3.1](../../docs/hello-dsh/03-capability-seams-and-services.md)，
> `subagent` 作为极端例子见 [03 § 3.4](../../docs/hello-dsh/03-capability-seams-and-services.md)。

---

## 4. `impl/01` 手写的最小版：provider + 模型工具

打开 [`impl/01-subagent-delegation.ts`](../M08-delegation-presets/impl/01-subagent-delegation.ts)。
它把真实产品里由 `dsh-tool-subagent` 分两步完成的事，合在一个插件里手写：

```ts
export const name = 'subagent-delegation'
export const inject = ['subagents', 'tools']

export function apply(ctx: Context) {
  // 1) 注册 provider（effect-based，fiber 销毁即撤销）。
  ctx.subagents.registerProvider(new LocalReviewerProvider())

  // 2) 把"委派一次评审"暴露成模型可见工具（对照 dsh-tool-subagent）。
  ctx.tools.register(defineTool({
    name: 'review_with_subagent',
    description: '把一个代码评审任务委派给子代理，返回其独立结论。',
    ...
  }))
}
```

注意 **`inject = ['subagents', 'tools']`**：Cordis 会等两项依赖都就绪才启动插件，避免 `apply` 里
读到未装载的服务。注册是 effect-based 的——和 [第 01 课](01-tool-pipeline.md) § 3 讲的一样，
`fiber.dispose()` 之后 provider 和工具一起消失，不需要手写反注册。

`execute` 是本课的核心，逐句都有理由：

```ts
async execute(args, exec) {
  if (!exec.agent) throw new Error('委派需要一个发起 agent')
  const run = await ctx.subagents.start('local-reviewer', {
    prompt: [{ type: 'text', text: args.task }],
    parent: exec.agent,
    signal: exec.signal,
  })
  try {
    const result = await run.result
    const text = result.output.map((block) => (block.type === 'text' ? block.text : '')).join('')
    return { text, childId: run.id, stopReason: result.stopReason }
  } finally {
    await run.dispose()
  }
}
```

- **`exec.agent` 是必填的发起者**。委派必须有"谁发起的"这层身份，缺了就直接抛
  `委派需要一个发起 agent`。这正是 [08 § 8.28](../../docs/hello-dsh/08-execution-services.md)
  讲的发起者追踪（`requireInitiator` 而非 `currentInitiator`）在工具层的体现。
- **`parent: exec.agent` + `signal: exec.signal`**：把父子关系与**调用方的取消信号**一起传下去。
  调用被取消，子代理也跟着取消。
- **`await run.result` 才拿到输出**——`start()` 返回的是句柄，不是结果（见下一节）。
- **`finally` 里无条件 `await run.dispose()`**。这是契约要求：消费者**必须** dispose 才能取消
  剩余工作并达到静止（quiescence）。`dispose()` 是幂等的，重复调用安全。

第 2 节 M08.1 的 ③④ 两行还顺带复述了工具契约：`canonical value` 是规范返回值
（`text` / `childId` / `stopReason`），`render 给模型看` 是回灌文本。本例的 `render` 直接取
`value.text`，所以两行内容看起来一样——**但它们是两个不同的东西**，这在第 01 课 § 3 已经拆过。

---

## 5. `SubagentProvider` 是接口，`SubagentRun` 是句柄

### Provider 用 `implements`，不是 `extends`

`SubagentProvider` 是一个 **interface**，不是一个可继承的运行时基类。官方 provider 一律用
`implements`，形状是：

```text
{ name, capabilities, inheritsParentContext, start(request): Promise<SubagentRun> }
```

本例的实现（注意 `readonly` 字段和 `implements` 关键字）：

```ts
class LocalReviewerProvider implements SubagentProvider {
  readonly name = 'local-reviewer'
  readonly capabilities: SubagentCapabilities = { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }
  readonly inheritsParentContext = false

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    ...
    return {
      id,
      localAgent: undefined,   // 本例不派生真实子 Agent，故为 undefined
      result: Promise.resolve({ output: [{ type: 'text', text: report }], stopReason: 'completed' }),
      async dispose() { /* 没有需要回收的子进程/子 fiber */ },
    }
  }
}
```

三个字段各自有真实用途：

- **`name`** 就是注册键，`ctx.subagents.start('local-reviewer', ...)` 里的字符串必须对上。
- **`capabilities`** 声明本 provider 支持的 start-time 特性。本例全为 `false`（离线、固定产出）；
  真实后端按自己的能力声明，而上层工具会据此**提前拒绝**不支持的配置。
- **`inheritsParentContext`** 是**描述性**声明，不是服务校验的能力：它只说"子代理看不看得见
  父会话的已完成 turn"。本例是 spawn 型（从零开始），所以是 `false`。

### `inheritsParentContext` 会直接改写模型看到的措辞

这是真实产品里最漂亮的一处设计。[`impl/01`](../M08-delegation-presets/impl/01-subagent-delegation.ts)
的注释写明第 3 步由 `@deepseek-ai/dsh-tool-subagent` 包做：它监听 `subagent/provider-added`、
在 provider 就绪时注册默认名 `subagent` 的工具，并**按 provider 的 `inheritsParentContext`
生成对模型 truthful 的描述**。

验证这一点可以读真实包里的措辞表（两条描述完全不同）：

| `inheritsParentContext` | 工具描述的开头 |
|---|---|
| `true` | `Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn).` |
| `false` | `Delegate a self-contained task to a subagent (a separate agent that works in its own context) ... Give it a complete, standalone prompt: it does not see this conversation.` |

为什么必须区分：**子代理看没看过这段对话，决定它要不要在 prompt 里被要求复述背景**。
对 fork 型子代理说"它看不到这次对话"是**假话**，会让模型写出多余的长 prompt；
对 spawn 型子代理不说这句，模型又会漏掉必要背景。所以描述不是文案，是**事实**。

### `SubagentRun` 是句柄，不是结果

```ts
// impl/01 注释里的形状
//   { id: SessionId, localAgent, result: Promise<SubagentResult>, dispose() }
```

`start()` **立刻**兑现一个句柄，真正的输出要在 `result` 上等。这个"开始"与"结束"的分离
不是风格问题，它换来三件事：

1. `subagent/start` 与 `subagent/end` 能分成**两个事件**——开始、结束各自可独立审计；
2. 取消（`dispose()`）和资源回收有明确的落点；
3. `stopReason` 与"运行是否成功建立"解耦：模型/传输失败**不会 reject** `result`，而是以
   `stopReason: 'error'` 兑现，让消费者映射成 `isError` 工具结果；只有 seam 无法表示的基础设施
   故障才 reject。

第 2 节 M08.1 的两行事件正是这条设计的可见形态：

```text
[event] subagent/start → provider=local-reviewer child=local-reviewer-1 local=false
[event] subagent/end   → runId=fb8598d6-3018-415c-84e5-4a6b39a02e2f stopReason=completed
```

- `child=local-reviewer-1` 是本例 provider 自己 `seq += 1` 造出来的 id（所以稳定可预期）。
- `local=false` 来自 `localAgent: undefined`——本例不派生真实进程内子 Agent。
- 两个事件的 `runId` **配对**；`end` 上的 `stopReason=completed` 与 ③ 里的 `stopReason` 是同一个值。

**一个重要的边界**：`start()` 抛错 = **没有 published child**，于是 `subagent/start` 和
`subagent/end` **两个事件都不发**（本例注释明确指向 M04.1 的观测方式）。
换句话说，**事件只在运行真的建立后才出现**——它是证据，不是尝试记录。

> **原理对照**：六种驱动的谱系（并点名 M08.1 是手写的第七种）见
> [08 § 8.27](../../docs/hello-dsh/08-execution-services.md)；
> 三个工具（`tool-subagent` 派发 / `-control` 控制 / `-report` 回报）的分工见
> [08 § 8.29](../../docs/hello-dsh/08-execution-services.md)。

---

## 6. 三种预设：组合来源 / 副作用 / 模型路由

预设不是"一组配置项"，而是三种**不同的授权**。本课各给一个最小场景。

### 6.1 agentPreset：决定 Session 的插件组合从哪来

[`impl/02-agent-presets.ts`](../M08-delegation-presets/impl/02-agent-presets.ts) 只做一件事——
在 Loader 提供的 `baseUrl` 下装配一个**空 roster**：

```ts
export const name = 'offline-agent-presets'
export const inject = ['sessionProjections']
export async function apply(ctx: Context): Promise<void> {
  const composition = ctx.extend({ baseUrl: import.meta.url })
  await composition.plugin(Loader, { baseUrl: import.meta.url })
  await composition.plugin(AgentPresets, {
    default: 'none',
    roots: [],
    includeShippedRoot: false,
    includeUserRoot: false,
  })
}
```

三个开关合起来的效果是：**服务照常装载，但不扫描任何用户目录**——离线可跑、结果可预期。
[`scenes/02-empty-preset-roster.ts`](../M08-delegation-presets/scenes/02-empty-preset-roster.ts)
把这点打印成三个数：

```ts
console.log('agentPresets:', { service: harness.ctx.agentPresets.constructor.name, configuredRoots: harness.ctx.agentPresets.roots.length, discovered: (await harness.ctx.agentPresets.list()).length })
```

```text
agentPresets: { service: 'AgentPresets', configuredRoots: 0, discovered: 0 }
```

`service: 'AgentPresets'` 证明**服务是真的**，`configuredRoots: 0, discovered: 0` 证明**目录是真的没扫**。
这两件事同时成立，才是"演示了 agentPresets 服务"而不是"绕过它"。

> **原理对照**：`preset` 组的构成见 [03 § 3.10](../../docs/hello-dsh/03-capability-seams-and-services.md)。
> agent preset 本质上是一段 cordis 配置（含 group 行 + `isolate` 声明），它决定的就是"这个 Session 装哪些能力"。

### 6.2 permissionPreset：只接受能**真实** confine 的 shell

[`impl/03-permission-presets.ts`](../M08-delegation-presets/impl/03-permission-presets.ts) 只有两行——
它直接再导出官方服务：

```ts
export { PermissionPresetService as default, PermissionPresetService, CUSTOM_PRESET } from '@deepseek-ai/dsh-permission-presets'
```

真正的戏在 [`scenes/03-reject-unisolated-shell.ts`](../M08-delegation-presets/scenes/03-reject-unisolated-shell.ts)：
它把这个服务装到一个**未隔离的 bash executor** 上，然后捕获错误：

```ts
const harness = await createHarness()
const fiber = harness.ctx.plugin(PermissionPresetService, {})
let rejected = ''
try {
  await fiber
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error)
}
console.log('permissionPresets:', { failLoud: rejected.includes('does not confine'), reason: rejected })
```

```text
permissionPresets: {
  failLoud: true,
  reason: 'permission: the mounted bash executor does not confine (no sandboxMode) — presets bundle a sandbox mode, so composing this plugin over an unconfined executor is a misconfiguration'
}
```

这段输出值得逐句读：

- **`failLoud: true`** 是场景自己算的：它检查错误信息里有没有 `does not confine`。
  注意这个字段是**脚本的断言**，不是服务的返回值。
- **抛错而不是降级**：预设里**打包了一个 sandbox mode**，把它装在无法 confine 的 executor 上
  是**配置错误**，不是"能跑就跑"。这正是 [08 § 8.23](../../docs/hello-dsh/08-execution-services.md)
  的 fail-closed 原则：安全相关的配置错误必须**响亮地失败**，不能默默放过。

换句话说：**权限预设不负责"把东西变安全"，它负责"只在能真安全时才允许组合"。**

### 6.3 modelSelection：只授权精确的 provider/model **对**

[`impl/04-subagent-model-selection.ts`](../M08-delegation-presets/impl/04-subagent-model-selection.ts)
再导出官方设置插件，场景传入一个白名单：

```ts
await harness.loadPlugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [{ provider: REAL_PROVIDER, model: realConfig().model }] })
console.log('subagentModelSelection:', harness.ctx.subagentModelSelection.current())
```

```text
subagentModelSelection: {
  enabled: true,
  allowedModels: [ { provider: 'anthropic-compat', model: 'fuyao-coding' } ]
}
```

两个设计点：

- **授权单位是"对"，不是"模型名"**。`{ provider, model }` 必须成对出现——同一个模型名在不同
  provider 下可能是不同的东西，只写模型名无法表达路由。
- **按 Session 快照**。`current()` 返回的是这个 Session 生效的策略快照，子代理工具据此判断
  某次委派能不能用这个路由。策略变了不会追溯改变已经开始的 Session。

---

## 7. 排障：provider 注册成功了，却一个 `subagent/*` 事件都没有

### 症状

`ctx.subagents.list()` 里有你的 provider，程序也不报错，但整个运行过程里
`subagent/start` / `subagent/end` **一个都没打印过**。

### 定位

按三步通路**从后往前**查：

1. 打开输出里的**模型可见工具**列表（`harness.visibleTools()`，对应 M08.1 的 ② 行）。
   **如果没有你的委派工具，模型根本不知道有这东西存在**——回到第 3 节，你只走到了第 1 步或第 2 步。
2. 如果工具在列表里，但事件还是没有：检查模型的 prompt 有没有给出**值得委派**的任务。
   模型不调用它，和模型不调用任何普通工具是同一类现象（对照 [第 01 课](01-tool-pipeline.md) § 7）。
3. 如果你看到工具被调用了、事件却没有：那说明 **`start()` 抛错了**。
   按第 5 节的边界，**没有 published child 就不发任何事件**，异常会变成 `isError` 工具结果。

### 原因与修改

最常见的错因是**把第 2 步当成了第 3 步**：

```ts
export function apply(ctx: Context) {
  ctx.subagents.registerProvider(new LocalReviewerProvider())   // ← 只做这一步
}
```

provider 注册好了，`ctx.subagents.start(...)` 也能用了，**但模型看不见任何入口**。
修法是补上模型可见工具这一层（[`impl/01`](../M08-delegation-presets/impl/01-subagent-delegation.ts)）：

```ts
ctx.tools.register(defineTool({ name: 'review_with_subagent', ... }))   // ← 只有这一步改变模型可见面
```

另一个同类错因是**依赖缺失**：插件 `inject` 里没写 `subagents` 或 `tools`，`apply` 里访问
服务时会在运行到那一刻才炸（错误形如 `cannot get property "..." without inject`）。
写法就是 `impl/01` 里的 `export const inject = ['subagents', 'tools']`。

**这个坑的特征**：程序安静地少了一样东西。事件是证据不是尝试记录，所以"没有事件"和
"没有发生"在输出上长得一模一样——必须回看**模型可见工具**那一行才能分辨。

---

## 8. 代码在哪

```bash
cd dsh-example && ls M08-delegation-presets/impl M08-delegation-presets/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-subagent-delegation.ts`](../M08-delegation-presets/impl/01-subagent-delegation.ts) | 文件头三步通路注释；`implements SubagentProvider`；`registerProvider`；`defineTool` 的 `execute` 里 `exec.agent` 守卫 + `start` + `finally dispose` |
| [`impl/02-agent-presets.ts`](../M08-delegation-presets/impl/02-agent-presets.ts) | `inject: ['sessionProjections']`；`roots: []` 与两个 `include*Root: false` |
| [`impl/03-permission-presets.ts`](../M08-delegation-presets/impl/03-permission-presets.ts) | 它只是再导出官方服务——戏在场景里 |
| [`impl/04-subagent-model-selection.ts`](../M08-delegation-presets/impl/04-subagent-model-selection.ts) | `model-selection-settings` 再导出 |
| [`scenes/01-delegate-a-review.ts`](../M08-delegation-presets/scenes/01-delegate-a-review.ts) | 两个 `subagent/*` 监听器；`callTool` 扮演"模型已决定调用"那一步 |
| [`scenes/02-empty-preset-roster.ts`](../M08-delegation-presets/scenes/02-empty-preset-roster.ts) | 三个数（service / roots / discovered）怎么打出来 |
| [`scenes/03-reject-unisolated-shell.ts`](../M08-delegation-presets/scenes/03-reject-unisolated-shell.ts) | `try { await fiber } catch`；`failLoud` 是脚本自己算的 |
| [`scenes/04-authorize-subagent-route.ts`](../M08-delegation-presets/scenes/04-authorize-subagent-route.ts) | `allowedModels` 里的 provider/model 对 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。M08 四个 scene 都很短，
`scenes/02` 只有 6 行，适合第一个读。

---

## 9. 动手练习

### 练习 A：证明"注册 provider"确实对模型不可见

把 [`impl/01-subagent-delegation.ts`](../M08-delegation-presets/impl/01-subagent-delegation.ts) 里
`ctx.tools.register(defineTool({...}))` 那一整段**注释掉**（保留 `registerProvider`）。

**验证命令**

```bash
cd dsh-example && node M08-delegation-presets/scenes/01-delegate-a-review.ts
```

**可验证答案**：`① 已注册子代理 provider: [ 'local-reviewer' ]` 仍在，
`② 已注册模型可见工具: []`（变成空列表），接着脚本**直接抛错退出**，
错误信息是 `不该失败: unknown tool "review_with_subagent"`
（[`scenes/01`](../M08-delegation-presets/scenes/01-delegate-a-review.ts) 里有
`if (res.isError) throw new Error(...)` 这层断言），并且**没有任何 `subagent/*` 事件**。
这就是第 3 节那张三步表的可执行版本。

### 练习 B：让子代理"继承父会话"，观察描述变化

在 `LocalReviewerProvider` 上把 `readonly inheritsParentContext = false` 改成 `true`，再跑一次：

```bash
cd dsh-example && npm run M08
```

**可验证答案**：本例的 `review_with_subagent` 是手写描述（不受 `inheritsParentContext` 影响），
所以**输出不会有可见变化**——`REAL_MODULE_OK M08 stages=4` 照常通过。
第 5 节讲的措辞改写发生在真实产品的 `dsh-tool-subagent` 里：它用 `providerWording(...)` 按
`inheritsParentContext` 生成工具描述。所以这道题的答案是：**改这个字段，改的是"真实产品会怎么说"，
不是本例的输出**——想亲眼看到就去看 `dsh-tool-subagent` 里那两条描述。

### 练习 C：验证 `start()` 抛错时两个事件都不发

在 [`scenes/01-delegate-a-review.ts`](../M08-delegation-presets/scenes/01-delegate-a-review.ts) 的
`callTool` 之前加一段：故意启动一个不存在的 provider，并单独挂两个监听器做计数：

```ts
let events = 0
harness.ctx.on('subagent/start', () => { events += 1 })
harness.ctx.on('subagent/end', () => { events += 1 })
try {
  await harness.ctx.subagents.start('ghost', { prompt: [{ type: 'text', text: 'x' }], parent: harness.agent, signal: new AbortController().signal })
} catch (error) {
  console.log('start 抛错:', (error as Error).message)
}
console.log('事件数:', events)
```

**验证命令**

```bash
cd dsh-example && node M08-delegation-presets/scenes/01-delegate-a-review.ts
```

**可验证答案**：抛错信息是 `no subagent provider registered for "ghost"`，而 `事件数: 0`。
之后原来那次正常委派仍会打出 `subagent/start` / `subagent/end` 两行——
**失败的那次一个事件都不发，成功的那次发两个**，这就是第 5 节说的"没有 published child 就没有事件"。

---

**下一课** → [第 09 课 · 长任务与编排](09-long-running-orchestration.md)：运行句柄与目标状态。

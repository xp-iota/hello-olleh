# 第 06 课 · 人在环路：六种人机协议

> **本课任务**：给宿主注册一条人类斜杠命令 `/hello`，再让一次 `deploy` 工具调用依次经历
> 「没人可问 → fail closed」「白名单放行 → allowed-once」「明确拒绝 → rejected」三种审批局面；
> 最后看清问题、计划、待办、反馈四种协议各自的持久化落点。
> **运行命令**：`cd dsh-example && npm run M06`
> **你将看到**：`/hello 张三` 返回一句问候而**没有消耗任何模型 turn**，`/nope` 明确落到 `undefined`；
> `deploy` 在没有应答器时以 `unavailable` 拒绝而不是默默放行。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课沿用同一个 `runtime/harness.ts` 装配链，
所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

「人在环路」不是一件事，是**六种方向不同、状态不同的协议**。它们唯一的共同点是：链路里有一个
真实的人（或代表人的策略）在某一步作出了显式裁决。本课把六种协议摊开：

| 协议 | 方向 | 入口 seam | 应答 / 状态 | 本课实现 |
|---|---|---|---|---|
| **斜杠命令** | 人 → 宿主 | `ctx.commands.execute` | `{kind:'success'\|'error', text?}`；**不消耗模型 turn** | `impl/01-command-hello.ts` |
| **审批** | 系统 → 人 | `ctx.approval.request`（由 `pre-execute` 的 `{kind:'ask'}` 触发） | 封闭四值 `ApprovalOutcome` | `impl/02-approval-answerer.ts` |
| **用户问题** | agent → 人 | `ctx.userQuestions.ask` | `{answers:[{id,selected,custom?}]}` | `impl/03-user-questions.ts` |
| **计划模式** | 人 ↔ agent | `/plan` 命令 + `ctx.planMode.set` | 日志投影 `plan` + 稳定退出工具 `exit_plan_mode` | `impl/04-plan-mode.ts` |
| **Todo** | agent → 人（可见） | `todo_write` 工具 | **整表替换** + `todos` 投影 | `impl/05-todo.ts` |
| **消息反馈** | 人 → 会话 | `ctx.messageFeedback` | 经 persistence 读取的耐久列表 | `impl/06-message-feedback.ts` |

本课要建立的三个核心直觉：

1. **命令不走模型**。命令是宿主自己执行的本地动作；想让模型也看见，必须显式 `followup`。
2. **审批是一个封闭枚举，缺能力就拒绝**。没有「默认放行」这个分支。
3. **计划、待办、反馈都不是内存状态**，而是能回放、能恢复的**日志/持久化投影**。

```bash
cd dsh-example && npm run M06
```

---

## 2. 真实输出

```text

████ M06 · 人在环路：显式命令与执行审批 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M06.1 · 人类斜杠命令直接进入宿主 ────
已注册命令: [ '/hello [可选: 要问候的名字]' ]
/hello 张三    → {"kind":"success","text":"你好，张三！"}
/hello       → {"kind":"success","text":"你好，朋友！"}
/nope        → (undefined：不是已注册命令)
会话日志里的命令事件: [ 'command/run', 'command/done', 'command/run', 'command/done' ]
REAL_STAGE_OK M06.1 calls=1 ms=1198 in=0 out=125 finish=stop

──── M06.2 · 工具 ask 请求进入审批 seam ────
== 场景：无应答器 → fail closed ==
  approval/decided → outcome: unavailable
  tool/result      → isError: true | Error: tool "deploy" requires approval, but no approval channel is available

== 场景：应答器把 deploy 列入白名单 → allowed-once ==
[approval] 自动放行(allowed-once)：deploy
  approval/decided → outcome: allowed-once
  tool/result      → isError: false | deploy 已执行: env=prod path= cmd=

== 场景：应答器不在白名单 → rejected ==
[approval] 拒绝(rejected)：deploy —— 部署需人工确认
  approval/decided → outcome: rejected
  tool/result      → isError: true | Error: the user rejected tool "deploy"
REAL_STAGE_OK M06.2 calls=6 ms=12359 in=0 out=1520 finish=stop tools=deploy,deploy,deploy "我调用了 `deploy` 工具（`env=prod`），但本次调用被审批方拒绝…"

──── M06.3 · 结构化问题进入宿主 answerer ────
userQuestions: { answers: [ { id: 'confirm', selected: [Array] } ] }
REAL_STAGE_OK M06.3 calls=1 ms=443 in=0 out=69 finish=stop

──── M06.4 · 用日志投影切换计划模式 ────
planMode: {
  transition: 'committed',
  state: { active: true },
  exitToolVisible: true
}
REAL_STAGE_OK M06.4 calls=1 ms=444 in=0 out=85 finish=stop

──── M06.5 · 整体替换 todo 列表 ────
todo: {
  isError: false,
  projection: [
    { content: '核对服务', status: 'completed' },
    { content: '运行门禁', status: 'in_progress' }
  ]
}
REAL_STAGE_OK M06.5 calls=1 ms=630 in=0 out=60 finish=stop

──── M06.6 · 读取耐久消息反馈 ────
messageFeedback: {
  service: 'MessageFeedbackService',
  persistence: 'JsonlSessionPersistence',
  listResult: { ok: true, value: { items: [] } }
}
REAL_STAGE_OK M06.6 calls=1 ms=929 in=0 out=54 finish=stop

REAL_MODULE_OK M06 stages=6 calls=11 failed=0
```

**对照自己的输出**：最后一行必须逐字出现 `REAL_MODULE_OK M06 stages=6 calls=11 failed=0`。

再看三个最快判读点：

- `M06.1` 的 `calls=1` 是机制阶段的**入口 probe**（一次真实复述请求），两次成功的命令派发
  **一次模型调用都没有加**——这就是「命令不消耗模型 turn」的直接证据。
- `M06.2` 是唯一的 `kind: 'model'` 阶段，`calls=6`、`tools=deploy,deploy,deploy`：三个场景各让真实模型
  在轮内派发了一次 `deploy`。
- `M06.4` 的 `exitToolVisible: true` 与 `M06.5` 的 `projection: [...]` 都是**读出来的**，不是打印常量。

---

## 3. 命令：一条不消耗模型 turn 的独立派发面

**先讲原理。** `ctx.commands` 是「人 → 宿主」的通道，和 `ctx.llm` / `agent-loop` 完全平行。用户在输入框
敲 `/hello 张三`，宿主把整行交给命令注册表；注册表找到 handler 就地执行、返回一段文本给 UI 渲染。
**全程没有一个 user message 被写进会话、没有一次模型请求**。这正是文档
[08 § 8.21](../../docs/hello-dsh/08-execution-services.md) 记的那句「`commands` 与 `tool-ask-user` 方向相反」：
前者人驱动宿主，后者宿主驱动人。

打开 [`impl/01-command-hello.ts`](../M06-human-in-the-loop/impl/01-command-hello.ts)：

```ts
export const name = 'command-hello'   // ← Cordis 插件名，不是命令名
export const inject = ['commands']    // ← 依赖 ctx.commands，满足后 apply 才运行

export function apply(ctx: Context) {
  ctx.commands.register({
    name: 'hello',                    // ← 小写、不带前导斜杠；用户输入 /hello
    description: '打印一句问候，并把当前会话名回显给你。',
    input: { hint: '[可选: 要问候的名字]' },   // ← 发现用的输入提示

    handler: (invocation) => {
      const who = invocation.rawInput.trim() || '朋友'   // ← rawInput 是命令名之后的全部内容
      // 纯本地动作：直接返回文本，UI 渲染。不产生模型请求。
      return { kind: 'success', text: `你好，${who}！` }
    },
  })
}
```

handler 拿到一个 `CommandInvocation`（含 `rawInput`、目标 agent、取消 `signal`），返回 `CommandResult`：
`{ kind:'success', text? }` 或 `{ kind:'error', text }`。**想让命令反过来喂模型，只有一条路**：
在 handler 里调用 `invocation.agent.followup(...)`（`impl/01` 的注释就是这么写的）——否则模型永远不知道
刚才发生过什么。

场景脚本 [`scenes/01`](../M06-human-in-the-loop/scenes/01-dispatch-slash-command.ts) 用真实的
`CommandRuntime` 口派发。注意 `execute` 的第二个参数是**完整的斜杠命令行**（含前导 `/`）：

```ts
console.log('已注册命令:', ctx.commands.list(agent).map((descriptor) => `/${descriptor.name} ${descriptor.input?.hint ?? ''}`.trim()))

for (const line of ['/hello 张三', '/hello', '/nope']) {
  const execution = await ctx.commands.execute(agent, line, [], signal)
  console.log(`${line.padEnd(12)} →`, execution ? JSON.stringify(execution.result) : '(undefined：不是已注册命令)')
}

console.log('会话日志里的命令事件:', agent.session.snapshotEvents().filter((event) => event.type.startsWith('command/')).map((event) => event.type))
```

这段代码逐行对上第 2 节 M06.1 的四行输出：

```text
已注册命令: [ '/hello [可选: 要问候的名字]' ]                       ← list(agent) 的发现视图
/hello 张三    → {"kind":"success","text":"你好，张三！"}            ← rawInput="张三"
/hello       → {"kind":"success","text":"你好，朋友！"}              ← rawInput 为空 → 回退"朋友"
/nope        → (undefined：不是已注册命令)                          ← 未知名字：不是错误结果，是 undefined
会话日志里的命令事件: [ 'command/run', 'command/done', 'command/run', 'command/done' ]
```

三个必须记准的结论：

- **`name` 是小写、不带斜杠的标识符**，用户才输 `/hello`。注册同名两次在同 scope 内直接抛错。
- **未知命令与语法错误返回 `undefined`，不写任何日志**。所以两个成功派发对应四行事件、恰好两对。
- **每次成功派发都写一对 `command/run` + `command/done`**。这对事件**没有被任何 turn 包住**——命令是
  独立平面的事件，这也是它「不消耗模型 turn」在日志层的体现。

> **原理对照**：命令注册表与派发口径见 [08 § 8.21](../../docs/hello-dsh/08-execution-services.md)；
> 「新行为放哪」的官方映射（加人类命令 → `command-<name>` 包）见
> [03 § 3.9](../../docs/hello-dsh/03-capability-seams-and-services.md)。

---

## 4. 审批：封闭四值与 fail closed

**先讲原理。** 当工具的 `pre-execute` 监听者返回 `{ kind:'ask', reason }`，这次调用不会执行也不会失败，
而是流向**审批 seam**：`ctx.approval.request(req)` 把请求交给监听 `approval/request` 的**应答器**。
应答器必须返回一个**封闭四值** `ApprovalOutcome`：

| 值 | 含义 |
|---|---|
| `allowed-once` | 唯一放行授权，**只对本次这一调用有效** |
| `rejected` | 人类明确拒绝 |
| `cancelled` | 取消了（signal 被 abort，迟到的回答会被丢弃） |
| `unavailable` | **没有应答器，或应答器抛错** —— fail closed |

`unavailable` 是这套设计的安全底线：**缺能力时拒绝，而不是默认放行，也不是无限等待**。真实实现里
连「应答器返回了一个不在词表里的野值」都会被归一成 `unavailable`。

打开 [`impl/02-approval-answerer.ts`](../M06-human-in-the-loop/impl/02-approval-answerer.ts)——它只做
「应答器」这一件事，不碰工具、不碰 `pre-execute`：

```ts
export const name = 'approval-answerer'
export const inject = []   // ← 只监听事件，不消费任何 ctx 服务
export const Config: z<Config> = z.object({
  autoApprove: z.array(z.string()).default([]),
})

export function apply(ctx: Context, config: Config) {
  ctx.on('approval/request', async (req: ApprovalRequest): Promise<ApprovalOutcome> => {
    if (config.autoApprove.includes(req.toolName)) {
      console.log(`[approval] 自动放行(allowed-once)：${req.toolName}`)
      return 'allowed-once'
    }
    console.log(`[approval] 拒绝(rejected)：${req.toolName} —— ${req.reason ?? '无因'}`)
    return 'rejected'
  })
}
```

应答器是 **waterfall 监听者**：返回一个 outcome 就是替这个 agent 作答，调用 `next()` 则把决定权交给链上
更专门的应答器（例如先问"是否命中预设"，未命中再弹 UI）。所以 CLI 交互弹窗、Web 审批卡片、CI 的
自动放行白名单、YOLO 全放行——**它们不是四套机制，只是四个不同的应答器实现**。

场景脚本 [`scenes/02`](../M06-human-in-the-loop/scenes/02-three-approval-outcomes.ts) 用一次内联插件把
`deploy` 变成「一律先请示」，再跑三种应答局面：

```ts
const deployGate = {
  name: 'deploy-gate',
  inject: ['tools'],
  apply(ctx: any) {
    ctx.tools.register(demoTool('deploy', '部署到指定环境'))
    ctx.on('tools/pre-execute', async (exec: any, next: () => any) =>
      exec.name === 'deploy' ? { kind: 'ask', reason: '部署需人工确认' } : next())
  },
}

const PROMPT = '请调用 deploy 工具把服务部署到 prod 环境。必须调用该工具，不要只给出建议。'
```

三种局面分别用「装不装应答器」「白名单里有没有 deploy」切换，输出与第 2 节完全对应：

```text
无应答器          → outcome: unavailable | Error: tool "deploy" requires approval, but no approval channel is available
白名单 autoApprove:['deploy'] → outcome: allowed-once | isError: false | deploy 已执行: env=prod path= cmd=
白名单 autoApprove:[]         → outcome: rejected     | Error: the user rejected tool "deploy"
```

注意后两种局面都装的是**同一个插件**，只差配置——这就是「策略不写在工具里」在审批面的复现。

### 一条容易踩的不变量：`approval.request()` 必须在打开的 turn 内

这是本阶段最值钱的细节。`approval/asked` + `approval/decided` 是**一对审计事件**，它们必须被 turn
包住；否则重放日志时会留下一条**崩溃尾巴**（有问无答）。真实实现因此在「空闲或轮间调用时」**先抛错、
连审计都不写**。

所以 `scenes/02` 不能在 turn 外裸调工具去触发审批，而是明确指令让**真实模型**在轮内派发 `deploy`，
审批自然发生在轮内：

```ts
  if (!sawToolCall) {
    throw new Error(`${label.trim()}：模型本轮没有调用 deploy —— 审批链路未被验证`)
  }
  if (outcome === undefined) {
    throw new Error(`${label.trim()}：deploy 被调用但没有发生 approval/decided —— 审批不变量未被验证`)
  }
```

场景对每个局面都**主动核验**：模型真的调了 `deploy`（否则 fail loud），且真的发生了 `approval/decided`
（否则 fail loud）。第 2 节 M06.2 的 `tools=deploy,deploy,deploy` 就是「模型确实在轮内派发了三次」的
证据；实测事件序列是 `tool/call → approval/asked → approval/decided → tool/result`。

> **原理对照**：审批链从 `ask` 到用户的完整路径见 [08 § 8.21](../../docs/hello-dsh/08-execution-services.md)；
> 「缺能力时 ask 等价于 deny」是 fail-closed 在全仓的四处体现之一，见
> [08 § 8.23](../../docs/hello-dsh/08-execution-services.md)；`pre-execute` 三段 waterfall 的契约见
> [07 § 7.11](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)。

---

## 5. 用户问题：scoped answerer waterfall，不是伪装的提示词

**先讲原理。** 模型想问人类一个**结构化问题**（选项、多选、标题），这属于 `user-questions` seam，底层是
一条 **answerer waterfall**，**不能**把它降级成往上下文里塞一句「请问用户是否继续？」——那样既拿不到
结构化答案，也让「谁在等谁」变得不可观测。`ctx.userQuestions.ask(request)` 派发 waterfall，
**等待第一个接受请求的回答者**；无人接受则以 `NO_PROVIDER` 失败。

[`impl/03-user-questions.ts`](../M06-human-in-the-loop/impl/03-user-questions.ts) 整个文件只有三行：

```ts
/** 通过 scoped waterfall 把结构化问题交给宿主 answerer，而不是伪装成提示词。 */
export { UserQuestionService as default, UserQuestionService, UserQuestionError } from '@deepseek-ai/dsh-user-questions'
export type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
```

它演示的是**Service Definition 与 Service Consumer 的分工**：这里只装配服务，回答者由场景挂上。

[`scenes/03`](../M06-human-in-the-loop/scenes/03-answer-structured-questions.ts) 装服务后注册一个
最小回答者，然后提出一个二选一问题：

```ts
harness.ctx.on('user-questions/request', request => Promise.resolve({
  answers: request.questions.map(question => ({ id: question.id, selected: ['继续'] })),
}))
const answer = await harness.ctx.userQuestions.ask({
  agent: harness.agent,
  questions: [{ id: 'confirm', question: '继续执行离线教学阶段？', options: [{ label: '继续' }, { label: '停止' }] }],
})
console.log('userQuestions:', answer)
```

输出是：

```text
userQuestions: { answers: [ { id: 'confirm', selected: [Array] } ] }
```

这里的 `[Array]` 是 `console.log` 的**默认展开深度**把内层数组折叠了，不是答案本身长这样——
场景代码里那个内层数组是 `['继续']`。要点是：**答案按 `id` 回填**，每个问题带自己的 `selected`
（单选时 `custom` 会覆盖 `selected`；跳过的条目保留为 `{ id, selected: [] }`）。请求里带 `agent` 时，
`ask()` 会验证它是注册表里**同一个存活实例**，并且只允许运行时根调用。

> **原理对照**：`ctx.userQuestions` 与 `tool-ask-user`（模型主动问用户的工具）的分工见
> [08 § 8.21](../../docs/hello-dsh/08-execution-services.md)。

---

## 6. 计划模式：状态写进日志投影，退出走稳定工具

**先讲原理。** 计划模式要问的是「agent 现在是不是在只规划、不执行的状态」。它**不改 `AgentLoop`**，
而是做两件正交的事：

1. **状态进日志投影**。plan 状态是一个 `sessionProjections` 单元，由**查询日志事件**算出来——因此
   它天然跟随回放、恢复与 fork，而不是一份会跟日志漂移的内存布尔量。
2. **退出走稳定工具**。模型规划完成后调用 `EXIT_PLAN_MODE`（值就是 `exit_plan_mode`）这个**具名工具**
   来请求退出，由人类审阅计划。工具名是稳定契约，UI 才能挂审批卡。

[`impl/04-plan-mode.ts`](../M06-human-in-the-loop/impl/04-plan-mode.ts) 只做转发：

```ts
/** planMode 用日志投影和稳定 exit tool 管理模式，不修改 AgentLoop。 */
export { PlanModeController as default, PlanModeController, EXIT_PLAN_MODE } from '@deepseek-ai/dsh-plan-mode'
```

[`scenes/04`](../M06-human-in-the-loop/scenes/04-toggle-plan-mode.ts) 装载它、切一次状态，然后**读三样东西**：

```ts
await harness.loadPlugin(PlanModeController, { section: '计划模式只允许分析和规划；完成后显式请求退出。' })
const transition = harness.ctx.planMode.set(harness.agent, true)
console.log('planMode:', { transition, state: harness.ctx.planMode.get(harness.agent), exitToolVisible: harness.visibleTools().includes(EXIT_PLAN_MODE) })
```

输出与第 2 节一致：

```text
planMode: {
  transition: 'committed',
  state: { active: true },
  exitToolVisible: true
}
```

- **`transition: 'committed'`** —— `set()` 的返回值说明这次切换**当场写进日志**了（另一种可能是
  `queued`：等下一个轮边界生效，那时状态只记录「有个待生效意图」）。
- **`state: { active: true }`** —— 从**投影**读出来的当前状态，而不是刚传进去的参数回显。
- **`exitToolVisible: true`** —— 退出工具真的出现在这个 agent 的**可见工具集**里。计划模式只要求
  「规划和呈现」，**不限制工具**；要强制限制请用沙箱与审批。

> **原理对照**：`plan-mode` 拦截 `agent/pre-step` 的位置见
> [06 § 6.5](../../docs/hello-dsh/06-agent-loop-and-session-log.md)；投影与持久化是两个独立 seam 见
> [06 § 6.16 附近](../../docs/hello-dsh/06-agent-loop-and-session-log.md)。

---

## 7. Todo 与消息反馈：整表替换 vs 耐久读取

这两个协议常被放一起讲，因为它们代表两种截然不同的持久化姿态。

### Todo：每次都替换整张表

**先讲原理。** `todo_write` 没有「改一条 / 删一条」的 API。模型每次发送**完整列表**，新列表**替换**
旧列表；`todo/write` 快照落在事件日志上，再由投影单元折叠成 `todos` 快照。既然状态来自日志，
**不需要一个额外的服务去存它**，回放与恢复就自动成立。

[`impl/05-todo.ts`](../M06-human-in-the-loop/impl/05-todo.ts) 同样只是转发：

```ts
/** todo_write 每次替换完整列表，并把快照折叠到 `todos` session projection。 */
export { name, inject, Config, apply } from '@deepseek-ai/dsh-tool-todo'
export type { Config as TodoConfig, TodoItem } from '@deepseek-ai/dsh-tool-todo'
```

[`scenes/05`](../M06-human-in-the-loop/scenes/05-replace-todo-list.ts) 一次写入两条，再读投影：

```ts
const harness = await createHarness({ plugins: [[todo, { allowParallelInProgress: false }]] })
const result = await harness.callTool('todo_write', {
  todos: [
    { content: '核对服务', status: 'completed' },
    { content: '运行门禁', status: 'in_progress' },
  ],
})
console.log('todo:', { isError: result.isError, projection: harness.ctx.sessionProjections.stateOf(harness.agent.session, 'todos') })
```

输出：

```text
todo: {
  isError: false,
  projection: [
    { content: '核对服务', status: 'completed' },
    { content: '运行门禁', status: 'in_progress' }
  ]
}
```

**`projection` 是读出来的**：`stateOf(session,'todos')` 去重放日志里的 `todo/write` 事件。注意
`allowParallelInProgress: false` 这个配置——它决定「允不允许同时有两个 `in_progress`」，是
**部署策略而不是写死的规则**。这份列表属于**唯一一个 agent 会话**，subagent 各存各的，没有共享列表；
`todo_write` 只表达「把整张表改成这样」，**没有隐式局部更新**。

### 消息反馈：经 persistence 才是耐久

**先讲原理。** 反馈（用户给某条消息留下的评注）必须**跨进程重启存活**，所以它不读内存，而是经
`ctx.sessionPersistence` 这个独立 seam。`impl/06` 装配的是一整条离线栈：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(JsonlSessionPersistence, { root: config.root, compression: 'none' })
  await ctx.plugin(commandFeedback)
  await ctx.plugin(MessageFeedbackService, { maxNoteBytes: config.maxNoteBytes })
}
```

[`scenes/06`](../M06-human-in-the-loop/scenes/06-read-durable-feedback.ts) 建临时目录、装配、列一次反馈：

```ts
const listed = await harness.ctx.messageFeedback.list({ sessionId: harness.agent.session.id })
console.log('messageFeedback:', { service: harness.ctx.messageFeedback.constructor.name, persistence: harness.ctx.sessionPersistence.constructor.name, listResult: listed })
```

输出：

```text
messageFeedback: {
  service: 'MessageFeedbackService',
  persistence: 'JsonlSessionPersistence',
  listResult: { ok: true, value: { items: [] } }
}
```

`persistence: 'JsonlSessionPersistence'` 这行就是本节的证据：反馈是**经 JSONL 持久化服务**读出来的，
不是某个内存数组。`items: []` 是**真实的空结果**（场景只列不写），而不是失败——注意它的形状是
`{ ok: true, value: { items: [] } }`：**结果是带标签的联合**，读失败会以非 `ok` 的形状返回，
不会退化成空数组骗人。

`command feedback` 与 `message feedback` **共用同一份 Session 日志**，区别只在前者附在命令事件上、
后者附在消息上。

> **原理对照**：`todo/write` 落在 `P/core/session` 的事件日志上；持久化与投影是两个独立 seam，见
> [06 § 6.16 之后](../../docs/hello-dsh/06-agent-loop-and-session-log.md)；`feedback` 组两个包的分工见
> [04 § 4 附近](../../docs/hello-dsh/04-extensions-and-ecosystem.md)。

---

## 8. 排障：审批永远是 `unavailable`，工具直接失败

### 症状

高风险工具调用没有弹任何询问，直接失败：

```text
approval/decided → outcome: unavailable
tool/result      → isError: true | Error: tool "deploy" requires approval, but no approval channel is available
```

### 定位

1. 先看 `outcome`。只要是 `unavailable`，就**不是**「人拒绝了」，而是**根本没人能回答**。
2. 再查这次装配里**有没有装应答器**（监听 `approval/request` 的插件）。`unavailable` 的两个来源是
   「没有应答器」和「应答器抛了错」，两者都会被归一成同一个值。
3. 如果装了应答器还一直是 `unavailable`，看它是不是 **waterfall 上只有 `next()` 没有终点**——
   「兄弟监听者的顺序不是优先级机制」，链尾必须有一个真正返回 outcome 的应答器。

### 原因与修改

这正是第 2 节第一个场景（`plugins: []`）的处境：`ask` 请求发出去了，但没有应答器，于是 fail closed。
修法是**挂一个终止应答器**——`scenes/02` 的另外两个场景就是同一个 `answererPlugin` 的两种配置：

```ts
await scenario('== 场景：无应答器 → fail closed ==', [])
await scenario('\n== 场景：应答器把 deploy 列入白名单 → allowed-once ==', [[answererPlugin, { autoApprove: ['deploy'] }]])
await scenario('\n== 场景：应答器不在白名单 → rejected ==', [[answererPlugin, { autoApprove: [] }]])
```

装上 `autoApprove: ['deploy']` 后输出立刻变成 `outcome: allowed-once` + `isError: false`。

**不要"修"成默认放行。** 把 `ask` 悄悄当 allow，会让约束的假象比没有约束更危险；正确做法是给部署
补一个应答器（交互弹窗 / Web 审批卡 / CI 白名单），或者显式把策略设成 `never`（确定性地拒绝）。

> **同一个错误在别处的表现**：headless 模式不含 `user-approval`，所以需要审批的操作会被**拒绝**而不是
> 卡住等待——这正是 fail-closed 的预期行为，见
> [08 § 8.21](../../docs/hello-dsh/08-execution-services.md)。

---

## 9. 代码在哪

```bash
cd dsh-example && ls M06-human-in-the-loop/impl M06-human-in-the-loop/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-command-hello.ts`](../M06-human-in-the-loop/impl/01-command-hello.ts) | `name` 小写不带斜杠；`input.hint`；handler 返回 `{kind:'success',text}` |
| [`impl/02-approval-answerer.ts`](../M06-human-in-the-loop/impl/02-approval-answerer.ts) | `approval/request` 监听；`autoApprove` schema；返回 `'allowed-once'` / `'rejected'` |
| [`impl/03-user-questions.ts`](../M06-human-in-the-loop/impl/03-user-questions.ts) | Service Definition 只做导出；回答者由场景挂 |
| [`impl/04-plan-mode.ts`](../M06-human-in-the-loop/impl/04-plan-mode.ts) | `EXIT_PLAN_MODE` 是稳定工具名 |
| [`impl/05-todo.ts`](../M06-human-in-the-loop/impl/05-todo.ts) | 整表替换 + `todos` 投影的语义在包内 |
| [`impl/06-message-feedback.ts`](../M06-human-in-the-loop/impl/06-message-feedback.ts) | `JsonlSessionPersistence` → `commandFeedback` → `MessageFeedbackService` 的装配顺序 |
| [`scenes/01-dispatch-slash-command.ts`](../M06-human-in-the-loop/scenes/01-dispatch-slash-command.ts) | `execute(agent, line, [], signal)` 的完整命令行；`command/run` 事件过滤 |
| [`scenes/02-three-approval-outcomes.ts`](../M06-human-in-the-loop/scenes/02-three-approval-outcomes.ts) | `deployGate` 的 `{kind:'ask'}`；两个 fail-loud 断言 |
| [`scenes/03`](../M06-human-in-the-loop/scenes/03-answer-structured-questions.ts) / [`scenes/04`](../M06-human-in-the-loop/scenes/04-toggle-plan-mode.ts) / [`scenes/05`](../M06-human-in-the-loop/scenes/05-replace-todo-list.ts) / [`scenes/06`](../M06-human-in-the-loop/scenes/06-read-durable-feedback.ts) | 每个都只有一个 `console.log`，适合当"读哪一行出哪一行"的对照 |

读法：**先读 scene 看它读什么、断言什么，再读 impl 看它注册/监听了什么**。本模块的 impl 大多只有
几行——因为它们演示的是"接缝在哪"，而不是"逻辑多复杂"。

---

## 10. 动手练习

### 练习 A：让命令自己决定成败

打开 [`impl/01-command-hello.ts`](../M06-human-in-the-loop/impl/01-command-hello.ts)，把 handler 改成：
`rawInput` 去掉空白后为空就返回 `{ kind: 'error', text: '请告诉我该问候谁。' }`。

**验证命令**

```bash
cd dsh-example && node M06-human-in-the-loop/scenes/01-dispatch-slash-command.ts
```

**可验证答案**：不带参数的 `/hello` 那行从 `{"kind":"success","text":"你好，朋友！"}` 变成
`{"kind":"error","text":"请告诉我该问候谁。"}`；`/nope` 仍然是 `(undefined：不是已注册命令)`。
注意两种"失败"是**不同性质**的：handler 的 `error` 是一次已派发的命令结算，而未知名字连注册表
都没进——后者不写任何日志。

### 练习 B：把拒绝局面翻成放行

打开 [`scenes/02`](../M06-human-in-the-loop/scenes/02-three-approval-outcomes.ts)，把第三个场景的
`{ autoApprove: [] }` 改成 `{ autoApprove: ['deploy'] }`，再跑一次。

**验证命令**

```bash
cd dsh-example && npm run M06
```

**可验证答案**：第三段输出从 `outcome: rejected` / `Error: the user rejected tool "deploy"` 变成
`outcome: allowed-once` / `isError: false`，并且出现 `[approval] 自动放行(allowed-once)：deploy`。
**同一份工具、同一份 gate，只有应答器配置变了**——这就是"策略不写在工具里"。跑完记得改回去，
否则三个场景里会有两个看起来一模一样。

### 练习 C（进阶）：观察整表替换的护栏

打开 [`scenes/05`](../M06-human-in-the-loop/scenes/05-replace-todo-list.ts)，把两条 todo 都写成
`status: 'in_progress'`，保持配置 `allowParallelInProgress: false` 不变。

**验证命令**

```bash
cd dsh-example && node M06-human-in-the-loop/scenes/05-replace-todo-list.ts
```

**可验证答案**：`isError` 变成 `true`（工具在 `execute` 阶段就拒绝了"同时两个进行中"），并且
`projection` 不会变成你写的那张表——校验发生在 `todo/write` 写入日志**之前**，所以日志里没多出任何
快照，投影维持原值。想让它成功，就得把配置改成 `allowParallelInProgress: true`，或者只留一条
`in_progress`——**这是在部署策略和模型行为之间做选择**。

---

**下一课** → [第 07 课 · 执行侧后端](07-execution-backends.md)：真实副作用分成三层——工具表达 I/O 意图，
执行 seam 选择后端，沙箱把策略落到进程边界。

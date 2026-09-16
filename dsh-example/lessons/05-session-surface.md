# 第 05 课 · 会话面：日志是事实，surface 是投影

> **本课任务**：跑一个真实 turn，然后逐条验证会话日志的四条不变量——`seq` 连续、事件深冻结、
> `deriveMessages()` 只投影 surface 事件、`replace` 是位置性替换——再依次装载持久化、查询、
> 投影缓存与标题四个 Provider，看清"事实 / 语料 / 加速 / 派生"为什么要分层。
> **运行命令**：`cd dsh-example && npm run M05`
> **你将看到**：12 条日志事件、`连续 = true`、改写冻结事件抛 `TypeError`、一次真实 `replace`
> 让 surface 节点 `4 → 3`、fork 的稳定前缀要求与 `flush → false`；随后四个 Provider 各打印一行结论。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

DSH 同时维护**两种视图**：

- **事件日志（event log）** 是唯一事实来源，只追加、永不修改；
- **surface（模型可见面）** 是从日志投影出来的、模型真正读到的消息序列。

口号是 **"model-visible means logged"**——**凡是模型能看到的，必须能从日志重建**。
本课先验证这条约束怎么被强制执行，再看日志周围那一圈服务为什么不能揉成一个。

| 控制面 | 回答的问题 | 本课对应实现 |
|---|---|---|
| **日志本体** | 事实怎么记录、怎么被投影成模型输入？ | `impl/01-session-log.ts`、`scenes/01-check-log-invariants.ts` |
| **事实耐久化** | 日志怎么落盘？ | `impl/02-session-persistence.ts` |
| **语料读取** | 历史会话怎么查？ | `impl/03-session-query.ts` |
| **投影加速** | 重启后怎么不重放全部历史？ | `impl/04-session-projection-cache.ts` |
| **标题派生** | 标题存在哪？ | `impl/05-session-title.ts` |

前一个是本课的**教学主线**（有真实模型 turn），后四个是**扩展面**（只装载真实 Provider 并打印结论）。

```bash
cd dsh-example && npm run M05
```

---

## 2. 真实输出

```text
████ M05 · 会话面：日志、持久化、查询、投影与标题 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M05.1 · 验证会话日志和模型可见面的不变量 ────
① 跑一个 turn（事件先落日志，append 即广播）:
  [log] seq=0 agent/inbox/spliced
  [log] seq=1 turn/start
  [log] seq=2 agent/inbox/spliced
  [log] seq=3 step/start
  [log] seq=4 system/message surfaceOp="append"
  [log] seq=5 user/message surfaceOp="append"
  [log] seq=6 user/message surfaceOp="append"
  [log] seq=7 request/header
  [log] seq=8 request/context
  [log] seq=9 assistant/message surfaceOp="append"
  [log] seq=10 step/end
  [log] seq=11 turn/end

② 不变量：seq 连续性（seq === 数组下标）
   连续 = true | 事件数 = 12

③ 不变量：事件深冻结（改写被拒）
   改写冻结事件 → TypeError（符合预期）

④ deriveMessages：只投影 surface 事件（chunk 不在其中）
   投影消息: system:You are an A | user:你好 | user:Current runt | assistant:reasoning,你好！很高兴见到你。有什

⑤ surfaceOp replace：位置性替换——摘要占据被遮蔽区间的原位置
  [log] seq=12 user/message surfaceOp={"op":"replace","startSeq":5,"endSeq":6}
    surface 节点 4 → 3，投影现在以摘要开头:
    system:You are an A | user:（摘要）前文已折叠 | assistant:reasoning,你好！很高兴见到你。有什

⑤b 两条 fail-closed 校验（真实实现的抛错原文）:
   区间不在 surface 上: surface replace at seq 13: startSeq and endSeq must reference earlier events
   引用不完整      : sourceEventSeqs must not be empty

⑥ fork：只能从**稳定前缀**分叉——边界落在未闭合的 turn 里会被拒
   边界在 open turn 内: fork boundary 2 in session "demo-session" ends inside open turn 1
  [store] session/created → demo-fork
   从 boundary=12 分叉 → 子会话 demo-fork 继承了 14 条事件

⑦ flush：parallel 持久化检查点（无监听者也正常返回）
   flush → false
REAL_STAGE_OK M05.1 calls=1 ms=946 in=0 out=45 finish=stop "你好！很高兴见到你。有什么我可以帮你的吗？"

──── M05.2 · 装载 JSONL persistence Provider ────
sessionPersistence: { backend: 'JsonlSessionPersistence', storedSessions: 0 }
REAL_STAGE_OK M05.2 calls=1 ms=937 in=0 out=116 finish=stop

──── M05.3 · 查询 live-preferred 会话语料 ────
sessionQuery: {
  provider: 'ExactReadSessionQuery',
  livePreferredCount: 1,
  firstId: 'demo-session'
}
REAL_STAGE_OK M05.3 calls=1 ms=651 in=0 out=73 finish=stop

──── M05.4 · 耐久化 projection checkpoint ────
sessionProjectionCache: {
  backend: 'JsonStorageBackend',
  cached: true,
  keys: [ 'subagentCatalog', 'subagentTiming', 'subagent', 'goal', 'inbox' ]
}
REAL_STAGE_OK M05.4 calls=1 ms=690 in=0 out=134 finish=stop

──── M05.5 · 把标题写成 latest-wins 日志事件 ────
sessionTitle: { title: '会话服务链', source: 'user', foldedAgain: '会话服务链' }
REAL_STAGE_OK M05.5 calls=1 ms=937 in=0 out=190 finish=stop

REAL_MODULE_OK M05 stages=5 calls=5 failed=0
```

**对照自己的输出**：最后一行必须是 `REAL_MODULE_OK M05 stages=5 calls=5 failed=0`。
如果你只关心主线，先确认 M05.1 里出现了 `连续 = true` 和 `surface 节点 4 → 3`——这两行分别代表
"日志契约成立"和"surface 可被重写"。`storedSessions: 0` 不是失败，原因见第 5、6 节。

---

## 3. 日志本体：不变量与模型可见投影

打开 [`M05-session-surface/impl/01-session-log.ts`](../M05-session-surface/impl/01-session-log.ts)。
整个插件只做一件事：把 `session/event` 打成流水账。

```ts
export const name = 'session-log'
export const inject = ['sessions']

export function apply(ctx: Context) {
  ctx.on('session/event', (session: any, event: any) => {
    console.log(`  [log] seq=${event.seq} ${event.type}${event.surfaceOp ? ` surfaceOp=${JSON.stringify(event.surfaceOp)}` : ''}`)
  })
  ctx.on('session/created', (session: any) => {
    console.log(`  [store] session/created → ${session.id}`)
  })
}
```

`inject = ['sessions']` 表示"等 `ctx.sessions`（会话日志服务）可用后再装监听器"。
第 2 节 ① 的 12 行 `[log] ...` 就是它打的。

### 不变量一：`append` 分配 `seq = log.length`

打开 [`scenes/01-check-log-invariants.ts`](../M05-session-surface/scenes/01-check-log-invariants.ts)：

```ts
console.log('\n② 不变量：seq 连续性（seq === 数组下标）')
const contiguous = session.snapshotEvents().every((event, index) => event.seq === index)
console.log('   连续 =', contiguous, '| 事件数 =', session.snapshotEvents().length)
```

真实实现里 `append` 就是这么写的：`seq: SessionSeq(this.log.length)`
（`packages/core/session/src/index.ts:727`）。**新事件的 `seq` 等于追加前的数组长度**，
所以"事件序号"和"数组下标"永远是同一个东西。这不是巧合而是契约——整个系统的重放、
持久化、`fork` 都建立在它之上。第 2 节 ② 的 `连续 = true | 事件数 = 12` 就是这条契约的实测。

### 不变量二：事件接受即被**深冻结**

```ts
console.log('\n③ 不变量：事件深冻结（改写被拒）')
try {
  ;(session.snapshotEvents()[0]!.data as any).turn = 999
  console.log('   居然改成功了?!')
} catch {
  console.log('   改写冻结事件 → TypeError（符合预期）')
}
```

`append` 在事件入列前对它做 `deepFreeze`（`index.ts:725`），所以**连嵌套的 `data` 也是冻结的**；
改写它抛 `TypeError`，而不是静默成功。输出里 `居然改成功了?!` 这一分支永远不会被走到。

为什么值得这么严：`deriveMessages()` 返回的 `Message` 对象**直接复用**日志里已冻结的事件数据
（不做第二次深拷贝）。冻结是"模型可见内容不能被就地篡改"这条保证的实现方式。

> **原理对照**：`append()` 的四道防御与"Model-visible means logged"见
> [06 § 6.12 / § 6.14](../../docs/hello-dsh/06-agent-loop-and-session-log.md)。

### 不变量三：`deriveMessages()` 只投影 surface 事件

第 2 节 ① 的日志里有 12 条事件，但 ④ 的投影只有 4 条：

```text
   投影消息: system:You are an A | user:你好 | user:Current runt | assistant:reasoning,你好！很高兴见到你。有什
```

打出这行的是场景里的一个小工具函数（`describe`，只取每条文本块的前 12 个字符，
非文本块直接打印它的类型名）：

```ts
const describe = (message: { role: string; content: Array<{ type: string; text?: string }> }) =>
  `${message.role}:${message.content.map((block) => (block.type === 'text' ? block.text?.slice(0, 12) : block.type)).join(',')}`
console.log('   投影消息:', session.deriveMessages().map(describe).join(' | '))
```

对着 12 行日志逐条看，就知道谁进了投影、谁没进：

| 日志事件 | 进投影？ |
|---|---|
| `agent/inbox/spliced` ×2、`turn/start`、`step/start`、`step/end`、`turn/end` | 否——生命周期记录 |
| `request/header`、`request/context` | 否——请求组装记录 |
| `system/message`（seq 4，`surfaceOp="append"`） | **是** → `system:You are an A` |
| `user/message`（seq 5，`surfaceOp="append"`） | **是** → `user:你好` |
| `user/message`（seq 6，`surfaceOp="append"`） | **是** → `user:Current runt` |
| `assistant/message`（seq 9，`surfaceOp="append"`） | **是** → `assistant:reasoning,...` |

结论写在 `deriveMessages` 的文档注释里：**surface 是派生历史的唯一来源**
（`packages/core/session/src/index.ts:825`）——每个"会产生消息"的事件在 `append` 时都要
带 `surfaceOp` 标记；**没有标记的原始事件（chunk、turn 边界）因此正确地缺席**。

两个容易误读的细节：

- `assistant:reasoning,你好！…` 里的 `reasoning` 是 `describe` 打印的**块类型**
  （模型的思考块），不是文本内容；
- 0.1.5 的日志里没有 `assistant/chunk` 行：流式原文内嵌在 `assistant/message.stream`
  里（`packages/core/session/src/types.ts:319`）。无论形态如何，chunk 类记录都不是
  surface 事件，所以永远不会出现在投影里。

顺便记住 0.1.5 的 surface 事件类型有**四个**：`system/message`、`user/message`、
`assistant/message`、`tool/result`（`types.ts:412`）。前三个在这一课出现了。

---

## 4. `surfaceOp`：`append` 入列，`replace` 位置性替换

`surfaceOp` 是**决定一个事件是否进入模型可见面的开关**，两种形态：

| 形态 | 语义 |
|---|---|
| `'append'` | 事件入列，追加到 surface 末尾 |
| `{ op: 'replace', startSeq, endSeq }` | **先遮蔽**当前 surface 上 `[startSeq, endSeq]` 这段节点，**再**把新事件放在被遮蔽区间的**原位置** |

后者就是"上下文压缩"折叠历史的方式。打开 [`scenes/01-check-log-invariants.ts`](../M05-session-surface/scenes/01-check-log-invariants.ts)：

```ts
const surfaceBefore = [...session.surface.nodes]
// start/end 必须是**当前 surface 上真实存在的节点 seq**，不是日志下标；写错会抛错而不是静默无效。
// 0.1.5：surface 节点 0 holds the system prompt —— 运行期只允许 system/message 在
// 恰好那一个节点上改写它。所以遮蔽区间从节点 1 起，跳过系统提示。
const shadowed = surfaceBefore.slice(1, 3)
// 0.1.5：只有能引用来源事件的节点才能替换 surface。assistant/message 的
// sourceEventSeqs 是 never，所以检查点用 user/message（与上游 compaction 一致）。
session.append(
  'user/message',
  createUserMessage({ content: [{ type: 'text', text: '（摘要）前文已折叠' }], source: { kind: 'user' } }) as any,
  { surfaceOp: { op: 'replace', startSeq: shadowed[0]!, endSeq: shadowed[shadowed.length - 1]! }, sourceEventSeqs: shadowed },
)
console.log(`   surface 节点 ${surfaceBefore.length} → ${session.surface.nodes.length}，投影现在以摘要开头:`)
console.log('   ', session.deriveMessages().map(describe).join(' | '))
```

`shadowed` 取到的是节点 1 和 2，也就是 seq 5（`你好`）与 seq 6（`Current runt…`）。
真实输出：

```text
  [log] seq=12 user/message surfaceOp={"op":"replace","startSeq":5,"endSeq":6}
    surface 节点 4 → 3，投影现在以摘要开头:
    system:You are an A | user:（摘要）前文已折叠 | assistant:reasoning,你好！很高兴见到你。有什
```

**这行输出是本课最值得盯住的地方**：

- surface 从 4 个节点变成 3 个——被遮蔽的两个节点换成了一个；
- 摘要**出现在原位**（`system` 之后、`assistant` 之前），而不是追加到末尾。
  这就是"位置性替换"：`replace` 是**原地折叠**，不是"删掉旧的再补一条新的"；
- **日志里 seq 5 和 seq 6 依然存在**，一条都没少。被改的只有模型可见的投影，
  事实永久保留——这正是 `[log] seq=12 ... surfaceOp={"op":"replace",...}` 这一行能出现在
  流水账里的原因。

所以 `[log]` 数到 13 行（`seq=0`…`seq=12`），而 `②` 报告的 `事件数 = 12`：
`②` 跑在 ⑤ 之前。顺序很重要，读输出时别把它们当成同一时刻的状态。

> **原理对照**：`surfaceOp` 的三条约束与压缩语义见
> [06 § 6.15](../../docs/hello-dsh/06-agent-loop-and-session-log.md)。

### 写错了不会静默失效：两条 fail-closed 校验

`replace` 写错了**不会静默失效，而是抛错**。场景故意造了两个错误：

```ts
const bogus = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }) as any
try {
  session.append('user/message', bogus, { surfaceOp: { op: 'replace', startSeq: SessionSeq(999), endSeq: SessionSeq(999) }, sourceEventSeqs: [SessionSeq(999)] })
} catch (error) {
  console.log('   区间不在 surface 上:', (error as Error).message)
}
try {
  const first = session.surface.nodes[0]!
  session.append('user/message', bogus, { surfaceOp: { op: 'replace', startSeq: first, endSeq: first }, sourceEventSeqs: [] })
} catch (error) {
  console.log('   引用不完整      :', (error as Error).message)
}
```

真实输出（两条都是实现的**抛错原文**）：

```text
   区间不在 surface 上: surface replace at seq 13: startSeq and endSeq must reference earlier events
   引用不完整      : sourceEventSeqs must not be empty
```

### 约束一：`startSeq/endSeq` 必须引用**比新事件更早**的事件

示例传的是 `SessionSeq(999)`。新事件将是 seq 13，而 `999 >= 13`，所以在
`validateSurfaceMetadata` 里就挂了（`packages/core/session/src/surface.ts:317`）——
**在还没进入"这个 seq 在不在 surface 上"的检查之前**。

这条约束是硬性的：引用未来事件等于循环定义。想看到另一条更像"找不到"的错误，
把 `999` 换成一个真实存在、但**不在 surface 上**的 seq（例如 `request/header` 的 `7`），
错误会变成 `surface replace: start seq 7 not found in surface`（`surface.ts:330`）。

### 约束二：`sourceEventSeqs` 不能为空

第二个 `try` 用 `sourceEventSeqs: []`，抛 `sourceEventSeqs must not be empty`
（`surface.ts:283`）。这条字段的语义是"**是哪些更早的事件产生了本条**"，
空数组等于不记录来源，对这四类 surface 事件都是非法的。

还有一条本场景没直接触发的第三重校验：`sourceEventSeqs` **必须覆盖每一个被遮蔽的
surface 节点**，否则抛 `surface replace: sourceEventSeqs must include every shadowed
surface node; missing <seq>`（`surface.ts:302`）——它排在"非空"检查之后，所以先撞上前一条。

### 为什么遮蔽区间从节点 1 开始

0.1.5 里 **surface 节点 0 放的是系统提示**。运行期只有 `system/message` 能改写
**恰好那一个**节点，别的类型不行；违规时抛
`surface replace: node 0 holds the system prompt and may be rewritten only by a
system/message over exactly that node`（`surface.ts:416`）。
所以上面的 `slice(1, 3)` 是刻意跳过系统提示的——练习 A 会让你亲手撞一次这个错误。

> ⚠️ 文档 [06 § 6.15](../../docs/hello-dsh/06-agent-loop-and-session-log.md) 引的错误串
> （`surface replace: start seq 999 not found in surface`）来自更早的版本；0.1.5 的
> 实际输出以本节这两行为准。

---

## 5. `fork` 要稳定前缀，`flush` 是并行检查点

```ts
console.log('\n⑥ fork：只能从**稳定前缀**分叉——边界落在未闭合的 turn 里会被拒')
try {
  harness.ctx.sessions.fork(session, SessionSeq(2), 'demo-fork-bad' as SessionId)
} catch (error) {
  console.log('   边界在 open turn 内:', (error as Error).message)
}
// turn/end 之后才是稳定前缀：boundary 取"要继承的事件条数"。
const stable = session.snapshotEvents().findIndex((event) => event.type === 'turn/end') + 1
const child = harness.ctx.sessions.fork(session, SessionSeq(stable), 'demo-fork' as SessionId)
console.log(`   从 boundary=${stable} 分叉 → 子会话 ${child.id} 继承了 ${child.snapshotEvents().length} 条事件`)

console.log('\n⑦ flush：parallel 持久化检查点（无监听者也正常返回）')
console.log('   flush →', await harness.ctx.sessions.flush(session))
```

真实输出：

```text
   边界在 open turn 内: fork boundary 2 in session "demo-session" ends inside open turn 1
  [store] session/created → demo-fork
   从 boundary=12 分叉 → 子会话 demo-fork 继承了 14 条事件
   flush → false
```

### `fork` 的边界必须落在**已闭合的 turn** 上

`boundary=2` 落在 `turn/start`（seq 1）之后、`turn/end`（seq 11）之前——`turn/end`
还没出现，说明这个 turn 还开着。实现的做法是：取 `[0, boundary]` 前缀里**最后一个**
`turn/start` 或 `turn/end`，若它是 `turn/start`，就拒绝（`index.ts:1246`）。
理由是**分叉出来的子会话必须是一个自洽的历史**，而"半个 turn"不是。

第二次调用取 `findIndex(turn/end) + 1`，在这个日志里 `turn/end` 是 seq 11，所以 `stable = 12`。
注意 `boundary` 是**闭区间上界**：`fork` 复制的是 `[0, boundary]` 这些事件，
然后子会话再追加一条自己的 `session/end-seed` 标记事件，
所以 `13 (seq 0…12) + 1 = 14` 条——这就是"继承了 14 条事件"的来源。
`session/created` 那行是 `impl/01-session-log.ts` 里第二个监听器打的，证明 `fork`
走的是正常的会话创建路径。

### `flush` 返回的是"有没有监听者参与"

`flush(session)` 派发 `session/flush` 给所有监听者，**并行**等它们全部 settle：
任何一个抛错就抛出第一个错误；否则返回 `callbacks.length > 0`
（`packages/core/session/src/index.ts:1137`）。这一课没有装任何持久化检查点策略，
所以**没有监听者 → 返回 `false`**，而"没有监听者"完全不是错误。

这也解释了 M05.2 的 `storedSessions: 0`：那个场景只装载了 JSONL Provider，
既没有把 `demo-session` 落盘，也没有谁去 `flush`，所以 `list()` 读到 0 条。
**"返回 false / 列表为空"在这里都是正确行为，不是故障。**

---

## 6. 为什么要分层：事实、语料、加速、派生

M05.2–M05.5 四个场景各自装载一个真实 Provider，各打印一行。它们回答的是**四个不同的问题**。

### 事实：JSONL 是"追加式日志"的天然格式

[`impl/02-session-persistence.ts`](../M05-session-surface/impl/02-session-persistence.ts) 只有两行：

```ts
/** JSONL 是 sessionPersistence 抽象服务的本地、追加式耐久 Provider。 */
export { default } from '@deepseek-ai/dsh-session-persistence-jsonl'
export type { Config } from '@deepseek-ai/dsh-session-persistence-jsonl'
```

场景在一个临时目录上装载它，然后读 `list()`：

```text
sessionPersistence: { backend: 'JsonlSessionPersistence', storedSessions: 0 }
```

每行一个 JSON 事件、追加即写、崩溃后按行恢复——**格式与 append-only 语义完全同构**，
所以持久化不需要事务，也不需要重写文件。

### 语料：精确读取在 Definition，全文检索留给 Provider

[`impl/03-session-query.ts`](../M05-session-surface/impl/03-session-query.ts) 演示了 seam 的分工：

```ts
export class ExactReadSessionQuery extends SessionQueryEngine {
  constructor(ctx: Context) {
    super(ctx)
  }
  async searchSessions(_request: SessionSearchRequest, _exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>> {
    throw new Error('demo query provider intentionally implements exact reads only')
  }
  async searchEvents(_request: SessionEventSearchRequest, _exec?: SessionSearchExecContext): Promise<SessionEventSearchPage> {
    throw new Error('demo query provider intentionally implements exact reads only')
  }
}
```

`listSessions()` / `readSession()` 这类**精确读取**由基类实现，所有 Provider 共用；
**全文检索**是抽象方法，必须由 Provider 提供。这个示例 Provider 只实现精确读取，
所以两个检索方法**明确拒绝**（抛错），而不是返回空结果假装成功——这正是 DSH
"misconfiguration fails loud" 的一贯做法。

```text
sessionQuery: {
  provider: 'ExactReadSessionQuery',
  livePreferredCount: 1,
  firstId: 'demo-session'
}
```

`livePreferredCount: 1` 是因为"语料"是 **live-preferred** 的：先取磁盘上的会话，
再用**内存里活着的**会话覆盖同 id 的记录（`session-query/src/corpus.ts:61`）。
这里没有装 persistence，所以磁盘是空的，唯一一条就是活着的 `demo-session`。

### 加速：checkpoint 是**可丢弃**的缓存

[`impl/04-session-projection-cache.ts`](../M05-session-surface/impl/04-session-projection-cache.ts)
按真实依赖顺序叠了四层：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: config.root })
  await ctx.plugin(storageDomain, { backend: 'json', routes: {} })
  await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 10, writeIntervalMs: 60_000 })
}
```

它存在的原因是**重放很贵**：冷启动要重建会话的投影值（标题、goal、inbox…）。
checkpoint 把这些投影的折叠结果按"事件切点"存进 storage，下次直接从切点续上。

```text
sessionProjectionCache: {
  backend: 'JsonStorageBackend',
  cached: true,
  keys: [ 'subagentCatalog', 'subagentTiming', 'subagent', 'goal', 'inbox' ]
}
```

`keys` 就是本次 checkpoint 里真实存在的投影单元——它们来自 harness 里装载的服务
（subagent 三个、goal 一个、agent-loop 的 inbox 一个）。关键性质是：
**checkpoint 落后于日志是允许的，超前于日志是禁止的**；缓存丢了，
一切都能从事实日志重算（`session-projection-cache/src/index.ts:131`）。
这就是"事实层"和"加速层"必须分开的理由。

### 派生：标题是 latest-wins 的**投影**，不是可变字段

[`impl/05-session-title.ts`](../M05-session-surface/impl/05-session-title.ts)：

```ts
/** 标题是 session/title 日志事件的 latest-wins 投影，不是可变 Session 字段。 */
export { SessionTitleService as default, SessionTitleService, SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
```

场景传入了带空白的 `'  会话服务链  '`，并连续读两次：

```text
sessionTitle: { title: '会话服务链', source: 'user', foldedAgain: '会话服务链' }
```

- `title` 是 `rename()` 归一化后的结果（去掉首尾空白；UTF-8 字节上限 96）；
- `source: 'user'` 说明这条标题来自**用户显式改名**，而不是自动生成；
- `foldedAgain` 是**重新从日志折叠一次**得到的值——它和 `title` 相同，说明标题确实
  是从 `session/title` 事件派生出来的，而 `foldSessionTitle()` 用的是
  `events.findLast(...)`，即**最后一条事件赢（latest-wins）**
  （`session-title/src/index.ts:282`）。

换句话说：改名不是"给 Session 对象上的字段赋值"，而是**追加一条新事件**。
历史上所有旧标题都还在日志里，模型可见面上一条都没有（`session/title` 是 log-only 事件）。

---

## 7. 排障：`fork` 抛 `ends inside open turn`

### 症状

你想从当前会话分叉一个子会话，`ctx.sessions.fork(session, boundary, childId)` 抛出：

```text
fork boundary 2 in session "demo-session" ends inside open turn 1
```

### 定位

1. 看错误里的 `boundary` 值（这里是 2），找到它在日志里的位置；
2. 打印 `session.snapshotEvents()` 的类型序列，看 `boundary` 之前**最后一个**
   `turn/start` / `turn/end` 是哪个——本课日志里 `seq=1 turn/start`、`seq=11 turn/end`，
   而 `boundary=2` 落在两者之间。

### 原因与修改

**边界必须落在已闭合 turn 的末尾**，因为子会话继承的是一段完整、自洽的历史。
驱动主循环的 `runTurn` 结束后（`await agent.whenIdle()`），日志里一定已经有
那个 turn 的 `turn/end`。取它之后的切点即可，场景里就是这一句：

```ts
const stable = session.snapshotEvents().findIndex((event) => event.type === 'turn/end') + 1
```

生产代码更应该等**这一轮真的结束**再分叉，而不是猜一个 seq。
同理，另两个同族错误是 `fork boundary N does not exist in session "..." (last seq: M)`
（边界越过日志末尾）和 `fork boundary N does not match a contiguous event seq`（边界不是整数）。

---

## 8. 代码在哪

```bash
cd dsh-example && ls M05-session-surface/impl M05-session-surface/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-session-log.ts`](../M05-session-surface/impl/01-session-log.ts) | `inject = ['sessions']`；两个 `ctx.on` 监听器 |
| [`impl/02-session-persistence.ts`](../M05-session-surface/impl/02-session-persistence.ts) | 整个文件只有 re-export——Provider 就是真实包 |
| [`impl/03-session-query.ts`](../M05-session-surface/impl/03-session-query.ts) | 继承 `SessionQueryEngine`；两个检索方法显式抛错 |
| [`impl/04-session-projection-cache.ts`](../M05-session-surface/impl/04-session-projection-cache.ts) | 四层 plugin 顺序：storage → json → domain → cache |
| [`impl/05-session-title.ts`](../M05-session-surface/impl/05-session-title.ts) | 注释一句话点明 latest-wins 投影 |
| [`scenes/01-check-log-invariants.ts`](../M05-session-surface/scenes/01-check-log-invariants.ts) | 全课主线：①–⑦ 正好对应第 3–5 节，**先读这个** |
| [`scenes/04-resume-from-checkpoint.ts`](../M05-session-surface/scenes/04-resume-from-checkpoint.ts) | `write()` → `cachedSnapshot()` 一读一写 |
| [`scenes/05-project-title.ts`](../M05-session-surface/scenes/05-project-title.ts) | `rename()` 后立刻 `get()` 折叠一次做对照 |

读法：**先读 scene 看它怎么"演"，再读 impl（必要时读 SDK）看它怎么"实现"**。
scene 里的注释密度远高于 impl，初学者从注释入手最快。

---

## 9. 动手练习

### 练习 A：撞一次"节点 0 是系统提示"

打开 [`scenes/01-check-log-invariants.ts`](../M05-session-surface/scenes/01-check-log-invariants.ts)，
把 ⑤ 里的 `const shadowed = surfaceBefore.slice(1, 3)` 改成 `slice(0, 1)`——
也就是让一个 `user/message` 去替换**节点 0（系统提示）**。

**验证命令**

```bash
cd dsh-example && node M05-session-surface/scenes/01-check-log-invariants.ts
```

**可验证答案**：这次 `append` 直接抛错（脚本中断），错误原文是
`surface replace: node 0 holds the system prompt and may be rewritten only by a
system/message over exactly that node`。
把类型从 `user/message` 换成 `system/message`（并给出对应的 `SystemMessage` 数据）
就能通过——**这条约束是"只有系统提示能改写系统提示"的运行时兑现**。

### 练习 B：把 `999` 换成一个真实但不在 surface 上的 seq

还是 ⑤b 的第一段，把 `startSeq` / `endSeq` / `sourceEventSeqs` 里的 `SessionSeq(999)`
换成 `SessionSeq(7)`（`7` 是日志里真实存在的 `request/header`）。

**验证命令**

```bash
cd dsh-example && node M05-session-surface/scenes/01-check-log-invariants.ts
```

**可验证答案**：错误从 `startSeq and endSeq must reference earlier events`
变成 `surface replace: start seq 7 not found in surface`。
两次抛错发生在**不同的校验层**：前者在"事件自洽性"检查，后者在"这个节点在不在当前
surface 上"检查。能区分这两层，说明你读懂了 `surfaceOp` 的校验顺序。

### 练习 C（进阶）：验证标题真的是 latest-wins

打开 [`scenes/05-project-title.ts`](../M05-session-surface/scenes/05-project-title.ts)，
在现有 `rename` 之后再加一次改名，例如 `rename(harness.agent.session, '第二个标题')`，
并把新结果的 `title` 打进日志。

**验证命令**

```bash
cd dsh-example && node M05-session-surface/scenes/05-project-title.ts
```

**可验证答案**：`get()` 返回 `第二个标题`，且 `session.snapshotEvents()` 里
**同时存在两条 `session/title` 事件**。旧标题没有被删掉，只是被最后一条遮蔽——
和 surface 的 `replace` 是同一个思想：**日志只追加，视图取最新**。

---

**下一课** → [第 06 课 · 人在环路](06-human-in-the-loop.md)：让 Agent 在关键处停下来，把决定权交还给人。

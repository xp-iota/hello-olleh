# 第 02 课 · 上下文装配与经济学

> **本课任务**：把 System Prompt 从一个"越拼越长的字符串"改造成结构化的 `PromptAssembly`；
> 用 section / variable / assemble 钩子往它里面贡献内容，再让压缩引擎把 12 条历史折成 4 条
> 模型可见消息——而会话日志一条都不删。
> **运行命令**：`cd dsh-example && npm run M02`
> **你将看到**：`assemble()` 打印出 `sections` / `variables` / `contexts` 三行结构，
> `{{today}}` 在渲染阶段才被替换；未注册的变量直接抛错；压缩后 surface 从 12 条变成 4 条，
> 而 `session 日志仍 13 条`。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

第 01 课处理的是"工具"；这一课处理**送进模型的那段上下文**。它的核心命题只有一句：

> **上下文是一份结构化的投影，不是一根不断增长的字符串。**

这句话一旦立住，装配、改写、压缩三件事各自的正确写法就都推出来了：

| 控制面 | 回答的问题 | 本课对应实现 |
|---|---|---|
| **Prompt 结构** | 提示词由哪些片段组成、谁先谁后？ | [`impl/01-prompt-section.ts`](../M02-context-assembly-economics/impl/01-prompt-section.ts)、[`impl/02-prompt-variable-assemble.ts`](../M02-context-assembly-economics/impl/02-prompt-variable-assemble.ts) |
| **历史长度** | 上下文太长了怎么变短，又不丢事实？ | [`impl/03-compaction-provider.ts`](../M02-context-assembly-economics/impl/03-compaction-provider.ts) |
| **预算度量** | 现在到底用了多少 token？ | [`impl/04-token-meter.ts`](../M02-context-assembly-economics/impl/04-token-meter.ts) |
| **结果体积** | 单条工具结果太长怎么办？ | [`impl/05-tool-result-pruner.ts`](../M02-context-assembly-economics/impl/05-tool-result-pruner.ts)、[`impl/06-spill-policy.ts`](../M02-context-assembly-economics/impl/06-spill-policy.ts) |

四个面合起来是一条链：**装配 → 改写 → 度量 → 压缩/裁剪/溢出**。前两个面决定"上下文长什么样"，
后两个面决定"它花多少钱"。

```bash
cd dsh-example && npm run M02
```

---

## 2. 真实输出

```text
████ M02 · 上下文装配与经济学：构造、改写、压缩 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M02.1 · 按顺序贡献 Prompt section ────
===== 组装后的 System Prompt =====
You are an AI agent powered by DeepSeek Harness.

你是一个乐于助人的编码助手。

# 回复风格
- 保持简洁，先给结论再给理由。
- 涉及代码时给出可运行的最小示例。
- 结尾署名：—— 来自扩展示例工程
REAL_STAGE_OK M02.1 calls=1 ms=727 in=0 out=72 finish=stop

──── M02.2 · 变量解析与 assembly waterfall ────
===== ① assemble() 的返回值是结构化 PromptAssembly，不是字符串 =====
   sections : runtime-preamble → harness:identity → deployment:persona-prefix → persona → date-aware → deployment:persona-suffix
   variables: {"provider":"anthropic-compat","model":"fuyao-coding","today":"2026-09-16"}
   contexts : 1 | tools: 0

===== ② 渲染成最终提示词（拼 section + 插值 {{today}}）=====
# 运行时前言（由 assemble 钩子注入）

You are an AI agent powered by DeepSeek Harness.

你是一个乐于助人的编码助手。

当前日期是 2026-09-16。请在涉及"今天/昨天"的回答里以该日期为准。

===== ③ 未注册的变量是**硬错误**：渲染阶段直接抛，不静默清空也不原样保留 =====
   renderPrompt 抛错: unknown prompt variable "{{nope}}" in section "x"; registered variables: (none)

===== ④ 已注册但求值为 undefined 的变量：同样 fail loud =====
   variables.maybe = undefined
   renderPrompt 抛错: prompt variable "{{maybe}}" has no value for this assembly (section "maybe-user")
REAL_STAGE_OK M02.2 calls=1 ms=631 in=0 out=94 finish=stop

──── M02.3 · 压缩历史并替换模型可见 surface ────
① 已装载 compaction 实现: DemoCompactionEngine （构造里 super(ctx) 即挂载，无手工 provide）

② 构建初始上下文：向 longCtx 的会话逐条追加 12 条 user 消息（surfaceOp: append）:
     + seq  0  "m0"
     + seq  1  "m1"
     + seq  2  "m2"
     + seq  3  "m3"
     + seq  4  "m4"
     + seq  5  "m5"
     + seq  6  "m6"
     + seq  7  "m7"
     + seq  8  "m8"
     + seq  9  "m9"
     + seq 10  "m10"
     + seq 11  "m11"
   → longCtx 的 surface 现有 12 条
   另造 shortCtx（2 条消息），用于对照“未到阈值不压”的分支

③ 压缩过程：compactIfNeeded(longCtx, 'pressure') —— 插件内部的判定与动作逐步可见:
   [demo-compaction] 压力信号：surface 12 条 ≥ 阈值 8 → 触发折叠
   [demo-compaction] 折叠区间：12 条 - 保留最近 3 条 → seq [0..8]（9 条）
   [demo-compaction] 追加摘要事件 seq 12：'user/message' 检查点 + surfaceOp { op:'replace', 0..8 }（摘要占据被遮蔽区间的原位）
   返回 CompactionResult（一笔可核对的账）:
     shadowedRange      = [0..8]  ← 被遮蔽的 9 条
     summarySeq         = 12      ← 摘要事件自己的 seq
     shadowedTokenCount = 1080    ← 省下的 token（示例用常数估算）

④ 最终结果：模型可见面从 12 条折叠成 4 条，日志一条没删:
   折叠后 surface（4 条）:
     seq 12  user       "（已把 9 条历史压成一段摘要）"
     seq  9  user       "m9"
     seq 10  user       "m10"
     seq 11  user       "m11"
   session 日志仍 13 条（append-only），seq 0–8 只是被摘要从可见面遮蔽

⑤ 对照：compactIfNeeded(shortCtx, 'pressure') —— 2 条 < 阈值 8，不压:
   [demo-compaction] 压力信号：surface 2 条 < 阈值 8 → 不压，返回 null
   返回值 = null

⑥ 手动 compactNow(shortCtx) —— 不受阈值约束，但 2 条都在“保留最近 3 条”之内:
   [demo-compaction] 2 条全在"保留最近 3 条"之内 → 无可折叠节点，返回 null
   返回值 = null

⑦ 尊重 signal：已 abort 的压力检查:
   [demo-compaction] signal 已 abort → 直接返回 null
   返回值 = null

⑧ 插件 fiber.dispose() 后 seam 自动卸载（回到未装）:
   ctx.compaction = undefined
REAL_STAGE_OK M02.3 calls=1 ms=833 in=0 out=56 finish=stop

──── M02.4 · 回放日志估算 token 压力 ────
tokenMeter: { baseline: 'estimated', surfaceTokens: 11, totalTokens: 11, nodes: 1 }
REAL_STAGE_OK M02.4 calls=1 ms=358 in=0 out=51 finish=stop

──── M02.5 · 确定性裁剪超长工具结果 ────
toolResultPruner: { before: 112, after: 55, marker: true }
REAL_STAGE_OK M02.5 calls=1 ms=552 in=0 out=53 finish=stop

──── M02.6 · 把超长结果 spill 到本地文件 ────
spillStore: {
  backend: 'LocalSpillStore',
  inlineBytes: 253,
  hasLocator: true,
  isError: false
}
REAL_STAGE_OK M02.6 calls=1 ms=253 in=0 out=20 finish=stop

REAL_MODULE_OK M02 stages=6 calls=6 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M02 stages=6`。最值得先看的两行是
M02.2 的 `sections : ...`（证明 `assemble()` 交出的是结构）和 M02.3 的
`session 日志仍 13 条（append-only）`（证明压缩没有删任何东西）。
如果 M02.2 那行打不出来，说明你手上还是一个字符串 API——本课第 3、5 节讲的就是这一点。

---

## 3. 拼接：section 是"有序片段"，不是字符串加法

打开 [`impl/01-prompt-section.ts`](../M02-context-assembly-economics/impl/01-prompt-section.ts)：

```ts
export function apply(ctx: Context, config: Config) {
  ctx.systemPrompt.section({
    name: 'example-reply-style',
    order: 300,
    // 静态文本即可满足大多数场景；需要动态内容时改成 (context) => string
    text: [
      '# 回复风格',
      '- 保持简洁，先给结论再给理由。',
      '- 涉及代码时给出可运行的最小示例。',
      `- 结尾署名：${config.signature}`,
    ].join('\n'),
  })
  // 返回值是 disposer；这里不接也没关系——插件 fiber 销毁时 effect 会自动回收。
}
```

**先讲原理**。注册的每一段都是带 `name` 和 `order` 的记录，最终拼装时按 `order` 升序排序。
`order` 的约定是有意义的：`-1000` 是 harness 身份、`0` 是部署 persona、`100~199` 是工具指引、
`10200` 是 persona 后缀。示例刻意用 `300`，落在 persona 之后、工具指引区之前。

这段代码有三个值得记住的性质：

1. **`text` 可以是字符串，也可以是函数**。函数形态在每次 `assemble()` 时求值，拿到
   `AssembleContext`——所以插件不需要缓存任何"当前状态"。
2. **注册是 effect-based 的**。`section()` 返回 disposer，同时把注册挂到插件 fiber 上；
   `fiber.dispose()` 之后这一段自动消失，不需要手写反注册。这与第 01 课工具注册是同一个模型。
3. **同名 section 在同一层会抛错**，但按 agent 作用域注册可以遮蔽全局同名段——覆盖行为是
   "整体遮蔽"，不是"文本拼接"。

场景侧则演示了顺序：[`scenes/01-assemble-system-prompt.ts`](../M02-context-assembly-economics/scenes/01-assemble-system-prompt.ts)
先放一个 `order: 0` 的 persona，再加载 `order: 300` 的插件：

```ts
// 演示 order 顺序：先放一个低 order 的段落，再加载本插件的 order=300 段。
harness.ctx.systemPrompt.section({ name: 'persona', order: 0, text: '你是一个乐于助人的编码助手。' })

await harness.loadPlugin(promptPlugin, { signature: '—— 来自扩展示例工程' })

console.log('===== 组装后的 System Prompt =====')
console.log(renderPrompt(await harness.ctx.systemPrompt.assemble(harness.assembleContext())))
```

对应第 2 节 M02.1 的输出：身份段在最前，persona 在中间，`# 回复风格` 那段带着
`—— 来自扩展示例工程` 的署名排在 persona 之后。

注意最后一行 `renderPrompt(...)`——**装配和渲染是两步**。`assemble()` 产出结构，
`renderPrompt()` 才产出字符串。这是整课的枢纽，下一节展开。

---

## 4. 变量：注册在装配前，插值在渲染时

打开 [`impl/02-prompt-variable-assemble.ts`](../M02-context-assembly-economics/impl/02-prompt-variable-assemble.ts)：

```ts
export function apply(ctx: Context) {
  // 1) 一个动态变量：每次装配都重新求值当天日期。
  ctx.systemPrompt.variable('today', () => new Date().toISOString().slice(0, 10))

  // 2) 一段引用该变量的正文（注意 {{today}} 占位，插值发生在 renderPrompt 阶段）。
  ctx.systemPrompt.section({
    name: 'date-aware',
    order: 100,
    text: '当前日期是 {{today}}。请在涉及"今天/昨天"的回答里以该日期为准。',
  })
```

**先讲原理**。变量不是"注册时就把值塞进文本"，而是"注册一张名字 → 求值函数的表"。真正的替换
发生在渲染阶段：渲染器扫到 `{{name}}`，去装配体的 `variables` 表里取值，再拼进字符串。
所以**同一份 section 文本在装配时仍带着 `{{today}}` 占位**。

这一点在第 2 节 M02.2 里被直接打印出来验证：

```text
   sections : runtime-preamble → harness:identity → deployment:persona-prefix → persona → date-aware → deployment:persona-suffix
   variables: {"provider":"anthropic-compat","model":"fuyao-coding","today":"2026-09-16"}
```

`sections` 列出的是**已排序的段名**（这一段来自
[`scenes/02-interpolate-variable.ts`](../M02-context-assembly-economics/scenes/02-interpolate-variable.ts)
的 `assembly.sections.map((section) => section.name).join(' → ')`），`variables` 是一张完整的表。
`provider` / `model` 这两个变量不是示例注册的，而是运行时自带的——**别和它们重名**。

然后是渲染，`{{today}}` 在这里才变成日期：

```text
当前日期是 2026-09-16。请在涉及"今天/昨天"的回答里以该日期为准。
```

### 缺值是硬错误，不是空字符串

这是本课最值得背下来的一条设计：**引用一个取不到值的变量，渲染直接抛错**。场景用 `try/catch`
把两种失败都打了出来（[`scenes/02`](../M02-context-assembly-economics/scenes/02-interpolate-variable.ts)
的 ③④ 两段）：

```text
③ renderPrompt 抛错: unknown prompt variable "{{nope}}" in section "x"; registered variables: (none)
④ variables.maybe = undefined
   renderPrompt 抛错: prompt variable "{{maybe}}" has no value for this assembly (section "maybe-user")
```

两种失败对应两条不同的检查：

| 情况 | 报错 |
|---|---|
| 正文引用了**从未注册**的名字 | `unknown prompt variable "{{nope}}" in section "x"; registered variables: (none)` |
| 变量**已注册**，但 provider 本次返回 `undefined` | `prompt variable "{{maybe}}" has no value for this assembly (section "maybe-user")` |

**为什么不静默清空、也不原样保留？** 因为这两条路都会把错误藏起来：清空会让你以为模型看到了
某段信息，原样保留会把 `{{today}}` 这种字面量发给模型。渲染器选择在装配阶段就炸——
错误信息里同时给出**段名**和**已注册变量列表**，定位成本极低。

变量名本身也受约束：必须匹配 `[a-z][a-z0-9_]*`（小写字母开头，只含小写字母/数字/下划线），
不匹配的名字在注册时就抛错。

---

## 5. `assemble` waterfall：返回类型就是纪律

继续看同一个文件的后半段：

```ts
  ctx.on('system-prompt/assemble', async (assembly: PromptAssembly, _context, next) => {
    // 先让下游把它们的改写做完，再在最终结果上加前言（外层包装的典型写法）。
    const downstream = await next()
    return {
      ...downstream,
      sections: [
        { name: 'runtime-preamble', text: '# 运行时前言（由 assemble 钩子注入）' },
        ...downstream.sections,
      ],
    }
  })
```

**先讲原理**。`system-prompt/assemble` 是一条 waterfall：`assemble()` 把已经排好序的
`PromptAssembly` 交进来，每个监听者可以改写后再往下传。它是**整体改写**的挂点——
统一加前后缀、脱敏、注入运行时信息，都写在这里。

两处写法值得逐字看：

- **先 `await next()` 再返回**。这是"外层包装"的典型写法：让下游（内层）先改完，自己在最终
  结果上叠加。如果先改再调 `next()`，你的改动可能被下游覆盖。
- **`return { ...downstream, sections: [...] }`**。展开运算符保留了 `contexts` / `tools` /
  `variables` 三个字段——**那是别人（Code Mode、结构化输出、运行时内建变量…）的贡献**。

### 把它拍平成 `{ text }` 会发生什么

这是本课最重要的一条禁令。如果监听者 `return { text: '...' }`：

1. 返回值不再是 `PromptAssembly`，**下游和调用方拿不到 `tools` / `contexts` / `variables`**；
2. 同一条 waterfall 上其它插件的贡献被整段丢弃；
3. 变量插值阶段会因为 `variables` 为空而抛 `unknown prompt variable`——失败点在很远的地方，
   症状看起来和这个钩子毫无关系。

**要加前言就往 `sections` 里插一段。** 第 2 节 M02.2 的 ② 行就是这个做法的结果：
渲染出的提示词第一段是 `# 运行时前言（由 assemble 钩子注入）`，而 `variables` 表里的
`provider` / `model` / `today` 一个都没丢。

还有一个容易踩的细节：`assembly.sections` 里装的是**已经排序好的** `AssembledSection`，
只有 `name` 和 `text` 两个字段——`order` 在注册侧才有意义。所以你想插到最前面，直接把它
放到数组头部（`[newSection, ...downstream.sections]`）就行，不需要伪造一个 `order`。

---

## 6. 压缩：日志一个字节不动，只改模型可见面

打开 [`impl/03-compaction-provider.ts`](../M02-context-assembly-economics/impl/03-compaction-provider.ts)。
这是全课最长的一段，但它只在回答一个问题：**上下文满了，怎么把它变短，又不丢事实？**

答案分两半：**日志（log）**和**可见面（surface）**。日志是只能追加的事实流；可见面是从日志
派生出来的、模型真正看到的那份有序投影。压缩不改日志，只往日志里追加一条"替换标记"，
让模型可见面跳过被折叠的区间。

### 6.1 Provider 的形状：`super(ctx)` 就是挂载

```ts
export class DemoCompactionEngine extends CompactionEngine {
  // 类式插件也用静态 inject：Cordis 创建实例前会等待 sessions 服务可用。
  static inject = ['sessions']

  // 静态 Config 与函数式插件导出的 Config 作用相同，负责外部配置校验和默认值。
  static Config: z<Config> = z.object({
    threshold: z.number().default(8),
  })

  private readonly threshold: number

  constructor(ctx: Context, config: Config) {
    // super(ctx) → CompactionEngine 内部把服务名钉成 'compaction'：本实例即刻成为 ctx.compaction。
    super(ctx)
    this.threshold = config.threshold
    this.registerAutomaticCompaction()
  }
```

`CompactionEngine` 是一个**抽象 cordis Service**。所以"提供一个 seam 实现"的形状不是调什么
注册函数，而是三步：继承它 → 用 `static inject` / `static Config` 声明依赖与配置 →
在构造里 `super(ctx)`。`super(ctx)` 这一步就把自己挂到了 `ctx.compaction`。

**没有 `ctx.provide('compaction', engine)` 这种写法。** 并且挂载是 effect-based 的——
第 2 节 M02.3 的 ⑧ 行就是证据：

```text
⑧ 插件 fiber.dispose() 后 seam 自动卸载（回到未装）:
   ctx.compaction = undefined
```

文件末尾 `export default DemoCompactionEngine`，由 cordis 的 `ctx.plugin` 负责 `new`
与卸载还原；场景里那句注释说的就是这个（`① 已装载 compaction 实现: DemoCompactionEngine
（构造里 super(ctx) 即挂载，无手工 provide）`）。

### 6.2 触发点：`agent/pre-step` waterfall 必须交回 `next()`

```ts
  private registerAutomaticCompaction(): void {
    this.ctx.on('agent/pre-step', async (payload, next) => {
      if (!payload.signal.aborted) {
        const result = await this.compactIfNeeded(payload.agent, 'pressure', payload.signal)
        if (result) console.log(`[compaction] pre-step 压力触发：折叠 ${result.shadowedSeqs.length} 条（省约 ${result.shadowedTokenCount} tokens）`)
      }
      return next()
    })
  }
```

自动压力检查跑在**每一步之前**（`agent/pre-step`）。它是 waterfall，所以监听者**观察完必须
交回 `next()`**——否则等于否决本步。手动 `/compact` 和溢出恢复走另外两个入口，但三个入口
最终都落到同一个折叠动作上。

### 6.3 判定：没到阈值就返回 `null`，还要尊重 `signal`

```ts
  async compactIfNeeded(agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
    if (signal.aborted) {
      console.log('   [demo-compaction] signal 已 abort → 直接返回 null')
      return null
    }
    // 用 surface 节点数作为最小压力信号（真实实现用 tokenMeter 估算上下文占用）。
    const visibleSeqs = agent.session.surface.nodes
    if (trigger === 'pressure') {
      // 压力模式下，未到安全线就"不压"，返回 null。
      if (visibleSeqs.length < this.threshold) {
```

第 2 节的三行边界输出正好对应三个 `null` 分支：

```text
⑤ [demo-compaction] 压力信号：surface 2 条 < 阈值 8 → 不压，返回 null
⑥ [demo-compaction] 2 条全在"保留最近 3 条"之内 → 无可折叠节点，返回 null
⑦ [demo-compaction] signal 已 abort → 直接返回 null
```

⑤ 是"没到压力线"，⑥ 是"到了但没东西可折"（手动 `compactNow` 不受阈值约束，但保留策略让
2 条全部落在保留区内），⑦ 是"调用方已经取消了，别再干活"。**返回 `null` 而不是空结果**是
有意的：调用方需要能区分"压了"和"没压"。

### 6.4 折叠：追加一条带 `surfaceOp` 的检查点

核心动作在 `fold()` 里：

```ts
    const shadowedRange = { start: foldedSeqs[0]!, end: foldedSeqs[foldedSeqs.length - 1]! }
    const summary: ContentBlock[] = [{ type: 'text', text: `（已把 ${foldedSeqs.length} 条历史压成一段摘要）` }]
    // 0.1.5 的两条硬约束合起来决定了摘要必须是 **user/message**：
    //   1. surface replace 要求节点的 sourceEventSeqs 覆盖每一个被遮蔽的 surface 节点
    //      （否则运行期抛 'sourceEventSeqs must include every shadowed surface node'）；
    //   2. assistant/message 的 sourceEventSeqs 类型是 never —— assistant 消息内嵌自己的
    //      provider 流，不引用来源事件。
    // 于是 assistant/message 结构上无法做 surface 替换。上游 compaction-basic 的做法是
    // 追加一条 user/message 检查点来占据被遮蔽区间的原位（见 packages/compaction/
    // compaction-basic/src/region.ts 的 commitCompactionBody）。
    const summaryEvent = session.append(
      'user/message',
      createUserMessage({ content: summary, source: { kind: 'user' } }) as never,
      { surfaceOp: { op: 'replace', startSeq: shadowedRange.start, endSeq: shadowedRange.end }, sourceEventSeqs: foldedSeqs },
    )
```

**先讲原理**。`surfaceOp: { op: 'replace', startSeq, endSeq }` 的含义是：
**用这一条新节点替换可见面上 `[startSeq, endSeq]` 区间内的节点**，并且新节点落在被替换区间的
原位上（所以日志里摘要的 `seq` 是 12，但它在可见面里排在 `m9` 前面）。日志本身只多了一条记录，
旧记录一个都没动。

为什么摘要**必须**是 `user/message`？两条硬约束合起来堵死了另一条路：

1. `surface replace` 要求这条新事件的 `sourceEventSeqs` **覆盖每一个被遮蔽的可见面节点**，
   否则运行期直接抛 `surface replace: sourceEventSeqs must include every shadowed surface node`；
2. `assistant/message` 的 `sourceEventSeqs` 类型是 `never`——assistant 消息内嵌自己的 provider
   流，不引用来源事件。

于是 `assistant/message` **在结构上就无法做 surface 替换**。这不是风格选择，是类型决定的。
上游 `compaction-basic` 的做法和这里一致：追加一条 `user/message` 检查点。

### 6.5 `CompactionResult` 是一笔可核对的账

`fold()` 的返回值不是"成功了"，而是一份账本：

```ts
    return {
      compactionId: CompactionId(`demo-${summaryEvent.seq}`),
      startSeq: shadowedRange.start,
      summarySeq: summaryEvent.seq,
      endSeq: summaryEvent.seq,
      summary,
      shadowedRange,
      shadowedSeqs: foldedSeqs,
      // 真实实现用 ctx.tokenMeter 量；示例用一个常数估算，只为把这条账目走通。
      shadowedTokenCount: foldedSeqs.length * 120,
    }
```

对应第 2 节 M02.3 的输出：

```text
     shadowedRange      = [0..8]  ← 被遮蔽的 9 条
     summarySeq         = 12      ← 摘要事件自己的 seq
     shadowedTokenCount = 1080    ← 省下的 token（示例用常数估算）
```

`summarySeq` 报的是**摘要事件自己的 seq**，`shadowedRange` 报的是被遮蔽的区间，
`shadowedSeqs` 是全部被遮蔽的 seq 列表，`shadowedTokenCount` 报省下多少 token。
调用方靠这份账做审计与遥测——这正是第 01 课"改呈现不改事实"的同一种思路：
**动作可被外部核对**。注意 `compactRegion()` 的返回类型不允许 `null`（显式区间压不动
就是调用方给错了区间，直接抛 `ManualCompactionError`），而 `compactIfNeeded()` 允许。

### 6.6 最终结果：12 → 4，日志 13

```text
④ 最终结果：模型可见面从 12 条折叠成 4 条，日志一条没删:
   折叠后 surface（4 条）:
     seq 12  user       "（已把 9 条历史压成一段摘要）"
     seq  9  user       "m9"
     seq 10  user       "m10"
     seq 11  user       "m11"
   session 日志仍 13 条（append-only），seq 0–8 只是被摘要从可见面遮蔽
```

**4 = 1 条摘要 + 保留最近 3 条。13 = 12 条原始消息 + 1 条摘要事件。** 这两个数字是同一件事的
两个视角，也是本课最该记住的一组对照：模型看到 4 条，事实日志有 13 条，`seq 0–8` 既没有被删、
也没有进模型——它们被遮蔽了。

### 6.7 预算的另外三块：计量、裁剪、溢出

压缩不是唯一的手段。M02.4–M02.6 三个阶段分别演示预算治理的另外三块，它们的实现都是
"一行 re-export"或"两个插件的组合"：

```ts
/** 以回放会话日志的方式估算当前模型可见面的 token 压力。 */
export { TokenMeter as default, TokenMeter } from '@deepseek-ai/dsh-token-meter'
```

```text
tokenMeter: { baseline: 'estimated', surfaceTokens: 11, totalTokens: 11, nodes: 1 }
```

**token meter 不占模型调用**：它靠**回放会话日志**估算压力。`baseline: 'estimated'` 说明这个
估计值不是 provider 报回来的精确计数。它是 `compactIfNeeded` 判断"到没到安全线"的输入。

```text
toolResultPruner: { before: 112, after: 55, marker: true }
```

**tool result pruner** 做的是确定性裁剪：对超长工具结果保留头尾、中间用带 `PRUNE_MARKER` 的
标记替换（`before` / `after` 是替换前后的字符数，`marker: true` 表示标记确实写进去了）。
它是**纯本地**的，比调 LLM 生成摘要便宜得多——而工具输出通常正是 token 消耗的大头。
场景文本里特意放了 emoji，用来验证裁剪不会切碎代理对（Unicode 安全）。

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(LocalSpillStore, { root: config.root, cleanupPeriodDays: 0 })
  await ctx.plugin(spillPolicy, { maxInlineBytes: config.maxInlineBytes })
}
```

```text
spillStore: {
  backend: 'LocalSpillStore',
  inlineBytes: 253,
  hasLocator: true,
  isError: false
}
```

**spill 是"存在哪里"与"什么时候外溢"的分工**：`LocalSpillStore` 提供 `ctx.spillStore` 能力
（按 session 建目录、写完整 UTF-8 文本、返回 locator），`spillPolicy` 决定是否使用它。
场景里工具返回约 1.2 KB 文本、阈值设 256 字节，结果是模型只收到 `253` 字节的预览
（`inlineBytes: 253`），`hasLocator: true` 表示内容里确实带上了指向临时根目录的 locator。
`isError: false` 说明这不是错误路径。

关键的边界是：**policy 是 best-effort**。没有 `ctx.spillStore`、或者保存失败时，它保留原文，
不会让一次工具调用因为"溢出失败"而失败。所以 `LocalSpillStore` 给的是**能力**，
`spillPolicy` 做的是**决策**——两者必须按顺序装载。

---

## 7. 排障：压缩跑了，模型请求却抛 `sourceEventSeqs` 错误

### 症状

`compactIfNeeded` 正常返回，日志里也能看到 `追加摘要事件 seq 12：'user/message' 检查点 +
surfaceOp { op:'replace', 0..8 }` 这一步，但紧接着整个请求失败，报错形如：

```text
surface replace: sourceEventSeqs must include every shadowed surface node; missing 0, 1, 2, ...
```

### 定位

1. 先看报错里的 `missing` 列表——它列出的正是**被遮蔽的可见面节点 seq**。
2. 再看你 `session.append(...)` 的第三个参数：`sourceEventSeqs` 是不是漏了、或者只写了区间
   端点（`[startSeq, endSeq]`）而不是**全部**被遮蔽的 seq。
3. 最后看事件的 `type`。如果你为了"更像模型发言"把摘要写成了 `assistant/message`，
   那你无论怎么填 `sourceEventSeqs` 都过不去。

### 原因与修改

`surface replace` 的契约是：新节点必须声明它由哪些旧节点派生而来，且这份声明要**覆盖每一个
被遮蔽的节点**。这是"Model-visible means logged"那条核心不变量的落地方式——可见面上每一条
内容都要能追溯到日志。

而 `assistant/message` 的 `sourceEventSeqs` 类型是 `never`，它**结构上就不可能**满足这条契约。
修法就是 [`impl/03-compaction-provider.ts`](../M02-context-assembly-economics/impl/03-compaction-provider.ts)
里已经写好的那种：

```ts
    const summaryEvent = session.append(
      'user/message',
      createUserMessage({ content: summary, source: { kind: 'user' } }) as never,
      { surfaceOp: { op: 'replace', startSeq: shadowedRange.start, endSeq: shadowedRange.end }, sourceEventSeqs: foldedSeqs },
    )
```

用 `user/message` 检查点，并把 `foldedSeqs`（**全部**被遮蔽的 seq，不是只有端点）原样传给
`sourceEventSeqs`。另外 `startSeq` / `endSeq` 都必须指向**更早**的事件、且当前可见面里确实
存在这两个节点，否则会抛 `surface replace: start seq ... not found in surface` 之类的错误。
这个坑的特征是：**折叠逻辑本身看起来完全正确，失败发生在写日志的那一行**。

---

## 8. 代码在哪

```bash
cd dsh-example && ls M02-context-assembly-economics/impl M02-context-assembly-economics/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-prompt-section.ts`](../M02-context-assembly-economics/impl/01-prompt-section.ts) | `order: 300` 的取值理由、`text` 的字符串/函数两种形态、末尾那条 disposer 注释 |
| [`impl/02-prompt-variable-assemble.ts`](../M02-context-assembly-economics/impl/02-prompt-variable-assemble.ts) | `variable('today', ...)`、正文里的 `{{today}}` 占位、`await next()` 后再展开 `...downstream` |
| [`impl/03-compaction-provider.ts`](../M02-context-assembly-economics/impl/03-compaction-provider.ts) | 构造里的 `super(ctx)`、`agent/pre-step` 的 `return next()`、三个 `null` 分支、`sourceEventSeqs` 那段长注释、`CompactionResult` 的七个字段 |
| [`impl/04-token-meter.ts`](../M02-context-assembly-economics/impl/04-token-meter.ts) | 整个文件就一行 export——能力来自真实包 |
| [`impl/05-tool-result-pruner.ts`](../M02-context-assembly-economics/impl/05-tool-result-pruner.ts) | 同上：`PRUNE_MARKER` 也是 re-export |
| [`impl/06-spill-policy.ts`](../M02-context-assembly-economics/impl/06-spill-policy.ts) | 两个 `ctx.plugin` 的**先后顺序**、`Config` 里没有默认值（`required()`） |
| [`scenes/03-fold-history.ts`](../M02-context-assembly-economics/scenes/03-fold-history.ts) | `createAgentContext` 怎么造载体、`printSurface` 怎么读可见面、⑧ 的 `fiber.dispose()` |
| [`scenes/06-spill-to-file.ts`](../M02-context-assembly-economics/scenes/06-spill-to-file.ts) | 阈值 256 与返回内容的字节数对照、`finally` 里删临时目录 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。

> **原理对照**：`ctx.systemPrompt` 的四类注册见
> [07 § 7.18](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)、
> `assemble()` 的组装过程见 [07 § 7.21](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)、
> 渲染与变量插值见 [07 § 7.22](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)、
> assemble waterfall 见 [07 § 7.26](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)；
> surface 机制见 [06 § 6.15](../../docs/hello-dsh/06-agent-loop-and-session-log.md)，
> 压缩的三个入口与两个 provider 见
> [08 § 8.33](../../docs/hello-dsh/08-execution-services.md)、
> [08 § 8.34](../../docs/hello-dsh/08-execution-services.md)。

---

## 9. 动手练习

### 练习 A：改一个 `order`，验证排序规则

把 [`impl/01-prompt-section.ts`](../M02-context-assembly-economics/impl/01-prompt-section.ts)
里的 `order: 300` 改成 `order: -50`，再跑：

**验证命令**

```bash
cd dsh-example && npm run M02
```

**可验证答案**：M02.1 的 `# 回复风格` 整段会**上移**——出现在
`You are an AI agent powered by DeepSeek Harness.` 之后、`你是一个乐于助人的编码助手。` 之前。
原因是 `-50` 小于 persona 的 `0`。这一条同时验证了另一件事：**你只改了一个数字，没有碰任何
拼接代码**。

### 练习 B：把"缺值硬错误"变成可观察的输出

在 [`impl/02-prompt-variable-assemble.ts`](../M02-context-assembly-economics/impl/02-prompt-variable-assemble.ts)
里，把 `date-aware` 段正文的 `{{today}}` 改成 `{{today2}}`（一个从未注册的名字），再跑：

**验证命令**

```bash
cd dsh-example && npm run M02
```

**可验证答案**：M02.2 的 ② 段不再打印提示词，而是抛出
`unknown prompt variable "{{today2}}" in section "date-aware"; registered variables: ...`
——错误信息里既有**出错的段名**（`date-aware`），也有**当前已注册的全部变量名**的列表。
把改动还原后 ② 恢复正常。
（注意：场景里 ② 的 `renderPrompt` 没有被 `try/catch` 包住——只有 ③④ 两段包了——
所以这个异常会直接终止脚本，该阶段不会留下 `REAL_STAGE_OK`。）

### 练习 C（进阶）：改压缩的保留条数

把 [`impl/03-compaction-provider.ts`](../M02-context-assembly-economics/impl/03-compaction-provider.ts)
里 `fold()` 的 `const keepRecent = 3` 改成 `5`，再跑：

**验证命令**

```bash
cd dsh-example && npm run M02
```

**可验证答案**：M02.3 的 ③ 段变成
`折叠区间：12 条 - 保留最近 5 条 → seq [0..6]（7 条）`，
`shadowedRange = [0..6]`、`shadowedTokenCount = 840`（7 × 120 的常数估算）；
④ 段的「折叠后 surface」变成 **6 条**（1 条摘要 + 保留的 `m7`–`m11`），
而 `session 日志仍 13 条（append-only）` **保持不变**。
后一个数字不变，正是"压缩不删事实"的直接证据。

---

**下一课** → [第 03 课 · 推理服务接入](03-inference-service-access.md)：Provider 路由三段解析与 `llm/stream` 的包装顺序。

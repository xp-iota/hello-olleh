# 第 03 课 · 推理服务接入：Provider 路由与流协议

> **本课任务**：把两个 `llm/stream` 监听器挂到真实模型调用上——外侧改写 `text-delta`、
> 内侧统计 chunk 与 usage——再换一条消费循环，逐条核对 `StreamChunk` 的协议不变量。
> **运行命令**：`cd dsh-example && npm run M03`
> **你将看到**：`[外侧·改写]` 先于 `[内侧·统计]` 打印，逐条 chunk 里夹着 **200 条**
> `reasoning-delta`，文本块被改写成全大写，最后 4 条 `协议检查: ... = true` 全部成立。

前置：[第 01 课 · 工具管线：三个正交控制面](01-tool-pipeline.md)（它讲的是 `tools/*` 那三段
waterfall；本课讲的是 `llm/stream` 这一条，两者对照着看最省力）。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

前面第 01 课讲的是"Agent 怎么用工具"；这一课往下走一层，讲"**Agent 怎么拿到模型的输出**"。
一次模型调用从场景到供应商 HTTP 之间，DSH 插了两样东西：

| 控制面 | 回答的问题 | 本课对应实现 |
|---|---|---|
| **Provider 路由** | 这次请求发给哪个适配器？ | [`run.ts`](../M03-inference-service-access/run.ts) 的 `provider` / `model` |
| **流拦截（waterfall）** | 谁能看见/改写这条 chunk 流？ | [`impl/llm-stream.ts`](../M03-inference-service-access/impl/llm-stream.ts) |
| **流协议** | 拿到的 chunk 序列合法吗？ | [`support/consume-stream.ts`](../M03-inference-service-access/support/consume-stream.ts) |

要建立的核心直觉是：**`ctx.llm.stream()` 不是直透适配器，而是一条可插拔的流水线**。
流水线上的每一层都能逐条看见 chunk——这正是"计量 token""录制回放""审查拦截""缓存命中"
这些能力能做成插件、而不是改适配器的原因。

```bash
cd dsh-example && npm run M03
```

因为要打真实推理服务，这个命令需要 `LLM_API_KEY`；没有密钥会当场报错，不会退回假数据。

---

## 2. 真实输出

```text

████ M03 · 推理服务接入：Provider 路由与流协议 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M03.1 · 用 llm/stream waterfall 包装 chunk 流 ────
① 消费经 llm/stream waterfall 包装后的 chunk 流:
  [外侧·改写] 包装下游流：text-delta → 大写
  [内侧·统计] 请求 model=fuyao-coding，透传并计数
  - block-start 
  - reasoning-delta 
  - reasoning-delta 
  - reasoning-delta 
  - reasoning-delta 
  - reasoning-delta 
  ……（此处省略 195 条 reasoning-delta：下游仍在逐条透传，大写改写不碰它们）……
  - block-end 
  - block-start 
  - text-delta "DEEPSEEK HARNESS "
  - text-delta "的 LLM 能力缝"
  - text-delta "是统一接入"
  - text-delta "、"
  - text-delta "切换"
  - text-delta "和编排大"
  - text-delta "模型能力的抽象接口"
  - text-delta "，"
  - text-delta "让"
  - text-delta "上层任务与具体"
  - text-delta " LLM 实现解耦"
  - text-delta "。"
  - block-end 
  - usage 
  - finish 

② 外侧改写生效（应为全大写且非空）: "DEEPSEEK HARNESS 的 LLM 能力缝是统一接入、切换和编排大模型能力的抽象接口，让上层任务与具体 LLM 实现解耦。"
③ 内侧统计生效: chunks=218, outputTokens=678
REAL_STAGE_OK M03.1 calls=2 ms=19531 in=0 out=1191 finish=stop

──── M03.d · 专项真实演示：同一消费循环接真实推理服务 ────
① 已注册的 provider 路由: [ 'anthropic-compat' ]
② 目标模型: anthropic-compat / fuyao-coding

③ 消费 anthropic-compat 路由（真实 HTTP + SSE）:
   聚合 assistant 文本: DeepSeek Harness 的 LLM 能力缝是它在评测框架中预留的标准化可插拔接口，用于将不同大模型的生成、推理和工具调用能力统一接入任务流程。
   reasoning-delta 字符数: 921 （thinking 块会映射成 reasoning-delta，不进入文本面）
   chunk 类型统计: {"block-start":2,"reasoning-delta":145,"block-end":2,"text-delta":5,"usage":1,"finish":1}
   block-start 的 blockType 序列: ["reasoning","text"]
   finish.reason: {"kind":"stop"}
   usage: {"inputTokens":0,"outputTokens":506}
协议检查: usage 在 finish 之前 = true
协议检查: finish 是最后一个 = true
协议检查: delta 的 index 都有 block-start = true
协议检查: 有 usage 载荷 = true
REAL_STAGE_OK M03.d calls=1 ms=6154 in=0 out=506 finish=stop "DeepSeek Harness 的 LLM 能力缝是它在评测框架中预留的标准化…"

REAL_MODULE_OK M03 stages=2 calls=3 failed=0
```

**对照自己的输出**：最后一行必须出现 `REAL_MODULE_OK M03 stages=2 calls=3 failed=0`；
M03.d 段必须有 4 行 `协议检查: ... = true`（有一次是 `false` 就说明流协议被破坏）。
M03.1 段的 `chunks=218` 与 `outputTokens=678` 是内层统计学到的数——它必须非零，否则
插件根本没作用在真实流上。顺手可以做个自检：**① 里打印的 chunk 行数正好也是 218**
（`200 + 12 + 2 + 2 + 1 + 1`），两个数相等说明内侧统计没有漏计也没有重复计。

---

## 3. `ctx.llm.stream()` 不是直透：`llm/stream` waterfall

打开 [`impl/llm-stream.ts`](../M03-inference-service-access/impl/llm-stream.ts)，先读文件头的注释：

```ts
/**
 * M03.1 · llm/stream waterfall：拦截一次模型调用的 chunk 流。
 *
 * `ctx.llm.stream()` 不是直透适配器：它经 `llm/stream` waterfall 派发。
 * 监听者拿到 `(options, next)`：
 *   - `next()` 得到下游（最终是适配器）的 chunk 流，可以**包装**它（改写/记录/限流）；
 *   - 不调 `next()` 直接返回自己的流 = 整段接管（缓存命中、审查拦截、replay）。
 *
 * 注意真实签名里 `next()` 返回的是 `AsyncIterable<StreamChunk>` 本身（不是 Promise），
 * 监听者返回值也是 `AsyncIterable<StreamChunk>`。
 */
```

这段注释里有两句话值得各记一遍：

- **`next()` 返回的是流，不是 Promise。** 如果它返回 Promise，就必须等整段回答结束才能拿到
  结果，"逐 chunk 拦截"就没有意义了。类型签名（见
  [07 § 7.3](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)）写得很直白：

  ```ts
  'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  ```

  左边是 `AsyncIterable`，右边也是 `AsyncIterable`——**进出都是流**。

- **不调 `next()` 就等于掐断下游。** 缓存命中时你直接返回自己造的流，适配器根本不会被调用，
  一次网络请求都省掉了。"包裹"与"接管"的区别只有一句 `next()`。

看本课插件的两个监听器本体（这两个是真实的完整实现）：

```ts
export function apply(ctx: Context) {
  // 外侧（第一个注册，最靠近 Consumer）：把 text-delta 全部转大写。
  ctx.on('llm/stream', (_options, next) => {
    console.log('  [外侧·改写] 包装下游流：text-delta → 大写')
    return (async function* (): AsyncIterable<StreamChunk> {
      for await (const chunk of next()) {
        yield chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.toUpperCase() } : chunk
      }
    })()
  })

  // 内侧（第二个注册，最靠近适配器）：观察 + 统计。
  ctx.on('llm/stream', (options, next) => {
    console.log(`  [内侧·统计] 请求 model=${options.model}，透传并计数`)
    return (async function* (): AsyncIterable<StreamChunk> {
      for await (const chunk of next()) {
        stats.chunks++
        if (chunk.type === 'usage') stats.outputTokens += chunk.usage.outputTokens
        yield chunk
      }
    })()
  })
}
```

两个监听器都拿到了 `options`，但只有内侧打印了它——**`model` 来自请求参数，不来自插件名**。
文件顶部那句注释说的就是这件事：

```ts
// 插件名只是诊断标识；模型路由名仍由请求的 options.model/provider 决定。
export const name = 'llm-stream-intercept'
export const inject = ['llm']
```

`name = 'llm-stream-intercept'` 只是 Cordis 里这个插件的标识。**`npm run M03` 的 banner 显示
`model=fuyao-coding`，那是 `options.model` 决定的，跟这个 `name` 毫无关系**——这是初学者最容易
误解的一处。

> **原理对照**：waterfall 的通用语义（短路、`prepend`、`next()` 的推进）集中在
> [cordis 06 § 6.3](../../docs/hello-cordis/06-event-system-and-waterfall.md)；DSH 侧
> `llm/stream` 接缝本身见 [07 § 7.3](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)。

---

## 4. "外侧 / 内侧"由注册顺序决定，不是语法

先把第 2 节的两行证据挑出来单看：

```text
  [外侧·改写] 包装下游流：text-delta → 大写
  [内侧·统计] 请求 model=fuyao-coding，透传并计数
```

**改写那行先打印。** 这就是"谁是外侧"的全部证据——先被调用的先打印。

关键在于：两段 `ctx.on('llm/stream', ...)` 的写法**完全同构**，都接收 `(options, next)`，
都返回一个包装生成器。代码里没有任何"我是外侧"的特殊语法、没有优先级数字、也没有
`async` 快慢之分。角色只由一件事决定：**它在派发队列里的位置**。

Cordis 的 `waterfall` 实现把这个队列摆得很清楚（[`sources/cordis/packages/core/src/events.ts`](../../sources/cordis/packages/core/src/events.ts)）：

```ts
waterfall(...args: any[]) {
  const [thisArg, callbacks] = this._resolve('waterfall', args)
  const inner = args.pop()
  const dispatch = () => {
    const callback = callbacks.shift()
    if (!callback) return inner()
    ...
```

- `callbacks.shift()`：**按数组顺序**取下一个监听器；
- `inner()`：队列耗尽后才执行的兜底，对 `llm/stream` 来说就是**真正的适配器调用**。

而注册时用的是 `push`（没有 `prepend` 时）：

```ts
private register(label: string, name: string | symbol, callback: any, options: EventOptions): () => void {
  const method = options.prepend ? 'unshift' : 'push'
```

`push` 进、`shift` 出 = **先注册的先被调用 = 先注册的在最外层**。所以
[`impl/llm-stream.ts`](../M03-inference-service-access/impl/llm-stream.ts) 先写"大写改写"、
后写"统计"，大写改写就在外侧。

一个可以直接在纸上推出来的结论：**把这两个 `ctx.on` 代码块上下调换，内外角色就跟着调换**——
统计变成外侧、大写变成内侧，而 `[外侧·改写]` / `[内侧·统计]` 这两个**字符串标签不会跟着变**。
标签是人手写的，位置才是机制。练习 A 会让你真的做一次这个交换。

数据返回方向与调用方向相反，README 里给的结构式很好用：

```ts
大写流(统计流(Adapter流))
```

- 向内拉：场景 → 外侧改写 → 内侧统计 → Adapter；
- 向外送：Adapter 产出的每条 chunk → 先被内侧统计 → 再被外侧改写 → 最后到场景。

本模块的 [顺序时序图](../M03-inference-service-access/diagrams/stream-wrapper-order.svg)
把这两条方向画在一起（[交互版](../M03-inference-service-access/diagrams/stream-wrapper-order.html) ·
[IR 源](../M03-inference-service-access/diagrams/stream-wrapper-order.sequence.json)）。

---

## 5. 三个时刻：注册 / 返回流 / 开始迭代

这是本课最反直觉、也最容易写出 bug 的一节。

看外侧监听器这一行：

```ts
return (async function* (): AsyncIterable<StreamChunk> {
  for await (const chunk of next()) { ... }
})()
```

`(async function* () { ... })()` **立刻创建并返回一个生成器对象，但函数体一行都没跑**。
于是同一次调用被切成三个时刻：

| 时刻 | 发生了什么 | 日志里的证据 |
|---|---|---|
| ① 监听器被调用 | 函数体立即执行到 `return` 之前；`console.log('  [外侧·改写] ...')` 打印 | `[外侧·改写]` 与 `[内侧·统计]` 两行在**任何 chunk 之前**打印 |
| ② 返回流 | 返回的是生成器对象，包装逻辑尚未运行；内侧此时**还没被调用** | 这两行之间不会插进任何 `- block-start` |
| ③ 开始迭代 | 场景 `for await` 拉动，生成器体开始执行，调用自己的 `next()` | `- block-start` 之后才出现逐条 chunk |

场景那边的一行代码触发了时刻 ③：

```ts
for await (const chunk of stream) {
  console.log('  -', chunk.type, chunk.type === 'text-delta' ? JSON.stringify(chunk.text) : '')
  if (chunk.type === 'text-delta') text += chunk.text
}
```

所以第 2 节里 `[外侧·改写]` 在 `[内侧·统计]` **之前**、而两者都在 `- block-start` **之前**，
不是巧合：时刻 ①② 只走"注册顺序"，时刻 ③ 才走"流的数据路径"。

### `next()` 不是又调了一次 `ctx.llm.stream()`

初学者常写错的一个心理模型是：`next()` = 重新发起一次请求。**不是。**
`next` 是 Cordis 在派发时闭包进去的一个推进函数，它共享同一个 `callbacks` 队列：

```ts
const next = () => {
  if (called) throw new Error('next() called multiple times')
  called = true
  return dispatch()
}
```

- 它只是 `shift` 出队列里的下一个监听器，**不会从外侧重新开始**；
- 队列耗尽时它调用 `inner()`，也就是适配器；
- 同一个监听器里**调第二次会直接抛 `next() called multiple times`**。

这条抛错把"每层只调一次"从建议变成了硬约束。因为 `next()` 返回的是**整条下游流**，
每层的正确写法是"调一次、拿整条、再 `for await` 逐条消费"：

```ts
for await (const chunk of next()) {   // ← 只在这里调用了一次 next()
  yield chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.toUpperCase() } : chunk
}
```

**不是每收到一个 chunk 就调一次 `next()`。** 后续的 chunk 是迭代器自己继续拉出来的。

### 不调 `next()` = 整段接管

如果外层监听器根本不碰 `next()`，而是直接 `yield` 自己造的 chunk，那么：

- 内侧监听器**不会被调用**（`[内侧·统计]` 不会打印）；
- 适配器**不会收到请求**（缓存/拦截的全部意义）；
- 场景仍然正常拿到一条合法的 chunk 流。

这就是 `impl/llm-stream.ts` 注释里写的"缓存命中、审查拦截、replay"的实现方式。
练习 B 会让你亲手做一次，并看到本场景的 fail-loud 断言如何把这种接管抓出来。

---

## 6. 协议不变量：四条检查与 `reasoning-delta`

M03.d 换了一条**独立的消费循环**——同一个 harness 装配，但**不加载本模块插件**
（所以 M03.d 的文本没有变大写，`stats` 也不会继续增长）。它把流交给
[`support/consume-stream.ts`](../M03-inference-service-access/support/consume-stream.ts) 聚合：

```ts
for await (const chunk of stream) {
  result.order.push(chunk.type)
  result.counts[chunk.type] = (result.counts[chunk.type] ?? 0) + 1
  switch (chunk.type) {
    case 'block-start':
      result.blockTypes.push(chunk.blockType)
      open.add(chunk.index)
      break
    case 'text-delta':
      if (!open.has(chunk.index)) result.orphanDeltas += 1
      result.text += chunk.text
      break
    case 'reasoning-delta':
      if (!open.has(chunk.index)) result.orphanDeltas += 1
      result.reasoningChars += chunk.text.length
      break
    ...
    case 'block-end':
      open.delete(chunk.index)
      break
    case 'usage':
      result.usage = chunk.usage
      break
    case 'finish':
      result.finish = chunk.reason
      break
  }
}
```

注意 `open` 这个集合：`block-start` 把 `index` 放进去，`block-end` 把它拿出来，
每个 delta 都要先查一次自己的 `index` 在不在里面——**不在就记一次 `orphanDeltas`**。
这就是"孤立 delta"的定义。

检查本身是四行纯断言：

```ts
export function printProtocolChecks(result: ConsumeResult): void {
  const usageBeforeFinish = result.order.indexOf('usage') < result.order.indexOf('finish')
  const finishIsLast = result.order.length > 0 && result.order[result.order.length - 1] === 'finish'
  console.log('协议检查: usage 在 finish 之前 =', usageBeforeFinish)
  console.log('协议检查: finish 是最后一个 =', finishIsLast)
  console.log('协议检查: delta 的 index 都有 block-start =', result.orphanDeltas === 0)
  console.log('协议检查: 有 usage 载荷 =', result.usage !== undefined)
}
```

对应第 2 节 M03.d 的 4 行全 `true`：

```text
协议检查: usage 在 finish 之前 = true
协议检查: finish 是最后一个 = true
协议检查: delta 的 index 都有 block-start = true
协议检查: 有 usage 载荷 = true
```

这四条不是"随便定的规范"，而是适配器**真的这么产出**。在
[`runtime/llm.ts`](../runtime/llm.ts) 里，SSE 解析循环结束后先发 `usage`、再发 `finish`，
而且这是函数最后两个 `yield`：

```ts
yield { type: 'usage', usage: tokenUsage(inputTotal, outputTokens, cacheReadTokens, cacheWriteTokens) }
const kind = FINISH_REASON[stopReason] ?? 'stop'
...
yield {
  type: 'finish',
  reason: kind === 'max-tokens' ? { kind: 'max-tokens' } : kind === 'tool-calls' ? { kind: 'tool-calls' } : { kind: 'stop' },
  replayState,
}
```

**顺序即契约**：下游可以放心地"看到 `finish` 就收尾"，不必担心后面还有数据。

### `reasoning-delta` 为什么不进文本面

第 2 节 M03.1 逐条 chunk 里那 **200 条** `reasoning-delta`，在 M03.d 里被单独统计：

```text
   reasoning-delta 字符数: 921 （thinking 块会映射成 reasoning-delta，不进入文本面）
   chunk 类型统计: {"block-start":2,"reasoning-delta":145,"block-end":2,"text-delta":5,"usage":1,"finish":1}
   block-start 的 blockType 序列: ["reasoning","text"]
```

三条证据连起来读：

1. `blockType 序列`是 `["reasoning","text"]`——这次回答有**两个** block，先思考、后文本；
2. `reasoning-delta` 的字符数（921）**不进** `聚合 assistant 文本`，后者只有最后那段正式回答；
3. `consume-stream.ts` 里也确实是分开累加的：`text` 只吃 `text-delta`，
   `reasoning-delta` 只进 `reasoningChars`。

再看 [`runtime/llm.ts`](../runtime/llm.ts) 的映射，就明白这些 chunk 从哪来：

```ts
} else if (block.type === 'thinking') {
  const text = block.thinking ?? ''
  active.set(index, { kind: 'reasoning', text, signature: block.signature ?? '' })
  yield { type: 'block-start', index, blockType: 'reasoning' }
  if (text) yield { type: 'reasoning-delta', index, text }
}
```

供应商的 `thinking` 块不存在"忽略"或"丢掉"——它被**映射成 `reasoning-delta` 单独成面**。
想给用户显示"模型正在思考"，读这条面；想拼最终回答，读 `text-delta`。两个面不能混。

### 大写示例的边界

[`impl/llm-stream.ts`](../M03-inference-service-access/impl/llm-stream.ts) 的改写条件只盯一个类型：

```ts
yield chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.toUpperCase() } : chunk
```

它**不改** `block-end.block.text`。也就是说，增量文本被改成了大写，而块收尾时携带的完整
`block.text` 仍是原文。**演示流包装够用了，真实的完整内容变换不能这样**——否则下游把
`text-delta` 拼出来的结果和 `block-end` 里的结果对不上。README 的"观察点与边界"第一条
讲的就是这件事。

（顺带说明一个证据边界：第 2 节 ① 的逐条打印只打印 `chunk.type` 和 `text-delta` 的文本，
**不打印 `block-end` 里的 `block.text`**；所以"块尾文本没被改写"是代码事实，这一点没有直接
落在本次日志里。日志能证明的是：聚合文本已全大写且首条增量原本是小写 ASCII。）

---

## 7. 排障：改成中文提问后，"大写改写"看起来没生效

### 症状

你把场景里的提问换成纯中文，跑 `npm run M03`，`② 外侧改写生效（应为全大写且非空）` 那行
打印出来的文本**跟原文一模一样**，一个字母都没变。于是怀疑 `llm/stream` 监听器根本没跑。

### 定位

1. 先看 ① 里有没有 `[外侧·改写] 包装下游流：text-delta → 大写` 这一行。
   打印了，说明监听器**被调用了**、也就说明 waterfall 派发是通的。
2. 再看 `③ 内侧统计生效: chunks=...` 是不是非零。非零说明 chunk 真的流过两层。
3. 最后看 ① 里 `text-delta` 的原文长什么样——如果里面全是汉字，答案就在这。

### 原因与修改

**中文没有大小写**。`'你好'.toUpperCase() === '你好'`，所以中文回答无法独立证明改写发生过。
本次真实运行之所以能证明，是因为模型的回答以一段 ASCII 开头：

```text
  - text-delta "DEEPSEEK HARNESS "
```

而 ② 里的聚合文本同样是 `DEEPSEEK HARNESS 的 LLM 能力缝...`——**原文本来是小写
`DeepSeek Harness`，这里变成了全大写**，改写确实生效了。

想自己独立验证，两条路：

- 让模型输出英文（改 `system` 或提问语），再看 ② 是否变成 `DEEPSEEK HARNESS ...`；
- 或者把改写换成与语言无关的变换（例如给每条 `text-delta` 加一个前缀标记），
  这样中文也能一眼看出包装层在不在。

一句话记住：**场景底部的断言检查的是"文本非空且等于其大写形式"，
它在中文下恒为真，所以中文用例只是一个弱证据。**

---

## 8. 代码在哪

```bash
cd dsh-example && ls M03-inference-service-access/impl M03-inference-service-access/scenes M03-inference-service-access/support
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/llm-stream.ts`](../M03-inference-service-access/impl/llm-stream.ts) | 文件头注释的"直透 vs 接管"；两个 `ctx.on('llm/stream')` 的**上下顺序**；`(async function*(){})()` 的写法；只改 `text-delta` 的条件 |
| [`scenes/wrap-chunk-stream.ts`](../M03-inference-service-access/scenes/wrap-chunk-stream.ts) | `loadPlugin` 的时机；`ctx.llm.stream({ provider, model, ... })` 的参数；`for await` 消费；底部两条 fail-loud 断言 |
| [`support/consume-stream.ts`](../M03-inference-service-access/support/consume-stream.ts) | `open` 集合与 `orphanDeltas`；`text` 与 `reasoningChars` 分开累加；`printProtocolChecks` 的四行 |
| [`run.ts`](../M03-inference-service-access/run.ts) | `listProviders()` 的打印；`consumeStream(harness.ctx.llm.stream({...}))` 的接法；失败断言 |
| [`runtime/llm.ts`](../runtime/llm.ts) | SSE 事件 → `StreamChunk` 的映射表（`content_block_start/delta/stop`）；结尾 `usage` → `finish` 的固定顺序 |
| [`runtime/harness.ts`](../runtime/harness.ts) | `registerAdapter([REAL_PROVIDER], ...)` 的路由注册；`probeAssembly()`（M03.1 的 `calls=2` 里有一次是它） |

读法：**先读 `scenes/` 看它怎么"演"，再读 `impl/` 看它怎么"实现"，最后读 `runtime/` 看真实适配器
怎么把 SSE 变成契约内的 chunk。**

---

## 9. 动手练习

### 练习 A：交换两个监听器，验证"内外由顺序决定"

把 [`impl/llm-stream.ts`](../M03-inference-service-access/impl/llm-stream.ts) 里的
"外侧·改写"和"内侧·统计"两个 `ctx.on` 代码块**整块上下调换**（只调换位置，不改内容），然后跑：

**验证命令**

```bash
cd dsh-example && npm run M03
```

**可验证答案**：① 里先打印的那一行变成 `[内侧·统计] 请求 model=...`，
`[外侧·改写] ...` 落到第二行——**先注册的先被调用**。但 `② 外侧改写生效` 的文本仍然是全大写、
`③ chunks=218` 仍然非零：角色换了，两个包装都还在链上，谁都没失效。字符串标签是手写的，
**位置才是机制**。

### 练习 B：不调 `next()`，看"整段接管"接管了什么

在"外侧·改写"的监听器里，把生成器体改成**不调用 `next()`**、直接吐一条自己造的 chunk：

```ts
ctx.on('llm/stream', (_options, next) => {
  console.log('  [外侧·改写] 整段接管：下游不会被调用')
  return (async function* (): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: 'CACHED ANSWER' }
  })()
})
```

（自造的文本必须仍是大写，否则场景底部的断言会先炸在另一处。）再跑：

```bash
cd dsh-example && npm run M03
```

**可验证答案**：`[内侧·统计]` **不再打印**（内侧监听器根本没被调用），并且脚本会 fail loud 抛
`llm/stream 内侧统计未生效 —— waterfall 观察者未被验证`。另外 `REAL_STAGE_OK M03.1` 的
`calls=` 会从 `2` 掉到 `1`（只剩入口 probe 那次真实调用）——**场景这次流根本没走到适配器**。
这就是"缓存命中不用发请求"同一套机制的另一面。

### 练习 C：打开逐条模式，验证协议检查不受影响

`consumeStream` 支持 `verbose`。把 [`run.ts`](../M03-inference-service-access/run.ts) 里
M03.d 的调用改成：

```ts
const real = await consumeStream(
  harness.ctx.llm.stream({ provider: 'anthropic-compat', model, system: '你是一个演示助手，回答保持一句话。', messages: [userText('用一句话介绍 DeepSeek Harness 的 LLM 能力缝。')] }),
  { verbose: true },
)
```

**验证命令**

```bash
cd dsh-example && npm run M03
```

**可验证答案**：M03.d 段会多出一批 `逐 chunk 流出：` 开头的行（本次真实运行的 M03.d 共
`2+145+2+5+1+1 = 156` 条 chunk）。读的时候注意块结构（M03.1 的 ① 已经给出了同一份协议的
完整样子）：`reasoning` 块先 `block-end`，随后才是 `block-start` + 文本块——**两个块 index
不同、各自成面**。而 `chunk 类型统计`、`block-start 的 blockType 序列` 和 4 行 `协议检查`
与不开 `verbose` 时**完全一致**：加不加观察者，不改流本身。

另外核一下 M03.1 的 ① 和 ③：① 打印的 chunk 行数是 `200+12+2+2+1+1 = 218`，
与 ③ 的 `chunks=218` 相等——**外侧逐条看到的条数和内侧统计到的条数一致**，
说明这个包装层既不丢 chunk 也不重复吐 chunk。

---

**下一课** → [第 04 课 · Agent 循环与干预面](04-agent-loop-intervention.md)：模型调用拿到了，
接下来看 AgentLoop 怎么把"一次调用"循环成"一轮对话"，以及从哪三个边界插手进去。

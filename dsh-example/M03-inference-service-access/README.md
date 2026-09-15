# M03 · 推理服务接入

本模块演示两件事：Adapter 把供应商的 HTTP/SSE 响应转换为统一的 `StreamChunk`；`llm/stream` 中间件在 Consumer 与 Adapter 之间逐条观察或改写 chunk。

## 运行与文件

```bash
npm run M03   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

这里只有一个中间件实现和一个对应场景，文件直接按职责命名，不保留跳号的数字前缀。

| 阶段 | 入口 | 观察什么 |
|---|---|---|
| M03.1 流中间件 | [scenes/wrap-chunk-stream.ts](scenes/wrap-chunk-stream.ts)，加载 [impl/llm-stream.ts](impl/llm-stream.ts) | 外侧改写文本，内侧统计 chunk 与 usage |
| M03.d 协议消费 | [run.ts](run.ts) 的 `runLlmAdapterMinimax()`，调用 [support/consume-stream.ts](support/consume-stream.ts) | 聚合文本、reasoning、usage 和 finish，打印协议检查结果 |

两个阶段各自创建 harness。M03.d **没有加载中间件插件**，因此不会转大写，也不会继续增加插件的 `stats`。两个阶段使用同一种流类型，但各有自己的消费循环。

## 从入口到真实模型，谁调用谁

1. [runtime/harness.ts](../runtime/harness.ts) 的 `createHarness()` 装配 `LlmRuntime`，提供 `ctx.llm` 服务，并将 `CountingAnthropicCompatAdapter` 注册到 `anthropic-compat` 路由。它在 [runtime/llm.ts](../runtime/llm.ts) 的 `AnthropicCompatAdapter` 上增加真实调用计数。
2. M03.1 场景执行 `await harness.loadPlugin(plugin)`，插件的 `apply(ctx)` 注册两个 `llm/stream` 监听器。这一步只安装处理逻辑，还没有请求模型。
3. 场景调用 `ctx.llm.stream({ provider, model, messages, ... })`。`provider` 选择 Adapter，`model` 指定模型；插件的 `name` 只是诊断标识，不参与路由。
4. `LlmRuntime` 派发 `llm/stream` waterfall，将内部 Adapter 调用作为最后的 `next`。监听器逐层包住它，返回 `AsyncIterable<StreamChunk>`。
5. 场景的 `for await` 拉取流时，才逐层进入异步生成器，最终由 Adapter 发起 HTTP 请求、解析 SSE，并产出统一 chunk。chunk 经过中间件后回到场景。

`runModule()` 还会在 M03.1 之前发起一次独立的装配探测请求，验证 agent-loop 完整链路。这个 probe 不加载本模块插件；后面场景里的请求才展示下面的两层包装。

## “外侧”和“内侧”到底指什么

**外侧靠近消费流的场景，内侧靠近产生流的 Adapter。** 对本例这两个未设置 `prepend` 的监听器，Cordis 按注册顺序调用：第一个注册的处于外侧，第二个处于内侧。因此实现文件先注册“大写改写”，再注册“统计”。

两段监听器写法相似是正常的：它们都接收 `(options, next)`，并返回一个包装下游流的生成器。**代码没有“我是内侧／外侧”的特殊语法；角色由监听器在派发队列中的位置决定，不由异步执行速度决定。** 本例两个 `ctx.on` 按代码从上到下注册，且都未设置 `prepend`。交换这两段注册代码，统计就变成外侧，大写改写就变成内侧。

下面按时间从上到下读。为突出两层关系，图中省略 Cordis / LlmRuntime 的中转列：第 ① 步实际经 `ctx.llm.stream()` 与 waterfall 派发，第 ④⑤ 步的 `next()` 由 Cordis 推进到下一项。第 ⑥—⑧ 步只展开一条文本 chunk，其他 chunk 继续按相同方向返回。

![注册顺序与流的调用时序](diagrams/stream-wrapper-order.svg)

**注册顺序与流的调用时序** — [交互版](diagrams/stream-wrapper-order.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/stream-wrapper-order.sequence.json)

- **内外由顺序决定**：默认先注册在外；交换注册顺序，内外互换。
- **调用向内推进**：每层 next() 一次，取下游流；迭代才开始执行。
- **数据逐层返回**：Adapter 产出后，先统计，再改写，最后消费。

可以把最终返回的流理解为这个嵌套表达式（用于说明结构，不是实际 API）：

```ts
大写流(统计流(Adapter流))
```

| 层 | 拿到的 `next()` 是什么 | 对返回的 chunk 做什么 |
|---|---|---|
| 外侧：大写改写 | 内侧统计监听器返回的流 | 将 `text-delta.text` 转成大写，其余原样传出 |
| 内侧：统计 | LlmRuntime 内部的 Adapter 流 | 每条增加 `stats.chunks`；遇到 `usage` 累加 `outputTokens`；原样传出 |
| Adapter | 已到达实际后端 | 发请求、解析 SSE、产生 `StreamChunk` |

### `next()` 为什么不会再次调用自己

`next` 由 Cordis waterfall 提供，内部保存着本次派发尚未执行的监听器队列。每调用一次，就取出下一个监听器；队列耗尽后，执行 LlmRuntime 提供的最终 Adapter 回调。它不是重新调用 `ctx.llm.stream()`，不会从外侧重新开始。

本例每层只调用一次 `next()`，得到下游的整个流，然后用 `for await` 逐条消费。**不是每收到一个 chunk 就调用一次 `next()`**。后续 chunk 通过流迭代器继续拉取。

### 注册、返回流、开始迭代是三个时刻

监听器中的关键写法是：

```ts
ctx.on('llm/stream', (_options, next) => {
  // 监听器被调用时立即执行，例如打印“外侧·改写”。
  return (async function* () {
    // 生成器被 for-await 消费时才执行这里。
    for await (const chunk of next()) {
      yield chunk.type === 'text-delta'
        ? { ...chunk, text: chunk.text.toUpperCase() }
        : chunk
    }
  })()
})
```

`(async function* () { ... })()` 立即创建并返回异步生成器对象，函数体此时尚未运行。`next()` 返回的是 `AsyncIterable<StreamChunk>`，不是等待整段回答的 Promise。

一次调用的实际顺序如下：

1. 场景调用 `ctx.llm.stream(...)`，外侧监听器先打印“外侧·改写”，返回外侧生成器；此时内侧尚未被调用。
2. 场景进入 `for await`，外侧生成器开始运行，调用自己的 `next()`。
3. Cordis 调用内侧监听器，它打印“内侧·统计”，返回内侧生成器。
4. 外侧开始消费内侧生成器，内侧调用自己的 `next()`，开始消费 Adapter 流。
5. Adapter 每产生一条 chunk，内侧先统计并 `yield`，外侧再改写并 `yield`，场景最后收到它。重复这一过程，直到流结束。

所以，向内拉取的顺序是“场景 → 外侧改写 → 内侧统计 → Adapter”；数据返回的顺序是“Adapter → 内侧统计 → 外侧改写 → 场景”。“先调用”与“先处理返回的 chunk”是相反的顺序。

### 用一条 chunk 走一遍

假设 Adapter 产生 `{ type: 'text-delta', index: 0, text: 'Hello dsh' }`：

1. 内侧收到原始文本，令 `stats.chunks += 1`，将同一条 chunk 传出。
2. 外侧收到它，复制为 `text: 'HELLO DSH'` 的新 chunk 并传出。
3. 场景收到大写文本，打印并拼接到最终 `text`。

如果收到的是 `usage`，内侧累计其中的 `outputTokens`，外侧不改写。这两个侧面处理的是**同一次模型请求的同一条流**，不会各发起一次请求。若某个监听器不调用 `next()` 而返回自己的流，后续监听器与 Adapter 就不会执行。

## 观察点与边界

- 运行 M03.1 时，先看到“外侧·改写”，再看到“内侧·统计”，之后是逐条 chunk 输出；最终显示聚合文本和统计值。
- 大写示例只修改 `text-delta`，不修改 `block-end.block.text`。它演示逐条流包装；生产中的完整内容变换还需保持增量文本与最终 block 一致。
- 中文没有大小写变化；当前断言检查文本非空且等于其大写形式，因此纯中文回答不能独立证明改写发生。理解转换时可对照上面的英文 chunk 示例。
- M03.d 的 helper 记录 chunk 顺序、block 类型、孤立 delta、usage 和 finish；顺序检查会打印，入口另对文本非空、finish/usage 存在及孤立 delta 为零做失败断言。
- 所有阶段都调用真实推理服务，没有离线替代路径。这里直接消费 `ctx.llm.stream()`，不需要让 agent-loop 代为发起中间件场景请求。

/**
 * M12.1 · cordis 的五种事件派发模式（DispatchMode）。
 *
 * 同一个 `ctx.on(name, fn)` 注册的监听器，被五种派发方式消费：
 *   - ctx.emit(name, ...args)      同步即发即忘：返回值与 Promise 都被忽略——session/event 就是这种
 *   - ctx.parallel(name, ...args)  并发等待全部监听者 settle；任一拒绝聚合为 AggregateError——
 *                                  session/flush 持久化检查点用这种
 *   - ctx.serial(name, ...args)    按注册顺序逐个 await，首个 isBailed 值（非 null/false/undefined）
 *                                  截链返回——agent/turn-stopping 用这种
 *   - ctx.bail(name, ...args)      serial 的同步版本。serial / bail 即 GoF 责任链模式（CoR）：
 *                                  问"谁来处理？"——首个接盘者截链，转发者不再拿回控制权
 *   - ctx.waterfall(name, ...args, next) 中间件而非责任链：围绕 next() 组合，
 *                                  **最后一个实参就是内建默认**（base）；外层逐层加工内层结果，
 *                                  不调 next() 即否决下游与内建默认——
 *                                  agent/pre-step、agent/request、llm/stream 用这种
 *
 * 两种模式的对照：④⑤（demo/pick）是责任链侧，⑥（demo/wrap）是中间件侧；
 * 判别准则：转发后还能不能拿回控制权、加工下游结果？
 * 原理只在一处展开：docs/hello-cordis/06 篇 § 6.3（分界见 § 6.3.6）。
 *
 * 下面监听者的**耗时与注册顺序是刻意安排的**，每组对照都为了暴露一个模式特征：
 *   - ② 慢的注册在前（A 50ms、B 10ms）→ 证明并发下完成顺序由耗时决定，与注册顺序无关
 *   - ④⑤ 全同步 → 证明 serial 与 bail 在同一批监听者上结果完全相同
 *   - ⑦b 异步 → 证明两者唯一的差别（await 与否）会带来怎样的后果
 *
 * 顺带演示 cordis 的**类型化事件表**：自定义事件要用模块增强声明进 `Events`，
 * 这样 `ctx.on` / `ctx.emit` 的参数与返回值都被 TS 检查（写错事件名直接编译不过）。
 */
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** @mode emit —— 三个观察者，其中 C 是异步的 */
    'demo/observe'(tag: string): void
    /** @mode parallel —— 两个耗时不同的持久化监听者 */
    'demo/flush'(tag: string): Promise<void>
    /** @mode serial / bail —— 全同步的责任链，两个模式结果相同 */
    'demo/pick'(n: number): string | undefined
    /** @mode serial / bail —— 异步责任链，暴露 bail 不等 await 的坑 */
    'demo/pick-async'(n: number): string | undefined | Promise<string | undefined>
    /** @mode bail —— isBailed 的边界：首个监听者返回 0 */
    'demo/boundary'(): number | undefined
    /** @mode waterfall —— 外层包装内层结果 */
    'demo/wrap'(text: string, next: () => Promise<string>): Promise<string>
  }
}

/** 本地延时的简写，只服务于本例的时序演示。 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 插件名只用于 Fiber 诊断；本例直接监听事件，不依赖任何运行时 service。
export const name = 'dispatch-modes'
// 空依赖表示 apply 可以立即运行；事件派发方法由 ctx 本身提供。
export const inject = []

export function apply(ctx: Context) {
  // ① emit：观察者 C 是异步的，用来证明"返回值与 Promise 都被忽略"。
  ctx.on('demo/observe', (tag) => {
    console.log(`  [观察者 A] 看到 ${tag}`)
  })
  ctx.on('demo/observe', (tag) => {
    console.log(`  [观察者 B] 看到 ${tag}`)
  })
  ctx.on('demo/observe', async (tag) => {
    await sleep(20)
    console.log(`  [异步观察者 C] 睡够 20ms 才看到 ${tag}`)
  })

  // ②③ parallel：A 慢（50ms）但注册在前，B 快（10ms）但注册在后。
  // 并发下完成顺序由耗时的长短决定，注册顺序不再有意义——这是 parallel 与 serial 的关键差别。
  ctx.on('demo/flush', async (tag) => {
    await sleep(50)
    console.log(`  [持久化 A] 已落盘 ${tag}（耗时 50ms）`)
  })
  ctx.on('demo/flush', async (tag) => {
    await sleep(10)
    if (tag === 'fail') throw new Error('模拟持久化后端故障')
    console.log(`  [持久化 B] 已落盘 ${tag}（耗时 10ms）`)
  })

  // ④⑤ serial / bail ≈ 责任链：每个候选者只决定"接不接"——A 放行（返回 undefined），B 接盘即截链。
  // 这一组**全是同步监听者**，所以 serial（await 版本）与 bail（同步版本）表现完全一致。
  ctx.on('demo/pick', () => {
    console.log('  [候选 A] 不接盘（return undefined → 继续问下一个）')
    return undefined
  })
  ctx.on('demo/pick', (n) => {
    console.log(`  [候选 B] 接盘 ${n} → 返回 bail 值截链`)
    return `winner:${n}`
  })

  // ⑦b 同一批监听者换成异步的：serial 会 await 出真值，bail 则把未决 Promise 当成截链值直接返回。
  ctx.on('demo/pick-async', async (n) => {
    await sleep(30)
    console.log(`  [异步候选] 睡够 30ms 才返回 ${n}`)
    return `async-winner:${n}`
  })

  // ⑦a isBailed 的边界：0 不是 null / false / undefined，于是它**意外地**截断了链。
  ctx.on('demo/boundary', () => {
    console.log('  [返回 0 的监听者] 0 既不是 null 也不是 false/undefined → 竟然截链了')
    return 0
  })
  ctx.on('demo/boundary', () => {
    console.log('  [下游监听者] 我本该执行，却被那个 0 截断了')
    return undefined
  })

  // ⑥ waterfall = 中间件：结果在最内层产生、逐层向外加工——A 包装下游结果；B 观察后交回 next()。
  // 若 B 不调 next()，内建默认也会被一并否决（与责任链的"接盘即止"相反）。
  ctx.on('demo/wrap', async (_text, next) => {
    const inner = await next()
    return `【A 包装】${inner}`
  })
  ctx.on('demo/wrap', (text, next) => {
    console.log(`  [B] 观察到输入 ${JSON.stringify(text)}，交回 next()`)
    return next()
  })
}

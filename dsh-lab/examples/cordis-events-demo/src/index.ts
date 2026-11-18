/**
 * 事件系统的五种派发模式：emit / parallel / serial / bail / waterfall。
 * 外加两条纪律：监听器即 effect（随 fiber 回收）、internal/dispatch 是全量观测入口。
 *
 * 运行：node src/index.ts / bun src/index.ts（无需构建）
 */
import { Context } from 'cordis'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

declare module 'cordis' {
  interface Events {
    'lab/notice'(msg: string): void
    'lab/boom'(): void
    'lab/report'(msg: string): void
    'lab/claim'(msg: string): string | number | null | false | undefined
    'lab/claim-async'(msg: string): Promise<string | null | undefined>
    'lab/wrap'(text: string, next: () => string): string
    'lab/gate'(text: string, next: () => string): string
    'lab/double'(text: string, next: () => string): string
    'lab/ping'(): void
    'lab/quiet'(): void
  }
}

const ctx = new Context()

console.log('① emit 与 parallel：同步广播 vs 并发上报')
ctx.on('lab/notice', (msg) => console.log('   [监听器 1] 收到', msg))
ctx.on('lab/notice', (msg) => console.log('   [监听器 2] 收到', msg))
ctx.emit('lab/notice', 'hello')
ctx.on('lab/report', async (msg) => {
  await sleep(20)
  console.log('   [上报 A] 完成', msg)
})
ctx.on('lab/report', async () => {
  await sleep(10)
  throw new Error('上报 B 失败')
})
try {
  await ctx.parallel('lab/report', 'metrics')
} catch (error) {
  const agg = error as AggregateError
  console.log('   parallel 抛 AggregateError：', agg.message, '，错误数 =', agg.errors.length)
}
ctx.on('lab/boom', () => {
  throw new Error('监听器抛错')
})
try {
  ctx.emit('lab/boom')
} catch (error) {
  console.log('   emit 不接异常，直接穿透：', (error as Error).message, '\n')
}

console.log('② bail 与 serial：首个「非空」返回值即认领，0 也算非空')
const asked: string[] = []
ctx.on('lab/claim', () => {
  asked.push('A(undefined)')
  return undefined
})
ctx.on('lab/claim', () => {
  asked.push('B(null)')
  return null
})
ctx.on('lab/claim', () => {
  asked.push('C(false)')
  return false
})
ctx.on('lab/claim', () => {
  asked.push('D(返回 0)')
  return 0
})
ctx.on('lab/claim', () => {
  asked.push('E(不会被问到)')
  return 'E'
})
const answer = ctx.bail('lab/claim', '谁来处理？')
console.log('   bail 结果：', answer, '（0 被 isBailed 判为认领）')
console.log('   被问到的监听器：', asked.join(' → '))
ctx.on('lab/claim-async', async () => {
  await sleep(5)
  return null
})
ctx.on('lab/claim-async', async () => {
  await sleep(5)
  return '异步认领者'
})
ctx.on('lab/claim-async', async () => {
  throw new Error('不会被执行')
})
const asyncAnswer = await ctx.serial('lab/claim-async', '谁来处理？')
console.log('   serial 结果：', asyncAnswer, '（逐个 await，认领即停）', '\n')

console.log('③ waterfall：洋葱模型，next() 委托，不调 next 即否决')
ctx.on('lab/wrap', (_text, next) => `【A】${next()}`)
ctx.on('lab/wrap', (_text, next) => `【B】${next()}`)
// inner 以无参形式执行：拿不到 '原始文本'，只能自带默认值
console.log('   全链委托：', ctx.waterfall('lab/wrap', '原始文本', () => '【base】'))
ctx.on('lab/gate', (_text, next) => `【外层】${next()}`)
ctx.on('lab/gate', () => '【接管】')   // 不调 next：下游与 inner 全部跳过
console.log('   中途否决：', ctx.waterfall('lab/gate', 'x', () => '【base】'))
ctx.on('lab/double', (_text, next) => {
  next()
  return next()
})
try {
  ctx.waterfall('lab/double', 'x', () => 'base')
} catch (error) {
  console.log('   重复调 next：', (error as Error).message, '\n')
}

console.log('④ 监听器即 effect：prepend 定顺序，once 只响一次，随 fiber 回收')
const hits: string[] = []
const off = ctx.on('lab/ping', () => hits.push('手动'))
const listenerPlugin = {
  name: 'listener-plugin',
  apply(inner: Context) {
    inner.on('lab/ping', () => hits.push('普通'))
    inner.on('lab/ping', () => hits.push('prepend'), { prepend: true })
    inner.once('lab/ping', () => hits.push('once'))
  },
}
const listenerFiber = ctx.use(listenerPlugin)
await listenerFiber
ctx.emit('lab/ping')
ctx.emit('lab/ping')
off()                        // on() 返回注销函数，手动监听随调随摘
await listenerFiber.dispose()
ctx.emit('lab/ping')         // fiber 已卸载：这次 emit 什么也不发生
console.log('   命中顺序：', hits.join(' → '), '\n')

console.log('⑤ internal/dispatch：全量事件流的观测入口')
const trail: string[] = []
ctx.on('internal/dispatch', (mode, name) => {
  trail.push(`${mode}:${String(name)}`)
})
ctx.emit('lab/quiet')
ctx.waterfall('lab/wrap', 't', () => 'base')
await ctx.serial('lab/claim-async', 'q')
ctx.bail('lab/claim', 'q')
console.log('   观测到：', trail.join(' '))
console.log('   （internal/ 开头的事件不上报，避免递归观测自身）')

console.log('演示结束')
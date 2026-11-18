/**
 * Fiber 的一生：六态状态机、可逆 effect、timer 作为 effect。
 *
 * 运行：node src/index.ts / bun src/index.ts（无需构建）
 */
import { Context } from 'cordis'
import TimerService from '@cordisjs/timer'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber: { state: number }) => STATE[fiber.state]

declare module 'cordis' {
  interface Context {
    tick: { n: number }
  }
  interface Events {
    'lab/ping'(): void
  }
}

const ctx = new Context()

console.log('① 六态：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED')
const slow = {
  name: 'slow',
  async apply(inner: Context) {
    console.log('   [slow] apply 开始')
    await sleep(30)
    inner.effect(() => async () => {
      console.log('   [slow] 清理开始')
      await sleep(20)
      console.log('   [slow] 清理结束')
    })
    console.log('   [slow] apply 结束')
  },
}
const slowFiber = ctx.use(slow)
console.log('   use() 刚返回：', stateOf(slowFiber))
await slowFiber
console.log('   await 之后：', stateOf(slowFiber))
const disposing = slowFiber.dispose()
console.log('   dispose() 刚返回：', stateOf(slowFiber))
await disposing
console.log('   清理完成：', stateOf(slowFiber), '\n')

console.log('② inject 缺席：PENDING 不是错误，是等待')
let applies = 0
const watcher = {
  name: 'watcher',
  inject: ['tick'],
  apply(inner: Context) {
    applies++
    console.log(`   [watcher] 第 ${applies} 次激活，tick.n =`, inner.tick.n)
  },
}
const watcherFiber = ctx.use(watcher)
await sleep(10)
console.log('   没有 provider：', stateOf(watcherFiber), '，apply 次数 =', applies)
const providerA = {
  name: 'provider-a',
  apply(inner: Context) {
    inner.provide('tick', { n: 1 })
  },
}
const aFiber = ctx.use(providerA)
await aFiber
await watcherFiber
console.log('   provider-a 上线：', stateOf(watcherFiber))
await aFiber.dispose()
await sleep(10)
console.log('   provider-a 卸载：', stateOf(watcherFiber), '（回到等待，而非销毁）')
const providerB = {
  name: 'provider-b',
  apply(inner: Context) {
    inner.provide('tick', { n: 2 })
  },
}
const bFiber = ctx.use(providerB)
await bFiber
await watcherFiber
console.log('   provider-b 上线：', stateOf(watcherFiber), '，apply 次数 =', applies, '\n')

console.log('③ 可逆 effect：同步清理按注册逆序完成，监听器随 fiber 消失')
const order: string[] = []
const noisy = {
  name: 'noisy',
  apply(inner: Context) {
    inner.effect(() => {
      order.push('装 A')
      return () => order.push('卸 A')
    })
    inner.effect(() => {
      order.push('装 B')
      return () => order.push('卸 B')
    })
    inner.on('lab/ping', () => order.push('听到 ping'))
  },
}
const noisyFiber = ctx.use(noisy)
await noisyFiber
ctx.emit('lab/ping')
await noisyFiber.dispose()
ctx.emit('lab/ping')   // 监听器已随 fiber 回收：这次 emit 什么也不发生
console.log('   顺序：', order.join(' → '), '\n')

console.log('④ timer 也是 effect：fiber 销毁，未触发的定时器一起取消')
await ctx.use(TimerService)
const fired: string[] = []
const alarms = {
  name: 'alarms',
  inject: ['timer'],
  apply(inner: Context) {
    inner.timeout(() => fired.push('早闹钟(30ms)'), 30)
    inner.timeout(() => fired.push('晚闹钟(200ms)'), 200)
  },
}
const alarmsFiber = ctx.use(alarms)
await alarmsFiber
await sleep(60)
await alarmsFiber.dispose()
await sleep(220)
console.log('   60ms 时卸载 fiber，最终触发：', fired.join('、') || '（无）', '\n')

console.log('⑤ apply 抛错：FAILED，且仍然可以 dispose')
const broken = {
  name: 'broken',
  apply() {
    throw new Error('装配期故意失败')
  },
}
const brokenFiber = ctx.use(broken)
await sleep(10)
console.log('   状态：', stateOf(brokenFiber))
await brokenFiber.dispose()
console.log('   dispose 后：', stateOf(brokenFiber))

await bFiber.dispose()
console.log('演示结束')
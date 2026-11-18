/**
 * ctx.isolate 的 realm 隔离：同名服务多份实现、按名字隔离、事件可见性、共享 label。
 *
 * 运行：node src/index.ts / bun src/index.ts（无需构建）
 */
import { Context, Service } from 'cordis'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber: { state: number }) => STATE[fiber.state]

declare module 'cordis' {
  interface Context {
    greeter: { greet(): string }
    clock: { now(): string }
  }
  interface Events {
    'lab/tick'(): void
  }
}

/** 以服务实例为 thisArg 派发事件：Service 的 filter 按 isolate 键筛监听器。 */
class Ticker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ticker')
  }
  tick() {
    this.ctx.emit(this, 'lab/tick')
  }
}

const ctx = new Context()

console.log('① 同名服务两份实现：isolate 按名字划出 realm')
const consumerRoot = {
  name: 'consumer-root',
  inject: ['greeter'],
  apply(inner: Context) {
    console.log('   [consumer-root] greeter =', inner.greeter.greet())
  },
}
const consumerRealm = {
  name: 'consumer-realm',
  inject: ['greeter'],
  apply(inner: Context) {
    console.log('   [consumer-realm] greeter =', inner.greeter.greet())
  },
}
const rootFiber = ctx.use(consumerRoot)
const realm = ctx.isolate('greeter')
const realmFiber = realm.use(consumerRealm)
await sleep(10)
console.log('   无 provider 时：', stateOf(rootFiber), '/', stateOf(realmFiber))
const outerFiber = ctx.use({
  name: 'provider-outer',
  apply(inner: Context) {
    inner.provide('greeter', { greet: () => 'outer' })
  },
})
await outerFiber
const innerFiber = realm.use({
  name: 'provider-inner',
  apply(inner: Context) {
    inner.provide('greeter', { greet: () => 'inner' })
  },
})
await innerFiber
console.log('   两个 consumer 同时：', stateOf(rootFiber), '/', stateOf(realmFiber), '\n')

console.log('② 隔离按名字生效：没被 isolate 的服务穿透 realm')
ctx.provide('clock', { now: () => 'root-clock' })
const clockFiber = realm.use({
  name: 'realm-clock',
  inject: ['clock'],
  apply(inner: Context) {
    console.log('   [realm-clock] clock.now() =', inner.clock.now())
  },
})
await clockFiber
console.log('   realm 只 shadow 了 greeter，clock 沿原型链回到 root', '\n')

console.log('③ 事件跟着 realm 走：以服务为 thisArg 派发，跨 realm 监听器不可见')
const hits: string[] = []
ctx.on('lab/tick', () => hits.push('root 听到'))
const tickRealm = ctx.isolate('ticker')
tickRealm.on('lab/tick', () => hits.push('realm 听到'))
const rootTicker = new Ticker(ctx)
const realmTicker = new Ticker(tickRealm)
rootTicker.tick()
realmTicker.tick()
console.log('   两次 tick 的命中：', hits.join(' → '), '（无隔离时应为 4 次）', '\n')

console.log('④ 同 label 即同 realm：卸载只影响本 realm 的消费者')
const tag = Symbol('shared-greeter')
const realmA = ctx.isolate('greeter', tag)
const realmB = ctx.isolate('greeter', tag)
const sharedFiber = realmB.use({
  name: 'consumer-shared',
  inject: ['greeter'],
  apply(inner: Context) {
    console.log('   [consumer-shared] greeter =', inner.greeter.greet())
  },
})
const sharedProviderFiber = realmA.use({
  name: 'provider-shared',
  apply(inner: Context) {
    inner.provide('greeter', { greet: () => 'shared' })
  },
})
await sharedProviderFiber
await sharedFiber
await sharedProviderFiber.dispose()
await sleep(10)
console.log('   共享 provider 卸载后：consumer-shared =', stateOf(sharedFiber), '，consumer-root =', stateOf(rootFiber))

console.log('演示结束')
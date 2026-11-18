/**
 * isolate 的 realm 隔离：同名服务多份实现、按名字隔离、事件可见性、共享 label。
 *
 * runner：由 cordis.yml 的 runner 行挂载，代码里没有一处 ctx.use / ctx.plugin；
 * realm 划分全部写在配置行的 isolate 字段里，这里只经行句柄做启用 / 禁用。
 */
import type { Context } from 'cordis'
import type { Entry } from '@cordisjs/loader'
import { hits } from './state.ts'
import type {} from './seam.ts'

export const name = 'runner'
export const inject = ['loader']

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber?: { state: number }) => (fiber ? STATE[fiber.state] : '（无）')

// yml 的行挂在 include 子树里；entries() 会递归遍历，按 id 找行句柄
function row(ctx: Context, id: string): Entry {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === id)
  if (!entry) throw new Error(`cordis.yml 里没有 id=${id} 的行`)
  return entry
}

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()

  console.log('① 同名服务两份实现：isolate 按名字划出 realm')
  const consumerRoot = row(ctx, 'consumer-root')
  const consumerRealm = row(ctx, 'consumer-realm')
  console.log('   无 provider 时：', stateOf(consumerRoot.innerFiber), '/', stateOf(consumerRealm.innerFiber))
  await row(ctx, 'provider-outer').update({ disabled: false })
  await ctx.loader.await()
  await row(ctx, 'provider-inner').update({ disabled: false })
  await ctx.loader.await()
  console.log('   两个 consumer 同时：', stateOf(consumerRoot.innerFiber), '/', stateOf(consumerRealm.innerFiber), '\n')

  console.log('② 隔离按名字生效：没被 isolate 的服务穿透 realm')
  await row(ctx, 'clock-provider').update({ disabled: false })
  await ctx.loader.await()
  console.log('   realm 只 shadow 了 greeter，clock 沿原型链回到 root', '\n')

  console.log('③ 事件跟着 realm 走：以服务为 thisArg 派发，跨 realm 监听器不可见')
  // 在各自 fiber 的 ctx 上 ctx.get 取服务：root 行与 realm 行各有一份 ticker
  row(ctx, 'ticker-root').innerFiber!.ctx.get('ticker')!.tick()
  row(ctx, 'ticker-realm').innerFiber!.ctx.get('ticker')!.tick()
  console.log('   两次 tick 的命中：', hits.join(' → '), '（无隔离时应为 4 次）', '\n')

  console.log('④ 同 label 即同 realm：卸载只影响本 realm 的消费者')
  const providerShared = row(ctx, 'provider-shared')
  await providerShared.update({ disabled: false })
  await ctx.loader.await()
  await providerShared.update({ disabled: true })
  await sleep(10)
  console.log('   共享 provider 卸载后：consumer-shared =', stateOf(row(ctx, 'consumer-shared').innerFiber), '，consumer-root =', stateOf(consumerRoot.innerFiber))

  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
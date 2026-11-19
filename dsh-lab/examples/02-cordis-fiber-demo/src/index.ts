/**
 * Fiber 的一生：六态状态机、可逆 effect、timer 作为 effect。
 *
 * runner：由 cordis.yml 的 runner 行挂载，代码里没有一处 ctx.use / ctx.plugin；
 * 插件全部在 cordis.yml 里声明，这里只经行句柄做启用 / 禁用 / dispose。
 */
import type { Context } from 'cordis'
import type { Entry } from '@cordisjs/loader'
import { counters, order, fired } from './state.ts'

export const name = 'runner'
export const inject = ['loader']

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 有界轮询：等谓词成立再继续，超时抛错——替代定长 sleep 的状态探针，消除碰运气的时序。 */
async function waitFor(predicate: () => boolean, { timeoutMs = 2000, intervalMs = 5, what = '' } = {}) {
  const t0 = Date.now()
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${what}`)
    await sleep(intervalMs)
  }
}

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber?: { state: number }) => (fiber ? STATE[fiber.state] : '（无）')

declare module 'cordis' {
  interface Context {
    tick: { n: number }
  }
  interface Events {
    'lab/ping'(): void
  }
}

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

  console.log('① 六态：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED')
  const slow = row(ctx, 'slow')
  const enabling = slow.update({ disabled: false })
  // fiber 已创建，apply 还在 sleep：正好落在 LOADING（轮询等状态到位，不定长等待）
  await waitFor(() => stateOf(slow.innerFiber) === 'LOADING', { what: 'slow 行进入 LOADING' })
  console.log('   启用行刚触发：', stateOf(slow.innerFiber))
  await enabling
  await ctx.loader.await()
  console.log('   await 之后：', stateOf(slow.innerFiber))
  const disposing = slow.dispose()
  console.log('   dispose() 刚返回：', stateOf(slow.innerFiber))
  await disposing
  console.log('   清理完成：', stateOf(slow.innerFiber), '\n')

  console.log('② inject 缺席：PENDING 不是错误，是等待')
  const watcher = row(ctx, 'watcher')
  console.log('   没有 provider：', stateOf(watcher.innerFiber), '，apply 次数 =', counters.applies)
  const providerA = row(ctx, 'provider-a')
  await providerA.update({ disabled: false })
  await ctx.loader.await()
  console.log('   provider-a 上线：', stateOf(watcher.innerFiber))
  await providerA.update({ disabled: true })
  await waitFor(() => stateOf(watcher.innerFiber) === 'PENDING', { what: 'watcher 回到 PENDING' })
  console.log('   provider-a 卸载：', stateOf(watcher.innerFiber), '（回到等待，而非销毁）')
  const providerB = row(ctx, 'provider-b')
  await providerB.update({ disabled: false })
  await ctx.loader.await()
  console.log('   provider-b 上线：', stateOf(watcher.innerFiber), '，apply 次数 =', counters.applies, '\n')

  console.log('③ 可逆 effect：同步清理按注册逆序完成，监听器随 fiber 消失')
  const noisy = row(ctx, 'noisy')
  await noisy.update({ disabled: false })
  await ctx.loader.await()
  ctx.emit('lab/ping')
  await noisy.dispose()
  ctx.emit('lab/ping')   // 监听器已随 fiber 回收：这次 emit 什么也不发生
  console.log('   顺序：', order.join(' → '), '\n')

  console.log('④ timer 也是 effect：fiber 销毁，未触发的定时器一起取消')
  const alarms = row(ctx, 'alarms')
  await alarms.update({ disabled: false })
  await ctx.loader.await()
  await sleep(60)
  await alarms.dispose()
  await sleep(220)
  console.log('   60ms 时卸载 fiber，最终触发：', fired.join('、') || '（无）', '\n')

  console.log('⑤ apply 抛错：FAILED，且仍然可以 dispose')
  const broken = row(ctx, 'broken')
  await broken.update({ disabled: false }).catch(() => {})
  await waitFor(() => stateOf(broken.innerFiber) === 'FAILED', { what: 'broken 行进入 FAILED' })
  console.log('   状态：', stateOf(broken.innerFiber))
  await broken.dispose()
  console.log('   dispose 后：', stateOf(broken.innerFiber))

  await providerB.dispose()
  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
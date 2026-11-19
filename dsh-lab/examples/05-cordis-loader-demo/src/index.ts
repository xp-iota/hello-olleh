/**
 * 配置树到 Fiber：group / disabled / 配置层 inject / 配置层 isolate / 运行时 patch。
 *
 * runner：由 cordis.yml 的 runner 行挂载；Fs / NodeFs / Loader 基础设施由 cordis CLI
 * 提供（与官方 bin.js 同构），代码里没有一处 ctx.use / ctx.plugin。
 * 本示例的教学点就是运行时 patch：loader.create / entry.update 属于运行时操作，
 * 走 root 内存树，Loader.commit 是空实现，不会写回任何文件。
 */
import type { Context } from 'cordis'
import type { EntryOptions } from '@cordisjs/loader'

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

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  /** create() 的类型签名是 Omit<EntryOptions,'id'>，但运行时 ensureId 接受显式 id。 */
  const createEntry = (options: EntryOptions) => ctx.loader.create(options)

  await ctx.loader.await()
  // 运行时装配走 root 内存树：Loader.commit 是空实现，不会写回任何文件
  await createEntry({ id: 'greeter-a', name: './src/plugins/greeter.ts', config: { tag: 'A' } })
  await ctx.loader.await()

  console.log('① 配置树 → Entry → Fiber：group 与 disabled')
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === '@cordisjs/include' || entry.options.id === 'runner') continue
    const fiber = entry.innerFiber ?? entry.outerFiber
    // options.id 是行自己的 id；entry.id 还带 include 子树前缀（CLI 随机生成，不稳定）
    console.log(`   ${entry.options.id.padEnd(18)} disabled=${String(entry.disabled).padEnd(5)} fiber=${stateOf(fiber)}`)
  }
  console.log('   sleeper 被禁用：根本不创建 Fiber；watcher 的 inject 来自配置行', '\n')

  console.log('② 只改 config：就地 patch，Fiber 不重建')
  const greeterEntry = ctx.loader.resolve('greeter-a')
  const uidBefore = greeterEntry.innerFiber!.uid
  await greeterEntry.update({ config: { tag: 'A2' } })
  await ctx.loader.await()
  console.log('   innerFiber uid 不变：', uidBefore === greeterEntry.innerFiber!.uid, '\n')

  console.log('③ inject 写在配置里：outer/inner 两层 Fiber，依赖缺席时等待')
  await createEntry({ id: 'late', name: './src/plugins/watcher.ts', inject: ['clock', 'greeter'], config: { tag: 'late' } })
  const late = ctx.loader.resolve('late')
  // clock 缺席：outer 停在 PENDING 等依赖，inner 还没创建——轮询等状态到位，不定长等待
  await waitFor(() => stateOf(late.outerFiber) === 'PENDING' && late.innerFiber === undefined, { what: 'late 行 outer PENDING / inner 未创建' })
  console.log('   clock 缺席：outer =', stateOf(late.outerFiber), '，inner =', stateOf(late.innerFiber))
  await createEntry({ id: 'clock-provider', name: './src/plugins/clock.ts' })
  await ctx.loader.await()
  console.log('   clock 上线：outer =', stateOf(late.outerFiber), '，inner =', stateOf(late.innerFiber), '\n')

  console.log('④ isolate 写在配置里：命名 realm 共享一份 provider')
  await createEntry({ id: 'greeter-r', name: './src/plugins/greeter.ts', config: { tag: 'R' }, isolate: { greeter: 'realmR' } })
  await createEntry({ id: 'watcher-r', name: './src/plugins/watcher.ts', inject: ['greeter'], config: { tag: 'r' }, isolate: { greeter: 'realmR' } })
  await ctx.loader.await()
  console.log('   root 侧 watcher 仍见 A2，realm 侧 watcher-r 见 R（见上方插件日志）', '\n')

  console.log('⑤ disabled 开关：卸载再重装')
  await late.update({ disabled: true })
  await waitFor(() => stateOf(late.innerFiber) === 'DISPOSED', { what: 'late 行 inner 进入 DISPOSED' })
  console.log('   禁用后：inner =', stateOf(late.innerFiber))
  await late.update({ disabled: false })
  await ctx.loader.await()
  console.log('   启用后：inner =', stateOf(late.innerFiber), '（apply 计数见插件日志）')

  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
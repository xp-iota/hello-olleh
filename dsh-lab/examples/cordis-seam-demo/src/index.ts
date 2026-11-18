/**
 * runner：场景驱动插件，由 cordis.yml 的 runner 行挂载。
 * 这里没有一处 ctx.use / ctx.plugin——插件全部在 cordis.yml 里声明，
 * 本插件只通过 loader 的行句柄做运行时开关（disabled 翻转、dispose）。
 */
import type { Context } from 'cordis'
import type { Entry } from '@cordisjs/loader'

export const name = 'runner'
export const inject = ['loader']

// FiberState 是 const enum，没有运行时对象可 import；按值镜像。
const STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING']

// yml 的行挂在 include 子树里；entries() 会递归遍历，按 id 找行句柄
function row(ctx: Context, id: string): Entry {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === id)
  if (!entry) throw new Error(`cordis.yml 里没有 id=${id} 的行`)
  return entry
}

function consumerState(ctx: Context): string {
  const state = row(ctx, 'consumer').innerFiber?.state
  return state === undefined ? '(no fiber)' : STATE_NAMES[state] ?? String(state)
}

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()

  console.log('\n① 启动即在位：provider-en 由 cordis.yml 声明，consumer 已自动激活')
  console.log(`   consumer 状态 = ${consumerState(ctx)}\n`)

  console.log('② 没声明 inject 的插件直接读 ctx.greeter（本 runner 只 inject 了 loader）')
  try {
    ;(ctx as any).greeter
  } catch (error) {
    console.log('   结果：' + (error as Error).message + '\n')
  }

  console.log('③ 换一个调用方（root 侧 ctx.get 直接调用服务）：事件照样广播')
  ctx.get('greeter')!.greet('root')
  console.log('')

  console.log('④ 禁用 provider-en 行：entry.update({ disabled: true })')
  await row(ctx, 'provider-en').update({ disabled: true })
  await ctx.loader.await()
  console.log(`   consumer 状态 = ${consumerState(ctx)}`)
  console.log('   结果：provider 卸载时先卸载依赖它的 consumer，再注销服务；audit 不受影响')
  console.log('   ctx.get("greeter") =', ctx.get('greeter'), '\n')

  console.log('⑤ 启用 provider-pirate 行（yml 里声明为 disabled: true）：consumer 的代码一行没改')
  await row(ctx, 'provider-pirate').update({ disabled: false })
  await ctx.loader.await()
  console.log(`   consumer 状态 = ${consumerState(ctx)}`)
  console.log('   结果：同一条 seam 换了实现，服务型与事件型 consumer 都被重新触发\n')

  await row(ctx, 'provider-pirate').dispose()
  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
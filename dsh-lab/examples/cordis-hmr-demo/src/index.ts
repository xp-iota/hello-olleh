/**
 * HMR 原位替换：Node 走 @cordisjs/hmr 的 reconcile 事务（需 --expose-internals）；
 * Bun 拿不到 Node 内部模块缓存，走 core registry.replace() 同一条缝（新 URL 重导入 + 先校验后动手）。
 * 插件一律动态 import：静态 import 会进 hostModules，被 hmr 记为 skipped。
 */
import { Context } from 'cordis'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const isBun = !!(process.versions as Record<string, string | undefined>).bun

const greeterUrl = new URL('./plugins/greeter.ts', import.meta.url)
const greeterFile = fileURLToPath(greeterUrl)
const source = await readFile(greeterFile, 'utf8')
const write = (tag: string) => writeFile(greeterFile, source.replaceAll('v1', tag))
const writeBroken = () => writeFile(greeterFile, "export const tag = 'v3'\nexport const apply = 42\n")

const ctx = new Context()
// 模块 namespace 整体作为组件：apply 与 inject 都是导出，_discover / replace 认这种形态
const greeter = await import(greeterUrl.href)
const consumer = await import('./plugins/consumer.ts')
const clock = await import('./plugins/clock.ts')

console.log(isBun ? '运行时：Bun（core registry.replace 缝）' : '运行时：Node（@cordisjs/hmr reconcile 事务）')
const greeterFiber = ctx.use(greeter)
ctx.use(consumer)
ctx.use(clock)
await sleep(10)
console.log('① 基线：greeter uid =', greeterFiber.uid)

if (!isBun) {
  const { default: Hmr } = await import('@cordisjs/hmr')
  await ctx.use(Hmr)

  await write('v2')
  const r2 = await ctx.hmr.reconcile(() => [greeterFile])
  await sleep(20)
  console.log('② 改文件 → reconcile：原位替换，Fiber 身份不变，依赖者经 epoch 级联')
  console.log('   settled =', r2.settled.length, '，greeter uid 不变 =', r2.settled.some((f) => f.uid === greeterFiber.uid), '，tag =', ctx.greeter.tag)

  await writeBroken()
  const r3 = await ctx.hmr.reconcile(() => [greeterFile])
  console.log('③ 导出损坏 → aborted：恢复缓存，旧组件继续运行')
  console.log('   aborted =', r3.aborted.length, '，settled =', r3.settled.length, '，tag 仍 =', ctx.greeter.tag)
  console.log('   首错:', String(r3.aborted[0]?.error).split('\n')[0])

  await write('v4')
  const r4 = await ctx.hmr.reconcile(() => [greeterFile])
  await sleep(20)
  console.log('④ 修好文件 → 再 reconcile：aborted unit 重试成功')
  console.log('   settled =', r4.settled.length, '，tag =', ctx.greeter.tag)

  const r5 = await ctx.hmr.reconcile(() => [fileURLToPath(import.meta.url)])
  console.log('⑤ host module（index.ts 自身）→ skipped：重启后才生效')
  console.log('   reason =', r5.skipped[0]?.reason, '；clock 与 greeter 无关，apply 计数见上方日志')
} else {
  // Bun 的模块缓存不吃 query 后缀（实测 ?v=2 仍命中旧模块），
  // 故每修订写一个新路径：等价于 Node 缓存驱逐后产生的新模块身份。
  const revUrl = (n: number) => new URL(`./plugins/.greeter-r${n}.ts`, import.meta.url)
  const writeRev = async (n: number, content: string) => {
    await writeFile(revUrl(n), content)
    return import(revUrl(n).href)
  }

  console.log('② 新修订新 URL 重导入 → registry.replace（HMR Stage 2/3 同一条缝）')
  const ns2 = await writeRev(2, source.replaceAll('v1', 'v2'))
  const fibers2 = ctx.registry.replace(greeter, ns2)
  await sleep(20)
  console.log('   replaced fibers =', fibers2.length, '，uid 不变 =', fibers2.some((f) => f.uid === greeterFiber.uid), '，tag =', ctx.greeter.tag)

  console.log('③ 导出损坏 → 先校验后动手：拒绝 replace，旧组件继续运行')
  const ns3 = await writeRev(3, "export const tag = 'v3'\nexport const apply = 42\n")
  const ok3 = typeof ns3.apply === 'function'
  if (ok3) ctx.registry.replace(greeter, ns3)
  console.log('   导出校验通过 =', ok3, '，tag 仍 =', ctx.greeter.tag)

  console.log('④ 修好 → 重导入 → 再 replace')
  const ns4 = await writeRev(4, source.replaceAll('v1', 'v4'))
  ctx.registry.replace(greeter, ns4)
  await sleep(20)
  console.log('   tag =', ctx.greeter.tag)
  console.log('⑤ hostModules/skipped 是 hmr 在 Node 缓存层的概念；Bun 演示 core 缝；clock 不受影响见日志')
  await Promise.all([2, 3, 4].map((n) => rm(revUrl(n), { force: true })))
}

if (!isBun) await writeFile(greeterFile, source)
console.log('演示结束（插件文件已恢复原状）')
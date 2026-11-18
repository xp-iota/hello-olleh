/**
 * dsh-boot-demo —— boot() 声明式装配的五个场景：
 *   S1 prepare + 两层 patch → 最小树 settle；
 *   S2 overlay 层整配置替换（后写胜出）；
 *   S3 required 行失败 → StartupError（fail-loud）；
 *   S4 缺服务 → PENDING，运行时 provide → ACTIVE；
 *   S5 dispose 逆序回收 effect。
 * Node 与 Bun 双运行时：本示例不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches, StartupError } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')
const OVERLAY = resolve(ROOT, 'cordis.overlay.yml')
const BROKEN = resolve(ROOT, 'cordis.broken.yml')

// home 收进本示例目录：整目录拷走仍然自洽。
const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun
  ? `bun ${process.versions.bun}`
  : `node ${process.version}`
console.log(`runtime = ${runtime}`)

// FiberState 是 const enum，没有运行时对象可 import；按值镜像（app-boot 同款做法）。
const STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING']

function helloState(ctx: Context): string {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'hello')
  const state = entry?.fiber?.state
  return state === undefined ? '(no fiber)' : STATE_NAMES[state] ?? String(state)
}

function dumpTree(ctx: Context): void {
  for (const entry of ctx.loader.entries()) {
    const state = entry.fiber?.state
    const label = state === undefined ? '(no fiber)' : STATE_NAMES[state] ?? String(state)
    console.log(`  ${entry.options.id.padEnd(22)} ${label}`)
  }
}

const basePatch = () => loadOverlayPatches('dsh-boot-demo', PATCH)
const provideMark = (ctx: Context) => { ctx.provide('labMark', 'from-prepare') }

// ── S1 + S2：prepare 提供 labMark，两层 patch 叠加 ─────────────────────────
console.log('\n=== S1 boot(): prepare + patch + overlay → 最小树 settle ===')
const ctxA = await boot(
  'dsh-boot-demo', CONFIG,
  [...basePatch(), ...loadOverlayPatches('dsh-boot-demo', OVERLAY)],
  provideMark, BASE_URL,
)
dumpTree(ctxA)
console.log('=== S2 overlay 语义：hello 的 tag 应为 overlay-wins（整配置替换，后写胜出）===')
console.log(`hello state = ${helloState(ctxA)}（tag 见上方 [hello] 日志）`)

// ── S3：required 行失败 → StartupError ─────────────────────────────────────
console.log('\n=== S3 fail-loud: required 行 agent-loop 激活失败 → StartupError ===')
try {
  await boot(
    'dsh-boot-demo', CONFIG,
    [...basePatch(), ...loadOverlayPatches('dsh-boot-demo', BROKEN)],
    provideMark, BASE_URL,
  )
  console.log('unexpected: boot succeeded')
} catch (error) {
  if (!(error instanceof StartupError)) throw error
  console.log(`捕获 StartupError，message 首行：${error.message.split('\n')[0]}`)
  for (const row of error.entries) {
    console.log(`  entries: id=${row.id} required=${row.required} outcome=${row.outcome.kind}`)
  }
  const failed = error.composition?.plugins.filter(p => p.state === 'failed') ?? []
  console.log(`  composition.failed = [${failed.map(p => p.id).join(', ')}]`)
}

// ── S4：不给 prepare → hello PENDING；运行时 provide → ACTIVE ──────────────
console.log('\n=== S4 服务可用性驱动：无 prepare → PENDING → provide → ACTIVE ===')
const ctxB = await boot('dsh-boot-demo', CONFIG, basePatch(), undefined, BASE_URL)
console.log(`provide 之前 hello state = ${helloState(ctxB)}`)
ctxB.provide('labMark', 'late-provide')
await ctxB.loader.await()
console.log(`provide 之后 hello state = ${helloState(ctxB)}`)

// ── S5：dispose 逆序回收 ───────────────────────────────────────────────────
console.log('\n=== S5 dispose：effect 按挂载逆序回收 ===')
await ctxB.fiber.dispose()
await ctxA.fiber.dispose()
console.log('\nBOOT_DEMO_OK')
/**
 * run.mjs —— 本示例自带的迷你运行时调度器（完全独立，不依赖 dsh-lab 根工程）。
 *
 *     node runtime/run.mjs [--runtime node|bun] <命令…>
 *
 * 为什么需要它：完整装配树里的 ptc-runtime-node 与 subprocess-local 在 Bun 下
 * 各有一条缝（见 bun-preload.mjs / lib/bun-shim.mjs），必须经 `BUN_OPTIONS`
 * 注入 preload——命令行 `--preload` 到不了孙进程，只有环境变量会一路继承。
 * Node 路径不需要任何补丁，但为了"换运行时只有一处逻辑"，也统一走这里。
 *
 * 最低版本：Node >= 22.18（原生 TS 类型剥离）、Bun >= 1.4.4。
 * DSH_NODE / DSH_BUN 可显式指定可执行文件。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runtimeEnv, spawnPlan } from './lib/spawn.mjs'

const DEMO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MINIMUM = { node: '22.18', bun: '1.4.4' }

function parseVersion(version) {
  return String(version).replace(/^v/, '').split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
}

function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual)
  const right = parseVersion(minimum)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return true
}

function detectVersion(command, needsShell = false) {
  const plan = needsShell
    ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `${command} --version`] }
    : { file: command, args: ['--version'] }
  try {
    return execFileSync(plan.file, plan.args, {
      encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().replace(/^v/, '')
  } catch {
    return undefined
  }
}

/** Windows 上 npm 全局装的 Bun 是 bun.cmd 包装脚本，没有同名 exe。 */
function systemCandidates(runtimeName) {
  if (process.platform !== 'win32') return [{ command: runtimeName, needsShell: false }]
  return [
    { command: `${runtimeName}.exe`, needsShell: false },
    { command: `${runtimeName}.cmd`, needsShell: true },
  ]
}

function resolveRuntime(runtimeName) {
  const overrideVar = runtimeName === 'node' ? 'DSH_NODE' : 'DSH_BUN'
  const override = process.env[overrideVar]
  const candidates = override
    ? [{ command: override, needsShell: /\.(cmd|bat)$/i.test(override) }]
    : systemCandidates(runtimeName)
  if (override && !existsSync(override)) throw new Error(`${overrideVar} 指向的文件不存在：${override}`)

  for (const candidate of candidates) {
    const version = detectVersion(candidate.command, candidate.needsShell)
    if (!version) continue
    if (!versionAtLeast(version, MINIMUM[runtimeName])) {
      throw new Error(`${candidate.command} 的 ${runtimeName} 是 ${version}，低于最低要求 ${MINIMUM[runtimeName]}`)
    }
    return { command: candidate.command, needsShell: candidate.needsShell, version }
  }
  throw new Error(`没有找到可用的 ${runtimeName}（最低 ${MINIMUM[runtimeName]}；可用 ${overrideVar} 指定可执行文件）`)
}

function parseArgv(argv) {
  let runtime = process.env.DSH_RUNTIME?.trim() || 'node'
  const args = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '-r' || token === '--runtime') {
      runtime = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (token.startsWith('--runtime=')) {
      runtime = token.slice('--runtime='.length)
      continue
    }
    args.push(token)
  }
  return { runtime, args }
}

const { runtime: runtimeName, args } = parseArgv(process.argv.slice(2))
if (runtimeName !== 'node' && runtimeName !== 'bun') {
  console.error(`✗ 未知运行时 ${runtimeName}；可选：node / bun`)
  process.exit(2)
}
if (args.length === 0) {
  console.error('用法：node runtime/run.mjs [--runtime node|bun] <命令…>')
  process.exit(2)
}

const runtime = resolveRuntime(runtimeName)
const env = runtimeEnv(runtimeName)
const plan = spawnPlan(runtime, args)
const child = spawn(plan.command, plan.argv, { cwd: DEMO_ROOT, env, stdio: 'inherit', shell: plan.shell })
child.once('error', (error) => {
  console.error(`✗ 无法启动 ${runtime.command}：${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
/**
 * run.mjs —— 统一的运行时调度器：`node runtime/run.mjs [--runtime node|bun] <命令…>`
 *
 * 所有 npm script 都经由这里，好处是"换运行时"只有一处逻辑：定义默认值、
 * 注入 BUN_OPTIONS、在 Windows 上处理 .cmd 包装脚本。
 *
 * 支持的入口形式：
 *
 *     node runtime/run.mjs runtime/check-bun-shim.mjs   # 直接跑一个脚本
 *     node runtime/run.mjs --runtime bun runtime/check-bun-shim.mjs
 *
 * 注意 `--runtime` 只能放在这里，不能透传给 npm：`npm run example:x -- --runtime bun`
 * 会被 npm 当成自己的配置项，报 `EUNKNOWNCONFIG`。改默认运行时请用
 * `DSH_RUNTIME=bun`，或直接用预置的 `example:x:bun` 脚本。
 *
 * 这里**不再**提供 --test / --typecheck 模式：根层零依赖（没有 node_modules、
 * 没有 tsconfig.json），这两项是各示例自己的 npm script（npm run typecheck）。
 *
 * @module dsh-lab/runtime/run
 */
import { spawn } from 'node:child_process'
import { PROJECT_ROOT, RUNTIME_NAMES, resolveRuntime } from './lib/runtimes.mjs'
import { runtimeEnv, spawnPlan } from './lib/spawn.mjs'

const HELP = `
dsh-lab 运行时调度器

用法：
  node runtime/run.mjs [--runtime <name>] <命令…>

选项：
  -r, --runtime <name>   用 node 还是 bun（默认取 DSH_RUNTIME，否则 node）
  -h, --help             显示本帮助

环境变量：
  DSH_RUNTIME            默认运行时（等价于每次传 --runtime）
  DSH_NODE / DSH_BUN     指定可执行文件（覆盖 PATH 查找）
`.trim()

/**
 * 解析命令行。手写而不是引 commander：这里要在**任何运行时**下都能跑，
 * 保持零依赖。
 *
 * @param {string[]} argv
 * @returns {{runtime: string, mode: 'exec'|'help', args: string[]}}
 * @throws {Error} `-r/--runtime` 缺值时——静默回退到 node 会让调用方
 *   以为切换成功，属于把输入错误吞掉。
 */
function parseArgv(argv) {
  let runtime = process.env.DSH_RUNTIME?.trim() ?? ''
  let mode = 'exec'
  const args = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '-h' || token === '--help') {
      mode = 'help'
      continue
    }
    if (token === '-r' || token === '--runtime') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('✗ -r/--runtime 需要一个值（node / bun）')
      runtime = value
      index += 1
      continue
    }
    if (token.startsWith('--runtime=')) {
      runtime = token.slice('--runtime='.length)
      continue
    }
    // 第一个非选项之后全部原样透传。
    args.push(token)
  }

  return { runtime: runtime === '' ? 'node' : runtime, mode, args }
}

/**
 * 用指定的运行时跑一个子进程，stdout/stderr 直通终端。
 *
 * @param {{command: string, needsShell?: boolean}} runtime
 * @param {string[]} args
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<number>}
 */
function runProcess(runtime, args, env) {
  const plan = spawnPlan(runtime, args)
  return new Promise((resolvePromise) => {
    const child = spawn(plan.command, plan.argv, {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'inherit',
      shell: plan.shell,
    })
    child.once('error', (error) => {
      console.error(`✗ 无法启动 ${runtime.command}：${error.message}`)
      resolvePromise(1)
    })
    child.once('exit', (code) => resolvePromise(code ?? 1))
  })
}

async function main() {
  const { runtime: runtimeName, mode, args } = parseArgv(process.argv.slice(2))

  if (mode === 'help') {
    console.log(HELP)
    return 0
  }

  if (!RUNTIME_NAMES.includes(runtimeName)) {
    console.error(`✗ 未知运行时 ${runtimeName}；可选：${RUNTIME_NAMES.join(' / ')}`)
    return 2
  }

  const runtime = resolveRuntime(runtimeName)
  const env = runtimeEnv(runtimeName)

  if (args.length === 0) {
    console.error(HELP)
    return 2
  }

  return runProcess(runtime, args, env)
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  },
)

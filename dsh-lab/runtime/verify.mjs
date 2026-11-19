/**
 * verify.mjs —— 仓库级双运行时校验：遍历 examples/，每个示例跑三项检查。
 *
 *   typecheck   pnpm run typecheck      （Node 侧 tsc）
 *   start       pnpm start              （Node，经 tsx 加载 .ts）
 *   start:bun   pnpm run start:bun      （Bun；dsh 系经各示例自带的 preload）
 *
 * 示例完全独立：这里只调用各示例自己的 pnpm scripts，不替它们装配任何东西。
 * 交互式入口（dsh-chat-demo 的 REPL）以 stdin=ignore 启动，读到 EOF 自行退出。
 * 子进程环境经 runtimeEnv('node') 清洗：剥掉继承来的 NODE_OPTIONS / BUN_OPTIONS，
 * 与 runtime/run.mjs 的口径一致——否则机器上全局注入的 loader / 预载会让
 * verify 结果取决于外部状态（tsx 只由示例自己的 start 脚本显式挂载）。
 *
 * 需要 key 的示例（dsh-llm-adapter-demo / dsh-chat-demo / dsh-perf-metrics-demo）
 * 在缺 LLM_API_KEY 时
 * 按「明确失败」计入报告（fail-loud 是设计行为），不静默跳过；但豁免是**有条件的**：
 * 只在输出匹配已知 fail-loud 报错特征（缺少 LLM_API_KEY / MISSING_CREDENTIAL）时才
 * 记 △。缺 key 却冒出别的报错（代码 bug、缺依赖、Bun 崩溃）照常记 ✗ 并让整轮失败
 * ——那正是无 key 机器上唯一能抓住的回归窗口。有 key 时它们必须真实通过。
 * 注意 △ 实际只出现在 llm-adapter-demo 与 perf-metrics-demo：chat-demo 的 start
 * 是 REPL，stdin=ignore 下读到 EOF 就退出（exit 0），不会触达 provider 调用路径，
 * 无需 key 也计 ✓。
 *
 * 结尾打印 `RUNTIMES_VERIFY_OK runtimes=2 checks=N` 作为脚本化判据。
 *
 * @module dsh-lab/runtime/verify
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXAMPLES_ROOT, listExamples } from './lib/examples.mjs'
import { PROJECT_ROOT, RUNTIME_NAMES } from './lib/runtimes.mjs'
import { runtimeEnv } from './lib/spawn.mjs'

/** 真实调用路径依赖 LLM_API_KEY 的示例（目录名带分组编号）。 */
const KEY_DEPENDENT = new Set(['10-dsh-llm-adapter-demo', '21-dsh-chat-demo', '22-dsh-perf-metrics-demo'])

/**
 * 缺 key 时的已知 fail-loud 报错特征。
 *
 * - dsh-llm-adapter-demo：'缺少 LLM_API_KEY：S4 要发起真实的 provider 请求…'
 * - dsh-chat-demo：适配器在真正调用时抛 code='MISSING_CREDENTIAL'，
 *   报错信息含 '缺少 LLM_API_KEY'。
 * - dsh-perf-metrics-demo：'缺少 LLM_API_KEY：本示例只跑真实模型调用…'
 *   （boot 之前就抛，不进装配）。
 *
 * 这些示例升级/改文案时这里要同步；对不上就说明报错来自别处，verify 照常记失败。
 */
const FAIL_LOUD_SIGNATURE = /缺少\s*LLM_API_KEY|MISSING_CREDENTIAL/

/**
 * 运行时废弃警告的特征。
 *
 * 上游对「已废弃」的运行时提示统一长这样（形如「注册表级 stateOf 读法 is deprecated;
 * 建议改用注册句柄的 handle.stateOf(session)」）。静态扫描只能看源码；有些废弃路径是
 * **间接**触发的（插件内部调用、装配时装配的组件调用），只有跑起来才会现形——所以
 * 实跑输出里出现这段话就算失败。示例自身不打印 "deprecated" 字样（已核对），不会误伤。
 */
const DEPRECATION_SIGNATURE = /is deprecated|has been deprecated|deprecated;/i

/** 单项检查的超时（毫秒）：真实模型调用可能较慢。 */
const CHECK_TIMEOUT_MS = 240_000

/** POSIX 上 SIGTERM 后再等这么久不退就 SIGKILL（毫秒）。 */
const KILL_GRACE_MS = 5_000

/**
 * 示例目录里是否已有 .env，或进程环境里已有 key。
 *
 * 值两侧成对引号要剥掉再判空：各示例的解析约定（10/22 的 env.ts / 21 的
 * loadDotEnv）都把 `LLM_API_KEY=""` 当缺失，这里若把空引号值当成有 key，
 * 一个合法的 keyless-△ 会被记成硬失败 ✗。
 */
function hasKey(exampleDir) {
  if (process.env.LLM_API_KEY !== undefined && process.env.LLM_API_KEY !== '') return true
  const envFile = join(exampleDir, '.env')
  if (!existsSync(envFile)) return false
  const match = readFileSync(envFile, 'utf8').match(/^\s*LLM_API_KEY\s*=\s*(.*)$/m)
  if (match === null) return false
  const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  return value !== ''
}

/**
 * 杀掉子进程的**整棵**进程树。
 *
 * shell:true 起的是外壳（Windows 上 cmd.exe、POSIX 上 /bin/sh），child.kill
 * 只杀外壳，pnpm→node/bun 的孙进程会活下来——挂着 stdin 的 REPL 就这么变成孤儿。
 * Windows 用 `taskkill /T /F` 递归强杀；POSIX 上 runScript 以 detached 启动，
 * 外壳自成进程组（pgid = child.pid），对负 pid 发信号即整组清理，先 SIGTERM、
 * 宽限期后升 SIGKILL。
 *
 * @param {import('node:child_process').ChildProcess} child
 * @returns {NodeJS.Timeout | undefined} 需要后续清理的升级定时器（POSIX 才有）
 */
function killTree(child) {
  if (process.platform === 'win32') {
    if (child.pid !== undefined) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    }
    return undefined
  }
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    return setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, KILL_GRACE_MS)
  }
  child.kill('SIGTERM')
  return setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
}

/**
 * 在示例目录里跑一条 pnpm script，收集输出。
 * stdin=ignore：交互式 REPL 读到 EOF 会自行退出，不会挂住校验。
 *
 * @param {string} exampleDir
 * @param {string} script
 * @returns {Promise<{code: number, output: string, timedOut: boolean}>}
 */
function runScript(exampleDir, script) {
  return new Promise((resolvePromise) => {
    const child = spawn(`pnpm run ${script}`, {
      cwd: exampleDir,
      env: runtimeEnv('node'),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      // POSIX 上让外壳自成进程组，超时才整组清理（见 killTree）；
      // Windows 上 detached 会另开控制台，跳过。
      detached: process.platform !== 'win32',
    })
    let output = ''
    let timedOut = false
    let killTimer
    const timer = setTimeout(() => {
      timedOut = true
      killTimer = killTree(child)
    }, CHECK_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolvePromise({ code: 1, output: `${output}\n${error.message}`, timedOut })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolvePromise({ code: code ?? 1, output, timedOut })
    })
  })
}

/**
 * 跑一个零依赖 .mjs 脚本，收集输出。
 *
 * 与 runScript 的区别：runScript 跑的是**示例自己的** pnpm script（cwd 在示例目录），
 * 这里跑的是根层 runtime/ 下的工具脚本（cwd 在 dsh-lab/）。
 *
 * @param {string} scriptPath 绝对路径
 * @returns {Promise<{code: number, output: string}>}
 */
function runNodeScript(scriptPath) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      env: runtimeEnv('node'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      resolvePromise({ code: 1, output: `${output}\n${error.message}` })
    })
    child.once('exit', (code) => {
      resolvePromise({ code: code ?? 1, output })
    })
  })
}

/** 从输出里取一行废弃警告摘要。 */
function deprecationHint(output) {
  const line = output.split(/\r?\n/).find((text) => DEPRECATION_SIGNATURE.test(text))
  return line === undefined ? '' : line.trim().slice(0, 140)
}

/** 从输出尾部取一行有意义的失败摘要。 */
function failureHint(output) {
  const lines = output.split(/\r?\n/).filter((lineText) => lineText.trim() !== '' && !lineText.startsWith('npm notice'))
  return lines.slice(-2).join(' ⏎ ').slice(0, 160)
}

async function main() {
  const examples = listExamples()
  if (examples.length === 0) throw new Error('examples/ 下没有找到任何示例')

  const results = []
  const keyFailures = []

  // 仓库级静态闸先跑：示例不得调用上游已废弃的 API。
  // 事实来源是各示例已安装包的 .d.ts 里的 @deprecated 标记（见 runtime/check-deprecated.mjs）。
  // 放在示例循环之前：这类问题会让后面的实跑结果失去意义，先拦下来更省事。
  const deprecated = await runNodeScript(join(PROJECT_ROOT, 'runtime', 'check-deprecated.mjs'))
  if (deprecated.code !== 0) {
    process.stdout.write(deprecated.output)
  }
  const deprecatedHits = deprecated.output.split(/\r?\n/).filter((lineText) => lineText.startsWith('✗')).length
  results.push({
    label: 'repo check:deprecated',
    ok: deprecated.code === 0,
    detail: deprecated.code === 0
      ? '示例未调用上游废弃的 API'
      : `命中 ${deprecatedHits} 处废弃 API（明细见上方输出）`,
  })

  for (const name of examples) {
    const exampleDir = join(EXAMPLES_ROOT, name)
    const installed = existsSync(join(exampleDir, 'node_modules'))
    const keyed = KEY_DEPENDENT.has(name)
    const keyPresent = hasKey(exampleDir)

    for (const check of ['typecheck', 'start', 'start:bun']) {
      const label = `${name} ${check}`
      if (!installed) {
        results.push({ label, ok: false, detail: '未安装（先跑 pnpm run install:all）' })
        continue
      }
      process.stdout.write(`… ${label}\n`)
      const run = await runScript(exampleDir, check)
      // 跑通了也不算数：输出里有上游的废弃警告，说明这条路径用了废弃 API。
      if (run.code === 0 && DEPRECATION_SIGNATURE.test(run.output)) {
        results.push({ label, ok: false, detail: `运行时出现废弃 API 警告：${deprecationHint(run.output)}` })
        continue
      }
      if (run.code === 0) {
        results.push({ label, ok: true, detail: 'exit 0' })
        continue
      }
      // 缺 key 的示例按「明确失败」计入报告：fail-loud 是设计行为，
      // 不静默跳过，也不当成环境故障——但如实列出。豁免以报错特征为凭：
      // 只认「缺 LLM_API_KEY」的已知报错，其余（代码 bug、缺依赖、Bun 崩溃）
      // 一律按真实失败处理，不能让 keyless 机器上的回归蒙混过关。
      if (keyed && !keyPresent && check !== 'typecheck') {
        if (FAIL_LOUD_SIGNATURE.test(run.output)) {
          keyFailures.push(label)
          results.push({ label, ok: true, keyFail: true, detail: 'fail-loud（缺 LLM_API_KEY，报错特征匹配）' })
          continue
        }
        results.push({
          label,
          ok: false,
          detail: `缺 key 但报错与已知 fail-loud 特征不符（${run.timedOut ? `超时 ${CHECK_TIMEOUT_MS / 1000}s` : `exit ${run.code}：${failureHint(run.output)}`}）`,
        })
        continue
      }
      results.push({
        label,
        ok: false,
        detail: run.timedOut ? `超时 ${CHECK_TIMEOUT_MS / 1000}s（已清理进程树）` : `exit ${run.code}：${failureHint(run.output)}`,
      })
    }
  }

  // 并排输出
  console.log('')
  console.log('─'.repeat(96))
  const width = Math.max(...results.map((row) => row.label.length))
  for (const row of results) {
    const mark = row.ok ? (row.keyFail ? '△' : '✓') : '✗'
    console.log(`${row.label.padEnd(width + 2)}${mark} ${row.detail}`)
  }
  console.log('─'.repeat(96))

  const failed = results.filter((row) => !row.ok)
  const runtimesCount = RUNTIME_NAMES.length
  if (failed.length > 0) {
    console.error('')
    console.error(`RUNTIMES_VERIFY_FAILED runtimes=${runtimesCount} checks=${results.length} failed=${failed.length}`)
    process.exitCode = 1
    return
  }
  if (keyFailures.length > 0) {
    console.log('')
    console.log(`缺 key 的明确失败（${keyFailures.length} 项，设计行为）：${keyFailures.join('、')}`)
    console.log('配好各示例目录的 .env（LLM_API_KEY）后重跑，这些项应转为真实通过。')
  }
  console.log('')
  console.log(`RUNTIMES_VERIFY_OK runtimes=${runtimesCount} checks=${results.length}`)
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

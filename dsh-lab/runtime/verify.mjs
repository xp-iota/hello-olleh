/**
 * verify.mjs —— 仓库级双运行时校验：遍历 examples/，每个示例跑三项检查。
 *
 *   typecheck   npm run typecheck        （Node 侧 tsc）
 *   start       npm start                （Node）
 *   start:bun   npm run start:bun        （Bun；dsh 系经各示例自带的 preload）
 *
 * 示例完全独立：这里只调用各示例自己的 npm scripts，不替它们装配任何东西。
 * 交互式入口（dsh-chat-demo 的 REPL）以 stdin=ignore 启动，读到 EOF 自行退出。
 *
 * 需要 key 的示例（dsh-llm-adapter-demo / dsh-chat-demo）在缺 LLM_API_KEY 时
 * 按「明确失败」计入报告（fail-loud 是设计行为），不静默跳过；其余检查全绿时
 * 仍以 RUNTIMES_VERIFY_OK 收尾并附缺 key 清单。有 key 时它们必须真实通过。
 *
 * 结尾打印 `RUNTIMES_VERIFY_OK runtimes=2 checks=N` 作为脚本化判据。
 *
 * @module dsh-lab/runtime/verify
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './lib/runtimes.mjs'

const EXAMPLES_ROOT = join(PROJECT_ROOT, 'examples')

/** 真实调用路径依赖 LLM_API_KEY 的示例。 */
const KEY_DEPENDENT = new Set(['dsh-llm-adapter-demo', 'dsh-chat-demo'])

/** 单项检查的超时（毫秒）：真实模型调用可能较慢。 */
const CHECK_TIMEOUT_MS = 240_000

/** 列出全部示例目录（带 package.json 的才算）。 */
function listExamples() {
  return readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES_ROOT, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort()
}

/** 示例目录里是否已有 .env，或进程环境里已有 key。 */
function hasKey(exampleDir) {
  if (process.env.LLM_API_KEY !== undefined && process.env.LLM_API_KEY !== '') return true
  const envFile = join(exampleDir, '.env')
  if (!existsSync(envFile)) return false
  return /^\s*LLM_API_KEY\s*=\s*\S+/m.test(readFileSync(envFile, 'utf8'))
}

/**
 * 在示例目录里跑一条 npm script，收集输出。
 * stdin=ignore：交互式 REPL 读到 EOF 会自行退出，不会挂住校验。
 *
 * @param {string} exampleDir
 * @param {string} script
 * @returns {Promise<{code: number, output: string, timedOut: boolean}>}
 */
function runScript(exampleDir, script) {
  return new Promise((resolvePromise) => {
    const child = spawn(`npm run ${script}`, {
      cwd: exampleDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
    let output = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, CHECK_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ code: 1, output: `${output}\n${error.message}`, timedOut })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: code ?? 1, output, timedOut })
    })
  })
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

  for (const name of examples) {
    const exampleDir = join(EXAMPLES_ROOT, name)
    const installed = existsSync(join(exampleDir, 'node_modules'))
    const keyed = KEY_DEPENDENT.has(name)
    const keyPresent = hasKey(exampleDir)

    for (const check of ['typecheck', 'start', 'start:bun']) {
      const label = `${name} ${check}`
      if (!installed) {
        results.push({ label, ok: false, detail: '未安装（先跑 npm run install:all）' })
        continue
      }
      process.stdout.write(`… ${label}\n`)
      const run = await runScript(exampleDir, check)
      if (run.code === 0) {
        results.push({ label, ok: true, detail: 'exit 0' })
        continue
      }
      // 缺 key 的示例按「明确失败」计入报告：fail-loud 是设计行为，
      // 不静默跳过，也不当成环境故障——但如实列出。
      if (keyed && !keyPresent && check !== 'typecheck') {
        keyFailures.push(label)
        results.push({ label, ok: true, keyFail: true, detail: 'fail-loud（缺 LLM_API_KEY，见示例 README）' })
        continue
      }
      results.push({
        label,
        ok: false,
        detail: run.timedOut ? `超时 ${CHECK_TIMEOUT_MS / 1000}s` : `exit ${run.code}：${failureHint(run.output)}`,
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
  if (failed.length > 0) {
    console.error('')
    console.error(`RUNTIMES_VERIFY_FAILED runtimes=2 checks=${results.length} failed=${failed.length}`)
    process.exitCode = 1
    return
  }
  if (keyFailures.length > 0) {
    console.log('')
    console.log(`缺 key 的明确失败（${keyFailures.length} 项，设计行为）：${keyFailures.join('、')}`)
    console.log('配好各示例目录的 .env（LLM_API_KEY）后重跑，这些项应转为真实通过。')
  }
  console.log('')
  console.log(`RUNTIMES_VERIFY_OK runtimes=2 checks=${results.length}`)
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
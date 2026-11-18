/**
 * run-bun.mjs —— `npm run start:bun` 的入口：用 Node 拉起 Bun，并注入 preload。
 *
 * 为什么需要这一层：subprocess-local 的 runner 是**孙进程**，命令行 --preload
 * 到不了那一层，只有 BUN_OPTIONS 环境变量会一路继承。所以在这里把
 * `--preload <bun-preload.mjs>` 写进 BUN_OPTIONS，再 spawn bun src/index.ts。
 *
 * 顺带清掉继承来的 NODE_OPTIONS / BUN_OPTIONS：机器上装了 tsx、或用户全局
 * 设了别的 preload 时，会让"本工程的运行环境"取决于外部状态。
 *
 * @module dsh-jobs-demo/runtime/run-bun
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRELOAD = fileURLToPath(new URL('./bun-preload.mjs', import.meta.url))
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

/**
 * Bun 用 shell 风格切分 BUN_OPTIONS，但不认引号：反斜杠转义空格，
 * 路径统一正斜杠（Windows 上 Bun 同样接受）。
 */
function escapeBunOptionPath(path) {
  return path.replace(/\\/g, '/').replace(/ /g, '\\ ')
}

const env = { ...process.env }
delete env.NODE_OPTIONS
delete env.BUN_OPTIONS
env.BUN_OPTIONS = `--preload ${escapeBunOptionPath(PRELOAD)}`

// PATH 上没有可 spawn 的 bun 时的回退候选：npm 全局包（npm i -g bun，
// 版本新）优先于官方安装器默认位置 ~/.bun/bin（可能是旧版，缺
// node:util.getSystemErrorMessage 会让 subprocess-local 导入失败）。
const candidates = [
  // npm 全局根：Windows 在 %APPDATA%\npm，POSIX 在 node 安装目录的 ../lib。
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'bun', 'bin', 'bun.exe')
    : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'bun', 'bin', 'bun'),
  join(homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
]
const BUN = candidates.find(existsSync) ?? 'bun'

const child = spawn(BUN, [ENTRY], { env, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(`无法启动 bun：${error.message}（需要 Bun >= 1.4.4 在 PATH 上）`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  process.exit(signal !== null ? 1 : code ?? 0)
})
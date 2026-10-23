/**
 * spawn.mjs —— 两个运行时之间的启动差异，全部集中在这里。
 *
 * 差异只有一处：Bun 缺 `node:module.stripTypeScriptTypes`（详见 lib/bun-shim.mjs）。
 * 必须用 `BUN_OPTIONS` 注入 preload，不能用命令行 `--preload`：
 *
 *   * 命令行参数只对本次进程有效。dsh-lab 的模块会**再 spawn 子进程**
 *     （M07 的执行后端、PTC 运行时都是），孙进程只继承环境变量；
 *   * `BUN_OPTIONS` 会一路继承下去，所以 preload 在每个层级都生效。
 *
 * 顺带清掉继承来的 `NODE_OPTIONS` / `BUN_OPTIONS`：机器上装了 tsx、或用户全局
 * 设了别的 preload 时，会让"本工程的运行环境"取决于外部状态 —— 那正是双运行时
 * 要避免的事。
 *
 * @module dsh-lab/runtime/lib/spawn
 */
import { fileURLToPath } from 'node:url'

/** Bun 专用的加载期补丁脚本。 */
export const BUN_PRELOAD = fileURLToPath(new URL('../bun-preload.mjs', import.meta.url))

/**
 * 把路径转成 `BUN_OPTIONS` 能接受的写法。
 *
 * Bun 用 shell 风格切分这个变量，但**不认引号**（`--preload="a b"` 会把引号
 * 留在路径里，报 `preload not found "\"a b\""`）。可用的是反斜杠转义空格；
 * 反斜杠本身会被当转义符吃掉，所以先把路径统一成正斜杠 —— Windows 上 Bun 同样接受。
 *
 * @param {string} path
 * @returns {string}
 */
export function escapeBunOptionPath(path) {
  return path.replace(/\\/g, '/').replace(/ /g, '\\ ')
}

/**
 * 构造子进程环境。
 *
 * @param {'node'|'bun'} runtimeName
 * @param {Record<string, string|undefined>} [base]
 * @returns {Record<string, string|undefined>}
 */
export function runtimeEnv(runtimeName, base = process.env) {
  const env = { ...base }
  delete env.NODE_OPTIONS
  delete env.BUN_OPTIONS
  if (runtimeName === 'bun') {
    // 两段式（`--preload <path>`）：等号形式在带空格的路径上不可靠。
    env.BUN_OPTIONS = `--preload ${escapeBunOptionPath(BUN_PRELOAD)}`
  }
  return env
}

/**
 * 按运行时解析结果拼出 spawn 参数。
 *
 * 只有"回退到 Windows 的 .cmd 包装脚本"时才需要经过 shell。这时**不用**
 * `shell: true`：Node 会报 DEP0190（参数不转义直接拼接），而且它在我们传入
 * 空 args 时仍会打印警告。改为自己拼命令行、显式调 `cmd.exe /d /s /c`，
 * 与 `shell: true` 内部做的事相同，但警告消失且行为可控。
 *
 * @param {{command: string, needsShell?: boolean}} runtime
 * @param {string[]} args
 * @returns {{command: string, argv: string[], shell: boolean}}
 */
export function spawnPlan(runtime, args) {
  if (runtime.needsShell !== true) return { command: runtime.command, argv: args, shell: false }
  // cmd.exe 的 `/s /c` 规则：整条命令若以引号开头，会被剥掉外层一对引号。
  // 所以这里**不加**外层引号，只在单个含空格的参数上加。
  const quote = (value) => (/[\s"]/.test(value) ? `"${value}"` : value)
  const line = [runtime.command, ...args].map(quote).join(' ')
  return { command: process.env.ComSpec ?? 'cmd.exe', argv: ['/d', '/s', '/c', line], shell: false }
}

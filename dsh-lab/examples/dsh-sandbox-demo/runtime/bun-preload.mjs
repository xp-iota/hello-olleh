/**
 * bun-preload.mjs —— Bun 侧的加载期补丁：只修 subprocess-local 的 runner 分隔符缝。
 *
 * 用法（由 runtime/run-bun.mjs 自动注入，无需手工调用）：
 *
 *     BUN_OPTIONS="--preload <abs path to this file>" bun src/index.ts
 *
 * `dsh-subprocess-local` 用一个私有 runner 子进程执行 shell 命令：
 *
 *     process.execPath <runner.js> -- <target argv…>
 *
 * 子进程里的 parseRunnerTargetArgv(process.argv.slice(2)) 要求第一项正好是 `--`。
 * Node 保留它，Bun **会吞掉脚本路径之后的第一个 `--`**：
 *
 *     node x.js -- a b  →  argv = [execPath, x.js, '--', 'a', 'b']
 *     bun  x.js -- a b  →  argv = [execPath, x.js, 'a', 'b']
 *
 * 于是 Bun 下一次性 shell 命令报：
 *
 *     subprocess runner requires target argv after a private -- delimiter
 *
 * 修法：preload 在任何主模块代码之前跑，此时 process.argv 已是最终形态，
 * 把 `--` 补回索引 2 即可。**只在 runner 入口生效**（私有环境变量 + 文件名
 * 双重判定），否则会污染所有普通脚本的 argv。
 *
 * 为什么必须是 preload 而不是改 child_process.spawn：runner 是被 provider
 * spawn 出来的孙进程，命令行的 --preload 到不了那一层，只有 BUN_OPTIONS
 * 会继承下去（见 run-bun.mjs）。
 *
 * 本示例不挂 ptc-runtime，所以不需要 stripTypeScriptTypes shim。
 *
 * @module dsh-sandbox-demo/runtime/bun-preload
 */

function restoreRunnerDelimiter() {
  if (process.env.DSH_SUBPROCESS_RUNNER === undefined) return

  const entry = process.argv[1]
  if (entry === undefined) return
  // runner 入口可能是 runner.js（构建产物）或 bin.ts（源码形态）。
  const name = entry.split(/[\\/]/).pop()
  if (name !== 'runner.js' && name !== 'bin.ts') return
  if (process.argv[2] === '--') return

  process.argv.splice(2, 0, '--')
}

restoreRunnerDelimiter()
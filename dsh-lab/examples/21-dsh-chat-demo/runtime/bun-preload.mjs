/**
 * bun-preload.mjs —— Bun 侧的加载期补丁：把 ptc-runtime 的 `node:module` 导入
 * 改指到本地 shim。
 *
 * 用法（由 runtime/run.mjs 自动注入，无需手工调用）：
 *
 *     BUN_OPTIONS="--preload <abs path to this file>" bun src/cli/bin.ts info
 *
 * 实现要点：
 *
 *   1. 只改 `@deepseek-ai/dsh-ptc-runtime-node` 包 lib 下的文件（宿主 index.js
 *      与 worker process.js 等都要补），filter 收得很窄，避免误伤别的包对
 *      `node:module` 的正常使用（如 `createRequire`）；
 *   2. 替换是**字符串精确匹配**（`replaceAll`：一个文件可能有多行
 *      `node:module` 导入，漏一行就在链接期炸），不匹配就原样返回并在 stderr
 *      留一行提示 —— 上游改了这个 import 就应当立刻被看见，而不是静默失效；
 *   3. 路径用 `fileURLToPath` 解码再转正斜杠：`URL.pathname` 带百分号编码，
 *      路径含空格/非 ASCII 时会静默指向不存在的文件。
 *
 * @module dsh-chat-demo/runtime/bun-preload
 */
import { plugin } from 'bun'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** ptc-runtime 包 lib 下所有入口（宿主 index.js 与 worker process.js 等都要补）。 */
const PTC_ENTRY = /dsh-ptc-runtime-node[\\/]lib[\\/][^\\/]+\.js$/

/** 原样的导入语句（上游当前写法）。 */
const ORIGINAL_IMPORT = 'from "node:module"'

/**
 * 修补 Bun 吞掉首个 `--` 的行为。
 *
 * `dsh-subprocess-local` 用一个私有 runner 子进程执行 shell 命令：
 *
 *     process.execPath <runner.js> -- <target argv…>
 *
 * 子进程里的 `parseRunnerTargetArgv(process.argv.slice(2))` 要求第一项正好是
 * `--`。Node 保留它，Bun **会吞掉脚本路径之后的第一个 `--`**：
 *
 *     node x.js -- a b  →  argv = [execPath, x.js, '--', 'a', 'b']
 *     bun  x.js -- a b  →  argv = [execPath, x.js, 'a', 'b']
 *
 * 于是 Bun 下一次性 shell 命令报：
 *
 *     subprocess runner requires target argv after a private -- delimiter
 *
 * 修法：preload 在任何主模块代码之前跑，此时 `process.argv` 已是最终形态，
 * 把 `--` 补回索引 2 即可。**只在 runner 入口生效**（按文件名 + 私有环境变量
 * 双重判定），否则会污染所有普通脚本的 argv。
 *
 * 为什么必须是 preload 而不是改 child_process.spawn：runner 是被 provider
 * spawn 出来的孙进程，命令行的 `--preload` 到不了那一层，只有 `BUN_OPTIONS`
 * 会继承下去（见 lib/spawn.mjs）。
 */
function restoreRunnerDelimiter() {
  if (process.env.DSH_SUBPROCESS_RUNNER === undefined) return

  const entry = process.argv[1]
  if (entry === undefined) return
  // runner 入口可能是 runner.js（构建产物）或 bin.ts（源码形态）。
  if (basename(entry) !== 'runner.js' && basename(entry) !== 'bin.ts') return
  if (process.argv[2] === '--') return

  process.argv.splice(2, 0, '--')
}

restoreRunnerDelimiter()

plugin({
  name: 'dsh-chat-demo:strip-types-shim',
  setup(build) {
    build.onLoad({ filter: PTC_ENTRY }, async (args) => {
      const source = await Bun.file(args.path).text()
      // fileURLToPath 而不是 URL.pathname：pathname 带百分号编码，
      // 路径含空格/非 ASCII 时会指向不存在的文件且无告警。
      const shimPath = fileURLToPath(new URL('./lib/bun-shim.mjs', import.meta.url))
        .replace(/\\/g, '/') // Windows 下 Bun 接受正斜杠，且免去正则反斜杠之扰

      if (!source.includes(ORIGINAL_IMPORT)) {
        // 上游改了导入写法：大声说出来，不要假装成功。
        process.emitWarning(
          'dsh-chat-demo: dsh-ptc-runtime-node 的 node:module 导入形态已变化，strip-types shim 未生效；请检查 runtime/bun-preload.mjs。',
        )
        return { contents: source, loader: 'js' }
      }

      // 一个文件可能有多行 node:module 导入（如 process.js 的 namespace +
      // 具名两行）：必须全部替换，漏一行就在链接期炸。
      const patched = source.replaceAll(ORIGINAL_IMPORT, `from "${shimPath}"`)
      return { contents: patched, loader: 'js' }
    })
  },
})

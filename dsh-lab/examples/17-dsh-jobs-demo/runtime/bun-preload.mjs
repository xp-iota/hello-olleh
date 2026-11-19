/**
 * bun-preload.mjs —— Bun 侧的加载期补丁，修五条缝：
 *   1. subprocess-local 的 runner 分隔符（Bun 吞脚本后首个 `--`）；
 *   2. ptc-runtime-node 的 `node:module` 导入（Bun 1.4.4 缺 stripTypeScriptTypes
 *      与 registerHooks 两个具名导出，链接期直接抛）→ 改指到 lib/bun-shim.mjs；
 *   3. worker env 白名单洗掉 BUN_OPTIONS → 宿主 spawn 前补回；
 *   4. Socket({fd:7}) 匿名管道 Bun/Windows 不支持 → koffi 直读句柄 Duplex；
 *   5. workflow guest 的 data URL 模块格式误判 → 落盘再导入。
 *
 * 用法（由 runtime/run-bun.mjs 自动注入，无需手工调用）：
 *
 *     BUN_OPTIONS="--preload <abs path to this file>" bun src/index.ts
 *
 * 缝 1：`dsh-subprocess-local` 用私有 runner 子进程执行命令：
 *
 *     process.execPath <runner.js> -- <target argv…>
 *
 * 子进程里的 parseRunnerTargetArgv(process.argv.slice(2)) 要求第一项正好是 `--`。
 * Node 保留它，Bun 会吞掉脚本路径之后的第一个 `--`。preload 在任何主模块代码
 * 之前跑，此时 process.argv 已是最终形态，把 `--` 补回索引 2 即可。
 * **只在 runner 入口生效**（私有环境变量 + 文件名双判定），否则会污染普通脚本。
 *
 * 缝 2：只改 `@deepseek-ai/dsh-ptc-runtime-node` 包 lib 下的文件（宿主与 worker
 * 都要补），filter 收得很窄，避免误伤别的包对 `node:module` 的正常使用；替换是
 * 字符串精确匹配，不匹配就原样返回并在 stderr 留警告——上游改了导入写法应当
 * 立刻被看见，而不是静默失效。shim 保住上游 slice(35, -2) 的位置假设，并给
 * registerHooks 一个降级空壳（见 lib/bun-shim.mjs 的代价说明）。
 *
 * 缝 3：PTC worker 的 env 是白名单重建的——宿主 index.js 把 process.env 里除
 * PATH/PATHEXT/SYSTEMROOT/WINDIR/TEMP/TMP 外的所有键置 undefined（凭据清洗），
 * BUN_OPTIONS 到不了 worker，preload 在 worker 里不生效，process.js 的
 * registerHooks 导入照样炸。修法：在宿主 spawn 调用前给 spec.env 补回
 * BUN_OPTIONS——subprocess-local 的 childEnv(extra) 在清洗之后合并 extra，
 * Windows runner 把完整 targetEnv 交给 CreateProcessW，所以这一针能穿过去。
 *
 * 缝 4：worker 的控制通道是 runner 继承的匿名管道，上游用 new Socket({fd:7})
 * 接管。Bun/Windows 既不把继承句柄映射成 fd（readSync(7) 是 EBADF），也不
 * 支持 Socket({fd}) 包匿名管道（Unsupported fd type: UNKNOWN）；但句柄本身
 * 在进程里（GetFileType 扫得到 FILE_TYPE_PIPE）。修法：把 process.js 里的
 * Socket 构造换成 lib/bun-control-channel.mjs 的 koffi 直读句柄 Duplex。
 *
 * 缝 5：workflow guest 经 data: URL 动态导入。Bun 的 data URL 模块格式判定
 * 会被 guest 里的 class 字段///#region 注释触发，误按 CJS 包成
 * { __esModule, default }，named export 全丢（runWorkflowGuest is not a
 * function）；同源码写成 .mjs 导入则正常。修法：宿主侧把 workflow-ptc 的
 * PROGRAM 模板里的 await import(GUEST_URL) 换成全局绑定 __dshBunGuestImport，
 * worker 侧给求值器 globals 注入该绑定（lib/bun-guest-import.mjs 落盘再导入）。
 *
 * 为什么必须是 preload 而不是改 child_process.spawn：runner/PTC worker 是被
 * spawn 出来的孙进程，命令行 --preload 到不了那一层，只有 BUN_OPTIONS 会继承。
 *
 * @module dsh-jobs-demo/runtime/bun-preload
 */
import { plugin } from 'bun'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** ptc-runtime 包 lib 下所有入口（宿主 index.js 与 worker process.js 等都要补）。 */
const PTC_ENTRY = /dsh-ptc-runtime-node[\\/]lib[\\/][^\\/]+\.js$/

/** workflow-ptc 宿主入口（PROGRAM 模板在这里，缝 5 要改）。 */
const WORKFLOW_ENTRY = /dsh-workflow-ptc[\\/]lib[\\/]index\.js$/

/** 原样的导入语句（上游当前写法）。 */
const ORIGINAL_IMPORT = 'from "node:module"'

/** 宿主 spawn PTC worker 的锚点（构建产物把 worker.ts 内联进 index.js）。 */
const WORKER_SPAWN_ANCHOR = 'const handle = this.ctx.subprocess.spawn({'

/**
 * 本 preload 的绝对路径（正斜杠），用于给 worker 重注入 BUN_OPTIONS。
 * fileURLToPath 而不是 URL.pathname：pathname 带百分号编码，
 * 路径含空格/非 ASCII 时会指向不存在的文件且无告警。
 */
const PRELOAD_PATH = fileURLToPath(import.meta.url).replace(/\\/g, '/')

/** BUN_OPTIONS 按命令行分词：路径里的空格要转义。 */
const PRELOAD_OPTION = `--preload ${PRELOAD_PATH.replace(/ /g, '\\ ')}`

/** worker 控制通道的上游构造（构建产物把 control.ts 内联进 process.js）。 */
const CONTROL_SOCKET = /return new Socket\(\{\s*fd: 7,\s*readable: true,\s*writable: true,\s*allowHalfOpen: true\s*\}\);/

/** workflow PROGRAM 模板里的 guest 导入（缝 5 宿主侧锚点）。 */
const GUEST_IMPORT = 'await import(${JSON.stringify(GUEST_URL)})'

/** worker 求值器 globals 初始化锚点（缝 5 worker 侧注入点）。 */
const GLOBALS_ANCHOR = 'evaluator.globals.console = makeConsoleShim(logSink);'

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
  name: 'dsh-jobs-demo:strip-types-shim',
  setup(build) {
    build.onLoad({ filter: PTC_ENTRY }, async (args) => {
      const source = await Bun.file(args.path).text()
      const shimPath = fileURLToPath(new URL('./lib/bun-shim.mjs', import.meta.url)).replace(/\\/g, '/')

      if (!source.includes(ORIGINAL_IMPORT)) {
        // 上游改了导入写法：大声说出来，不要假装成功。
        process.emitWarning(
          'dsh-jobs-demo: dsh-ptc-runtime-node 的 node:module 导入形态已变化，strip-types shim 未生效；请检查 runtime/bun-preload.mjs。',
        )
        return { contents: source, loader: 'js' }
      }

      // 一个文件可能有多行 node:module 导入（如 process.js 的 namespace +
      // 具名两行）：必须全部替换，漏一行就在链接期炸。
      let patched = source.replaceAll(ORIGINAL_IMPORT, `from "${shimPath}"`)

      // 缝 3：宿主 index.js 额外给 worker 的 spec.env 补回 BUN_OPTIONS。
      const posixPath = args.path.replace(/\\/g, '/')
      if (posixPath.endsWith('/lib/index.js')) {
        if (!patched.includes(WORKER_SPAWN_ANCHOR)) {
          process.emitWarning(
            'dsh-jobs-demo: PTC worker spawn 锚点已变化，BUN_OPTIONS 重注入未生效；请检查 runtime/bun-preload.mjs。',
          )
        } else {
          patched = patched.replace(
            WORKER_SPAWN_ANCHOR,
            `env.BUN_OPTIONS = ${JSON.stringify(PRELOAD_OPTION)};\n\t\t${WORKER_SPAWN_ANCHOR}`,
          )
        }
      }

      // 缝 4：worker 入口（process.js / persistent-process.js）把 Socket({fd:7})
      // 换成 koffi 直读继承句柄的 Duplex。
      if (posixPath.endsWith('/lib/process.js') || posixPath.endsWith('/lib/persistent-process.js')) {
        if (!CONTROL_SOCKET.test(patched)) {
          process.emitWarning(
            'dsh-jobs-demo: worker 控制通道构造形态已变化，fd shim 未生效；请检查 runtime/bun-preload.mjs。',
          )
        } else {
          const controlShimPath = fileURLToPath(new URL('./lib/bun-control-channel.mjs', import.meta.url)).replace(/\\/g, '/')
          patched = `import { openBunControlChannel } from "${controlShimPath}";\n${patched}`
            .replace(CONTROL_SOCKET, 'return openBunControlChannel();')
        }

        // 缝 5（worker 侧）：给求值器 globals 注入 guest 导入绑定，与宿主侧
        // PROGRAM 模板的 __dshBunGuestImport 调用配套。
        if (!patched.includes(GLOBALS_ANCHOR)) {
          process.emitWarning(
            'dsh-jobs-demo: worker globals 锚点已变化，guest 导入绑定未注入；请检查 runtime/bun-preload.mjs。',
          )
        } else {
          const guestShimPath = fileURLToPath(new URL('./lib/bun-guest-import.mjs', import.meta.url)).replace(/\\/g, '/')
          patched = `import { importDataUrl as __dshBunGuestImport } from "${guestShimPath}";\n${patched}`
            .replace(GLOBALS_ANCHOR, `${GLOBALS_ANCHOR}\n\t\t\tevaluator.globals.__dshBunGuestImport = __dshBunGuestImport;`)
        }
      }
      return { contents: patched, loader: 'js' }
    })

    // 缝 5（宿主侧）：workflow PROGRAM 模板的 data URL 导入换成全局绑定调用。
    build.onLoad({ filter: WORKFLOW_ENTRY }, async (args) => {
      const source = await Bun.file(args.path).text()
      if (!source.includes(GUEST_IMPORT)) {
        process.emitWarning(
          'dsh-jobs-demo: workflow PROGRAM 模板形态已变化，guest 导入降级未生效；请检查 runtime/bun-preload.mjs。',
        )
        return { contents: source, loader: 'js' }
      }
      const patched = source.replace(GUEST_IMPORT, 'await __dshBunGuestImport(${JSON.stringify(GUEST_URL)})')
      return { contents: patched, loader: 'js' }
    })
  },
})
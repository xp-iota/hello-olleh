/**
 * bun-shim.mjs —— 补上 Bun 缺失的 `node:module` 具名导出：
 * `stripTypeScriptTypes`（完整替身）与 `registerHooks`（降级空壳），
 * 其余导出原样透传。
 *
 * ## 为什么需要它
 *
 * `@deepseek-ai/dsh-ptc-runtime-node` 在模块顶层这样导入：
 *
 *     import { stripTypeScriptTypes } from "node:module";
 *
 * 这个 API 是 Node 22.13+ 的（`--experimental-strip-types` 家族），Bun 1.4.4
 * 至今没有实现。Bun 对内置模块的**具名导出**在链接阶段就解析，缺失时直接抛：
 *
 *     SyntaxError: Export named 'stripTypeScriptTypes' not found in module 'node:module'
 *
 * 这个错误发生在模块加载期，不是调用期，所以 `try/catch` 救不了；`boot()` 把它
 * 记成"该行导入失败"，于是 `ptc-runtime` 不激活 → `workflow-ptc` 等 `ptcRuntime`
 * → `tool-workflow` 等 `workflowEngine`，三个入口一起 pending。表现是**能启动、
 * 但少 1 个工具**（26 对 27），属于最难查的一类静默降级。
 *
 * ## 为什么只能在加载期改写源码
 *
 * 试过并且都不可行的路子：
 *
 *   * preload 里 `require('node:module').stripTypeScriptTypes = fn` —— `require`
 *     看到新属性，但 ESM 具名导入仍走链接期的静态导出表，拿不到；
 *   * preload 里 `Object.defineProperty(await import('node:module'), ...)` ——
 *     内置模块的 namespace 是 non-extensible，抛 TypeError；
 *   * Bun 插件 `onResolve` / `onLoad` 拦 `node:module` —— 内置模块不进插件管线，
 *     回调根本不会被调用；
 *   * `tsconfig` 的 `paths` 把 `node:module` 指到自己的文件 —— Bun 不拿 paths
 *     重写内置模块说明符。
 *
 * 可行的只有一条：用 Bun 插件的 `onLoad` **改写这个包自己的源码**，把那一行
 * import 换成指向本文件的相对路径。插件在模块求值前跑，所以拿到的是还没
 * 链接的新源码。
 *
 * ## 为什么不能用 Bun.Transpiler 直接顶替
 *
 * 上游有两处调用，对输出**做了位置假设**：
 *
 *   * `stripTypeScriptTypes(spec.program)`（持久 PTC）：整段产物直接当代码用，
 *     只要语义对就行；
 *   * `stripTypeScriptTypes(PREFIX + program + SUFFIX)`（一次性 PTC）：随后取
 *     `stripped.slice(35, stripped.length - 2)` —— 硬编码认为前缀正好 35 字符
 *     （`async function __dsh_program__() {\n`）、后缀正好 `\n}`。
 *
 * Node 的 `stripTypeScriptTypes` 是**原地替换**：它把类型标注抹成空格，字面量
 * 的位置一个字节都不动，所以 35 / `-2` 成立。而 `Bun.Transpiler` 会**重新排版**
 * （重新缩进、补分号、行尾加换行），长度立刻漂移，`slice` 就切错。
 *
 * 所以这里的做法是：调用 Transpiler 拿到剥离后的代码，再把结果**按前缀/后缀
 * 原样拼回去**，让返回值满足上游的位置假设。
 *
 * @module dsh-chat-demo/runtime/lib/bun-shim
 */

/**
 * 上游一次性 PTC 使用的前缀（长度必须与上游的 `slice(35, …)` 一致）。
 *
 * 这是本工程唯一"必须逐字节对齐"的契约，导出给 check-bun-shim.mjs 复用：
 * 契约只在这里声明一份，校验就不会对着自己那份拷贝空转。
 */
export const STRIP_PREFIX = 'async function __dsh_program__() {\n'

/** 上游一次性 PTC 使用的后缀（同样导出，供契约校验复用）。 */
export const STRIP_SUFFIX = '\n}'

/** Transpiler 实例复用：构造开销不小，且它本身无状态。 */
let transpiler

function getTranspiler() {
  if (typeof Bun === 'undefined') {
    // 本文件只在 Bun 下被加载（由 bun-preload.mjs 改写导入而来）。在 Node 上
    // 走到这里说明有人手工 import 了它 —— 直接说清楚，而不是抛 ReferenceError。
    throw new Error(
      'dsh-chat-demo: bun-shim 只能在 Bun 下使用（Node 自带 node:module.stripTypeScriptTypes，不需要这个 shim）。',
    )
  }
  transpiler ??= new Bun.Transpiler({ loader: 'ts' })
  return transpiler
}

/**
 * 用 Bun 的转译器剥离一个代码片段的类型标注。
 *
 * 输入是完整可解析的**模块**（持久 PTC 传入的整段程序，可能带顶层
 * import/export——包进函数体会变成语法错误）时直接用 Transpiler 直译；
 * 输入是**语句列表**（没有外层函数包裹，`return` 在顶层非法、直译必然失败）
 * 时，先包进 async 函数再剥，然后按上游的位置约定取回函数体。
 *
 * @param {string} code
 * @returns {string}
 */
function strip(code) {
  const input = String(code)

  // 分支 A：调用方自己已经包好了外层函数（上游的一次性 PTC 就是这样）。
  if (input.startsWith(STRIP_PREFIX) && input.endsWith(STRIP_SUFFIX)) {
    const body = input.slice(STRIP_PREFIX.length, input.length - STRIP_SUFFIX.length)
    const strippedBody = stripStatements(body)
    // 按上游的 slice(35, len-2) 还原：返回值必须仍然以 PREFIX 开头、以 SUFFIX 结尾。
    return STRIP_PREFIX + strippedBody + STRIP_SUFFIX
  }

  // 分支 B：裸片段。先按完整模块直译；直译不了（典型是顶层 return 的语句列表）
  // 再按语句列表处理。两个分支的失败都向上抛，不静默产出错误代码。
  try {
    return getTranspiler().transformSync(input)
  } catch {
    return stripStatements(input)
  }
}

/**
 * 剥离一段**语句列表**（可能含 `return`）的类型标注。
 *
 * Transpiler 不接受顶层 `return`，所以统一包进 async 函数；剥完再把函数壳去掉。
 * 这里不追求与 Node 逐字节相同（Node 抹空格、这里重新排版），只保证：
 * 语义等价、可被 `new Function`/`vm` 正常执行、且不引入上游未预期的字符。
 *
 * @param {string} source
 * @returns {string}
 */
function stripStatements(source) {
  const wrapped = `${STRIP_PREFIX}${source}${STRIP_SUFFIX}`
  const output = getTranspiler().transformSync(wrapped)

  // Transpiler 会重新格式化整个函数，所以不能按原偏移切。改为定位函数头与
  // 末尾的 `}`：函数头之后、最后一个 `}` 之前就是函数体。
  const headerMatch = /^async function __dsh_program__\(\) \{\n?/.exec(output)
  if (headerMatch === null) {
    // 意料之外的输出形态：退回"原样返回"，让上游自己报语法错误，
    // 而不是在这里静默产出错误代码。
    return source
  }
  const bodyStart = headerMatch[0].length
  const lastBrace = output.lastIndexOf('}')
  if (lastBrace <= bodyStart) return source

  let body = output.slice(bodyStart, lastBrace)
  // Transpiler 会在函数末尾补一个换行；去掉尾部空白，避免把空行带进代码。
  body = body.replace(/\s+$/, '')
  return body
}

/**
 * `node:module.stripTypeScriptTypes` 的替身。
 *
 * 签名与 Node 一致：`(code, options?) => string`。`options.mode` 在 Node 上区分
 * `strip`（删类型）与 `transform`（降级语法），Bun 的 ts loader 已经是"两步都做"，
 * 因此这里忽略该参数 —— 上游也只用到默认模式。
 *
 * @param {string} code
 * @returns {string}
 */
export function stripTypeScriptTypes(code) {
  return strip(code)
}

/** 标记：用于自检时确认 shim 真的被装上了。 */
export const BUN_STRIP_SHIM = true

/**
 * `node:module.registerHooks` 的降级替身（Bun 无同步模块定制钩子）。
 *
 * 上游用它给程序内的 `await import(...)` 接沙箱判决（imports/module-hooks.ts）。
 * Bun 没有钩子管线，这里只保住链接期与构造期不炸：返回可 deregister 的空壳。
 * **代价**：Bun 下程序内的动态 import 走 Bun 默认加载器，不经沙箱 importHandler
 * 判决——不用程序内 import 的示例不受影响；要用 import 的示例请在 Node 下跑。
 *
 * @returns {{ deregister: () => void }}
 */
export function registerHooks() {
  return { deregister() {} }
}

// 其余导出原样透传（createRequire、builtinModules 等）：上游 worker 还从
// node:module 拿别的东西，不能只给两个替身就把整个模块换掉。
export * from 'node:module'
export { default } from 'node:module'

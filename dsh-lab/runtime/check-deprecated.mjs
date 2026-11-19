/**
 * check-deprecated.mjs —— 「示例不得调用上游已废弃的 API」守卫。
 *
 * 背景：上游 dsh 用 `@deprecated` JSDoc 标出**打算移除**的接口。dsh-lab 的示例
 * 是给别人照着抄的代码——示例里出现已废弃的写法，读者复制过去就踩进上游已经决定
 * 淘汰的路径。上游对同步读会话历史的决策尤其明确（见上游
 * `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`）：
 * `Session.eventAt()` / `Session.snapshotEvents()` / `Session.ownEvents()` 三个
 * 同步读接口「现有逻辑可以暂不迁移，但**禁止新增调用**」。示例是新写的代码，
 * 不属于"现有逻辑"，所以必须用新缝（`session/event` 订阅 / 异步分页）。
 *
 * 事实来源：各示例**已安装**的 `@deepseek-ai/*` 包 .d.ts 里的 `@deprecated` 标记
 * （当前 0.2.2-rc.5）。上游新增废弃项时本守卫自动跟上，不靠手抄名单。
 * 没装依赖时回落到 `FALLBACK_SYMBOLS`（与 0.2.2-rc.5 对齐）并明确提示。
 *
 * 扫描范围：dsh-lab/ 全树（runtime/ + examples/ + 本仓 README）。
 * 排除：node_modules/、diagrams/（archify 产物，内含浏览器 JS）、.dsh-home/、
 * .cordis/（loader 生成物）、.bun-guest-cache/、dist/、build/。
 *
 * 豁免机制：某一**行**里出现 `check-deprecated:allow` 标记即跳过该行。
 * 这是给"故意提到废弃 API 名字"的地方用的（例如讲迁移为什么要改），
 * 与上游 `oxlint-disable-next-line typescript/no-deprecated` 的行级豁免同构。
 *
 * 用法：node runtime/check-deprecated.mjs
 * 结尾打印 `CHECK_DEPRECATED_OK symbols=N files=M` 作为脚本化判据。
 *
 * @module dsh-lab/runtime/check-deprecated
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PROJECT_ROOT } from './lib/runtimes.mjs'

/**
 * 兜底废弃符号清单（与 0.2.2-rc.5 安装态一致）。
 * 只有在完全没装依赖时才用；装了依赖则以 .d.ts 为准。
 */
const FALLBACK_SYMBOLS = [
  'cordis-plugin-timer::setTimeout',
  'cordis-plugin-timer::setInterval',
  'dsh-agent::agent/request',
  'dsh-api-session-controller::page',
  'dsh-session::eventAt',
  'dsh-session::snapshotEvents',
  'dsh-session::ownEvents',
  'dsh-session-projection::stateOf',
  'dsh-session-projection::cachedSnapshot',
]

/**
 * 特殊匹配规则。
 *
 * 默认规则是「标识符按单词边界出现即命中」，但下面几个必须更精确，否则会误伤：
 *
 * - `setTimeout` / `setInterval`：废弃的是 cordis-plugin-timer 混进 ctx 的那两个
 *   （`ctx.setTimeout()`），**全局** `setTimeout()` 不废弃——所以只匹配带点的形态。
 * - `stateOf`：废弃的是注册表级 `sessionProjections.stateOf()`；上游推荐的替代
 *   `handle.stateOf(session)` 恰恰也带点，用负向后顾排除 handle 前缀。
 * - `page`：废弃的是 `sessionController.page()`；别的 `.page()` 与它无关，收窄到
 *   服务名。
 * - `agent/request`：是一个事件名字符串，按引号形态匹配。
 */
const RULES = {
  'cordis-plugin-timer::setTimeout': {
    pattern: /\.setTimeout\(/,
    hint: 'cordis-plugin-timer 的 ctx.setTimeout() 已废弃，改用 ctx.timeout()',
  },
  'cordis-plugin-timer::setInterval': {
    pattern: /\.setInterval\(/,
    hint: 'cordis-plugin-timer 的 ctx.setInterval() 已废弃，改用 ctx.interval()',
  },
  'dsh-agent::agent/request': {
    pattern: /['"`]agent\/request['"`]/,
    hint: 'agent/request waterfall 已废弃（只为既有监听器保留），不要新增监听',
  },
  'dsh-api-session-controller::page': {
    pattern: /sessionController\.page\(/,
    hint: 'sessionController.page() 已废弃，改用 sessionController.events()',
  },
  'dsh-session::eventAt': {
    pattern: /\.eventAt\(/,
    hint: 'Session.eventAt() 已废弃（同步读会话历史被上游终止），改用 session/event 订阅或异步分页',
  },
  'dsh-session::snapshotEvents': {
    pattern: /\bsnapshotEvents\b/,
    hint: 'Session.snapshotEvents() 已废弃（同步读会话历史被上游终止），改用 session/event 订阅或异步分页',
  },
  'dsh-session::ownEvents': {
    pattern: /\bownEvents\b/,
    hint: 'Session.ownEvents() 已废弃（同步读会话历史被上游终止），改用 session/event 订阅或异步分页',
  },
  'dsh-session-projection::stateOf': {
    pattern: /(?<!handle)\.stateOf\(/,
    hint: '注册表级 sessionProjections.stateOf() 已废弃，改用注册句柄的 handle.stateOf(session)',
  },
  'dsh-session-projection::cachedSnapshot': {
    pattern: /\bcachedSnapshot\b/,
    hint: 'sessionProjections.cachedSnapshot() 已废弃，改用 snapshot(session, keys)',
  },
}

/**
 * 行级豁免标记。
 *
 * 两种用法：
 * - 单行：某行含 `check-deprecated:allow` 即豁免该行；
 * - 块级：`check-deprecated:allow begin` 到 `check-deprecated:allow end` 之间的
 *   所有行豁免（用于文档里成段列举废弃 API 名字的地方）。
 */
const ALLOW_MARKER = 'check-deprecated:allow'
const ALLOW_BEGIN = 'check-deprecated:allow begin'
const ALLOW_END = 'check-deprecated:allow end'

/** 扫描时跳过的目录名。 */
const SKIP_DIRS = new Set([
  'node_modules',
  'diagrams',
  '.dsh-home',
  '.cordis',
  '.bun-guest-cache',
  'dist',
  'build',
  '.git',
])

/** 参与扫描的扩展名。 */
const SCAN_EXT = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.md'])

/** 本脚本自身：规则表里写着废弃符号的字面量，扫自己会自我命中。 */
const SELF_FILE = 'runtime/check-deprecated.mjs'

/**
 * 从 JSDoc 块里取出紧随其后的声明名。
 *
 * `@deprecated` 下面可能隔着一整段说明文字，才到真正的声明行，所以向下找
 * 第一个"像声明"的行：带引号的事件名，或 `名字(` / `名字<` 形态的标识符。
 *
 * @param {string[]} lines
 * @param {number} deprecatedLineIndex
 * @returns {string | null}
 */
function findDeclaredSymbol(lines, deprecatedLineIndex) {
  for (let index = deprecatedLineIndex + 1; index < Math.min(deprecatedLineIndex + 14, lines.length); index += 1) {
    const line = lines[index] ?? ''
    if (line.includes('@deprecated')) break
    if (/^\s*(\*|\/\/)/.test(line)) continue
    const quoted = line.match(/'([^']+)'/)
    if (quoted) return quoted[1] ?? null
    const named = line.match(/^\s*(?:static\s+|readonly\s+|get\s+|set\s+|abstract\s+|async\s+)*([A-Za-z_$][\w$]*)\s*[(<]/)
    if (named) return named[1] ?? null
  }
  return null
}

/**
 * 扫描各示例已安装包的 .d.ts，收集全部 @deprecated 符号。
 *
 * @returns {Map<string, {package: string, symbol: string}>}
 */
function collectFromInstalledPackages() {
  const found = new Map()
  const examplesDir = join(PROJECT_ROOT, 'examples')
  if (!existsSync(examplesDir)) return found

  for (const example of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!example.isDirectory()) continue
    const vendor = join(examplesDir, example.name, 'node_modules', '@deepseek-ai')
    if (!existsSync(vendor)) continue

    for (const pkg of readdirSync(vendor, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const stack = [join(vendor, pkg.name)]
      while (stack.length > 0) {
        const current = stack.pop()
        let entries
        try {
          entries = readdirSync(current, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          const path = join(current, entry.name)
          if (entry.isDirectory()) {
            stack.push(path)
            continue
          }
          if (!entry.name.endsWith('.d.ts')) continue
          const lines = readFileSync(path, 'utf8').split(/\r?\n/)
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? ''
            if (!line.includes('@deprecated')) continue
            const symbol = findDeclaredSymbol(lines, index)
            if (symbol === null) continue
            const key = `${pkg.name}::${symbol}`
            if (!found.has(key)) found.set(key, { package: pkg.name, symbol })
          }
        }
      }
    }
  }
  return found
}

/**
 * 列出参与扫描的文件。
 *
 * @returns {string[]} 绝对路径
 */
function listScanFiles() {
  const files = []
  const stack = [PROJECT_ROOT]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        stack.push(path)
        continue
      }
      if (!entry.isFile()) continue
      const dot = entry.name.lastIndexOf('.')
      if (dot < 0) continue
      if (!SCAN_EXT.has(entry.name.slice(dot))) continue
      if (relative(PROJECT_ROOT, path).replace(/\\/g, '/') === SELF_FILE) continue
      files.push(path)
    }
  }
  return files.sort()
}

function main() {
  const installed = collectFromInstalledPackages()
  const symbols = installed.size > 0
    ? installed
    : new Map(FALLBACK_SYMBOLS.map((key) => {
      const [pkg, symbol] = key.split('::')
      return [key, { package: pkg, symbol }]
    }))

  const rules = []
  for (const key of symbols.keys()) {
    const rule = RULES[key]
    const symbol = symbols.get(key)?.symbol ?? key.split('::')[1] ?? key
    rules.push({
      key,
      symbol,
      pattern: rule?.pattern ?? new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
      hint: rule?.hint ?? `${key} 已废弃`,
    })
  }

  const files = listScanFiles()
  const hits = []

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    let inAllowBlock = false
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (line.includes(ALLOW_BEGIN)) {
        inAllowBlock = true
        continue
      }
      if (line.includes(ALLOW_END)) {
        inAllowBlock = false
        continue
      }
      if (inAllowBlock) continue
      if (line.includes(ALLOW_MARKER)) continue
      for (const rule of rules) {
        if (!rule.pattern.test(line)) continue
        hits.push({
          file: relative(PROJECT_ROOT, file).replace(/\\/g, '/'),
          line: index + 1,
          key: rule.key,
          hint: rule.hint,
          text: line.trim(),
        })
      }
    }
  }

  console.log(`废弃 API 扫描：symbols=${rules.length} files=${files.length} source=${installed.size > 0 ? '已安装包的 .d.ts' : '兜底清单（未装依赖）'}`)
  if (installed.size === 0) {
    console.log('  提示：没找到已安装的 @deepseek-ai/*，用的是兜底清单。先跑 npm run install:all 可拿到上游最新废弃项。')
  }

  if (hits.length > 0) {
    console.error('')
    for (const hit of hits) {
      console.error(`✗ ${hit.file}:${hit.line}`)
      console.error(`    ${hit.key} —— ${hit.hint}`)
      console.error(`    │ ${hit.text}`)
    }
    console.error('')
    console.error(`CHECK_DEPRECATED_FAILED hits=${hits.length} symbols=${rules.length}`)
    process.exitCode = 1
    return
  }

  console.log('')
  console.log(`CHECK_DEPRECATED_OK symbols=${rules.length} files=${files.length}`)
}

main()

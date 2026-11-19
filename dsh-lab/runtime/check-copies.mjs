/**
 * check-copies.mjs —— 「完全独立的代价」漂移守卫。
 *
 * dsh-lab 的示例完全独立，几个已知文件是**成对/成组拷贝**的（自写插件、Bun shim、
 * spawn 工具）。副本各自演化时，最容易出的事不是功能坏掉，而是**无声漂移**：
 * 一份修了 bug 另一份没修、一份加了透传另一份没有。这个脚本把「副本应保持一致」
 * 从 README 里的承诺变成可执行的检查：
 *
 *   1. bun-shim.mjs 三份（根参照层、17-jobs、21-chat）；
 *   2. spawn.mjs 两份（根、21-chat）；
 *   3. bun-preload.mjs 两份（根、21-chat；17-jobs 的五缝超集另做包含性检查）；
 *   4. anthropic-compat 插件三份（10-llm-adapter、21-chat、22-perf-metrics，含各自测试）；
 *   5. safety-guardrail 插件两份（20-guardrail、21-chat，含各自测试）。
 *
 * 归一化只抹掉**必然不同**的部分：@module 名、示例名前缀（dsh-lab/dsh-jobs-demo/
 * dsh-chat-demo → DEMO）与各自的修复指引命令（npm run mechanism / npm run info）。
 * 其余任何字节差异都算漂移，非零退出并点名第一处分歧。
 *
 * 用法：node runtime/check-copies.mjs
 *
 * @module dsh-lab/runtime/check-copies
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './lib/runtimes.mjs'

/** 归一化：抹掉副本间**必然**不同的标识，其余逐字节比较。 */
function normalize(content) {
  return content
    .replace(/dsh-(lab|jobs-demo|chat-demo|llm-adapter-demo|guardrail-demo|perf-metrics-demo)/g, 'DEMO')
    .replace(/npm run (mechanism|info)/g, 'npm run <cmd>')
    .split(/\r?\n/)
    .filter((line) => !line.includes('@module'))
}

/** 逐行比较归一化后的副本，返回第一处分歧（无分歧返回 null）。 */
function firstDivergence(a, b) {
  const lines = Math.max(a.length, b.length)
  for (let i = 0; i < lines; i += 1) {
    if (a[i] !== b[i]) {
      return {
        line: i + 1,
        a: a[i - 1] !== undefined ? `${a[i - 1]}\n${a[i]}` : a[i],
        b: b[i - 1] !== undefined ? `${b[i - 1]}\n${b[i]}` : b[i],
      }
    }
  }
  return null
}

/** 成组拷贝：组内所有文件归一化后必须互相一致。 */
const COPY_GROUPS = [
  {
    name: 'bun-shim.mjs（根 / 17-jobs / 21-chat）',
    files: [
      'runtime/lib/bun-shim.mjs',
      'examples/17-dsh-jobs-demo/runtime/lib/bun-shim.mjs',
      'examples/21-dsh-chat-demo/runtime/lib/bun-shim.mjs',
    ],
  },
  {
    name: 'spawn.mjs（根 / 21-chat）',
    files: ['runtime/lib/spawn.mjs', 'examples/21-dsh-chat-demo/runtime/lib/spawn.mjs'],
  },
  {
    name: 'bun-preload.mjs（根 / 21-chat）',
    files: ['runtime/bun-preload.mjs', 'examples/21-dsh-chat-demo/runtime/bun-preload.mjs'],
  },
  {
    name: 'anthropic-compat/index.ts（10 / 21 / 22）',
    files: [
      'examples/10-dsh-llm-adapter-demo/src/plugins/anthropic-compat/index.ts',
      'examples/21-dsh-chat-demo/src/plugins/anthropic-compat/index.ts',
      'examples/22-dsh-perf-metrics-demo/src/plugins/anthropic-compat/index.ts',
    ],
  },
  {
    name: 'anthropic-compat/index.test.ts（10 / 21 / 22）',
    files: [
      'examples/10-dsh-llm-adapter-demo/src/plugins/anthropic-compat/index.test.ts',
      'examples/21-dsh-chat-demo/src/plugins/anthropic-compat/index.test.ts',
      'examples/22-dsh-perf-metrics-demo/src/plugins/anthropic-compat/index.test.ts',
    ],
  },
  {
    name: 'safety-guardrail/index.ts（20 / 21）',
    files: [
      'examples/20-dsh-guardrail-demo/src/plugins/safety-guardrail/index.ts',
      'examples/21-dsh-chat-demo/src/plugins/safety-guardrail/index.ts',
    ],
  },
  {
    name: 'safety-guardrail/index.test.ts（20 / 21）',
    files: [
      'examples/20-dsh-guardrail-demo/src/plugins/safety-guardrail/index.test.ts',
      'examples/21-dsh-chat-demo/src/plugins/safety-guardrail/index.test.ts',
    ],
  },
]

/**
 * 包含性检查：17-jobs 的 preload 是五缝**超集**，不与根逐字节对齐，但根的
 * runner 分隔符修补逻辑必须原样（modulo 前缀）出现在超集里——根若改了判定
 * 逻辑而超集没跟上，也是漂移。
 */
const SUPERSET_CONTAINMENT = [
  {
    name: '17-jobs preload ⊇ 根 preload 的 restoreRunnerDelimiter',
    whole: 'examples/17-dsh-jobs-demo/runtime/bun-preload.mjs',
    part: 'runtime/bun-preload.mjs',
    extract: /\nfunction restoreRunnerDelimiter\(\) \{[\s\S]*?\n\}/,
  },
]

const read = (relativePath) => normalize(readFileSync(join(PROJECT_ROOT, relativePath), 'utf8'))

let failed = 0
let pairs = 0

for (const group of COPY_GROUPS) {
  const [reference, ...others] = group.files.map(read)
  for (const [index, otherPath] of group.files.slice(1).entries()) {
    pairs += 1
    const divergence = firstDivergence(reference, read(otherPath))
    if (divergence !== null) {
      failed += 1
      console.error(`✗ ${group.name}：与首份在归一化后第 ${divergence.line} 行开始分歧`)
      console.error(`  首份（${group.files[0]}）：`)
      console.error(`    ${divergence.a.replace(/\n/g, '\n    ')}`)
      console.error(`  副本（${otherPath}）：`)
      console.error(`    ${divergence.b.replace(/\n/g, '\n    ')}`)
      continue
    }
    console.log(`✓ ${group.name}`)
  }
}

for (const check of SUPERSET_CONTAINMENT) {
  pairs += 1
  const partMatch = check.extract.exec(readFileSync(join(PROJECT_ROOT, check.part), 'utf8'))
  const part = partMatch === null ? null : normalize(partMatch[0]).join('\n')
  const whole = read(check.whole).join('\n')
  if (part === null) {
    failed += 1
    console.error(`✗ ${check.name}：在 ${check.part} 里找不到要校验的代码块（锚点过期？）`)
    continue
  }
  if (!whole.includes(part)) {
    failed += 1
    console.error(`✗ ${check.name}：超集副本缺少该代码块`)
    continue
  }
  console.log(`✓ ${check.name}`)
}

console.log('')
if (failed > 0) {
  console.error(`COPIES_CHECK_FAILED pairs=${pairs} failed=${failed}`)
  process.exitCode = 1
} else {
  console.log(`COPIES_CHECK_OK pairs=${pairs} failed=0`)
}

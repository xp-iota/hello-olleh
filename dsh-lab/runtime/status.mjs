/**
 * status.mjs —— `npm run runtime:status`：说清两套运行时各自解析到哪、版本是否达标。
 *
 * 失败不是静默的：任何一个不达标都以非零码退出，并把"为什么这个版本不行"
 * （清单里的 `reason`）和升级地址一起打出来。
 *
 * @module dsh-lab/runtime/status
 */
import { installedStatus, loadManifest } from './lib/runtimes.mjs'

const manifest = loadManifest()

console.log(`运行时状态（清单：runtime/runtimes.json，schema v${manifest.schemaVersion}）：`)

let failed = 0

for (const status of installedStatus()) {
  const { entry, name } = status
  const label = `${entry.displayName} v${entry.version}（${entry.channel === 'current' ? 'Current 线' : '最新稳定'}）`
  if (status.ok) {
    const { resolved } = status
    const exact = resolved.version === entry.version
    const mark = exact ? '✓' : '·'
    console.log(`  ${mark} ${label}`)
    console.log(`        ${resolved.command}`)
    console.log(
      `        版本 ${resolved.version}${exact ? '（与清单一致）' : `（清单为 ${entry.version}，当前 ${resolved.version}）`}` +
        `，来源 ${resolved.source === 'override' ? `覆盖变量 DSH_${name.toUpperCase()}` : 'PATH'}`,
    )
  } else {
    failed += 1
    console.log(`  ✗ ${label}`)
    for (const detail of status.error.split('\n')) console.log(`      ${detail.trim()}`)
  }
}

console.log('')
console.log(`升级方式：Node ${manifest.runtimes.node.reference}`)
console.log(`          Bun  ${manifest.runtimes.bun.reference}`)

if (failed > 0) {
  console.error('')
  console.error(`RUNTIME_STATUS_FAILED runtimes=${failed}`)
  process.exitCode = 1
}

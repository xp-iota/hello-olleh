/**
 * install-all.mjs —— `npm run install:all`：遍历 examples/ 逐个 npm install。
 *
 * 每个示例完全独立（自带 package.json 与 .npmrc），这里只是批量代跑，
 * 不做任何共享提升。任一示例安装失败立即非零退出并点名。
 *
 * @module dsh-lab/runtime/install-all
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './lib/runtimes.mjs'

const EXAMPLES_ROOT = join(PROJECT_ROOT, 'examples')

function installOne(exampleDir) {
  return new Promise((resolvePromise) => {
    const child = spawn('npm install --no-audit --no-fund', {
      cwd: exampleDir,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    })
    child.once('error', () => resolvePromise(1))
    child.once('exit', (code) => resolvePromise(code ?? 1))
  })
}

async function main() {
  const examples = readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES_ROOT, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort()

  let failed = 0
  for (const name of examples) {
    console.log(`\n── install ${name} ──`)
    const code = await installOne(join(EXAMPLES_ROOT, name))
    if (code !== 0) {
      failed += 1
      console.error(`✗ ${name} 安装失败（exit ${code}）`)
    }
  }

  console.log('')
  if (failed > 0) {
    console.error(`INSTALL_ALL_FAILED examples=${examples.length} failed=${failed}`)
    process.exitCode = 1
    return
  }
  console.log(`INSTALL_ALL_OK examples=${examples.length}`)
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
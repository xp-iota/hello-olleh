/**
 * install-all.mjs —— `pnpm run install:all`：遍历 examples/ 逐个 pnpm install。
 *
 * 每个示例完全独立（自带 package.json 与 pnpm-workspace.yaml 设置文件），这里只是批量代跑，
 * 不做任何共享提升。任一示例安装失败立即非零退出并点名。
 *
 * 与 verify.mjs 同一套约束：
 *
 *   * 超时上限（单个 install 卡死不能挂住整批——注册表停滞、postinstall
 *     提示都会造成假死）；
 *   * examples/ 为空按配置错误处理（非零退出），不打印静默的 0 成功；
 *   * 示例清单来自 lib/examples.mjs 的唯一实现，不再各自手写。
 *
 * @module dsh-lab/runtime/install-all
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { EXAMPLES_ROOT, listExamples } from './lib/examples.mjs'

/** 单个示例安装的超时（毫秒）：pnpm install 通常远快于这个上限。 */
const INSTALL_TIMEOUT_MS = 600_000

function installOne(exampleDir) {
  return new Promise((resolvePromise) => {
    const child = spawn('pnpm install', {
      cwd: exampleDir,
      stdio: 'inherit',
      shell: true,
      // POSIX 上让外壳自成进程组，超时才整组清理（同 verify.mjs）；
      // Windows 上 detached 会另开控制台，跳过。
      detached: process.platform !== 'win32',
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // shell:true 只杀得到外壳；pnpm 的孙进程要用进程树清理（同 verify.mjs）。
      if (process.platform === 'win32') {
        if (child.pid !== undefined) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        }
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
        setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        }, 5_000)
      } else {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5_000)
      }
    }, INSTALL_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      // pnpm 根本没起来（ENOENT/EACCES）时也把原因带出来，不能只剩一个空的 exit 1。
      resolvePromise({ code: 1, spawnError: error.message })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: timedOut ? 124 : (code ?? 1) })
    })
  })
}

async function main() {
  const examples = listExamples()
  if (examples.length === 0) throw new Error(`examples/ 下没有找到任何示例（检查 ${EXAMPLES_ROOT} 是否完整）`)

  let failed = 0
  for (const name of examples) {
    console.log(`\n── install ${name} ──`)
    const { code, spawnError } = await installOne(join(EXAMPLES_ROOT, name))
    if (code !== 0) {
      failed += 1
      const reason =
        code === 124
          ? `超时 ${INSTALL_TIMEOUT_MS / 1000}s`
          : spawnError !== undefined
            ? `无法启动：${spawnError}`
            : `exit ${code}`
      console.error(`✗ ${name} 安装失败（${reason}）`)
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

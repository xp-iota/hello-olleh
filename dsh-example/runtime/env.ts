/**
 * env.ts —— 唯一的 .env 加载点，以及唯一的"真实模式就绪"前置检查。
 *
 * 工程根 `.env` 保存真实 provider 配置（`LLM_API_KEY` 等），文件被 .gitignore 忽略。
 * `process.loadEnvFile` 不覆盖已存在的环境变量，所以命令行临时注入优先于文件。
 * 文件不存在时静默跳过 —— 离线模式本来就不需要它。
 *
 * 真实模式的入口（runtime/real.ts）与装配入口（runtime/harness.ts）都从这里进，
 * 避免出现"某个入口忘了加载 .env，于是真实模式误报缺密钥"这种偏差。
 */
import { isMockMode } from './mode.ts'

let loaded = false

export function loadProjectEnv(): void {
  if (loaded) return
  loaded = true
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url))
  } catch {
    /* 没有 .env：继续读进程环境变量 */
  }
}

loadProjectEnv()

/**
 * 真实模式的前置检查：`.env` 已加载、且 `LLM_API_KEY` 在场，否则当场退出。
 *
 * 三个专项真实演示（各模块 `real/` 下的 `*-minimax.ts`）原先各自复制了同一段
 * loadEnvFile + 缺密钥报错，既啰嗦又容易改漏一处。现在它们统一调这一个函数，
 * 报错文案与修复指引只有一份。
 *
 * mock 模式直接返回：`--mock` 下这些演示阶段根本不会被执行（`run.ts` 已按 `realOnly` 跳过）。
 */
export function requireRealCredentials(module: string): void {
  loadProjectEnv()
  if (isMockMode() || process.env.LLM_API_KEY) return
  console.error('✗ 缺少 LLM_API_KEY。')
  console.error('  复制 .env.example 为 .env 并填入推理服务密钥，或在命令前临时注入：')
  console.error(`  LLM_API_KEY=<your-key> npm run ${module}`)
  process.exit(1)
}

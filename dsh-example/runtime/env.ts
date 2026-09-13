/**
 * env.ts —— 唯一的 .env 加载点。
 *
 * 工程根 `.env` 保存真实 provider 配置（`MINIMAX_API_KEY` 等），文件被 .gitignore 忽略。
 * `process.loadEnvFile` 不覆盖已存在的环境变量，所以命令行临时注入优先于文件。
 * 文件不存在时静默跳过 —— 离线模式本来就不需要它。
 *
 * 真实模式的入口（runtime/real.ts）与装配入口（runtime/harness.ts）都从这里进，
 * 避免出现"某个入口忘了加载 .env，于是真实模式误报缺密钥"这种偏差。
 */
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

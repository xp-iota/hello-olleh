/**
 * env.ts —— 读本目录 .env（完全独立：不依赖根工程或任何 dotenv 包）。
 *
 * 规则与常见 dotenv 一致：KEY=VALUE 逐行解析，忽略空行与 # 注释，
 * 值两侧的成对引号剥掉（`KEY="a b"` 与 `KEY='a b'` 等价），
 * **不覆盖已存在的进程环境**（显式导出优先于文件）。
 *
 * 与 15-dsh-chat-demo 的 loadDotEnv（src/cli/bin.ts）是同源副本，
 * 两边的解析行为必须一致（差异由根层 check:copies 守卫不了——刻意
 * 各自实现——所以这里把约定写成注释，改一边必须同步另一边）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadDotEnv(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const file = resolve(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}
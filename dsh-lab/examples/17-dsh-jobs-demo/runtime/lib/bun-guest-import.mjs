/**
 * bun-guest-import.mjs —— Bun/Windows 下 data URL 动态导入的降级实现。
 *
 * workflow-ptc 把自包含的 guest ESM 编码成 data: URL，在 PTC 程序里
 * `await import(GUEST_URL)` 加载。Node 按 ESM 解析 data URL；Bun 1.4.4 的
 * data URL 模块格式判定会被 guest 里的 class 字段、//#region 注释等触发，
 * 误按 CJS 包一层 { __esModule, default }，named export 全部丢失
 * （runWorkflowGuest is not a function）。同一份源码写成 .mjs 文件导入则
 * 完全正常——所以这里把 data URL 落盘成 .mjs 再导入，绕开格式判定。
 *
 * 落盘位置是 worker 的 cwd（沙箱工作区）下的 .bun-guest-cache/，按内容
 * sha1 命名：同一 guest 只写一次，读权限在 workspace-write/read-only 下
 * 都成立。guest 只 import node:vm 内置模块，文件位置不影响解析。
 *
 * @module dsh-jobs-demo/runtime/lib/bun-guest-import
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/** 把 data:text/javascript URL 物化为 .mjs 文件并导入，返回模块命名空间。 */
export async function importDataUrl(url) {
  const prefix = 'data:text/javascript,'
  if (!url.startsWith(prefix)) return import(url)
  const source = decodeURIComponent(url.slice(prefix.length))
  const dir = join(process.cwd(), '.bun-guest-cache')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${createHash('sha1').update(source).digest('hex')}.mjs`)
  if (!existsSync(file)) writeFileSync(file, source)
  return import(pathToFileURL(file).href)
}
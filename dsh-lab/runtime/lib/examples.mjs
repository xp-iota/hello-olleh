/**
 * examples.mjs —— 「列出全部示例」的唯一实现。
 *
 * verify / install-all 都要遍历 examples/；判定规则（带 package.json 的目录）
 * 只在这里存在一份，避免两处手写漂移。
 *
 * @module dsh-lab/runtime/lib/examples
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './runtimes.mjs'

export const EXAMPLES_ROOT = join(PROJECT_ROOT, 'examples')

/** 列出全部示例目录（带 package.json 的才算），按目录名排序。 */
export function listExamples() {
  return readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES_ROOT, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort()
}

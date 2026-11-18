/**
 * big-text —— 产出可控大小文本的工具，服务于裁剪与溢写两个场景。
 * medium：3000 个互不相同的词（约 2 万字符、数千 token）——超过 pruner 的
 *         8192 字符阈值，但低于 spill 的 12500 token 预算；
 * huge：  16000 个互不相同的词（约 11 万字符、数万 token）——超过 spill 预算。
 * 词互不相同是刻意的：重复字符会被估算器压得很低，测不出真实压力。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-big-text'
export const inject = ['tools']

export function makeText(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(' ')
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'big_text',
      description: '产出指定规模的文本，用于观察上下文经济学机制。',
      parameters: {
        size: { type: 'string', required: true, description: 'medium 或 huge' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args: unknown) {
        const { size } = args as { size: string }
        return makeText(size === 'huge' ? 16000 : 3000)
      },
    }),
  )
}
/**
 * word-count —— 最小工具插件（cordis 插件形态）。
 *
 * 三个约定：
 *   - name 只用于诊断/日志，不是工具名；
 *   - inject = ['tools'] 声明依赖，满足后 cordis 才调用 apply；
 *   - 注册是 effect-based 的：插件 fiber 销毁 → 工具自动反注册。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-wordcount'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'word_count',
      description: '统计一段文本的单词数与字符数。',
      parameters: {
        text: { type: 'string', required: true, description: '要统计的文本' },
        caseSensitive: { type: 'boolean', description: '是否区分大小写（影响去重）' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            words: { type: 'number', required: true },
            chars: { type: 'number', required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: `${value.words} 词 / ${value.chars} 字符` }],
      },
      async execute(args: unknown) {
        const { text, caseSensitive } = args as { text: string; caseSensitive?: boolean }
        const source = caseSensitive === true ? text : text.toLowerCase()
        const words = source.trim() === '' ? 0 : source.trim().split(/\s+/).length
        return { words, chars: text.length }
      },
    }),
  )
}
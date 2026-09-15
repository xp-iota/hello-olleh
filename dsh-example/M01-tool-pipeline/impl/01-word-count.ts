/**
 * M01.1 · 给模型注册一个可见工具（word_count）。
 *
 * 这是 dsh 最常见的扩展：模型在 System Prompt 里看到这个工具的 schema，
 * 就能自主决定何时调用它。`defineTool` 会从 `parameters` 推断出 `execute(args)`
 * 的强类型；`output.schema` 是"规范的(canonical) JSON 返回值"，`output.render`
 * 把它渲染成模型可读的内容块。
 *
 * 关键点：
 *   - `inject = ['tools']` 声明本插件依赖 ctx.tools（cordis 依赖注入）。
 *   - 注册是 effect-based 的：插件 fiber 销毁 → 工具自动反注册（天然热重载）。
 *   - 抛异常或返回不合法的值 = isError；正常业务结果应放进 canonical 值里。
 *   - 尊重 `exec.signal`：模型/用户取消时应中止在途工作。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

// `name` 是 Cordis 给这个插件/Fiber 使用的标识，只影响诊断和日志，不是工具名。
// `inject` 声明启动前必须先有 `ctx.tools`；满足依赖后 Cordis 才会调用下面的 apply。
export const name = 'tool-wordcount'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'word_count',
    description: '统计一段文本的单词数与字符数。', // ← 这句是模型看到的说明

    // 参数 schema：required 显式写，其余默认可选
    parameters: {
      text: { type: 'string', required: true, description: '要统计的文本' },
      caseSensitive: { type: 'boolean', description: '是否区分大小写（影响去重词数）' },
    },

    // 返回值的规范 schema + 给模型看/给人看的渲染
    // 注意真实 DSL 的两条硬要求：object 必须显式写 `additionalProperties`，
    // 必填字段写在**每个 property 上**（`required: true`），不是 JSON Schema 的 required 数组。
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

    // args 已被自动校验，类型来自上面的 parameters：{ text: string; caseSensitive?: boolean }
    async execute(args, exec) {
      // 简单演示：取消信号已触发就尽早退出
      if (exec.signal.aborted) throw new Error('aborted')

      const source = args.caseSensitive ? args.text : args.text.toLowerCase()
      const words = source.trim() ? source.trim().split(/\s+/).length : 0
      return { words, chars: args.text.length }
    },
  }))
}

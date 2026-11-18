/**
 * probe-tools —— 六个探针工具，函数体记录执行顺序。
 *
 * 护栏断言的关键证据在这里产生：每个工具函数体开始时检查「护栏日志是否已经
 * 写出」（guardrailLines 由 index.ts 的 stdout 包装器填充），并把执行事实记进
 * bodyOrder——被拦截的工具绝不应出现在 bodyOrder 里。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'probe-tools'
export const inject = ['tools']

/** index.ts 的 stdout 包装器把护栏日志行推进这里。 */
export const guardrailLines: string[] = []
/** 真正执行过的工具函数体（按顺序）。 */
export const bodyOrder: string[] = []
/** 每个工具函数体开始时，护栏日志是否已在场。 */
export const bodySawGuardrail: Record<string, boolean> = {}

function markBody(tool: string): void {
  bodySawGuardrail[tool] = guardrailLines.some(line => line.includes(`tool=${tool}`))
  bodyOrder.push(tool)
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'demo_echo',
      description: '回显文本；参数里的敏感键用于验证护栏脱敏。',
      parameters: {
        text: { type: 'string', required: true, description: '要回显的文本' },
        apiKey: { type: 'string', description: '敏感键（应被脱敏）' },
        authorization: { type: 'string', description: '敏感键（应被脱敏）' },
        maxTokens: { type: 'number', description: '预算字段（不应被 token 规则误伤）' },
      },
      output: {
        schema: { type: 'object', properties: { echo: { type: 'string', required: true } }, additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: `echo: ${value.echo}` }],
      },
      async execute(args: unknown) {
        markBody('demo_echo')
        return { echo: (args as { text: string }).text }
      },
    }),
  )

  for (const tool of ['demo_danger', 'demo_shell', 'demo_ask', 'demo_cancel', 'demo_guarded'] as const) {
    ctx.tools.register(
      defineTool({
        name: tool,
        description: `策略探针：${tool}。`,
        parameters: {
          command: { type: 'string', description: '可选命令文本（用于危险模式匹配）' },
        },
        output: {
          schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } }, additionalProperties: false },
          render: () => [{ type: 'text', text: `${tool} body ran` }],
        },
        async execute() {
          markBody(tool)
          return { ok: true }
        },
      }),
    )
  }
}
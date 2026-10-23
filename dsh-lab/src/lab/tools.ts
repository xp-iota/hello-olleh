/**
 * tools.ts —— 阶段脚本共用的工具调用辅助。
 *
 * 把 `ctx.tools.execute()` 的返回（`ToolExecutionResult`，content 是 block 数组）
 * 压成一行可打印的文本，避免每个阶段都重复写一遍投影逻辑。
 *
 * @module dsh-lab/lab/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-tools'

/** 一次调用的精简结果。 */
export interface CalledTool {
  readonly isError: boolean
  readonly content: string
  /** 成功时的规范值（canonical JSON value）。 */
  readonly value: unknown
}

/** 把 content block 数组拼成一行文本。 */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : `[${block?.type ?? '?'}]`))
    .join(' ')
}

/**
 * 调用一个已注册的工具（不经过模型）。
 *
 * @param ctx - 服务树。
 * @param name - 工具名。
 * @param args - 参数（会被工具自己的 schema 校验）。
 * @param agent - 可选调用方；沙箱与作用域收紧按它判定。
 */
export async function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<CalledTool> {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`lab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    name,
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
    signal: new AbortController().signal,
  })
  const isError = result.isError === true
  return {
    isError,
    content: blocksToText(result.content),
    value: isError ? undefined : (result as { value?: unknown }).value,
  }
}

/** 截断到一行，便于日志。 */
export function preview(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}

/**
 * tools.ts —— 阶段脚本共用的工具调用辅助。
 *
 * 0.2.2 起 `ctx.tools.execute()` 的输入是一整批模型原始调用（`ToolBatchInput`，
 * `calls` 里是 `ToolCallBlock`，参数为 JSON 字符串），返回 `ToolBatchResult`。
 * 本文件把"单次调用"这层便利封装固定下来，阶段代码仍然只关心一次调用的结果。
 *
 * @module dsh-lab/lab/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
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
 * 执行一个已注册的工具（不经过模型），返回原生 `ToolExecutionResult`。
 *
 * 0.2.2 的批接口要求 `ToolCallBlock.arguments` 是**模型产出的 JSON 字符串**，
 * 所以这里做一次 `JSON.stringify`：这是真实的协议形状，不是适配层的权宜之计。
 *
 * @param ctx - 服务树。
 * @param name - 工具名。
 * @param args - 参数（会被工具自己的 schema 校验）。
 * @param agent - 可选调用方；沙箱与作用域收紧按它判定。
 */
export async function executeTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId(`lab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        name,
        arguments: args === undefined ? '{}' : JSON.stringify(args),
      },
    ],
    ...(agent === undefined ? {} : { agent }),
    signal: new AbortController().signal,
  })
  const settled = batch.results[0]
  if (settled === undefined) throw new Error(`工具 ${name} 没有返回结果（批次为空）`)
  return settled.result
}

/**
 * 调用一个已注册的工具（不经过模型），并压成一行可打印结果。
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
  const result = await executeTool(ctx, name, args, agent)
  const isError = result.isError === true
  return {
    isError,
    content: blocksToText(result.content),
    value: isError ? undefined : result.value,
  }
}

/** 截断到一行，便于日志。 */
export function preview(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}

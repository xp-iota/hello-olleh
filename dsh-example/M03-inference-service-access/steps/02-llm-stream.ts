/**
 * 20 · llm/stream waterfall：拦截一次模型调用的 chunk 流。
 *
 * `ctx.llm.stream()` 不是直透适配器：它经 `llm/stream` waterfall 派发。
 * 监听者拿到 `(options, next)`：
 *   - `next()` 得到下游（最终是适配器）的 chunk 流，可以**包装**它（改写/记录/限流）；
 *   - 不调 `next()` 直接返回自己的流 = 整段接管（缓存命中、审查拦截、replay）。
 *
 * 注意真实签名里 `next()` 返回的是 `AsyncIterable<StreamChunk>` 本身（不是 Promise），
 * 监听者返回值也是 `AsyncIterable<StreamChunk>`。
 *
 * 本例注册两个监听者：外层把 text-delta 转大写（包装），内层统计 chunk 数与 usage（观察）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

// 插件名只是诊断标识；模型路由名仍由请求的 options.model/provider 决定。
// 依赖 llm 后才能安全注册 llm/stream waterfall 监听器。
export const name = 'llm-stream-intercept'
export const inject = ['llm']

/** 统计口：run.ts 断言用（真实产品里这会是遥测后端的一次上报）。 */
export interface StreamStats {
  chunks: number
  outputTokens: number
}

export const stats: StreamStats = { chunks: 0, outputTokens: 0 }

export function apply(ctx: Context) {
  // 内层（后注册先包住适配器）：观察 + 统计。
  ctx.on('llm/stream', (options, next) => {
    console.log(`  [内层·统计] 请求 model=${options.model}，透传并计数`)
    return (async function* (): AsyncIterable<StreamChunk> {
      for await (const chunk of next()) {
        stats.chunks++
        if (chunk.type === 'usage') stats.outputTokens += chunk.usage.outputTokens
        yield chunk
      }
    })()
  })

  // 外层（先注册先看到流）：把 text-delta 全部转大写。
  ctx.on('llm/stream', (_options, next) => {
    console.log('  [外层·改写] 包装下游流：text-delta → 大写')
    return (async function* (): AsyncIterable<StreamChunk> {
      for await (const chunk of next()) {
        yield chunk.type === 'text-delta' ? { ...chunk, text: chunk.text.toUpperCase() } : chunk
      }
    })()
  })
}

/**
 * 07 · 转换 / 审计工具返回结果。
 *
 * 工具管线里三个"结果侧"扩展点（见 [08] 三段 waterfall）：
 *   - tools/execute      包裹真实派发（超时/重试/指标）——拿到的是可变的 mutableExec
 *   - tools/post-execute 显式转换结果或附加上下文——返回 PostToolDecision
 *   - tools/result       对最终不可变结果做"受 containment 的"观测（审计/度量）
 *
 * PostToolDecision：
 *   { kind:'accept', content?|value?, additionalContexts? }  接受（可替换呈现/规范值/加上下文）
 *   { kind:'block', feedback }                                阻断，把纠正反馈变成一次 error 结果
 *
 * 本例：对 word_count 用 post-execute 追加一条模型可见提示（可见地转换呈现，不改规范值）；
 *       result 做纯审计日志。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'

// 插件名用于诊断；监听 tools/* 事件所需的工具服务由 inject 声明。
// Cordis 会等 ctx.tools 可用后再运行 apply，插件卸载时监听器也会自动移除。
export const name = 'tool-result-transform'
export const inject = ['tools']

export function apply(ctx: Context) {
  // 1) 结果转换：命中 word_count 时，在它的呈现内容后面追加一条提示（保留规范值不变）。
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    if (exec.name === 'word_count') {
      const base = result.content
      return {
        kind: 'accept',
        content: [...base, { type: 'text' as const, text: '\n[post-execute 策略] 已在结果后追加一条模型可见提示' }],
      }
    }
    return next() // 其它工具透传给链上下一个监听者
  })

  // 2) 纯审计：result 的返回类型是 undefined，改动会被忽略——它只能"看"。
  //    这里做的是不可翻案的最终结果观测，适合指标/留痕。
  ctx.on('tools/result', (exec, result) => {
    // 判别字段是 isError（对照 ToolExecutionSuccess / ToolExecutionFailure）。
    const ok = (result as { isError?: boolean }).isError !== true
    console.log(`[audit] 工具 ${exec.name} 结束 → ${ok ? 'ok' : 'error'}`)
  })
}

/**
 * M03 的运行入口：**只跑真实推理服务**。
 *
 *   node M03-inference-service-access/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { createHarness, requireRealCredentials, runModule, userText, type StageSpec } from '../runtime/harness.ts'
import { consumeStream, printProtocolChecks } from './support/consume-stream.ts'

/** 真实专项：用教学阶段相同的 Consumer 消费 anthropic-compat 流。 */
async function runLlmAdapterMinimax(): Promise<void> {
  requireRealCredentials('M03')

  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  const harness = await createHarness()

  console.log('① 已注册的 provider 路由:', harness.ctx.llm.listProviders().map((info) => info.id))
  console.log('② 目标模型:', `anthropic-compat / ${model}`)

  console.log('\n③ 消费 anthropic-compat 路由（真实 HTTP + SSE）:')
  const real = await consumeStream(
    harness.ctx.llm.stream({
      provider: 'anthropic-compat',
      model,
      system: '你是一个演示助手，回答保持一句话。',
      messages: [userText('用一句话介绍 DeepSeek Harness 的 LLM 能力缝。')],
    }),
  )
  console.log('   聚合 assistant 文本:', real.text)
  console.log('   reasoning-delta 字符数:', real.reasoningChars, '（thinking 块会映射成 reasoning-delta，不进入文本面）')
  console.log('   chunk 类型统计:', JSON.stringify(real.counts))
  console.log('   block-start 的 blockType 序列:', JSON.stringify(real.blockTypes))
  console.log('   finish.reason:', JSON.stringify(real.finish))
  console.log('   usage:', JSON.stringify(real.usage))
  printProtocolChecks(real)

  await harness.dispose()

  if (!real.finish || real.usage === undefined || real.text === '' || real.orphanDeltas > 0) {
    throw new Error('anthropic-compat 流未守住 StreamChunk 协议契约 —— LLM seam 未被验证')
  }
}

const stages: readonly StageSpec[] = [
  { id: 'M03.2', title: '用 llm/stream waterfall 包装 chunk 流', kind: 'mechanism', path: './scenes/02-wrap-chunk-stream.ts' },

  // 专项真实演示直接内联。
  { id: 'M03.d', title: '专项真实演示：同一消费循环接真实推理服务', kind: 'model', run: runLlmAdapterMinimax },
]

await runModule('M03', '推理服务接入：Provider 路由与流协议', stages, import.meta.url)

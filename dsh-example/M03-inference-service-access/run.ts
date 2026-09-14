/**
 * M03 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M03-inference-service-access/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M03-inference-service-access/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

/** 真实专项：用教学阶段相同的 Consumer 消费 anthropic-compat 流。 */
async function runLlmAdapterMinimax(): Promise<void> {
  // 保持动态导入：mock 模式会在执行本回调前跳过，不能提前触发真实模式依赖求值。
  const { requireRealCredentials } = await import('../runtime/harness.ts')
  const { createHarness, userText } = await import('../runtime/harness.ts')
  const { consumeStream, printProtocolChecks } = await import('./support/consume-stream.ts')

  requireRealCredentials('M03')

  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  const harness = await createHarness()

  console.log('① 已注册的 provider 路由:', harness.ctx.llm.listProviders().map((info) => info.id))
  console.log('② 目标模型:', `anthropic-compat / ${model}`)

  console.log('\n③ 消费 anthropic-compat 路由（真实 HTTP + SSE）:', '（mock 路由的消费见前置阶段）')
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
  { id: 'M03.1', title: '注册并消费离线 LLM Adapter', kind: 'mechanism', path: './phases/01-consume-chunk-protocol.ts' },
  { id: 'M03.2', title: '用 llm/stream waterfall 包装 chunk 流', kind: 'mechanism', path: './phases/02-wrap-chunk-stream.ts' },

  // 专项真实演示直接内联；mock 模式打印 skip，不调用 run。
  { id: 'M03.d', title: '专项真实演示：同一消费循环接真实推理服务', kind: 'model', run: runLlmAdapterMinimax, realOnly: true },
]

await runModule('M03', '推理服务接入：Provider 路由与流协议', stages, import.meta.url)

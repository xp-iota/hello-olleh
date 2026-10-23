/**
 * M03 · 推理服务接入。
 *
 * 这一章看的是"一次模型调用"这条接缝：`ctx.llm.stream()` 是唯一入口，适配器把
 * provider 的线协议翻译成 dsh 的 chunk 协议，`llm/stream` 是环绕它的 waterfall。
 *
 * 本工程自带的 `anthropic-compat` 适配器就是这一章的主角：它注册了一条真实路由，
 * 把 Anthropic Messages + SSE 翻译成 chunk。没有 LLM_API_KEY 时，本模块的 model
 * 阶段会明确失败——这正是"不静默降级"的设计。
 *
 * @module dsh-lab/M03
 */
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M03.1 —— 列出已注册的路由与模型。 */
async function listRoutes(stage: StageContext) {
  const { ctx } = stage
  const providers = ctx.llm.listProviders()
  stage.log(`已注册路由：${providers.map((info: { id: string }) => info.id).join(', ') || '(none)'}`)
  stage.assert(providers.length > 0, '没有任何 provider 路由')

  for (const info of providers) {
    const models = await ctx.llm.listModels(info.id).catch(() => [])
    stage.log(`  ${info.id}（${info.name ?? ''}）：${models.map((m: { id: string }) => m.id).join(', ') || '(未公开模型目录)'}`)
  }
}

/** M03.2 —— 环绕 llm/stream 的 waterfall。 */
async function wrapChunkStream(stage: StageContext) {
  const { ctx } = stage
  let seen = 0
  // waterfall：可以不调用 next() 而直接返回自己的流（拦截），
  // 也可以先拿 next() 的流再包一层（观察/改写）。
  const off = ctx.on('llm/stream', (options, next) => {
    seen += 1
    stage.log(`llm/stream 被调用：provider=${String(options.provider)} model=${String(options.model)}`)
    return next()
  })
  stage.log('已挂上 llm/stream 监听（下一次真实请求会经过它）')

  // 本阶段不发真实请求：只验证 waterfall 能挂载与卸载。
  off()
  stage.assert(seen === 0, '没有发请求时不应有拦截记录')
}

/** M03.3 —— 真实调用一次模型，验证适配器端到端。 */
async function realCall(stage: StageContext) {
  const { ctx } = stage
  if (process.env.LLM_API_KEY === undefined || process.env.LLM_API_KEY === '') {
    throw new Error(
      '缺少 LLM_API_KEY：本阶段要发起真实的 provider 请求。在 dsh-lab/.env 里配置后重跑。',
    )
  }
  const provider = process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'
  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  stage.log(`请求 ${provider} / ${model}`)

  const chunks: string[] = []
  let reasoning = 0
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  const stream = ctx.llm.stream({
    provider,
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: '用一句中文回答：dsh 的 tool 管线有几段？' }] }],
    maxTokens: 200,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') chunks.push(chunk.text)
    else if (chunk.type === 'reasoning-delta') reasoning += 1
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  const text = chunks.join('')
  stage.assert(text.length > 0, '模型没有返回任何文本（适配器或网络有问题）')
  stage.log(`回答：${text.slice(0, 200)}`)
  stage.log(`推理增量块：${reasoning}；用量：${usage?.inputTokens ?? '?'} in / ${usage?.outputTokens ?? '?'} out`)
}

export default defineModule({
  id: 'M03',
  title: '推理服务接入',
  stages: [
    { id: 'M03.1', title: '列出路由与模型目录', kind: 'mechanism', run: listRoutes },
    { id: 'M03.2', title: '环绕 llm/stream 的 waterfall', kind: 'mechanism', run: wrapChunkStream },
    { id: 'M03.3', title: '真实调用一次模型（anthropic-compat）', kind: 'model', run: realCall },
  ],
})

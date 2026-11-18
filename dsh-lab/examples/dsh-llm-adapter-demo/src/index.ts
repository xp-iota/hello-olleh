/**
 * dsh-llm-adapter-demo —— 模型接入层这条接缝，四个场景：
 *   S1 路由与模型目录：providerInfo / listModels / resolveModel 的发现面；
 *   S2 llm/stream waterfall：环绕每次模型调用的观察/改写缝（脚本化适配器，离线）；
 *   S3 合成 SSE 端到端：stub fetch 喂真实适配器，验证 Anthropic → chunk 翻译层（离线）；
 *   S4 真实调用：需要 LLM_API_KEY（本目录 .env），缺 key 明确失败（fail loud）。
 * 关键认识：ctx.llm.stream() 是唯一入口，适配器把 provider 线协议翻译成 chunk 协议，
 * llm/stream waterfall 环绕它——换网关只改配置，不改管线。
 * 机制路径（--mechanism）跑 S1–S3，全程离线；Node 与 Bun 双运行时。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { loadDotEnv } from './env.ts'
import { ScriptedAdapter } from './plugins/scripted-adapter.ts'

loadDotEnv()

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')
const MECHANISM_ONLY = process.argv.includes('--mechanism')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-llm-adapter-demo', CONFIG,
  loadOverlayPatches('dsh-llm-adapter-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const userMessage = { role: 'user' as const, content: [{ type: 'text' as const, text: '用一句中文回答：dsh 的工具管线有几段？' }] }

// ── S1：路由与模型目录——发现面 ────────────────────────────────────────────
console.log('\n=== S1 路由与模型目录 ===')
{
  const providers = ctx.llm.listProviders()
  console.log(`已注册路由：${providers.map(p => p.id).join(', ')}`)
  assert(providers.some(p => p.id === 'anthropic-compat'), '自写路由应当注册成功')

  const models = await ctx.llm.listModels('anthropic-compat')
  console.log(`模型目录：${models.map(m => m.id).join(', ')}`)
  assert(models.length > 0, '适配器应当公开模型目录')

  const info = await ctx.llm.resolveModelInfo('anthropic-compat', models[0].id)
  console.log(`resolveModelInfo：id=${info.id}，defaultMaxTokens=${info.defaultMaxTokens ?? '(未声明)'}`)
  assert(info.id === models[0].id && info.provider === 'anthropic-compat', '模型元数据形状不符')
}

// ── S2：llm/stream waterfall——环绕每次模型调用 ────────────────────────────
console.log('\n=== S2 llm/stream waterfall ===')
const releaseScripted = ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())
{
  let seen = 0
  let chunks = 0
  // waterfall：拿 next() 的流再包一层（观察/改写）；不调 next() 直接返回自己的流则是拦截。
  const off = ctx.on('llm/stream', (options, next) => {
    seen += 1
    console.log(`llm/stream 命中：provider=${String(options.provider)} model=${String(options.model)}`)
    const upstream = next()
    return (async function* () {
      for await (const chunk of upstream) {
        chunks += 1
        yield chunk
      }
    })()
  })

  const texts: string[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'lab-scripted', model: 'seed', messages: [userMessage] })) {
    if (chunk.type === 'text-delta') texts.push(chunk.text)
  }
  off()
  console.log(`waterfall 命中 ${seen} 次，经手 ${chunks} 个 chunk，文本长度=${texts.join('').length}`)
  assert(seen === 1 && chunks === 5 && texts.join('').length > 0, 'waterfall 应当环绕真实流')
}
releaseScripted()

// ── S3：合成 SSE 端到端——stub fetch 喂真实适配器 ──────────────────────────
console.log('\n=== S3 合成 SSE 端到端（离线）===')
{
  // 一段合法的 Anthropic Messages SSE：message_start → text block → delta×2 →
  // block_stop → message_delta(end_turn) → message_stop。
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_stub","model":"stub-model","usage":{"input_tokens":12,"output_tokens":0}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好，"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"护栏。"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n')

  const originalFetch = globalThis.fetch
  let wireUrl = ''
  let wireHeaders: Record<string, string> = {}
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    wireUrl = String(input)
    wireHeaders = (init?.headers ?? {}) as Record<string, string>
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  // 合成路径也需要一个 key 形状的值（只验证翻译层，不发真实请求）。
  const originalKey = process.env.LLM_API_KEY
  process.env.LLM_API_KEY = 'stub-key-offline'

  try {
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'anthropic-compat', model: 'stub-model', messages: [userMessage], maxTokens: 64,
    })) {
      chunks.push(chunk)
    }
    const text = chunks.filter(c => c.type === 'text-delta').map(c => (c as { text: string }).text).join('')
    const finish = chunks.find(c => c.type === 'finish') as { reason: { kind: string } } | undefined
    const usage = chunks.find(c => c.type === 'usage') as { usage: { inputTokens: number; outputTokens: number } } | undefined
    console.log(`线协议端点：${wireUrl}`)
    console.log(`归属头在场：${Object.keys(wireHeaders).some(k => k.toLowerCase() === 'user-agent')}，x-api-key 在场=${'x-api-key' in wireHeaders}`)
    console.log(`翻译结果：text=${text}，finish=${finish?.reason.kind}，usage=${usage?.usage.inputTokens} in / ${usage?.usage.outputTokens} out`)
    assert(wireUrl.endsWith('/v1/messages'), '应当请求 Anthropic Messages 端点')
    assert(text === '你好，护栏。' && finish?.reason.kind === 'stop', 'SSE → chunk 翻译不符')
    assert(usage?.usage.inputTokens === 12 && usage.usage.outputTokens === 7, '用量应当从 SSE 事件累计')
    assert(Object.keys(wireHeaders).some(k => k.toLowerCase() === 'user-agent'), '每个请求必须带归属头')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.LLM_API_KEY
    else process.env.LLM_API_KEY = originalKey
  }
}

// ── S4：真实调用——需要 key，缺 key 明确失败 ───────────────────────────────
if (MECHANISM_ONLY) {
  console.log('\n=== S4 真实调用：--mechanism 跳过（机制路径不需要 key）===')
} else {
  console.log('\n=== S4 真实调用 ===')
  const key = process.env.LLM_API_KEY
  if (key === undefined || key === '') {
    throw new Error(
      '缺少 LLM_API_KEY：S4 要发起真实的 provider 请求。复制 .env.example 为 .env 并填入 key 后重跑；' +
      '只跑机制路径请用 npm run mechanism（不需要 key）。',
    )
  }
  const provider = process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'
  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  console.log(`请求 ${provider} / ${model}`)
  const texts: string[] = []
  let reasoning = 0
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  // 旧 M03.3 用 maxTokens:200，fuyao 网关的模型会把预算花在 thinking 块上导致
  // 空回答——实测 1024 仍然全部花在推理上（finish=max-tokens，无文本），
  // 给到 8192（与适配器 defaultMaxTokens 一致）才有正文；README 如实记录。
  for await (const chunk of ctx.llm.stream({ provider, model, messages: [userMessage], maxTokens: 8192 })) {
    if (chunk.type === 'text-delta') texts.push(chunk.text)
    else if (chunk.type === 'reasoning-delta') reasoning += 1
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  const text = texts.join('')
  assert(text.length > 0, '模型没有返回任何文本（适配器或网络有问题）')
  console.log(`回答：${text.slice(0, 200)}`)
  console.log(`推理增量块：${reasoning}；用量：${usage?.inputTokens ?? '?'} in / ${usage?.outputTokens ?? '?'} out`)
}

await ctx.fiber.dispose()
console.log('\nLLM_ADAPTER_OK')
/**
 * 模块 M03 的对应阶段 的**真实推理服务版**：`node M03-inference-service-access/run-real.ts`
 * （或用根目录 `npm run M03:real`）。
 *
 * 与 `run.ts` 共用**同一个**消费循环（consume.ts）——"换 provider 不换 Consumer"
 * 在这里被直接演示：差异只有 llm.stream() 的 `provider` 从 'mock' 换成 'anthropic-compat'，
 * 后者是 harness 检测到 LLM_API_KEY 时注册的真实适配器（见 runtime/llm-minimax.ts，
 * MiniMax 的 Anthropic 兼容端点，真实 HTTP + SSE）。
 *
 * mock 路由的离线消费与逐 chunk 协议追踪集中在 run.ts（离线套件只跑它）；本脚本
 * 只消费 `anthropic-compat` 路由，与 run.ts 的 mock 段共用同一组协议检查断言。
 *
 * ⚠️ 本脚本会发起**真实网络请求并消耗额度**，且需要 `LLM_API_KEY`；
 * 离线套件 `npm run all` 只跑各示例的 `run.ts`，不会碰到这里。
 */
import { createHarness, userText } from '../../runtime/harness.ts'
import { consumeStream, printProtocolChecks } from '../support/consume-stream.ts'

// runtime/harness.ts 启动时也会加载工程根 .env；这里先加载一次，
// 好在装配 harness 之前就把"密钥没配"这件事说清楚。
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch { /* 没有 .env：继续看进程环境变量 */ }

if (!process.env.LLM_API_KEY) {
  console.error('✗ 缺少 LLM_API_KEY。')
  console.error('  复制 .env.example 为 .env 并填入推理服务密钥，或在命令前临时注入：')
  console.error('  LLM_API_KEY=<your-key> npm run M03:real')
  process.exit(1)
}

const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
// 'mock' 路由由 harness 内置适配器占位（本插件如何在 'mock' 路由上注册与被消费，见 run.ts）；
// 'anthropic-compat' 路由由 harness 检测到密钥后注册 —— 本脚本只消费真实路由，不需要示例插件。
const harness = await createHarness()

console.log('① 已注册的 provider 路由:', harness.ctx.llm.listProviders().map((info) => info.id))
console.log('② 目标模型:', `anthropic-compat / ${model}`)

// —— 消费 anthropic-compat 路由（真实 HTTP + SSE）——
// 消费代码与 run.ts 的 mock 段共用同一个 consumeStream()，只有 stream() 的入参不同。
console.log('\n③ 消费 anthropic-compat 路由（真实 HTTP + SSE）:', '（mock 路由的消费见 run.ts）')
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

// fail loud：本例的全部意义就是"同一份契约在真实 provider 上同样成立"。
// 流没有 finish、没有 usage、没产出文本或 index 协议被破坏，都算链路未验证。
if (!real.finish || real.usage === undefined || real.text === '' || real.orphanDeltas > 0) {
  throw new Error('anthropic-compat 流未守住 StreamChunk 协议契约 —— LLM seam 未被验证')
}

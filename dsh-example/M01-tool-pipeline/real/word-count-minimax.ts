/**
 * 模块 M01 的对应阶段 的**真实推理服务版**：`node M01-tool-pipeline/run.ts`
 * （或用根目录 `npm run M01`）。
 *
 * 与 `run.ts` 的区别只有一处：`run.ts` 是**我们**直接 `callTool('word_count', ...)`，
 * 这里换成**模型自己决定要不要调**。provider 路由指到 `anthropic-compat`
 * （真实适配器见 `runtime/llm-minimax.ts`，MiniMax 的 Anthropic 兼容端点），
 * 于是链路变成：
 *
 *   word_count 的 description + parameters schema 汇入 System Prompt
 *     → MiniMax 读到这个工具，第一步 finish 出 `{kind:'tool-calls'}` + tool-call 块
 *     → 真实 agent-loop 派发 `ctx.tools.execute` 跑我们的 execute()
 *     → 工具结果按 output.render 回灌成模型可见文本
 *     → MiniMax 第二步基于结果收尾成自然语言
 *
 * 也就是说 01 里注册的那个工具，**不需要为了对接模型再写任何胶水代码**。
 *
 * ⚠️ 本例会发起**真实网络请求并消耗额度**，且需要 `LLM_API_KEY`；
 * 本文件是 `run.ts` 的 `M01.d` 阶段；`--mock` 下该阶段直接跳过，不执行到这里。
 */
import { requireRealCredentials } from '../../runtime/env.ts'
import { createHarness } from '../../runtime/harness.ts'
import * as wordcountPlugin from '../steps/01-word-count.ts'

// 真实模式前置检查：加载 .env，缺密钥当场退出（逻辑只有 runtime/env.ts 一份）。
requireRealCredentials('M01')

/** 一条**必须动用 word_count 才能答对**的 query：明确禁止模型自己数。 */
const QUERY = [
  '请统计这句话的词数和字符数：',
  '"DeepSeek Harness makes every tool call observable"',
  '。必须调用 word_count 工具来算，不要自己数，最后用一句中文报出结果。',
].join('')

const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
// 插件放在 plugins 里 → 在 agent 建立之前就注册好，模型第一步就能看见这个工具。
const harness = await createHarness({
  provider: 'anthropic-compat',
  model,
  plugins: [[wordcountPlugin]],
})

console.log('① 推理服务:', `anthropic-compat / ${model}`, '（真实 HTTP + SSE）')
console.log('② 模型可见工具:', harness.visibleTools())
console.log('③ 用户 query:', QUERY)

const { text, steps, session } = await harness.runTurn({ prompt: QUERY })

// 从**真实会话日志**里读工具调用证据，而不是靠适配器自报。
// 模型发起的 tool-call 与回灌的 tool-result 都以消息块形式落在日志上。
const toolCalls: Array<{ name: string; args: string }> = []
const toolResults: string[] = []
for (const event of session.snapshotEvents()) {
  const content = (event.data as any)?.message?.content
  if (!Array.isArray(content)) continue
  for (const block of content) {
    if (block?.type === 'tool-call') {
      toolCalls.push({ name: String(block.name), args: String(block.arguments) })
    }
    if (block?.type === 'tool-result') {
      const rendered = (block.content ?? [])
        .map((inner: any) => (inner?.type === 'text' ? inner.text : inner?.type))
        .join(' | ')
      toolResults.push(`isError=${block.isError ?? false} · ${rendered}`)
    }
  }
}

console.log('④ 模型发起的工具调用:', toolCalls.length === 0 ? '(无)' : '')
for (const call of toolCalls) console.log(`   → ${call.name} ${call.args}`)
console.log('⑤ 工具结果回灌给模型:', toolResults.length === 0 ? '(无)' : '')
for (const result of toolResults) console.log(`   → ${result}`)
console.log('⑥ 模型最终回答:', JSON.stringify(text))
console.log('⑦ 本轮 step 数:', steps, '（工具调用会多出一步：调用步 + 收尾步）')

await harness.dispose()

// fail loud：本例的全部意义就是"模型自己调了这个工具"。
// 没调到通常意味着 query 不够明确或模型改了主意，而不是链路可用。
if (!toolCalls.some((call) => call.name === 'word_count')) {
  throw new Error('MiniMax 本轮没有调用 word_count —— 工具链路未被验证')
}

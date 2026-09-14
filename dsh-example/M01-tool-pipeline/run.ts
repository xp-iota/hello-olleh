/**
 * M01 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M01-tool-pipeline/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M01-tool-pipeline/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

/** 真实专项：让模型自主决定调用 word_count，并从会话日志核验调用证据。 */
async function runWordCountMinimax(): Promise<void> {
  // 保持动态导入：mock 模式会在执行本回调前跳过，不能提前触发真实模式依赖求值。
  const { requireRealCredentials } = await import('../runtime/harness.ts')
  const { createHarness } = await import('../runtime/harness.ts')
  const wordcountPlugin = await import('./steps/01-word-count.ts')

  requireRealCredentials('M01')

  /** 一条必须动用 word_count 才能答对的 query：明确禁止模型自己数。 */
  const query = [
    '请统计这句话的词数和字符数：',
    '"DeepSeek Harness makes every tool call observable"',
    '。必须调用 word_count 工具来算，不要自己数，最后用一句中文报出结果。',
  ].join('')

  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  // 插件在 agent 建立前注册，模型第一步就能看见 word_count。
  const harness = await createHarness({
    provider: 'anthropic-compat',
    model,
    plugins: [[wordcountPlugin]],
  })

  console.log('① 推理服务:', `anthropic-compat / ${model}`, '（真实 HTTP + SSE）')
  console.log('② 模型可见工具:', harness.visibleTools())
  console.log('③ 用户 query:', query)

  const { text, steps, session } = await harness.runTurn({ prompt: query })

  // 从真实会话日志读取工具调用与结果回灌证据，不依赖适配器自报。
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

  if (!toolCalls.some((call) => call.name === 'word_count')) {
    throw new Error('MiniMax 本轮没有调用 word_count —— 工具链路未被验证')
  }
}

const stages: readonly StageSpec[] = [
  { id: 'M01.1', title: '注册工具与 Fiber 回收', kind: 'mechanism', path: './phases/01-register-and-dispose.ts' },
  { id: 'M01.2', title: 'pre-execute 权限门', kind: 'mechanism', path: './phases/02-deny-bash-call.ts' },
  { id: 'M01.3', title: 'post-execute 结果变换', kind: 'mechanism', path: './phases/03-append-model-notice.ts' },
  { id: 'M01.4', title: '按 Agent 收紧可见工具', kind: 'mechanism', path: './phases/04-narrow-visible-set.ts' },
  { id: 'M01.5', title: '不可翻案的单调守卫', kind: 'mechanism', path: './phases/05-guard-overrides-allow.ts' },

  // 专项真实演示直接内联；mock 模式打印 skip，不调用 run。
  { id: 'M01.d', title: '专项真实演示：模型自主决定调用 word_count', kind: 'model', run: runWordCountMinimax, realOnly: true },
]

await runModule('M01', '工具管线：从注册、可见性到执行前后策略', stages, import.meta.url)

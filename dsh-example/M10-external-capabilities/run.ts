/**
 * M10 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M10-external-capabilities/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M10-external-capabilities/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

/** 真实专项：对照同一请求在注入 SKILL.md 前后的真实模型输出。 */
async function runSkillCodeReviewMinimax(): Promise<void> {
  // 保持动态导入：mock 模式会在执行本回调前跳过，不能提前触发真实模式依赖求值。
  const { requireRealCredentials } = await import('../runtime/harness.ts')
  const { createHarness } = await import('../runtime/harness.ts')
  const { PROMPT, checkFormat, invokeSkill, registerSkill } = await import('./steps/01-skill-code-review.ts')

  requireRealCredentials('M10')

  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  console.log('目标模型: anthropic-compat /', model, '（真实 HTTP + SSE）')

  /** 跑一个真实 turn；withSkill=true 时先把 SKILL.md 正文注入下一步上下文。 */
  async function review(sessionId: string, withSkill: boolean): Promise<string> {
    const harness = await createHarness({
      provider: 'anthropic-compat',
      model,
      sessionId: sessionId as import('@deepseek-ai/dsh-session').SessionId,
    })
    if (withSkill) invokeSkill(harness, await registerSkill(harness))
    const outcome = await harness.runTurn({ prompt: PROMPT })
    await harness.dispose()
    return outcome.text
  }

  console.log('\n① A 组：不注入 skill')
  const plain = await review('demo-review-plain', false)
  console.log(plain.split('\n').map((line) => '   ' + line).join('\n'))
  const plainChecks = checkFormat(plain)
  console.log('   → 第一行是结论 =', plainChecks.verdictFirst, '| 清单条目数 =', plainChecks.findings)

  console.log('\n② B 组：注入 SKILL.md 正文（同一段 diff、同一句请求）')
  const guided = await review('demo-review-skill', true)
  console.log(guided.split('\n').map((line) => '   ' + line).join('\n'))
  const guidedChecks = checkFormat(guided)
  console.log('   → 第一行是结论 =', guidedChecks.verdictFirst, '| 清单条目数 =', guidedChecks.findings)
  console.log('   → 严重性顺序 =', JSON.stringify(guidedChecks.severities))

  if (!guidedChecks.verdictFirst || guidedChecks.findings === 0) {
    throw new Error('注入 skill 后模型没有按清单格式作答 —— 数据扩展的效果未被验证')
  }
}

const stages: readonly StageSpec[] = [
  { id: 'M10.1', title: '注册、发现并注入代码审查 Skill', kind: 'model', path: './phases/01-inject-skill-into-turn.ts' },
  { id: 'M10.2', title: '跨进程 MCP：真实成功往返与明确拒绝', kind: 'mechanism', path: './phases/02-mcp-round-trip.ts' },
  { id: 'M10.3', title: '检查 Webhook Host-plane 组合边界', kind: 'mechanism', path: './phases/03-check-webhook-boundary.ts' },
  { id: 'M10.4', title: '装配动态 Cordis 扩展工具', kind: 'mechanism', path: './phases/04-mount-dynamic-tool.ts' },
  { id: 'M10.5', title: '配置 Webhook 所需默认模型路由', kind: 'mechanism', path: './phases/05-route-default-model.ts' },

  // 专项真实演示直接内联；mock 模式打印 skip，不调用 run。
  { id: 'M10.d', title: '专项真实演示：注入 SKILL.md 前后的真实作答对照', kind: 'model', run: runSkillCodeReviewMinimax, realOnly: true },
]

await runModule('M10', '外部能力接入：知识、协议、Webhook 与动态扩展', stages, import.meta.url)

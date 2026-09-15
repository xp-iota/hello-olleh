/**
 * M10 的运行入口：**只跑真实推理服务**。
 *
 *   node M10-external-capabilities/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import { createHarness, requireRealCredentials, runModule, type StageSpec } from '../runtime/harness.ts'
import { PROMPT, checkFormat, invokeSkill, registerSkill } from './impl/01-skill-code-review.ts'

/** 真实专项：对照同一请求在注入 SKILL.md 前后的真实模型输出。 */
async function runSkillCodeReviewMinimax(): Promise<void> {
  requireRealCredentials('M10')

  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  console.log('目标模型: anthropic-compat /', model, '（真实 HTTP + SSE）')

  /** 跑一个真实 turn；withSkill=true 时先把 SKILL.md 正文注入下一步上下文。 */
  async function review(sessionId: string, withSkill: boolean): Promise<string> {
    const harness = await createHarness({
      provider: 'anthropic-compat',
      model,
      sessionId: sessionId as SessionId,
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
  { id: 'M10.1', title: '注册、发现并注入代码审查 Skill', kind: 'model', path: './scenes/01-inject-skill-into-turn.ts' },
  { id: 'M10.2', title: '跨进程 MCP：真实成功往返与明确拒绝', kind: 'mechanism', path: './scenes/02-mcp-round-trip.ts' },
  { id: 'M10.3', title: '检查 Webhook Host-plane 组合边界', kind: 'mechanism', path: './scenes/03-check-webhook-boundary.ts' },
  { id: 'M10.4', title: '装配动态 Cordis 扩展工具', kind: 'mechanism', path: './scenes/04-mount-dynamic-tool.ts' },
  { id: 'M10.5', title: '配置 Webhook 所需默认模型路由', kind: 'mechanism', path: './scenes/05-route-default-model.ts' },

  // 专项真实演示直接内联。
  { id: 'M10.d', title: '专项真实演示：注入 SKILL.md 前后的真实作答对照', kind: 'model', run: runSkillCodeReviewMinimax },
]

await runModule('M10', '外部能力接入：知识、协议、Webhook 与动态扩展', stages, import.meta.url)

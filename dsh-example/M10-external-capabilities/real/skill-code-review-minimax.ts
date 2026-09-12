/**
 * 模块 M10 的对应阶段 的**真实推理服务版**：`node M10-external-capabilities/run-real.ts`
 * （或用根目录 `npm run M10:real`）。
 *
 * 同一段 diff、同一句请求，跑**两个真实 turn**做对照：
 *   A 组：不装 skill —— 模型按自己的习惯答；
 *   B 组：注入 `SKILL.md` 正文 —— 模型按清单的硬格式答。
 * 两组共用 `review.ts` 的注册/渲染/注入代码，差异只有\"有没有 inject 那一下\"，
 * 所以\"一份 Markdown 改变了模型行为\"在这里是可核对的事实，而不是一句口号。
 *
 * ⚠️ 本脚本会发起**真实网络请求并消耗额度**，且需要 `MINIMAX_API_KEY`；
 * 离线套件 `npm run all` 只跑各示例的 `run.ts`，不会碰到这里。
 */
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createHarness } from '../../runtime/harness.ts'
import { PROMPT, checkFormat, invokeSkill, registerSkill } from '../steps/01-skill-code-review.ts'

// runtime/harness.ts 启动时也会加载工程根 .env；这里先加载一次，
// 好在装配 harness 之前就把"密钥没配"这件事说清楚。
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch { /* 没有 .env：继续看进程环境变量 */ }

if (!process.env.MINIMAX_API_KEY) {
  console.error('✗ 缺少 MINIMAX_API_KEY。')
  console.error('  复制 .env.example 为 .env 并填入 MiniMax 平台密钥，或在命令前临时注入：')
  console.error('  MINIMAX_API_KEY=<your-key> npm run M10:real')
  process.exit(1)
}

const model = process.env.MINIMAX_MODEL ?? 'MiniMax-M3'
console.log('目标模型: minimax-m3 /', model, '（真实 HTTP + SSE）')

/** 跑一个真实 turn；withSkill=true 时先把 SKILL.md 正文注入下一步上下文。 */
async function review(sessionId: string, withSkill: boolean) {
  const harness = await createHarness({ provider: 'minimax-m3', model, sessionId: sessionId as SessionId })
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

// fail loud：B 组必须落在清单要求的格式里，否则这条数据扩展链路没有被验证。
if (!guidedChecks.verdictFirst || guidedChecks.findings === 0) {
  throw new Error('注入 skill 后模型没有按清单格式作答 —— 数据扩展的效果未被验证')
}

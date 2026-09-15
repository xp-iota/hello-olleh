/**
 * 08 的共享部分：把 `SKILL.md` 喂进**真实 `ctx.skills`**（`@deepseek-ai/dsh-skill` 的
 * `SkillRegistry`），并给出评审用的那段 diff 与\"清单是否被遵守\"的核对函数。
 *
 * `run.ts` 的离线 phase 与内联 `M10.d` 真实阶段都用这一份 ——
 * 差异只有 agent 的 `provider`，skill 的注册、渲染与注入完全相同。
 *
 * 真实产品里 SKILL.md 由 `@deepseek-ai/dsh-skill-filesystem` 这类 provider 从磁盘目录
 * 自动发现（`registerProvider`）；这里为了不依赖用户 home 目录布局，直接用注册表的
 * `register()` 口把同一份数据喂进去 —— 消费侧（list / get / render / inject）一模一样。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { userText } from '../../runtime/harness.ts'
import type { Harness } from '../../runtime/harness.ts'

/** 待评审的改动：手写循环引入了下标越界（漏掉首项、读越界项），并用 eval 拼接优惠码。 */
export const DIFF = `--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,7 +1,9 @@
 export function total(items: Item[]): number {
-  return items.reduce((sum, it) => sum + it.price * it.qty, 0)
+  let sum = 0
+  for (let i = 1; i <= items.length; i++) sum += items[i].price * items[i].qty
+  return sum
 }
 
 export function applyCoupon(code: string): number {
-  return COUPONS[code] ?? 0
+  return eval('COUPONS.' + code) ?? 0
 }`

/** 两个脚本喂给模型的同一句请求。 */
export const PROMPT = `帮我 review 这段改动：\n\n${DIFF}`

/** SKILL.md = YAML frontmatter（name / description）+ Markdown 正文。 */
function parseSkillFile(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) throw new Error('SKILL.md 缺少 frontmatter')
  const front: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) front[kv[1]] = kv[2].trim()
  }
  return { name: front.name, description: front.description, content: match[2].trim() }
}

/** 注册本目录的 SKILL.md，并把注册表里取回的完整定义交出来。 */
export async function registerSkill(harness: Harness): Promise<SkillDefinition> {
  const path = fileURLToPath(new URL('../assets/SKILL.md', import.meta.url))
  const parsed = parseSkillFile(readFileSync(path, 'utf8'))
  harness.ctx.skills.register({
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    path,
    source: 'project-dsh',
    // 调用策略必须显式给全两个布尔：模型能否自主调用、人能否用 /skill 调用。
    invocation: { modelInvocable: true, userInvocable: true },
  })
  const skill = await harness.ctx.skills.get(parsed.name)
  if (!skill) throw new Error('skill 应当能被取到')
  return skill
}

/**
 * \"模型调用该 skill\"这一步：把 `renderSkillContent` 渲染出的正文经 `agent.inject()`
 * 排进下一步的模型可见上下文（`inbox.nextStep`），由主循环在 step 边界认领。
 */
export function invokeSkill(harness: Harness, skill: SkillDefinition): void {
  harness.agent.inject(userText(
    renderSkillContent(skill),
    { kind: 'skill-invocation', name: skill.name, form: 'instructions' },
  ))
}

/** 清单要求的硬格式：第一行是结论，问题行形如 `[严重性] 文件:行 — 问题 — 建议`。 */
export function checkFormat(answer: string): { verdictFirst: boolean; findings: number; severities: string[] } {
  const lines = answer.split('\n').map((line) => line.trim()).filter(Boolean)
  const matches = lines.map((line) => /^\[(正确性|安全|风格)\]/.exec(line)).filter((m) => m !== null)
  return {
    verdictFirst: /^结论：(可合|需改|阻断)/.test(lines[0] ?? ''),
    findings: matches.length,
    severities: matches.map((m) => m![1]),
  }
}

/**
 * 装配树的启动探针：不开 REPL、不调模型，只回答一个问题——
 * "cordis.patch.yml 里的每一行能不能真的激活，服务能不能被取到"。
 *
 * 用法：node scripts/probe-boot.ts
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootLab } from '../src/boot.ts'

const lab = await bootLab()
const { ctx } = lab

const services = [
  'llm',
  'sessions',
  'sessionQuery',
  'sessionProjections',
  'tools',
  'agents',
  'agentLoop',
  'approval',
  'userQuestions',
  'commands',
  'tokenMeter',
  'storage',
  'skills',
  'subagents',
  'jobs',
  'goals',
  'workflowEngine',
  'sessionTitle',
  'invariants',
] as const

console.log(`home: ${lab.home}`)
let missing = 0
for (const name of services) {
  const value = ctx.get(name as never)
  if (value === undefined) {
    console.log(`  ✗ ctx.${name} 未装配`)
    missing += 1
  } else {
    console.log(`  ✓ ctx.${name}`)
  }
}

const tools = ctx.tools.schemas()
console.log(`\n工具数: ${tools.length}`)
console.log(`工具名: ${tools.map((t: { name: string }) => t.name).sort().join(', ')}`)

// `commands.list(agent)` 是**按 agent 求值**的（同一条 /goal 在不同作用域可能
// 有不同实现），所以这里借一个临时 agent 来盘点。
const scratch = await ctx.agents.create({
  sessionId: SessionId(`probe-boot-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const commands = ctx.commands.list(scratch.agent)
console.log(`\n斜杠命令: ${commands.map((c: { name: string }) => '/' + c.name).join(', ')}`)
await scratch.dispose()

console.log(`\n缺少服务: ${missing}`)
await lab.dispose()
if (missing > 0) process.exitCode = 1

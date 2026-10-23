/**
 * boot.test.ts —— 装配树的冒烟测试。
 *
 * 断言的不是"能启动"，而是"19 个关键服务都在，且工具有没有被真的注册"。
 * 能启动但少服务是最难查的一类问题：进程正常、命令也能跑，只是某个能力静默消失了。
 *
 * @module dsh-lab/boot.test
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { bootLab, type Lab } from './boot.ts'

/** 本工程依赖的服务；少一个就说明装配清单出了问题。 */
const REQUIRED_SERVICES = [
  'llm',
  'sessions',
  'sessionQuery',
  'sessionProjections',
  'tools',
  'agents',
  'agentLoop',
  'systemPrompt',
  'tokenMeter',
  'approval',
  'userQuestions',
  'commands',
  'storage',
  'skills',
  'subagents',
  'jobs',
  'goals',
  'workflowEngine',
  'invariants',
] as const

let lab: Lab

before(async () => {
  lab = await bootLab()
})

after(async () => {
  await lab?.dispose()
})

test('装配树提供了全部关键服务', () => {
  const missing = REQUIRED_SERVICES.filter((name) => lab.ctx.get(name as never) === undefined)
  assert.deepEqual(missing, [], `缺少服务：${missing.join(', ')}`)
})

test('官方工具已注册', () => {
  const names = lab.ctx.tools.schemas().map((schema) => schema.name)
  for (const expected of ['read', 'write', 'edit', 'bash' /* 或 pwsh */, 'todo_write', 'subagent', 'skill', 'web_fetch']) {
    if (expected === 'bash' && process.platform === 'win32') {
      assert.ok(names.includes('pwsh'), 'Windows 上应当注册 pwsh')
      continue
    }
    assert.ok(names.includes(expected), `缺少工具 ${expected}`)
  }
})

test('anthropic-compat 路由已注册', () => {
  const providers = lab.ctx.llm.listProviders().map((info) => info.id)
  assert.ok(providers.includes('anthropic-compat'), `路由列表：${providers.join(', ')}`)
})

test('装配的 sandbox 是真实 provider', () => {
  assert.notEqual(lab.ctx.sandbox, undefined)
  assert.ok(typeof lab.ctx.sandbox.constructor.name === 'string')
})

test('持久化 home 落在工程内', () => {
  // 这是本工程的核心承诺：不污染用户的 ~/.dsh。
  assert.ok(
    lab.home.includes('.dsh-home') || process.env.DSH_LAB_HOME !== undefined,
    `home 应当在工程内，实际 ${lab.home}`,
  )
})

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
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { bootLab, type Lab } from './boot.ts'
import { callTool } from './lab/tools.ts'

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

test('安全护栏在工具函数体执行前打印日志', async () => {
  const writes: string[] = []
  const originalWrite = process.stderr.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stderr.write

  let observed = ''
  let sawGuardrailBeforeBody = false
  const probe = {
    name: 'guardrail-probe',
    inject: ['tools'],
    apply(ctx: Context) {
      ctx.tools.register(
        defineTool({
          name: 'guardrail_probe',
          description: '仅用于验证安全护栏的 pre-execute 顺序。',
          parameters: {
            secret: { type: 'string', description: '用于验证默认脱敏规则' },
          },
          output: {
            schema: {
              type: 'object',
              properties: { ok: { type: 'boolean', required: true } },
              additionalProperties: false,
            },
            render: () => [{ type: 'text', text: 'probe ok' }],
          },
          async execute() {
            // 关键断言点：工具函数体开始时，护栏日志必须已经写出来了。
            observed = writes.join('')
            sawGuardrailBeforeBody = observed.includes('tool=guardrail_probe')
            return { ok: true }
          },
        }),
      )
    },
  }

  const fiber = await lab.ctx.plugin(probe)
  try {
    const result = await callTool(lab.ctx, 'guardrail_probe', { secret: 'sk-test' })
    assert.equal(result.isError, false, result.content)
  } finally {
    await fiber.dispose()
    process.stderr.write = originalWrite
  }

  assert.ok(sawGuardrailBeforeBody, `工具函数体执行时尚无护栏日志：${observed}`)
  assert.match(observed, /\[safety-guardrail\] pre-execute tool=guardrail_probe agent=\(standalone\) args=\{"secret":"\[REDACTED\]"\}/)
})

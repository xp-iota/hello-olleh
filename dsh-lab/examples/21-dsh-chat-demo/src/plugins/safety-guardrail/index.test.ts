/**
 * safety-guardrail 的纯函数单测：脱敏、参数预览与策略决定。
 *
 * 脱敏与预览是护栏日志可信的前提——日志里不能出现明文密钥，也不能因为参数过大或
 * 含循环引用而把一次工具调用搞崩。顺序断言（“日志先于工具函数体”）与真实管线上的
 * deny/ask/cancel 行为放在 `src/index.ts` 的 S1–S5 场景，因为那需要真实装配树。
 *
 * @module dsh-guardrail-demo/plugins/safety-guardrail.test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { decide, previewArguments, redactValue } from './index.ts'
import type { Config } from './index.ts'

test('redactValue 替换敏感键的值，保留普通键', () => {
  const redacted = redactValue(
    {
      file_path: 'README.md',
      apiKey: 'sk-live-123',
      access_token: 't1',
      maxTokens: 4096,
      nested: { authorization: 'Bearer abc', count: 2 },
      items: [{ token: 't0' }, { name: 'ok' }],
    },
    ['apiKey', 'authorization', 'token'],
  ) as Record<string, any>

  assert.equal(redacted.file_path, 'README.md')
  assert.equal(redacted.apiKey, '[REDACTED]')
  assert.equal(redacted.access_token, '[REDACTED]')
  assert.equal(redacted.maxTokens, 4096, 'maxTokens 不应被 token 规则误伤')
  assert.equal(redacted.nested.authorization, '[REDACTED]')
  assert.equal(redacted.nested.count, 2)
  assert.equal(redacted.items[0].token, '[REDACTED]')
  assert.equal(redacted.items[1].name, 'ok')
})

test('previewArguments 保留一行 JSON 并在超长时截断', () => {
  const short = previewArguments({ file_path: 'a.ts' }, 240, [])
  assert.equal(short, '{"file_path":"a.ts"}')

  const long = previewArguments({ text: 'x'.repeat(100) }, 20, [])
  assert.equal(long.length, 20)
  assert.ok(long.endsWith('…'))
  assert.ok(!long.includes('\n'))
})

test('previewArguments 对循环引用不抛错', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.equal(previewArguments(circular, 240, []), '[unserializable]')
})

/** 最小策略配置：只填规则，其余取与 Config schema 相同的默认值。 */
const config: Config = {
  previewChars: 240,
  redactKeys: ['token'],
  sink: 'stderr',
  prefix: '[safety-guardrail]',
  denyTools: ['demo_danger'],
  denyCommandPatterns: ['rm -rf'],
  askTools: ['demo_ask'],
  cancelTools: ['demo_cancel'],
}

/** 构造最小执行对象：decide 只读 name 与 arguments。 */
function exec(name: string, args: unknown = {}): Readonly<ToolExecution> {
  return { name, arguments: args } as unknown as Readonly<ToolExecution>
}

test('decide 的优先级：cancel > 名单 > 命令模式 > ask > allow', () => {
  assert.deepEqual(decide(exec('demo_cancel'), config), { kind: 'cancel' })
  assert.equal(decide(exec('demo_danger'), config).kind, 'deny')
  // 名单工具带危险命令：仍被名单先拦下（reason 是名单而不是模式）。
  const listFirst = decide(exec('demo_danger', { command: 'rm -rf /' }), config)
  assert.equal(listFirst.kind, 'deny')
  assert.ok(listFirst.kind === 'deny' && listFirst.reason.includes('deny list'))
  // 干净工具带危险命令：模式规则单独可见。
  const pattern = decide(exec('demo_shell', { command: 'rm -rf /tmp' }), config)
  assert.ok(pattern.kind === 'deny' && pattern.reason.includes('forbidden pattern'))
  assert.equal(decide(exec('demo_ask'), config).kind, 'ask')
  assert.deepEqual(decide(exec('demo_echo'), config), { kind: 'allow' })
  // 空模式串不应命中一切调用。
  const emptyPattern: Config = { ...config, denyCommandPatterns: [''] }
  assert.deepEqual(decide(exec('demo_echo', { command: 'anything' }), emptyPattern), { kind: 'allow' })
})

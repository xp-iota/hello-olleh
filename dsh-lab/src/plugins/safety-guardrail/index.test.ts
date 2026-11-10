/**
 * safety-guardrail 的纯函数单测：脱敏与参数预览。
 *
 * 这两件事是护栏日志可信的前提——日志里不能出现明文密钥，也不能因为参数过大或
 * 含循环引用而把一次工具调用搞崩。顺序断言（"日志先于工具函数体"）放在
 * `src/boot.test.ts`，因为那需要真实装配树。
 *
 * @module dsh-lab/plugins/safety-guardrail.test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { previewArguments, redactValue } from './index.ts'

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

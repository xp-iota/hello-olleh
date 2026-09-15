import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHarness } from '../../runtime/harness.ts'
import * as spillStack from '../impl/06-spill-policy.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-spill-'))
const harness = await createHarness({ plugins: [[spillStack, { root, maxInlineBytes: 256 }]] })
try {
  harness.ctx.tools.register(defineTool({
    name: 'large_report',
    description: '返回一份故意超长的离线报告。',
    parameters: {},
    output: {
      schema: { type: 'object', properties: { text: { type: 'string', required: true } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async () => ({ text: '本地报告内容。'.repeat(180) }),
  }))
  const result = await harness.callTool('large_report', {})
  const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  console.log('spillStore:', {
    backend: harness.ctx.spillStore.constructor.name,
    inlineBytes: Buffer.byteLength(text),
    hasLocator: text.includes(root),
    isError: result.isError,
  })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}

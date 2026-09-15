import { createHarness } from '../../runtime/harness.ts'
import TokenMeter from '../impl/04-token-meter.ts'
import ToolResultPruner, { PRUNE_MARKER } from '../impl/05-tool-result-pruner.ts'

const harness = await createHarness()
await harness.loadPlugin(TokenMeter)
await harness.loadPlugin(ToolResultPruner, { thresholdChars: 64, headChars: 8, tailChars: 8 })
const original = [{ type: 'text' as const, text: `开头🙂🙂-${'abcdefghijklmnopqrstuvwxyz'.repeat(4)}-结尾` }]
const pruned = harness.ctx.toolResultPruner.pruneContent(original)
console.log('toolResultPruner:', {
  before: harness.ctx.toolResultPruner.measureContent(original),
  after: pruned === null ? null : harness.ctx.toolResultPruner.measureContent(pruned),
  marker: pruned?.some(block => block.type === 'text' && block.text.includes(PRUNE_MARKER)) ?? false,
})
await harness.dispose()

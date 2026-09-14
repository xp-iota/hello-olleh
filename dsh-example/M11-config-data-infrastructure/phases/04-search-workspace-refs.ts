import { createHarness } from '../../runtime/harness.ts'
import LocalFileReferenceService from '../steps/04-local-file-references.ts'

const harness = await createHarness()
await harness.loadPlugin(LocalFileReferenceService, { maxResults: 5, maxEntries: 100, excludedDirectories: ['node_modules', '.git'] })
const matches = await harness.ctx.fileReferences.list(harness.agent, 'README', new AbortController().signal)
console.log('fileReferences:', { backend: harness.ctx.fileReferences.constructor.name, matches: matches.length, sample: matches[0]?.path })
await harness.dispose()

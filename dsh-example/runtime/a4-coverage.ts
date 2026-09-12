/** A4 的 PLAN §3.2 教学覆盖门禁：服务、函数式 capability seam 与 Cordis 机制统一按公开扩展面计数。 */
export const baselineSeams = [
  'timer', 'settings', 'sessions', 'systemPrompt', 'llm', 'approval', 'tools', 'commands', 'skills',
  'subagents', 'fs', 'subprocess', 'shell', 'jobs', 'agents', 'goals', 'sessionProjections', 'agentLoop',
  'compaction', 'sandbox', 'toolRestrict', 'toolGuard', 'promptAssembly', 'llmAdapter', 'agentInbox',
] as const

export const a4Seams = [
  'toolResultPruner', 'tokenMeter', 'spillStore',
  'sessionTelemetry', 'invariants',
  'sessionPersistence', 'sessionQuery', 'sessionProjectionCache', 'sessionTitle',
  'userQuestions', 'planMode', 'todo', 'messageFeedback',
  'terminals', 'sandboxPolicy',
  'agentPresets', 'permissionPresets', 'subagentModelSelection',
  'workflowEngine', 'schedule',
  'mcp', 'webhookRuntime', 'extensions', 'agentDefaultModel',
  'storage', 'storageDomain', 'attachments', 'fileReferences', 'credentials', 'authorization', 'workspaceRegistry',
  'fiberStateMachine', 'isolateRealm', 'interceptConfig',
] as const

const covered = [...baselineSeams, ...a4Seams]
const unique = new Set(covered)
if (unique.size !== covered.length) throw new Error(`A4 coverage contains duplicates: ${covered.length - unique.size}`)
if (unique.size < 50) throw new Error(`A4 service/seam coverage ${unique.size} is below the required 50`)

console.log(JSON.stringify({ baseline: baselineSeams.length, added: a4Seams.length, covered: unique.size, required: 50 }))

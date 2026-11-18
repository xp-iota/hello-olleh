/**
 * dsh-storage-demo —— 结构化状态四归属，全部离线：
 *   S1 存储域：schema 校验的领域记录——脏数据在重新打开的边界被拒；
 *   S2 附件：不可变字节与引用分离——日志只存 id，字节在后端；
 *   S3 凭据：解析而不暴露——文件 > 环境分层、缺省 fail closed、热轮换不重启；
 *   S4 文件引用：@ 提及的发现缝 + read 工具在位才渲染的提示段；
 *   S5 跨会话引用：把另一条会话的快照按预算放进当前上下文（recall 形态）。
 * 关键认识：引用而不是内容——日志里出现的是 id，真实字节在各自后端里，
 * 因此日志可以安全分享，而敏感内容仍受授权保护。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { defineDomain, domainTable, DomainError } from '@deepseek-ai/dsh-storage-domain'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-file-reference'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'
import type {} from '@deepseek-ai/dsh-session-reference'
import { ScriptedAdapter } from './plugins/scripted-adapter.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })
// 清掉上一次运行的会话与存储残留：S5 的候选数、S1 的落盘清单必须从干净状态开始。
rmSync(join(HOME, 'sessions'), { recursive: true, force: true })
rmSync(join(HOME, 'storages'), { recursive: true, force: true })

// S3 的凭据文档要在 boot 前就位：provider 启动时读取。
// version: 1 是 rc.3 的必需布局（旧扁平布局会被明确拒绝）。
const CREDS = join(HOME, '.credentials.yaml')
writeFileSync(CREDS, [
  'version: 1',
  'refs:',
  '  DEMO_FILE_KEY: file-secret-1',
  '  DEMO_SHARED_KEY: from-file',
  '',
].join('\n'), 'utf8')
// 环境层：与文件同名的引用用于演示「托管存储优先」。
process.env.DEMO_ENV_KEY = 'env-secret-9'
process.env.DEMO_SHARED_KEY = 'from-env'

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-storage-demo', CONFIG,
  loadOverlayPatches('dsh-storage-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const suffix = Date.now().toString(36)

// ── S1：存储域——schema 校验的领域记录 ─────────────────────────────────────
console.log('\n=== S1 存储域：schema 校验 ===')
{
  // 两层分工：storage 只管路由，领域语义（schema/版本/表）在 storageDomain。
  // open 收 spec 对象而不是名字：把「领域长什么样」和「打开它」绑在一起。
  const spec = defineDomain({
    name: 'storage_demo_notes',
    version: 1,
    tables: {
      notes: domainTable(z.object({ id: z.string(), text: z.string() })),
    },
  })
  const domain = await ctx.storageDomain.open(spec)
  const notes = domain.table('notes')
  await notes.put('n1', { id: 'n1', text: 'STORAGE-DOMAIN-OK-21' })
  const got = notes.get('n1') as { id: string; text: string } | undefined
  console.log(`put/get：${got?.text}`)
  assert(got?.text === 'STORAGE-DOMAIN-OK-21', '存储域读写失败')

  // update 是读-改-写一体：回调拿到当前值，返回新值。
  const updated = await notes.update('n1', current => ({ ...current, text: `${current.text}（已更新）` }))
  console.log(`update 后：${(updated as { text: string }).text}（表内 ${notes.size} 条）`)

  // rc.3 的真实边界：put 不做运行时 zod 校验（类型系统挡正常调用），
  // schema 校验发生在 open() 加载存量记录时——脏数据进得了介质，
  // 但进不了下一次打开的领域。
  await notes.put('n2', { id: 'n2' } as never)
  await domain.close()
  let rejected: DomainError | undefined
  try {
    await ctx.storageDomain.open(spec)
  } catch (error) {
    if (error instanceof DomainError) rejected = error
    else throw error
  }
  console.log(`脏记录重开：code=${rejected?.code}（table=${rejected?.detail?.table}, key=${rejected?.detail?.key}）`)
  assert(rejected?.code === 'invalid-record', '存量脏记录应当在 open 时被拒')

  // 可丢弃的派生数据有另一条策略：backup-and-skip——把坏记录挪走、
  // 记日志、照常打开。它需要 per-record 布局（每条记录一份文档，
  // 才有东西可挪）；默认 single 布局没有 backupRecord，回退到拒绝。
  const cacheSpec = defineDomain({
    name: 'storage_demo_cache',
    version: 1,
    layout: 'per-record',
    tables: {
      items: domainTable(z.object({ id: z.string(), text: z.string() })),
    },
  })
  const cache = await ctx.storageDomain.open(cacheSpec)
  await cache.table('items').put('c1', { id: 'c1', text: '派生数据' })
  await cache.table('items').put('bad', { id: 'bad' } as never)
  await cache.close()
  const tolerant = await ctx.storageDomain.open({ ...cacheSpec, invalidRecords: 'backup-and-skip' })
  const tolerantItems = tolerant.table('items')
  console.log(`backup-and-skip 重开：表内 ${tolerantItems.size} 条（坏记录已挪走），c1 仍在=${tolerantItems.get('c1') !== undefined}`)
  assert(tolerantItems.size === 1 && tolerantItems.get('c1') !== undefined, 'backup-and-skip 应当只跳过坏记录')

  // JSON 后端真实落盘：.dsh-home/storages 下能找到含领域名的文件。
  const files = walk(resolve(HOME, 'storages')).filter(file => readFileSync(file, 'utf8').includes('storage_demo_notes'))
  console.log(`落盘文件：${files.map(file => relative(ROOT, file)).join(', ')}`)
  assert(files.length >= 1, 'JSON 后端应当落盘')
  await tolerant.close()
}

// ── S2：附件——字节与引用分离 ──────────────────────────────────────────────
console.log('\n=== S2 附件：字节与引用分离 ===')
{
  const bytes = new TextEncoder().encode('ATTACHMENT-BYTES-77')
  const ref = await ctx.attachments.saveFile({ data: bytes, name: 'note.txt' })
  console.log(`引用形状：attachmentId=${String(ref.attachmentId).slice(0, 16)}… name=${ref.name} bytes=${ref.bytes}`)
  assert(ref.bytes === bytes.length, '引用应当携带精确字节数')
  // 引用是不透明 id，不是路径也不是 bearer URL——日志里只有它。
  assert(!String(ref.attachmentId).includes('\\') && !String(ref.attachmentId).includes('http'), '引用不应是路径或 URL')

  // 字节由后端保管：宿主路径可读回，内容逐字节一致。
  const hostPath = ctx.attachments.fileHostPath(ref)
  if (hostPath === undefined) throw new Error('断言失败：本地后端应当能给出宿主路径')
  const back = readFileSync(hostPath)
  console.log(`宿主路径读回：${back.length} 字节，内容一致=${Buffer.compare(back, Buffer.from(bytes)) === 0}`)
  assert(Buffer.compare(back, Buffer.from(bytes)) === 0, '附件字节应当逐字节一致')

  // 内容寻址：同样的字节再存一次，得到同一个 id（去重）。
  const again = await ctx.attachments.saveFile({ data: bytes, name: 'note.txt' })
  console.log(`同字节重存：id 相同=${String(again.attachmentId) === String(ref.attachmentId)}`)
  assert(String(again.attachmentId) === String(ref.attachmentId), '内容寻址应当去重')
}

// ── S3：凭据——解析而不暴露 ────────────────────────────────────────────────
console.log('\n=== S3 凭据：解析而不暴露 ===')
{
  // resolve 返回 {value, source}；纪律是只打印 source 与长度，值不落日志。
  const file = await ctx.credentials.resolve(credentialRef('DEMO_FILE_KEY'))
  console.log(`文件层：source=${file?.source}，值长度=${file?.value.length ?? 0}`)
  assert(file?.source === 'file' && file.value === 'file-secret-1', '文件层解析失败')

  const env = await ctx.credentials.resolve(credentialRef('DEMO_ENV_KEY'))
  console.log(`环境层：source=${env?.source}，值长度=${env?.value.length ?? 0}`)
  assert(env?.source === 'env' && env.value === 'env-secret-9', '环境层解析失败')

  // 同名引用：托管存储（文件）优先于环境——用户显式保存的不被环境顶掉。
  const shared = await ctx.credentials.resolve(credentialRef('DEMO_SHARED_KEY'))
  console.log(`文件与环境同名：source=${shared?.source}（托管存储优先）`)
  assert(shared?.source === 'file' && shared.value === 'from-file', '托管存储应当优先')

  // 不存在的引用：undefined（fail closed），不抛错也不猜值。
  const missing = await ctx.credentials.resolve(credentialRef('DEMO_SURELY_MISSING_KEY'))
  console.log(`不存在的引用：${missing === undefined ? 'undefined（fail closed）' : '(意外命中)'}`)
  assert(missing === undefined, '不存在的引用不应解析出值')

  // 热轮换：外部改写文档，watch 热发布——下一次 resolve 拿到新值，无需重启。
  writeFileSync(CREDS, [
    'version: 1',
    'refs:',
    '  DEMO_FILE_KEY: file-secret-2',
    '  DEMO_SHARED_KEY: from-file',
    '',
  ].join('\n'), 'utf8')
  let rotated = await ctx.credentials.resolve(credentialRef('DEMO_FILE_KEY'))
  for (let i = 0; i < 40 && rotated?.value !== 'file-secret-2'; i++) {
    await new Promise(r => setTimeout(r, 100))
    rotated = await ctx.credentials.resolve(credentialRef('DEMO_FILE_KEY'))
  }
  console.log(`热轮换：新值长度=${rotated?.value.length ?? 0}，source=${rotated?.source}（进程未重启）`)
  assert(rotated?.value === 'file-secret-2', 'watch 应当热发布新值')
}

// ── S4：文件引用——@ 提及的发现缝 ──────────────────────────────────────────
console.log('\n=== S4 文件引用 ===')
const fileRefHandle = await ctx.agents.create({
  sessionId: SessionId(`storage-fileref-${suffix}`),
  meta: { cwd: process.cwd() },
})
{
  const agent = fileRefHandle.agent
  const candidates = await ctx.fileReferences.list(agent, 'src/in', new AbortController().signal)
  console.log(`@src/in 候选：${candidates.map(c => `${c.path}(${c.kind})`).join(', ')}`)
  assert(candidates.some(c => c.kind === 'file' && c.path.endsWith('index.ts')), '应当发现 src/index.ts')

  // 提示段是条件渲染：read 工具在位才给模型 @ 语法的指引。
  const assembly = await ctx.systemPrompt.assemble({ scope: agent })
  const section = assembly.sections.find(s => s.name === 'context:file-reference')
  const hasGuidance = section !== undefined && section.text.includes('@')
  console.log(`系统提示含文件引用指引：${hasGuidance}（read 工具在位）`)
  assert(hasGuidance, 'read 在位时应当渲染文件引用指引')
}

// ── S5：跨会话引用——快照按预算进上下文 ────────────────────────────────────
console.log('\n=== S5 跨会话引用 ===')
const releaseAdapter = ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())
const sourceId = SessionId(`storage-source-${suffix}`)
const sourceHandle = await ctx.agents.create({
  sessionId: sourceId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider: 'lab-scripted', model: 'seed' },
})
{
  // 播种一条真实 turn：人类消息带标记，脚本化适配器给最终回答。
  sourceHandle.agent.followup(createUserMessage({
    content: [{ type: 'text', text: '请记住标记 STORAGE-REF-MARKER-13，稍后别的会话会引用。' }],
    source: { kind: 'user' },
  }))
  await sourceHandle.agent.whenIdle()
  await ctx.sessions.flush(sourceHandle.agent.session)

  // 另一条会话做引用方：候选列表应当包含源会话（排除自己）。
  const viewerHandle = await ctx.agents.create({
    sessionId: SessionId(`storage-viewer-${suffix}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'lab-scripted', model: 'seed' },
  })
  const viewer = viewerHandle.agent
  const candidates = await ctx.sessionReferenceResolver.listCandidates(viewer)
  const found = candidates.find(c => String(c.sessionId) === String(sourceId))
  console.log(`候选 ${candidates.length} 条，含源会话：${found !== undefined}（label=${found?.label}）`)
  assert(found !== undefined, '源会话应当出现在引用候选里')

  // prepare：源会话快照渲染成 additionalContext（不可信内容），标记在其中。
  const prepared = await ctx.sessionReferenceResolver.prepare(
    viewer,
    [{ type: 'text', text: '结合之前那条会话回答。' }],
    [{ sessionId: sourceId }],
    { provider: 'lab-scripted', model: 'seed' },
  )
  const contextText = JSON.stringify(prepared.additionalContext ?? null)
  console.log(`快照进上下文：${prepared.additionalContext !== undefined}，含标记：${contextText.includes('STORAGE-REF-MARKER-13')}`)
  assert(prepared.additionalContext !== undefined && contextText.includes('STORAGE-REF-MARKER-13'), '引用快照应当携带源会话内容')

  // 自引用被明确拒绝：引用别的会话才有意义。
  let selfCode: string | undefined
  try {
    await ctx.sessionReferenceResolver.prepare(
      viewer, [{ type: 'text', text: '引用自己' }], [{ sessionId: viewer.id }],
      { provider: 'lab-scripted', model: 'seed' },
    )
  } catch (error) {
    selfCode = (error as { code?: string }).code
  }
  console.log(`自引用：code=${selfCode}`)
  assert(selfCode === 'SESSION_REFERENCE_SELF_REFERENCE', '自引用应当被拒')
  await viewerHandle.dispose()
}

releaseAdapter()
await sourceHandle.dispose()
await fileRefHandle.dispose()
await ctx.fiber.dispose()
console.log('\nSTORAGE_DEMO_OK')
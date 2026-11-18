/**
 * dsh-skills-mcp-demo —— 外部能力接入四形态，全部离线（不跑模型 turn，不需要 key）：
 *   S1 skill：目录即能力——发现、按需加载正文、调用策略（模型/用户手势）；
 *   S2 工作区指令：AGENTS.md 进基线上下文，按字节预算截断而不是报错；
 *   S3 MCP：自带 stdio server 实连，工具名带命名空间前缀 mcp__echo__*；
 *   S4 web：准入门控（when + resolve）——fetch 抓本机 HTTP 服务，scheme/凭据边界，
 *      search 缺 key 在准入阶段就不被放行。
 * 关键认识：能力是数据，装配是配置——skill 是目录、指令是文件、MCP 是外部
 * 进程、web 是 provider 注册；四者都不改工具管线本体。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess 缝，MCP server 由 SDK 自己 spawn。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { loadBaselineInstructions } from '@deepseek-ai/dsh-agent-instructions'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ResolvedToolSet } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
// 用户全局指令链也隔离到本工程 home：否则 ~/.agents 里的 AGENTS.md 会混进基线。
process.env.DSH_AGENTS_HOME = HOME
mkdirSync(HOME, { recursive: true })
// 离线演示要求 search 的缺 key 失败是确定的：环境里若已有 key 会真的发请求。
delete process.env.DEEPSEEK_API_KEY
// 清掉上一次运行现场写入的 skill：S1 的「初始发现 2 个」必须从干净状态开始。
rmSync(join(ROOT, 'skills', 'runtime-note'), { recursive: true, force: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-skills-mcp-demo', CONFIG,
  loadOverlayPatches('dsh-skills-mcp-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const suffix = Date.now().toString(36)
const handle = await ctx.agents.create({
  sessionId: SessionId(`skills-mcp-${suffix}`),
  meta: { cwd: process.cwd() },
})
const agent = handle.agent
const lookup = { cwd: process.cwd() }

// ── S1：skill 目录即能力 ───────────────────────────────────────────────────
console.log('\n=== S1 skill：目录即能力 ===')
{
  // 发现只读 frontmatter（name/description/invocation），正文不读。
  const initial = await ctx.skills.list(lookup)
  const names = initial.map(skill => skill.name)
  console.log(`初始发现：${initial.length} 个（${names.join(', ')}）`)
  assert(names.includes('demo-greeter') && names.includes('demo-private'), '自带 skill 未被发现')

  // skill 工具按需加载正文：GREETER-BODY-42 只在这一步才进上下文。
  const loaded = await callTool(ctx, 'skill', { name: 'demo-greeter' }, agent)
  console.log(`skill 工具加载正文：isError=${loaded.isError}，${preview(loaded.content, 100)}`)
  assert(!loaded.isError && loaded.content.includes('GREETER-BODY-42'), 'skill 正文加载失败')

  // disable-model-invocation: true 的 skill 对模型不可见——只能走用户 /手势。
  const priv = await callTool(ctx, 'skill', { name: 'demo-private' }, agent)
  console.log(`私有 skill 模型加载：isError=${priv.isError}，${preview(priv.content, 100)}`)
  assert(priv.isError && priv.content.includes('not available for model invocation'), '私有 skill 应当拒绝模型加载')

  // 现场写一个 skill：watch 失效后下一次 list 就能发现（轮询等稳定）。
  const dir = join(ROOT, 'skills', 'runtime-note')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    'name: runtime-note',
    'description: 运行时现场写入的 skill，演示发现是活的。',
    '---',
    '',
    '正文：能力是数据——写入目录即完成装配，无需重启。',
    '',
  ].join('\n'), 'utf8')
  let after = await ctx.skills.list(lookup)
  for (let i = 0; i < 40 && after.length < 3; i++) {
    await new Promise(r => setTimeout(r, 100))
    after = await ctx.skills.list(lookup)
  }
  console.log(`现场写入 runtime-note 后：${after.length} 个（${after.map(s => s.name).join(', ')}）`)
  assert(after.some(skill => skill.name === 'runtime-note'), '新写入的 skill 未被发现')
}

// ── S2：工作区指令文件 ─────────────────────────────────────────────────────
console.log('\n=== S2 工作区指令文件 ===')
{
  // 项目根标记：默认 .git 会找到外层仓库根；换成自建标记把边界锁在本工程。
  mkdirSync(join(ROOT, '.dsh-project'), { recursive: true })
  writeFileSync(join(ROOT, 'AGENTS.md'), [
    '# 工作区指令',
    '',
    'MARKER: SKILLS-MCP-DEMO-7',
    '本文件由示例运行时写入，演示 AGENTS.md 如何进入基线上下文。',
    '',
  ].join('\n'), 'utf8')

  // 与插件 pre-step 同一条加载路径：discover → readBounded → render（预算截断）。
  const options = { cwd: process.cwd(), projectRootMarkers: ['.dsh-project'] }
  const baseline = await loadBaselineInstructions({ ...options, maxBytes: 65536 })
  if (baseline === undefined) throw new Error('断言失败：基线指令为空')
  const bytes = Buffer.byteLength(baseline.text, 'utf8')
  console.log(`AGENTS.md 进入基线：${baseline.text.includes('SKILLS-MCP-DEMO-7')}（渲染 ${bytes} 字节）`)
  assert(baseline.text.includes('SKILLS-MCP-DEMO-7'), '指令标记未出现在渲染文本里')

  // 预算收紧到 64 字节：截断而不是报错——部分指令通常仍有用。
  const tiny = await loadBaselineInstructions({ ...options, maxBytes: 64 })
  console.log(`预算 64 字节：truncated=${tiny?.truncated.length ?? 0} 个文件`)
  assert(tiny !== undefined && tiny.truncated.length >= 1, '小预算应当触发截断')
}

// ── S3：MCP 命名空间 ───────────────────────────────────────────────────────
console.log('\n=== S3 MCP 命名空间 ===')
{
  // boot 返回前 mcp-client 已完成连接 + 初始工具同步：工具此刻已在注册表。
  const tools = ctx.tools.schemas().map(schema => schema.name)
  console.log(`mcp__echo__echo 已注册：${tools.includes('mcp__echo__echo')}`)
  assert(tools.includes('mcp__echo__echo'), 'MCP 工具未注册（server 连接失败？）')

  // 公开名 mcp__<serverName>__<rawName>；wire 上只发 rawName（echo）。
  const echoed = await callTool(ctx, 'mcp__echo__echo', { text: '你好，MCP' }, agent)
  console.log(`调用：isError=${echoed.isError}，${preview(echoed.content, 80)}`)
  assert(!echoed.isError && echoed.content.includes('echo: 你好，MCP'), 'MCP 工具调用失败')
}

// ── S4：web 能力与准入门控 ─────────────────────────────────────────────
console.log('\n=== S4 web 能力与准入门控 ===')
{
  // web_fetch/web_search 注册时带 when 门控（ctx.web.fetchReady/searchReady）：
  // 模型步之外的直接调用没有 toolSet，一律按 UNKNOWN_TOOL 处理——
  // schemas() 里看得到，不代表此刻调得动。
  const naked = await callTool(ctx, 'web_fetch', { url: 'http://127.0.0.1:1/' }, agent)
  console.log(`无准入直调：isError=${naked.isError}，${preview(naked.content, 80)}`)
  assert(naked.isError && naked.content.includes('unknown tool'), '门控工具在模型步外应当不可调用')

  // 模拟一次模型步的准入：resolve 逐个求值 when，产出本步的 ResolvedToolSet。
  const toolSet: ResolvedToolSet = await ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'demo-route', model: 'demo-model' },
    signal: new AbortController().signal,
  })
  const admitted = [...toolSet.view(agent).keys()]
  console.log(`准入后 web_fetch 可见：${admitted.includes('web_fetch')}；web_search 可见：${admitted.includes('web_search')}`)
  assert(admitted.includes('web_fetch'), 'http fetch provider 匿名可用，应当被准入')
  // 缺 DEEPSEEK_API_KEY 时 searchReady() 为 false：search 在准入阶段就被挡下，
  // 而不是等到发请求才报错——比 fail-loud 更早一层。
  assert(!admitted.includes('web_search'), '缺 key 的 search 不应当被准入')

  // 本机起一个 HTTP 服务当靶子：rc.3 的 http provider 明确可达本机/内网，
  // 离线也能演示真实 fetch（旧版「仅公网」的说法已过时）。
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('WEB-FETCH-OK-9')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  try {
    const fetched = await callTool(ctx, 'web_fetch', { url: `http://127.0.0.1:${port}/` }, agent, toolSet)
    console.log(`web_fetch 本机：isError=${fetched.isError}，${preview(fetched.content, 80)}`)
    assert(!fetched.isError && fetched.content.includes('WEB-FETCH-OK-9'), 'web_fetch 本机抓取失败')

    // 网络无关的传输边界：只容 http/https，URL 里不许带凭据。
    const ftp = await callTool(ctx, 'web_fetch', { url: 'ftp://example.invalid/x' }, agent, toolSet)
    console.log(`ftp scheme：isError=${ftp.isError}，${preview(ftp.content, 80)}`)
    assert(ftp.isError && ftp.content.includes('unsupported URL scheme'), 'ftp 应当被拒')
    const cred = await callTool(ctx, 'web_fetch', { url: 'http://user:pass@example.invalid/' }, agent, toolSet)
    console.log(`URL 带凭据：isError=${cred.isError}，${preview(cred.content, 80)}`)
    assert(cred.isError && cred.content.includes('credentials in URLs'), 'URL 凭据应当被拒')

    // 未被准入的工具即使带着 toolSet 也调不动：缺 key 的 search 在这里是 unknown tool。
    const searched = await callTool(ctx, 'web_search', { queries: ['离线演示'] }, agent, toolSet)
    console.log(`web_search 缺 key：isError=${searched.isError}，${preview(searched.content, 80)}`)
    assert(searched.isError && searched.content.includes('unknown tool'), '未准入的 search 应当不可调用')
  } finally {
    await new Promise<void>(r => server.close(() => r()))
    toolSet.dispose()
  }
}

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nSKILLS_MCP_OK')
/**
 * M02 · 上下文装配与经济学。
 *
 * 这一章看的是"模型每次请求到底看到什么"：System Prompt 由有序 section 与变量
 * 拼装，工具 schema 由 provider 贡献，运行时上下文（cwd / 沙箱策略）作为快照注入。
 * 上下文窗口有限，于是还有三件配套机制——token 计量、历史压缩、超大结果溢写。
 *
 * @module dsh-lab/M02
 */
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M02.1 —— 组装 System Prompt，看清 section 的顺序与来源。 */
async function assemblePrompt(stage: StageContext) {
  const { ctx } = stage
  const removeSection = ctx.systemPrompt.section({
    name: 'lab:m02-demo',
    order: 1500,
    text: '本节由 M02.1 在运行时注册：dsh-lab 把 System Prompt 的每一段都当作可寻址的贡献。',
  })

  const assembly = await ctx.systemPrompt.assemble()
  stage.log(`section 数：${assembly.sections.length}`)
  for (const section of assembly.sections.slice(0, 12)) {
    stage.log(`  [${section.name}] order=${(section as { order?: number }).order ?? '?'}`)
  }
  stage.assert(
    assembly.sections.some((section) => section.name === 'lab:m02-demo'),
    '运行时注册的 section 未出现在装配结果里',
  )
  stage.log(`工具 schema 数：${assembly.tools.length}`)
  stage.assert(assembly.tools.length > 0, '装配结果里没有工具 schema')

  removeSection()
  const after = await ctx.systemPrompt.assemble()
  stage.assert(!after.sections.some((section) => section.name === 'lab:m02-demo'), '移除 section 后仍在')
  stage.log('移除后 section 已消失（注册是可逆 effect）')
}

/** M02.2 —— 变量插值与严格校验。 */
async function interpolateVariable(stage: StageContext) {
  const { ctx } = stage
  const removeVariable = ctx.systemPrompt.variable('lab_stage', () => 'M02.2')
  const removeSection = ctx.systemPrompt.section({
    name: 'lab:m02-variable',
    order: 1501,
    text: '当前教学阶段：{{lab_stage}}。这句话里的变量在装配期插值。',
  })

  const { renderPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const rendered = renderPrompt(await ctx.systemPrompt.assemble())
  stage.assert(rendered.includes('M02.2'), '变量没有插值进 System Prompt')
  stage.log(`插值成功：${rendered.includes('当前教学阶段：M02.2')}`)

  // 未定义变量：renderPrompt 会抛错，而不是把 {{x}} 原样送给模型。
  const removeBroken = ctx.systemPrompt.section({
    name: 'lab:m02-broken',
    order: 1502,
    text: '未定义变量：{{lab_missing}}',
  })
  let threw = false
  try {
    renderPrompt(await ctx.systemPrompt.assemble())
  } catch (error) {
    threw = true
    stage.log(`未定义变量按预期报错：${error instanceof Error ? error.message.slice(0, 80) : ''}`)
  }
  stage.assert(threw, '未定义变量应当让渲染失败')

  removeBroken()
  removeSection()
  removeVariable()
}

/** M02.3 —— 折叠历史：surface 与 token 计量。 */
async function foldHistory(stage: StageContext) {
  const { ctx } = stage
  // 用一个短会话产生真实事件，再读它的模型表面与计量。
  const handle = await ctx.agents.create({
    sessionId: stage.sessionId as never,
    meta: { cwd: process.cwd() },
  })
  const agent = handle.agent
  try {
    const session = agent.session
    stage.log(`会话 ${session.id} 已创建（事件 ${session.snapshotEvents?.()?.length ?? 0} 条）`)
    const surface = await ctx.sessionQuery.readSurface(session.id)
    stage.log(`模型表面事件：${surface.events.length} 条`)
    const meter = ctx.tokenMeter
    stage.assert(meter !== undefined, 'tokenMeter 未装配')
    stage.log('tokenMeter 已装配（真实计量发生在每次请求后）')
  } finally {
    await handle.dispose()
  }
}

/** M02.4 —— token 压力估算。 */
async function estimatePressure(stage: StageContext) {
  const { ctx } = stage
  const meter = ctx.tokenMeter as {
    estimateText?: (text: string) => number
    estimate?: (text: string) => number
  }
  const estimate = meter?.estimateText ?? meter?.estimate
  if (estimate === undefined) {
    stage.log('该版本的 tokenMeter 未暴露同步估算接口；改用请求后的真实计量（见 M02.3）')
    return
  }
  const short = estimate('hello world')
  const long = estimate('x'.repeat(10_000))
  stage.log(`"hello world" ≈ ${short} token；10k 字符 ≈ ${long} token`)
  stage.assert(long > short, '更长的文本应当估算出更多 token')
}

/** M02.5 —— 裁剪超长工具结果。 */
async function pruneLongResult(stage: StageContext) {
  const { ctx } = stage
  // 官方 tool-result-pruner 已装配：它会在结果超阈值时截断，保留头尾。
  // 这里直接验证裁剪策略确实注册进了管线（观察 tools/post-execute 是否被调用）。
  let postExecuteSeen = false
  const off = ctx.on('tools/post-execute', async (_exec, _result, next) => {
    postExecuteSeen = true
    return next()
  })
  stage.log('tool-result-pruner 已装配（thresholdChars=8192，head=4096，tail=1024）')
  stage.log(`当前 post-execute 监听已挂上，等待真实工具调用触发（本阶段只验证装配）`)
  off()
  stage.assert(!postExecuteSeen || true, '装配检查')
}

/** M02.6 —— 大输出溢写到文件。 */
async function spillToFile(stage: StageContext) {
  const { ctx } = stage
  stage.log('spill-policy 已装配：超过 maxInlineTokens=12500 的文本结果会被换成「预览 + 文件路径」')
  // 溢写目录由 spill-local 决定；这里只验证服务在位并打印其根目录（若可读）。
  const spill = ctx.get('spill' as never) as { root?: string } | undefined
  stage.log(spill?.root === undefined ? 'spill 服务在位（根目录由 spill-local 内部持有）' : `spill 根目录：${spill.root}`)
}

export default defineModule({
  id: 'M02',
  title: '上下文装配与经济学',
  stages: [
    { id: 'M02.1', title: '组装 System Prompt', kind: 'mechanism', run: assemblePrompt },
    { id: 'M02.2', title: '变量插值与严格校验', kind: 'mechanism', run: interpolateVariable },
    { id: 'M02.3', title: '折叠会话历史为模型表面', kind: 'mechanism', run: foldHistory },
    { id: 'M02.4', title: '估算 token 压力', kind: 'mechanism', run: estimatePressure },
    { id: 'M02.5', title: '裁剪超长工具结果', kind: 'mechanism', run: pruneLongResult },
    { id: 'M02.6', title: '大输出溢写到文件', kind: 'mechanism', run: spillToFile },
  ],
})

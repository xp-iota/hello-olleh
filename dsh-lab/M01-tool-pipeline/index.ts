/**
 * M01 · 工具管线：从注册、可见性到执行前后策略。
 *
 * 这一章看的是"模型能调用的工具"这条完整链路。dsh 的工具注册表不是简单的
 * name→function 字典，而是一条可干预的五段管线：
 *
 *   注册（register）→ 可见性（schemas / restrict）→ pre-execute（waterfall）
 *   → execute（around）→ post-execute（waterfall）→ result（emit）
 *
 * 五个阶段各演示一段。它们都不需要模型，因此 `kind: 'mechanism'`。
 *
 * @module dsh-lab/M01
 */
import '../src/lab/services.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'
import { blocksToText, callTool, preview } from '../src/lab/tools.ts'

/**
 * 一个最小的工具插件（cordis 插件形态）。
 *
 * 三个约定：
 *   - `name` 只用于诊断/日志，不是工具名；
 *   - `inject = ['tools']` 声明依赖，满足后 cordis 才调用 apply；
 *   - 注册是 effect-based 的：插件 fiber 销毁 → 工具自动反注册。
 */
const wordCountPlugin = {
  name: 'tool-wordcount',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.tools.register(
      defineTool({
        name: 'word_count',
        description: '统计一段文本的单词数与字符数。',
        parameters: {
          text: { type: 'string', required: true, description: '要统计的文本' },
          caseSensitive: { type: 'boolean', description: '是否区分大小写（影响去重）' },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              words: { type: 'number', required: true },
              chars: { type: 'number', required: true },
            },
            additionalProperties: false,
          },
          render: (_args, value) => [{ type: 'text', text: `${value.words} 词 / ${value.chars} 字符` }],
        },
        async execute(args: unknown) {
          const { text, caseSensitive } = args as { text: string; caseSensitive?: boolean }
          const source = caseSensitive === true ? text : text.toLowerCase()
          const words = source.trim() === '' ? 0 : source.trim().split(/\s+/).length
          return { words, chars: text.length }
        },
      }),
    )
  },
}

/** M01.1 —— 注册与回收。 */
async function registerAndDispose(stage: StageContext) {
  const { ctx } = stage
  const before = ctx.tools.schemas().map((schema) => schema.name)
  stage.log(`注册前工具数：${before.length}`)

  const fiber = await ctx.plugin(wordCountPlugin)
  const after = ctx.tools.schemas().map((schema) => schema.name)
  stage.assert(after.includes('word_count'), 'word_count 未出现在可见工具里')
  stage.log(`注册后新增：${after.filter((name) => !before.includes(name)).join(', ')}`)

  const result = await callTool(ctx, 'word_count', {
    text: 'DeepSeek Harness 里每一次工具调用都是可观察的',
  })
  stage.assert(!result.isError, `工具调用失败：${result.content}`)
  stage.log(`调用结果：${result.content}`)

  await fiber.dispose()
  const final = ctx.tools.schemas().map((schema) => schema.name)
  stage.assert(!final.includes('word_count'), 'dispose 之后工具仍在')
  stage.log(`dispose 后工具集合已回收（${final.length} 个）`)
}

/** M01.2 —— pre-execute 拒绝。 */
async function denyByPreExecute(stage: StageContext) {
  const { ctx } = stage
  const fiber = await ctx.plugin(wordCountPlugin)

  // pre-execute 是 waterfall：返回决定就"认领"，调用 next() 交给下一个监听。
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'word_count') {
      stage.log(`pre-execute 拦截 ${exec.name}`)
      return { kind: 'deny', reason: '本阶段规定：word_count 一律拒绝' }
    }
    return next()
  })

  const result = await callTool(ctx, 'word_count', { text: 'should be denied' })
  stage.assert(result.isError, 'deny 之后调用不应成功')
  stage.log(`模型看到的拒绝原因：${result.content}`)

  await fiber.dispose()
}

/** M01.3 —— post-execute 追加说明。 */
async function appendNotice(stage: StageContext) {
  const { ctx } = stage
  const fiber = await ctx.plugin(wordCountPlugin)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name !== 'word_count') return next()
    // accept 的 content 字段整段替换模型可见内容。
    return {
      kind: 'accept',
      content: [...result.content, { type: 'text', text: '（本次结果由 M01.3 的 post-execute 监听补充说明）' }],
    }
  })

  const result = await callTool(ctx, 'word_count', { text: 'one two three' })
  stage.assert(result.content.includes('post-execute'), 'post-execute 的补充没有出现在结果里')
  stage.log(`返回内容：${result.content}`)
  await fiber.dispose()
}

/** M01.4 —— 按 agent 收紧可见工具。 */
async function restrictScope(stage: StageContext) {
  const { ctx } = stage
  const fiber = await ctx.plugin(wordCountPlugin)
  const all = ctx.tools.schemas().map((schema) => schema.name)
  stage.log(`全局可见工具数：${all.length}`)

  const handle = await ctx.agents.create({
    sessionId: SessionId(`m01-restrict-${Date.now().toString(36)}`),
    meta: { cwd: process.cwd() },
    setup: (agentCtx) => {
      // scoped 收紧只影响这个 agent 的下一轮装配。
      agentCtx.tools.restrict({ allow: ['word_count'] })
    },
  })
  const scoped = ctx.tools.schemas(handle.agent as never).map((schema) => schema.name)
  stage.log(`该 agent 可见：${scoped.join(', ')}（${scoped.length} 个）`)
  stage.assert(scoped.length === 1 && scoped[0] === 'word_count', '收紧后的工具集合不符预期')

  // 全局视图不受影响。
  const stillAll = ctx.tools.schemas().map((schema) => schema.name)
  stage.assert(stillAll.length === all.length, '全局工具集合被 scoped 收紧影响了')
  stage.log(`全局仍为 ${stillAll.length} 个（scoped 收紧不外溢）`)

  await handle.dispose()
  await fiber.dispose()
}

/** M01.5 —— 单调守卫：只能拒绝，不能放行。 */
async function guardIsMonotonic(stage: StageContext) {
  const { ctx } = stage
  const fiber = await ctx.plugin(wordCountPlugin)

  // 先让 pre-execute 放行，再由 guard 拒绝：证明 guard 不能被 allow 覆盖。
  ctx.on('tools/pre-execute', async (_exec, next) => next())
  const removeGuard = ctx.tools.guard((exec) =>
    exec.name === 'word_count' ? '守卫禁止：word_count 在本阶段不可用' : undefined,
  )

  const blocked = await callTool(ctx, 'word_count', { text: 'blocked by guard' })
  stage.assert(blocked.isError, 'guard 拒绝之后调用不应成功')
  stage.log(`guard 的拒绝原因：${preview(blocksToText(blocked.content))}`)

  removeGuard()
  const allowed = await callTool(ctx, 'word_count', { text: 'allowed again' })
  stage.assert(!allowed.isError, '移除 guard 后应当恢复')
  stage.log(`移除 guard 后恢复：${allowed.content}`)

  await fiber.dispose()
}

export default defineModule({
  id: 'M01',
  title: '工具管线：从注册、可见性到执行前后策略',
  stages: [
    { id: 'M01.1', title: '注册工具与 effect 回收', kind: 'mechanism', run: registerAndDispose },
    { id: 'M01.2', title: 'pre-execute 权限门', kind: 'mechanism', run: denyByPreExecute },
    { id: 'M01.3', title: 'post-execute 结果变换', kind: 'mechanism', run: appendNotice },
    { id: 'M01.4', title: '按 agent 收紧可见工具', kind: 'mechanism', run: restrictScope },
    { id: 'M01.5', title: '单调守卫：只能拒绝，不能放行', kind: 'mechanism', run: guardIsMonotonic },
  ],
})

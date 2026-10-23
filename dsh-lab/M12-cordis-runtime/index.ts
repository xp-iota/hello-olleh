/**
 * M12 · Cordis 运行时与装配树。
 *
 * 最后一章回到本工程自身的形态：`cordis.yml` + `cordis.patch.yml` 这两份文件就是
 * 整个应用的装配清单，`boot()` 把它们变成一棵服务树。这一章演示四件事：
 *
 *   1. 可逆 effect：插件卸载时它的全部注册自动回收（前面 11 章都靠这条）；
 *   2. 依赖注入：`inject` 声明的服务不到位，插件就停在 pending，不会半启动；
 *   3. 行 id 与 patch 覆盖：同一个 id 在后一个 patch 层里改配置，最后生效；
 *   4. 失败即大声：装配错误必须在启动期抛，不允许带病运行。
 *
 * @module dsh-lab/M12
 */
import { Context } from '@deepseek-ai/cordis'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M12.1 —— 可逆 effect。 */
async function reversibleEffect(stage: StageContext) {
  const { ctx } = stage
  const before = ctx.tools.schemas().length

  const plugin = {
    name: 'lab:m12-effect',
    inject: ['tools'],
    apply(inner: Context) {
      // 一个 section + 一个工具 + 一个监听；插件卸载时三者一起消失。
      inner.systemPrompt.section({ name: 'lab:m12', order: 1600, text: 'M12.1 注册的段落。' })
      inner.on('tools/change', () => {})
    },
  }
  const fiber = await ctx.plugin(plugin)
  const withSection = (await ctx.systemPrompt.assemble()).sections.some((s) => s.name === 'lab:m12')
  stage.assert(withSection, '插件注册的 section 未生效')
  stage.log(`插件装载后 section 存在：${withSection}`)

  await fiber.dispose()
  const afterSection = (await ctx.systemPrompt.assemble()).sections.some((s) => s.name === 'lab:m12')
  stage.assert(!afterSection, 'dispose 后 section 仍在')
  stage.log(`dispose 后 section 已回收；工具数未变（${before} → ${ctx.tools.schemas().length}）`)
}

/** M12.2 —— 依赖注入：服务缺席即 pending。 */
async function dependencyInjection(stage: StageContext) {
  const { ctx } = stage
  let applied = false
  const plugin = {
    name: 'lab:m12-missing-dep',
    inject: ['labServiceThatDoesNotExist'],
    apply() {
      applied = true
    },
  }
  const fiber = await ctx.plugin(plugin)
  // 依赖不满足：apply 不会被调用，fiber 停在 pending。
  stage.log(`依赖缺席时 apply 被调用：${applied}（应为 false）`)
  stage.assert(!applied, '依赖缺失时不应执行 apply')
  await fiber.dispose()
  stage.log('cordis 用「不启动」代替「半启动」，这是装配期最有用的一条保证')
}

/** M12.3 —— 行 id 与 patch 覆盖。 */
async function patchOverride(stage: StageContext) {
  const { ctx } = stage
  // 装配清单本身是可读的：找到关键行的 id，说明覆盖语法。
  const loader = ctx.loader
  stage.log(`loader 在位：${loader !== undefined}`)
  stage.log('覆盖语法：在 cordis.patch.yml 里再写一条 `- id: <已有行 id>` + `config:`，后者整段替换')
  stage.log('禁用语法：`disabled: true` 或 `disabled: !!js <expr>`（本工程用它按平台选 pwsh/bash）')
  stage.log('新增语法：`- insert: [...]`，可嵌套 `group` 做子节点')
}

/** M12.4 —— 失败即大声。 */
async function failLoud(stage: StageContext) {
  const { ctx } = stage
  // 注册一个配置非法的插件：cordis 会在装配期抛错，而不是等到第一次调用。
  let threw = false
  try {
    await ctx.plugin({
      name: 'lab:m12-bad-config',
      inject: [],
      Config: (await import('@deepseek-ai/schemastery')).default.object({
        requiredField: (await import('@deepseek-ai/schemastery')).default.string().required(),
      }),
      apply() {},
    })
  } catch {
    threw = true
  }
  stage.log(`非法配置在装配期报错：${threw}`)
  stage.log('不允许「带病运行」：装配期的错误必须在装配期抛出')
}

/** M12.5 —— 打印装配树概况。 */
async function describeTree(stage: StageContext) {
  const { ctx } = stage
  const tools = ctx.tools.schemas()
  const commands = ctx.commands.list(
    (await ctx.agents.create({ sessionId: stage.sessionId as never })).agent,
  )
  stage.log(`工具 ${tools.length} 个：${tools.map((schema) => schema.name).sort().join(', ')}`)
  stage.log(`命令 ${commands.length} 个：${commands.map((command) => '/' + command.name).join(', ')}`)
  const providers = ctx.llm.listProviders()
  stage.log(`路由 ${providers.length} 条：${providers.map((info: { id: string }) => info.id).join(', ')}`)
  stage.log('以上全部来自 cordis.patch.yml —— 没有一行是代码里手工 new 出来的')
}

export default defineModule({
  id: 'M12',
  title: 'Cordis 运行时与装配树',
  stages: [
    { id: 'M12.1', title: '可逆 effect', kind: 'mechanism', run: reversibleEffect },
    { id: 'M12.2', title: '依赖注入：缺席即不启动', kind: 'mechanism', run: dependencyInjection },
    { id: 'M12.3', title: '行 id 与 patch 覆盖', kind: 'mechanism', run: patchOverride },
    { id: 'M12.4', title: '失败即大声', kind: 'mechanism', run: failLoud },
    { id: 'M12.5', title: '装配树概况', kind: 'mechanism', run: describeTree },
  ],
})

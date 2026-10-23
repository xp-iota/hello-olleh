/**
 * M11 · 配置、数据与持久化。
 *
 * 除了会话日志，dsh 还有四类结构化状态，各有明确归属：
 *
 *   存储     `ctx.storage`       schema 校验的领域记录（storage-domain over JSON backend）
 *   附件     `ctx.attachments`   图片/文件的不可变字节，日志里只存引用
 *   凭据     `ctx.credentials`   密钥的引用解析（永不进日志、永不进环境）
 *   引用     `ctx.sessionReferences` / `ctx.fileReferences`  跨会话与文件的快照引用
 *
 * 这一章的关键是"引用而不是内容"：日志里出现的是 id，真实字节在各自的后端里，
 * 因此日志可以安全分享，而敏感内容仍然受授权保护。
 *
 * @module dsh-lab/M11
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M11.1 —— 存储域：schema 校验的结构化记录。 */
async function storageDomain(stage: StageContext) {
  const { ctx } = stage
  stage.log(`storage 服务：${ctx.storage.constructor.name}`)
  // 领域由 storage-domain 的 DomainFacility 打开，而不是 storage 上的方法。
  // 分两层是有意的：storage 只管"哪个领域路由到哪个后端"，领域语义（schema、
  // 版本、表结构）在上一层的 facility。
  const facility = ctx.storageDomain
  stage.log(`storageDomain 服务：${facility?.constructor?.name ?? '(未装配)'}`)
  stage.assert(facility !== undefined, 'storageDomain 未装配（storage-domain 行）')

  // 一个真实的领域声明：一张表 + 一条记录 schema。
  // `defineDomain` 在模块加载期就校验名字/版本，schema 不符则在 open 时报错——
  // 也就是说脏数据进不去，而不是进去之后才被发现。
  const { defineDomain, domainTable } = await import('@deepseek-ai/dsh-storage-domain')
  const { z } = await import('zod')
  const spec = defineDomain({
    name: 'lab_m11_demo',
    version: 1,
    tables: {
      notes: domainTable(z.object({ id: z.string(), text: z.string() })),
    },
  })
  const opened = await facility
    .open(spec)
    .then((domain) => ({ ok: true as const, domain }))
    .catch((error: Error) => ({ ok: false as const, error }))
  if (opened.ok) {
    stage.log(`已打开领域 "lab_m11_demo"（表：notes）`)
    stage.log('storage-domain 用 zod 校验写入，schema 不符即报错（不会静默存脏数据）')
  } else {
    stage.log(`打开领域失败（属正常，取决于后端路由）：${opened.error.message.slice(0, 90)}`)
  }
}

/** M11.2 —— 附件：字节与引用分离。 */
async function attachments(stage: StageContext) {
  const { ctx } = stage
  const attachments = ctx.get('attachments' as never)
  stage.log(`attachments：${attachments === undefined ? '(未装配)' : '在位'}`)
  stage.log('消息里的 ImageBlock 只带 attachment 引用；字节由 attachment-local 保管')
  stage.log('这样会话日志可以安全复制，而图片仍然按授权读取')
}

/** M11.3 —— 凭据：解析而不暴露。 */
async function credentials(stage: StageContext) {
  const { ctx } = stage
  const { credentialRef } = await import('@deepseek-ai/dsh-credentials')
  stage.log(`credentials 服务：${ctx.credentials.constructor.name}`)
  // 引用是"带品牌的字符串"（POSIX 环境变量名那种形态），不是 {kind, name} 对象。
  // 用一个必然不存在的引用，验证"解析不到返回 undefined"而不是抛错。
  const missing = await ctx.credentials.resolve(credentialRef('DSH_LAB_SURELY_MISSING_KEY'))
  stage.log(`不存在的引用解析结果：${missing === undefined ? 'undefined（fail closed）' : '(意外命中)'}`)
  stage.assert(missing === undefined, '不存在的引用不应解析出值')
  // 存在与否都不打印值：这条接缝的整个意义就是"值不落到日志里"。
  const present = await ctx.credentials.resolve(credentialRef('LLM_API_KEY'))
  stage.log(`LLM_API_KEY 是否可解析：${present === undefined ? '否（未配置）' : '是（值不外显）'}`)
  stage.log('适配器在每次请求时解析引用，因此轮换密钥不需要重启进程')
}

/** M11.4 —— 跨会话引用。 */
async function sessionReference(stage: StageContext) {
  const { ctx } = stage
  const refs = ctx.get('sessionReferences' as never)
  stage.log(`session-reference：${refs === undefined ? '(未装配)' : '在位'}`)
  stage.log('把另一条会话的快照按预算放进当前上下文（recall 形态），而不是复制整条日志')
}

/** M11.5 —— 文件引用。 */
async function fileReference(stage: StageContext) {
  const { ctx } = stage
  const refs = ctx.get('fileReferences' as never)
  stage.log(`file-reference：${refs === undefined ? '(未装配)' : '在位'}`)
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  try {
    const assembly = await ctx.systemPrompt.assemble()
    const hasFileRef = assembly.sections.some((section) => section.name.toLowerCase().includes('file'))
    stage.log(`系统提示含文件引用段落：${hasFileRef}`)
  } finally {
    await handle.dispose()
  }
}

export default defineModule({
  id: 'M11',
  title: '配置、数据与持久化',
  stages: [
    { id: 'M11.1', title: '存储域与 schema 校验', kind: 'mechanism', run: storageDomain },
    { id: 'M11.2', title: '附件：字节与引用分离', kind: 'mechanism', run: attachments },
    { id: 'M11.3', title: '凭据：解析而不暴露', kind: 'mechanism', run: credentials },
    { id: 'M11.4', title: '跨会话引用', kind: 'mechanism', run: sessionReference },
    { id: 'M11.5', title: '文件引用', kind: 'mechanism', run: fileReference },
  ],
})

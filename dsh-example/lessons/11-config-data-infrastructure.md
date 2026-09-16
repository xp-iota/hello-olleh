# 第 11 课 · 配置与数据设施：分层解析、内容寻址与不读秘密

> **本课任务**：注册一个带 schema 的 settings 命名空间，走完「默认值 → update 合并 → 过期修订号被拒 →
> mutate 路径编辑 → replace 重置」的完整写入序列；再把 storage / attachments / file references /
> credentials+authorization / workspace 五类数据设施各自装一遍，看它们各自暴露什么、藏住什么。
> **运行命令**：`cd dsh-example && npm run M11`
> **你将看到**：`theme/fontSize` 的分层解析与 `revision` 逐级递增；一条 CAS 冲突报错原文；
> 附件 id 是一串 `sha256:` 摘要；凭证只报 `configured: false`，一个 secret 都没读。
> 六个阶段的机制断言全部由**本地设施**驱动——每阶段唯一那次模型调用只是入口 probe。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

前几课都在讲「让模型做事」。这一课反过来：讲**状态放在哪、谁能改、改了怎么不互相踩**。
六个场景是六块互相独立的基础设施，只有第 1 块有完整的行为序列，其余五块各证明一条设计原则。

| 子能力 | 回答的问题 | 本课对应实现 | 关键设计点 |
|---|---|---|---|
| **settings** | 用户偏好放哪、怎么合并？ | `impl/01-settings-namespaces.ts` | schema 默认值 + base + user 三层；`revision` 做 CAS |
| **storage** | 数据落在哪个后端？ | `impl/02-json-storage-domain.ts` | `storage` 是 hub，domain 声明式路由到 JSON |
| **attachments** | 大块内容怎么存？ | `impl/03-local-attachments.ts` | 内容寻址：id 就是内容哈希 |
| **file references** | 怎么索引候选文件？ | `impl/04-local-file-references.ts` | 按 Agent workspace 索引，**只给相对路径** |
| **credentials / authorization** | 秘密怎么不泄露？ | `impl/05-credentials-authorization.ts` | 只暴露引用与状态；授权 flow 可撤销 |
| **workspace** | 怎么组合而不复制数据？ | `impl/06-workspace-registry.ts` | 视图存进 storage domain，Session 交给持久化 |

```bash
cd dsh-example && npm run M11
```

> **注意**：M11 的六个场景都是 `kind: 'mechanism'`，跑之前会各做一次真实推理入口 probe。
> **机制断言本身不调模型**——所以即使模型返回内容有波动，本课的机制输出也是稳定的。

---

## 2. 真实输出

```text
████ M11 · 配置与数据设施：配置、存储、附件、凭证与工作区 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M11.1 · 注册并驱动 settings 命名空间 ────
① 未写任何东西：解析值 = schema 默认值
   { theme: 'dark', fontSize: 14 } | revision = 0

② update：合并补丁进 user 层
  [watch] demo 提交 → {"theme":"dark","fontSize":16} （prev: {"theme":"dark","fontSize":14}）
   revision = 1

③ 乐观并发：过期 expectedRevision 被拒
   settings namespace "demo" changed since it was read (expected revision 0, now 1)

④ 带对的 expectedRevision 则放行
  [watch] demo 提交 → {"theme":"light","fontSize":16} （prev: {"theme":"dark","fontSize":16}）
   revision = 2

⑤ mutate：路径级编辑（op 是 set / unset）
  [watch] demo 提交 → {"theme":"light","fontSize":18} （prev: {"theme":"light","fontSize":16}）
   当前值: { theme: 'light', fontSize: 18 }

⑥ replace({})：整段清空 user 层 → 全部回落默认值（merge 表达不了的"重置"）
  [watch] demo 提交 → {"theme":"dark","fontSize":14} （prev: {"theme":"light","fontSize":18}）
   重置后: { theme: 'dark', fontSize: 14 }

⑦ 重复注册同一命名空间抛错
   settings namespace "demo" is already registered
REAL_STAGE_OK M11.1 calls=1 ms=650 in=0 out=103 finish=stop

──── M11.2 · 装配 JSON storage 与 domain 路由 ────
storage: {
  hub: 'Storage',
  backend: 'JsonStorageBackend',
  domainFacility: 'DomainFacility'
}
REAL_STAGE_OK M11.2 calls=1 ms=559 in=0 out=52 finish=stop

──── M11.3 · 保存 content-addressed 本地附件 ────
attachments: {
  backend: 'LocalAttachmentStore',
  attachmentId: 'sha256:565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3',
  name: 'sample.bin'
}
REAL_STAGE_OK M11.3 calls=1 ms=584 in=0 out=99 finish=stop

──── M11.4 · 按 Agent workspace 搜索文件引用 ────
fileReferences: {
  backend: 'LocalFileReferenceService',
  matches: 5,
  sample: 'README.md'
}
REAL_STAGE_OK M11.4 calls=1 ms=1600 in=0 out=69 finish=stop

──── M11.5 · 只读取凭证状态并列出授权 flow ────
credentials: {
  provider: 'LocalCredentialProvider',
  safeDescription: { configured: false, writable: true },
  authorizationFlows: []
}
REAL_STAGE_OK M11.5 calls=1 ms=504 in=0 out=58 finish=stop

──── M11.6 · 组合 workspace 与耐久 Session ────
workspaceRegistry: {
  service: 'WorkspaceRegistry',
  listed: 0,
  persistence: 'JsonlSessionPersistence'
}
REAL_STAGE_OK M11.6 calls=1 ms=527 in=0 out=85 finish=stop

REAL_MODULE_OK M11 stages=6 calls=6 failed=0
```

**对照自己的输出**：最后一行必须是 `REAL_MODULE_OK M11 stages=6 calls=6 failed=0`。
六个 `REAL_STAGE_OK` 里的 `calls=1` 是那一阶段的入口 probe（真实模型复述），**机制正文不消耗模型调用**。
M11.1 的正文是本课唯一需要逐行读的证据链——第 ④～⑦ 节全部围绕它展开。

---

## 3. settings 一：分层解析与命名空间

打开 [`impl/01-settings-namespaces.ts`](../M11-config-data-infrastructure/impl/01-settings-namespaces.ts)。

```ts
export const name = 'settings-namespaces'   // 插件名，用于 Fiber 诊断
export const inject = ['settings']          // ctx.settings 就绪后 apply 才运行

/** 命名空间字面量，导出给 run.ts 复用同一个值。 */
export const DEMO_NS = 'demo' as const

export const DemoSchema: z<DemoSettings> = z.object({
  theme: z.string().default('dark'),
  fontSize: z.number().default(14),
})

export function apply(ctx: Context) {
  const scope = ctx.settings.register(DEMO_NS, DemoSchema)

  // scope.watch：只观测本命名空间的提交，拿 (next, prev) 两个解析值；返回注销 disposer。
  ctx.effect(() => scope.watch((next, prev) => {
    console.log('  [watch] demo 提交 →', JSON.stringify(next), `（prev: ${JSON.stringify(prev)}）`)
  }))
}
```

### 值是怎么解析出来的

第 2 节 ① 行是起点：

```text
① 未写任何东西：解析值 = schema 默认值
   { theme: 'dark', fontSize: 14 } | revision = 0
```

什么都没写，却拿得到一个完整的 `{ theme, fontSize }`——因为它不是一个「存储的值」，而是**三层叠加的结果**：

```text
schema default  →  composition base  →  user 层覆盖
```

`schema default` 来自 `z.string().default('dark')` / `z.number().default(14)`；
`composition base` 是注册时可选传的 `base`（本课没传，所以是空层）；
`user 层` 是真正写进 provider 文档、随用户修改而变化的那部分。
**`revision` 跟踪的是 user 层，不是解析值**——所以 ① 行 `revision = 0`。

这条分离是第 ⑥ 节「`replace({})` 重置」能成立的前提：清空 user 层之后，下面两层原封不动地重新露出来。

### 一个版本事实：这里**没有** `settingsNamespace()` 工厂

实现文件顶部写得很直白：

```ts
// 0.1.5 起没有 settingsNamespace() 工厂：命名空间就是字符串字面量，
// 由 register() 的 SettingsNamespaceInput 在类型层校验（必须小写字母开头）。
```

也就是说 0.1.5 之后 `DEMO_NS` **就是一个普通字符串字面量**，不需要也不存在一个 `settingsNamespace('demo')`
这样的 brand 铸造函数。约束移到了类型层：`register()` 的形参类型会要求命名空间是
「小写字母开头、后面只能是小写字母/数字/连字符」的字符串字面量；写成 `'Demo'` 或 `'demo_ns'`
会**在编译期**报类型错误，而不是运行期抛异常。

### `watch` 返回 disposer

```ts
ctx.effect(() => scope.watch((next, prev) => { ... }))
```

`scope.watch` 只观测**本命名空间**的提交（不是全局 settings 变化），回调拿到 `(next, prev)` 两个**已解析**的值，
返回一个注销函数；外面套的 `ctx.effect(...)` 把这个注销挂到插件 Fiber 上。
第 2 节里 ②④⑤⑥ 四行 `[watch] demo 提交 → ...` 就是它的输出——**写几次就响几次**，
而且 `prev` 与 `next` 都已经是三层合成后的完整值：

```text
[watch] demo 提交 → {"theme":"light","fontSize":16} （prev: {"theme":"dark","fontSize":16}）
```

只有 `theme` 变了，但两边的 `fontSize` 都在——因为 watch 观测的是**解析值**，不是 diff。

> **原理对照**：settings 组与「settings 与启动配置不是一回事」的区分见
> [09 § 9.17](../../docs/hello-dsh/09-host-runtime-and-storage.md)。

---

## 4. settings 二：乐观并发的两个层级

这是本课最重要的一节，也是最容易记混的地方。

### provider 级写路径带 CAS

第 2 节的 ②③④ 三行构成一次完整的 CAS（compare-and-swap）演示。场景代码
（[`scenes/01-settings-cas-conflict.ts`](../M11-config-data-infrastructure/scenes/01-settings-cas-conflict.ts)）：

```ts
console.log('\n③ 乐观并发：过期 expectedRevision 被拒')
try {
  await settings.update(DEMO_NS, { fontSize: 20 }, 0)
  console.log('   竟然通过了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}

console.log('\n④ 带对的 expectedRevision 则放行')
await settings.update(DEMO_NS, { theme: 'light' }, revision())
```

- ② 写了一次 → `revision` 从 0 变 1；
- ③ 拿着**读到的旧值 0** 去写 → 被拒，报错原文：
  `settings namespace "demo" changed since it was read (expected revision 0, now 1)`
- ④ 拿**当前** `revision()` 再写 → 通过，`revision = 2`。

**关键点是 ③ 的补丁本身完全合法**：`{ fontSize: 20 }` 类型对、字段存在、schema 也认。
它被拒的**唯一原因**是调用方拿着一个过期快照在写——这正是「乐观并发」的定义：
不锁，但用修订号在提交点识别出「你读到的世界已经变了」。

### scope 级 API 不带 CAS

实现文件的注释把这条边界写死了：

```ts
 *   - register(ns, schema) 返回属主 scope：get() / watch((next, prev)) / update(patch) /
 *     replace(section) —— scope 级**不带**乐观并发；重复注册抛错；
 *   - provider 级写路径带 CAS：update / replace / mutate(ns, ops, expectedRevision)
 *     —— 修订号不匹配抛 SettingsConflictError；mutate 的 op 是 set / unset。
```

整理成对照表：

| 层级 | 调用形式 | 是否带 `expectedRevision` | 适用场景 |
|---|---|---|---|
| **scope 级** | `scope.get()` / `scope.watch(cb)` / `scope.update(patch)` / `scope.replace(section)` | **不带** | 插件改自己注册的那个命名空间：只有一个写者，没有并发问题 |
| **provider 级** | `settings.get(ns)` / `settings.update(ns, patch, rev)` / `settings.replace(ns, section, rev)` / `settings.mutate(ns, ops, rev)` | **带**（可选） | 配置界面等**外部**写者：读 → 展示 → 用户改 → 写回，中间可能隔了很久 |

这条分工很实用：插件**自己**的默认值和内部开关用 scope 级，简单；
**配置面板**代表用户写，必须走 provider 级并回传它读到的那份 `revision`，
否则会静默覆盖别人在这期间做的修改。

### `mutate` 是路径级编辑

第 2 节 ⑤：

```ts
await settings.mutate(DEMO_NS, [{ op: 'set', path: ['fontSize'], value: 18 }])
```

```text
⑤ mutate：路径级编辑（op 是 set / unset）
  [watch] demo 提交 → {"theme":"light","fontSize":18} （prev: {"theme":"light","fontSize":16}）
   当前值: { theme: 'light', fontSize: 18 }
```

`mutate` 的第二个参数是一串**有序路径操作**，`op` 只有两个取值：

| `op` | 含义 |
|---|---|
| `set` | 把 `path` 指向的位置设为 `value` |
| `unset` | 删掉 `path` 指向的位置——**该字段回落到底层（base / schema 默认值）** |

为什么要有 `mutate` 而不是让大家都用 `update`？因为持有**脱敏视图**的调用方不能安全地
`update` 整个对象：它没看到的字段会在合并时被它一起提交。`mutate` 只声明「我要改这个路径」，
**不需要重述没碰过的字段，也就无法删掉自己从未见过的字段**。`replace` 则保留作整体重置的入口。

### `replace({})` 表达 merge 表达不了的「重置」

第 2 节 ⑥：

```ts
await settings.replace(DEMO_NS, {})
```

```text
⑥ replace({})：整段清空 user 层 → 全部回落默认值（merge 表达不了的"重置"）
  [watch] demo 提交 → {"theme":"dark","fontSize":14} （prev: {"theme":"light","fontSize":18}）
   重置后: { theme: 'dark', fontSize: 14 }
```

`update` 的语义是**合并补丁**，所以它永远只能往上加/改，**无法把某个键删除回默认值**——
`{ fontSize: undefined }` 不是删除，`{}` 则是空操作。`replace` 走另一条路：**用整段 section 顶替 user 层**，
`replace({})` 就是「user 层清空」，于是解析值层层回落，正好等于 ① 行最初的 schema 默认值。
注意 `revision` 仍在递增（这是第 3 次提交），只是**内容**回到了起点。

### ⑦ 重复注册抛错

```text
⑦ 重复注册同一命名空间抛错
   settings namespace "demo" is already registered
```

命名空间是**唯一**的：`register()` 是「声明这个命名空间的 schema 与属主」，
同一个 ns 注册两次就是两个属主争一份 schema，没有合理的合并语义，所以直接抛错。
这和 `register` 的 effect 语义配对——注册挂在调用插件的 Fiber 上，插件 dispose 时命名空间与
它的 observers 一起被移除，**不需要手写反注册**。

---

## 5. storage：hub 与声明式 domain 路由

打开 [`impl/02-json-storage-domain.ts`](../M11-config-data-infrastructure/impl/02-json-storage-domain.ts)——**全文 15 行**：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: config.root })
  await ctx.plugin(storageDomain, { backend: 'json', routes: {} })
}
```

三个插件、三层职责，第 2 节 M11.2 的输出来自
[`scenes/02-route-storage-domain.ts`](../M11-config-data-infrastructure/scenes/02-route-storage-domain.ts)
里的一句 `console.log`：

```ts
console.log('storage:', { hub: harness.ctx.storage.constructor.name, backend: harness.ctx.storage.backend.get('json').constructor.name, domainFacility: harness.ctx.storageDomain.constructor.name })
```

```text
storage: {
  hub: 'Storage',
  backend: 'JsonStorageBackend',
  domainFacility: 'DomainFacility'
}
```

三个名字对应三个层次：

| 名字 | 角色 | 说明 |
|---|---|---|
| `Storage` | **hub（Definition）** | 服务本体，`ctx.storage`；它自己**不存数据**，只管注册 backend |
| `JsonStorageBackend` | **backend（Provider）** | 真正读写数据的实现，`ctx.storage.backend.get('json')` 按名字取到它 |
| `DomainFacility` | **域路由** | 把**声明式 domain** 映射到某个 backend |

`storageDomain` 的配置 `{ backend: 'json', routes: {} }` 就是这条路由的声明：默认 backend 是 `json`，
`routes` 留空表示没有特例 domain。**结果是插件都不需要知道「数据存在 JSON 还是 SQLite」**——
它们只声明自己要一个 domain，由这一层决定落到哪个 backend。要换成 SQLite，
改的是这一个文件，一行配置，其它调用点不动。

> **原理对照**：四个 storage 包的大小与分工、JSON vs SQLite 的选择见
> [09 § 9.28](../../docs/hello-dsh/09-host-runtime-and-storage.md)。

---

## 6. attachments 与 file references：内容寻址 + 工作区相对路径

这两个扩展面各只有一个 re-export，实现全在官方包里：

```ts
/** attachments Definition 由 content-addressed 本地 Provider 实现，文件落在显式 dshHome。 */
export { LocalAttachmentStore as default, LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
```

```ts
/** fileReferences 按 Agent workspace 索引候选文件，不把宿主绝对路径写进模型参数。 */
export { LocalFileReferenceService as default, LocalFileReferenceService } from '@deepseek-ai/dsh-file-reference-local'
```

两行注释已经把设计点说完了，下面用输出把它们坐实。

### attachments：id 就是内容摘要

[`scenes/03-store-attachment.ts`](../M11-config-data-infrastructure/scenes/03-store-attachment.ts)：

```ts
  const ref = await harness.ctx.attachments.saveFile({ data: Uint8Array.from([79, 75]), name: 'sample.bin' })
  console.log('attachments:', { backend: harness.ctx.attachments.constructor.name, attachmentId: String(ref.attachmentId), name: ref.name })
```

```text
attachments: {
  backend: 'LocalAttachmentStore',
  attachmentId: 'sha256:565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3',
  name: 'sample.bin'
}
```

`Uint8Array.from([79, 75])` 是两个字节 `0x4F 0x4B`（ASCII 的 `OK`）。
把那两个字节做 SHA-256，得到的正是 `565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3`——
也就是说 **`attachmentId` 不是随机 id，不是自增序号，而是内容的哈希本身**：

```bash
node -e "console.log(require('crypto').createHash('sha256').update(Buffer.from([79,75])).digest('hex'))"
# 565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3
```

「内容寻址（content-addressed）」这个性质推出三件事，都很值钱：

1. **同样内容自然去重**：存两次同样的字节会得到同一个 id，后端只需要存一份（`name` 是引用上的元数据，
   换名字不影响 id）。
2. **id 可验证**：拿到文件后重算摘要即可确认内容没被篡改——不需要额外的完整性字段。
3. **id 本身不泄露任何东西**：它是哈希，不是路径、不是带 token 的 URL。所以它**可以安全地序列化进
   Session 日志、发给模型**；文件在磁盘哪里，留在 Host 侧。

配套一条边界：文件落在**显式传入的 `dshHome`**（场景里是 `mkdtemp` 出来的临时目录），
不是散落在当前工作目录——测试与真实运行用同一套代码路径，只是换 root。

### file references：只给工作区相对路径

[`scenes/04-search-workspace-refs.ts`](../M11-config-data-infrastructure/scenes/04-search-workspace-refs.ts)：

```ts
await harness.loadPlugin(LocalFileReferenceService, { maxResults: 5, maxEntries: 100, excludedDirectories: ['node_modules', '.git'] })
const matches = await harness.ctx.fileReferences.list(harness.agent, 'README', new AbortController().signal)
console.log('fileReferences:', { backend: harness.ctx.fileReferences.constructor.name, matches: matches.length, sample: matches[0]?.path })
```

```text
fileReferences: {
  backend: 'LocalFileReferenceService',
  matches: 5,
  sample: 'README.md'
}
```

注意 `list()` 的第一个参数是 **`harness.agent`**，不是路径字符串——索引范围由**那个 Agent 的
workspace** 决定。这解释了 `excludedDirectories: ['node_modules', '.git']` 为什么是服务配置而不是查询参数：
它是索引策略，属于服务，不属于某一次查询。`maxResults: 5` 也直接体现在 `matches: 5` 上。

`sample: 'README.md'` 是**相对路径**。实际跑一下把五个候选都打出来，可以看到全是工作区相对形式：

```text
{ path: 'README.md', kind: 'file' }
{ path: 'M01-tool-pipeline/README.md', kind: 'file' }
{ path: 'M05-session-surface/README.md', kind: 'file' }
{ path: 'M06-human-in-the-loop/README.md', kind: 'file' }
{ path: 'M07-execution-backends/README.md', kind: 'file' }
```

**为什么必须这样**：这些候选最终会变成用户提示里的 `@` 引用，进而进入模型参数。
如果这里吐的是 `/home/someone/...` 这样的宿主绝对路径，就等于把机器的目录结构、
用户名、甚至内部项目命名一起塞进了发给推理服务的请求里。相对路径对模型**同样够用**
（它作用于同一个工作区），却不多泄露一个字节——这也是实现文件注释那句
「**不把宿主绝对路径写进模型参数**」的兑现。

`kind: 'file' | 'directory'` 是给补全用的：目录继续展开，文件结束一次 mention。

---

## 7. credentials / authorization / workspace：组合而不读秘密

### credentials：只描述，不取值

[`impl/05-credentials-authorization.ts`](../M11-config-data-infrastructure/impl/05-credentials-authorization.ts)：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(LocalCredentialProvider, { path: config.path, watch: false, debounceMs: 0 })
  await ctx.plugin(AuthorizationService)
}
```

场景只调了 `describe`，并且用的是 `credentialRef(...)` 铸出来的**引用**，不是明文：

```ts
  const info = await harness.ctx.credentials.describe(credentialRef('DSH_EXAMPLE_UNSET_CREDENTIAL'))
  console.log('credentials:', { provider: harness.ctx.credentials.constructor.name, safeDescription: info, authorizationFlows: harness.ctx.authorization.list() })
```

```text
credentials: {
  provider: 'LocalCredentialProvider',
  safeDescription: { configured: false, writable: true },
  authorizationFlows: []
}
```

`{ configured: false, writable: true }` 里**没有任何 secret**，只有两个布尔：

- `configured`：现在能不能解析出一个值（这里是「没配」，因为名字就是 `..._UNSET_...`）；
- `writable`：当前 provider 能不能写这个引用。

这正是「安全描述（safe description）」的含义：配置界面需要知道
「这个密钥配了没有 / 能不能改」，但**永远不需要知道它是什么**。
`describe` 之所以是读取 secret 的**唯一入口的替代品**，是因为它根本不经过解析那一步。

这跟第 6 节的附件 id 是同一个思路的两个实例：**对外暴露的是可用性元数据，不是值本身**。
（附件暴露的是内容哈希，凭证暴露的是布尔状态。）

### authorization：注册的是**可撤销**的 flow

```text
authorizationFlows: []
```

空数组——因为本课的场景一个 flow 都没注册。但它证明的是接口形状：`ctx.authorization.list()`
返回的是「当前注册了哪些 flow」，一个纯列表。

flow 的注册语义按设计是**可撤销**的：注册返回一个 disposer，撤销后这条 flow 就从列表里消失。
这个形状不是随便选的，它配合的是 host/client 分离——浏览器那侧发起授权、拿回凭证，
**凭证在 Host 侧落库，client 只拿到引用**。所以：

- 配置面读不到 secret（只有 `describe` 的布尔）；
- 每条 flow 的生命周期与注册它的插件绑定，插件卸载流程即可撤销；
- 需要「用户授权 / 撤销授权」时，被操作的是 flow 与 record，而不是把密钥读出来再写回。

一句话记住本节的边界：**能读 secret 的代码路径和能展示配置的代码路径，是两个不同的面**。

### workspace：组合，不复制

[`impl/06-workspace-registry.ts`](../M11-config-data-infrastructure/impl/06-workspace-registry.ts)：

```ts
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(jsonStorage, { root: join(config.root, 'storage') })
  await ctx.plugin(JsonlSessionPersistence, { root: join(config.root, 'sessions'), compression: 'none' })
  await ctx.plugin(WorkspaceRegistry)
}
```

```text
workspaceRegistry: {
  service: 'WorkspaceRegistry',
  listed: 0,
  persistence: 'JsonlSessionPersistence'
}
```

三行装载对应三个已有能力，**没有一行在重新实现存储**：

1. 复用第 5 节的 `impl/02-json-storage-domain.ts`（注意是直接 import 那个模块，连配置都只是换 root）——
   workspace 的视图存在 storage domain 里；
2. 装 `JsonlSessionPersistence`，把 `root/sessions` 作为 Session 落盘位置；
3. 装 `WorkspaceRegistry`，它的 `list()` 就是输出里的 `listed: 0`。

`listed: 0` 是**空注册表的正常输出**（临时 root，没有历史 workspace），不是错误。
真正传递信息的是 `persistence: 'JsonlSessionPersistence'`——workspace 与 Session 共用一套
持久化设施来**校验 Session**，所以「这个 Session 属于哪个 workspace」这类信息不会
出现第二份副本。

> **原理对照**：JSONL 为什么契合、以及为什么它有 1939 行，见
> [09 § 9.30](../../docs/hello-dsh/09-host-runtime-and-storage.md)。

### 边界：`fileUploads` 只记录，不装载

[`README.md`](../M11-config-data-infrastructure/README.md) 最后一节写得很清楚：

> `fileUploads` 强依赖 client connection 与 Host 传输面，因此只记录边界，不装载到核心 harness。

这是本课最该学的一条**判断准则**：一个能力如果依赖「浏览器连接 + Host 传输面」才成立，
那它就不属于核心 harness 的职责。硬塞进来只会让 core 背上一份它无法自洽的依赖。
**记录边界**（在 README 里点明它存在、以及为什么不在）比**假装它不存在**更诚实，
也比**硬装进来**更可维护。

---

## 8. 排障：settings 写进去的值「看起来没生效」

### 症状

改了 schema 的默认值（比如把 `fontSize` 默认从 `14` 改成 `20`），跑起来仍然是 `14`；
或者 `replace({})` 之后以为「回到我配的 base」，结果回到了别处。

### 定位

先看 `describe()` 给出的三个层次，而不是只看解析值。本课场景里那句
`settings.describe().find((descriptor) => descriptor.ns === DEMO_NS)?.revision`
就是在读 descriptor。`describe()` 返回每个命名空间的
**composition `base` 与 raw user 两层**，正是为了回答这个问题：
某个字段到底是被 user 层覆盖了，还是本来就在 base 里。

### 原因与修改

解析顺序是固定的 **schema default → base → user**，后写的赢。两个常见错法：

1. **默认值改了但 user 层早就存了那个键**。只要 user 层里有 `fontSize`（② 行 `update` 之后就写进去了），
   schema 默认值就被盖住，改 schema 不会有任何可见变化。修法是 `replace({})` 或
   `mutate(ns, [{ op: 'unset', path: ['fontSize'] }])` 把这个键从 user 层删掉——删掉之后它才重新
   回落到下面两层。
2. **以为 `update` 能删键**。它不能：merge 语义只能加和改。想「重置」必须用 `replace`。

第三个不太像 bug 的坑：**代码里一切正常，配置面板却报 CAS 冲突**。那通常是因为面板把
`revision` 缓存得太久——它必须用**刚刚读到的**那份 descriptor 的 revision，读和写之间的任何一次
其它写入都会让它的期望过期（③ 行的报错正是这个）。

---

## 9. 代码在哪

```bash
cd dsh-example && ls M11-config-data-infrastructure/impl M11-config-data-infrastructure/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-settings-namespaces.ts`](../M11-config-data-infrastructure/impl/01-settings-namespaces.ts) | `DEMO_NS` 字面量、「没有 `settingsNamespace()` 工厂」的注释、`register` 返回 scope、`ctx.effect(() => scope.watch(...))` |
| [`scenes/01-settings-cas-conflict.ts`](../M11-config-data-infrastructure/scenes/01-settings-cas-conflict.ts) | ①～⑦ 的完整序列；③ 的过期 revision、⑤ 的 `{ op: 'set', path }`、⑥ 的 `replace({})` |
| [`impl/02-json-storage-domain.ts`](../M11-config-data-infrastructure/impl/02-json-storage-domain.ts) | 三行 `ctx.plugin`：hub / backend / domain 层的分工 |
| [`scenes/02-route-storage-domain.ts`](../M11-config-data-infrastructure/scenes/02-route-storage-domain.ts) | `backend.get('json')` 与 `domainFacility` 的取名方式 |
| [`impl/03-local-attachments.ts`](../M11-config-data-infrastructure/impl/03-local-attachments.ts) + [`scenes/03-store-attachment.ts`](../M11-config-data-infrastructure/scenes/03-store-attachment.ts) | `saveFile` 入参、`String(ref.attachmentId)` 的形状 |
| [`impl/04-local-file-references.ts`](../M11-config-data-infrastructure/impl/04-local-file-references.ts) + [`scenes/04-search-workspace-refs.ts`](../M11-config-data-infrastructure/scenes/04-search-workspace-refs.ts) | `list(agent, query, signal)` 的首参是 agent、`maxResults` 与输出的对应 |
| [`impl/05-credentials-authorization.ts`](../M11-config-data-infrastructure/impl/05-credentials-authorization.ts) + [`scenes/05-list-authorization-flows.ts`](../M11-config-data-infrastructure/scenes/05-list-authorization-flows.ts) | `credentialRef(...)` 引用、只调 `describe`、`authorization.list()` |
| [`impl/06-workspace-registry.ts`](../M11-config-data-infrastructure/impl/06-workspace-registry.ts) | 直接 import `./02-json-storage-domain.ts` 的复用姿势、`join(root, 'storage'/'sessions')` |

读法：**先读 scene 看它「演」出了哪几行输出，再读 impl 看它怎么「实现」**。
M11 的 impl 普遍极短（`03`/`04` 只有 2 行），所以真正的信息量在 scene 的调用方式与输出的对照上。

---

## 10. 动手练习

### 练习 A：用 `unset` 验证「回落」而不是「删除」

在 [`scenes/01-settings-cas-conflict.ts`](../M11-config-data-infrastructure/scenes/01-settings-cas-conflict.ts) 的 ⑤ 之后，
再加一次 `mutate`，只 `unset` `fontSize`（不 `set` 任何值）：

```ts
await settings.mutate(DEMO_NS, [{ op: 'unset', path: ['fontSize'] }])
console.log('   unset 之后:', settings.get(DEMO_NS))
```

**验证命令**

```bash
cd dsh-example && node M11-config-data-infrastructure/scenes/01-settings-cas-conflict.ts
```

**可验证答案**：此刻 user 层里还有 ④ 写入的 `theme: 'light'`，`fontSize` 被删掉后回落到 schema 默认值，
所以打印 `{ theme: 'light', fontSize: 14 }`（本课已实测）。
关键领悟：`unset` **不是把字段设成 `undefined`，而是把它从 user 层移除**——
移除之后，下面两层（base、schema 默认值）就露出来了。

### 练习 B：把 ③ 的过期 revision 换成当前值

把 [`scenes/01-settings-cas-conflict.ts`](../M11-config-data-infrastructure/scenes/01-settings-cas-conflict.ts) 里
`await settings.update(DEMO_NS, { fontSize: 20 }, 0)` 的最后一个实参从 `0` 改成 `revision()`。

**验证命令**

```bash
cd dsh-example && npm run M11
```

**可验证答案**：M11.1 的 ③ 不再打印那句 `changed since it was read`，而会打印
`竟然通过了?!`（场景为「本该失败却通过」这个分支准备的兜底分支）——
`revision` 依次变成 2，后面的 ④ 变成 3（本课已实测）。
这条练习证明 ③ 被拒的**唯一原因是修订号过期**，与补丁内容无关。

### 练习 C（进阶）：亲手验证内容寻址的两个推论

在 [`scenes/03-store-attachment.ts`](../M11-config-data-infrastructure/scenes/03-store-attachment.ts) 里
`saveFile` 之后再存两次：一次内容相同、文件名不同，一次内容不同、文件名相同。

**验证命令**

```bash
cd dsh-example && node M11-config-data-infrastructure/scenes/03-store-attachment.ts
```

**可验证答案**：同内容两次拿到**完全相同的** `sha256:565339…`（即使 `name` 不同），
改一个字节则 id 立刻完全不同（本课实测 `[79,76]` → `sha256:9ce28c43c1ca…`）。
也就是说 **id 只由内容决定，`name` 不参与**——这正是「去重免费、id 可校验」的来源。

---

**下一课** → [第 12 课 · 框架机制本体](12-framework-mechanisms.md)：把前面十一课用到的
事件派发、Fiber 生命周期与服务注入收进 Cordis 本体，回答「监听器为什么能组合、资源为什么能回收」。

# M11 · 配置、数据与持久化

除了会话日志，dsh 还有四类结构化状态，各有明确归属：

| 状态 | 服务 | 特点 |
|---|---|---|
| 存储域 | `ctx.storageDomain` | schema 校验的领域记录 |
| 附件 | `ctx.attachments` | 不可变字节，日志只存引用 |
| 凭据 | `ctx.credentials` | 引用解析，值永不进日志 |
| 引用 | `ctx.sessionReferences` / `ctx.fileReferences` | 跨会话/文件的快照 |

贯穿这一章的原则是：**引用而不是内容**。日志里出现的是 id，真实字节在各自后端里。

## 学习目标

- 理解 `storage`（路由）与 `storageDomain`（领域语义）为什么分两层；
- 知道 `defineDomain` 的 schema 校验发生在什么时候；
- 明白凭据的"解析而不暴露"如何做到轮换密钥不用重启；
- 分清附件与文件引用。

## 运行

```bash
npm run M11
```

不需要 key。

## 代码地图

```text
M11-config-data-durability/index.ts
├─ M11.1 storageDomain    # defineDomain + domainTable + facility.open
├─ M11.2 attachments      # 字节与引用分离
├─ M11.3 credentials      # credentialRef 解析，值不外显
├─ M11.4 sessionReference # 跨会话引用在位情况
└─ M11.5 fileReference    # 文件引用与系统提示
```

## M11.1：两层存储

`ctx.storage` 只管一件事：**哪个领域路由到哪个后端**。领域语义（schema、版本、表结构）在 `ctx.storageDomain` 上。

```ts
const spec = defineDomain({
  name: 'lab_m11_demo',
  version: 1,
  tables: {
    notes: domainTable(z.object({ id: z.string(), text: z.string() })),
  },
})
const domain = await ctx.storageDomain.open(spec)
```

`open` 收的是 **spec 对象**，不是名字字符串。这个签名选择有讲究：如果传名字，facility 就得自己去找 spec 注册表；传 spec 则把"这个领域长什么样"和"打开它"绑在一起，不会出现"名字对了但 schema 是旧的"。

`defineDomain` 在**模块加载期**就校验名字与版本，schema 不符则在 `open` 时报错。也就是说脏数据进不去，而不是进去之后才被发现。

## M11.3：凭据

```ts
const value = await ctx.credentials.resolve(credentialRef('LLM_API_KEY'))
```

`credentialRef` 是"带品牌的字符串"——POSIX 环境变量名那种形态，不是 `{kind, name}` 对象。品牌类型让编译器能区分"随便一个字符串"和"一个已校验的引用"。

两个行为值得注意：

1. **解析不到返回 `undefined`**，不抛错。这条接缝要能回答"配了吗"，而"没配"不是异常。
2. **值不外显**。M11.3 打印的是"是否可解析：是/否"，从不打印值。这不是示例的客气，是这条接缝存在的理由——值一旦落进日志就没有秘密了。

适配器在**每次请求**时解析（见 M03），所以轮换密钥不需要重启进程。

## 附件与文件引用

| | 附件 | 文件引用 |
|---|---|---|
| 内容 | 不可变字节（图片、上传文件） | 文件系统里某个文件的快照 |
| 日志里存 | attachment id | 路径 + 版本信息 |
| 读回时机 | 模型请求时按需 | 装配时按预算 |

消息里的 `ImageBlock` 只带 attachment 引用。这样会话日志可以安全复制（给别人看、提交到仓库），而图片仍然按授权读取。

## 排错

| 现象 | 原因 |
|---|---|
| `storage.domain is not a function` | 领域在 `storageDomain` 上，不在 `storage` 上 |
| `open` 报 schema 错 | `defineDomain` 的 spec 与已存数据版本不兼容 |
| `name.toUpperCase is not a function` | `credentials.resolve` 要 `credentialRef()` 包装的字符串，不是对象 |
| 附件读不到 | 引用过期或后端不在位 |

## 练习

1. 把 M11.1 的 `version` 改成 2，看已存数据会不会被接受（提示：`compatibleVersions`）。
2. 写一个违反 schema 的记录，确认它在写入时被拒而不是读出来才发现。
3. 给 M11.3 加一条断言：解析成功时**不要**把值打印到 stdout。

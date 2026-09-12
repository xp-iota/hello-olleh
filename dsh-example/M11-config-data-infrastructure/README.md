# M11 · 配置与数据设施

本模块整合原 23，聚焦 `ctx.settings` 的数据治理语义。

## 运行

```bash
npm run M11
```

`steps/01-settings-namespaces.ts` 用字符串字面量 `demo` 注册 schema，定义默认值与类型。运行阶段依次验证：读取默认配置、update 局部合并、带 revision 的 mutate/CAS、replace 整体替换、空对象重置回 schema 默认值，以及重复注册同一命名空间时 fail-loud。

命名空间让插件只拥有自己的配置域；schema 让缺省值和验证在边界发生；revision 让并发写入显式失败，而不是后写者静默覆盖前写者。

**结论：**配置不是任意 JSON 袋，而是带名称、schema、写语义和并发版本的数据接口。


## A4 · 数据设施 Provider 链

| 步骤 | 服务 | Provider/策略 |
|---|---|---|
| 02 | `storage`、`storageDomain` | 显式 JSON backend 路由 |
| 03 | `attachments` | content-addressed 本地文件 |
| 04 | `fileReferences` | Agent workspace 本地索引 |
| 05 | `credentials`、`authorization` | 只输出安全状态，不读取或打印 secret |
| 06 | `workspaceRegistry` | storage domain + session persistence |

`fileUploads` 属于 `dsh-client-file-upload`，强依赖 client connection/Host 传输面；PLAN §3.4 明确排除 client/web/desktop，因此 A4 只记录边界，不装载该服务。

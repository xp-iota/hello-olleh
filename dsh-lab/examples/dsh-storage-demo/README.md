# dsh-storage-demo —— 结构化状态四归属：存储域、附件、凭据、引用

一个完全独立的工程：把整个目录拷到任何地方，`npm install` 之后 `npm start`（Node）或
`npm run start:bun`（Bun）即可运行。**全程离线**——不需要任何 API key，五个场景全部
用真实服务 API 驱动，S5 的会话 turn 由自带的脚本化适配器播种。

配套文章：[09 宿主与运行面](../../../docs/hello-dsh/09-host-runtime-and-storage.md)
（§9.28 `ctx.storage` 四个包、§9.30–9.31 会话持久化与检索、§9.34 存储位置 Harness home）。
版本面：`@deepseek-ai/*` **0.2.2-rc.3**（与 `sources/deepseek-harness` 快照同版）、
`@deepseek-ai/cordis` **4.1.0**、`zod` **4.6.6**（storage-domain 同款）。

## 1. 问题

「把东西存下来」在 dsh 里不是一个存储，而是**四种归属不同的状态设施**，共享同一个认识：
**引用而不是内容**——日志里出现的是 id / ref / 名字，真实字节在各自后端里，
因此会话日志可以安全分享，而敏感内容仍受授权保护。

| 设施 | 状态归属 | 核心 API | 本示例验证什么 |
|:-----|:---------|:---------|:---------------|
| 存储域 | 插件自己的领域记录 | `defineDomain` + `storageDomain.open` | schema 校验发生在**重开边界**、backup-and-skip、真实落盘 |
| 附件 | 不可变字节 | `attachments.saveFile` / `fileHostPath` | 内容寻址 id、字节逐字节读回、同字节去重 |
| 凭据 | 敏感值 | `credentials.resolve(credentialRef(...))` | `{value,source}` 分层、文件优先环境、fail closed、**热轮换不重启** |
| 引用 | 指向别处的指针 | `fileReferences.list` / `sessionReferenceResolver` | @ 发现缝、条件提示段、跨会话快照进上下文、自引用拒绝 |

旧 M11 模块的三处描述在 rc.3 已过时，本示例全部以实测纠正：
**put 不做运行时 zod 校验**（校验在 `open()` 加载存量时）；
**local provider 是服务基类的子类**（只挂 local 一行，再挂基类行会报重复注册）；
**backup-and-skip 需要 per-record 布局**（single 布局没有 backupRecord，回退到拒绝）。

## 2. 装配树

`cordis.yml` 是空树 `[]`，全部装配来自 `cordis.patch.yml`（九行 base + 两行 fs/工作目录 +
三组状态设施 + 会话读取面，共 24 行）：

```yaml
# 结构化状态的最小树：九行 base + 两行 fs/工作目录 + 三组状态设施 + 会话读取面。
# 本示例不跑真实模型：S5 用脚本化适配器播种一条真实 turn（离线）。
# 依赖链：storage-domain/storage-json 注入 storage；
#         attachment-local/credentials-local/file-reference-local 都是服务基类的
#         子类（自己注册服务），只挂 local 一行，不能再挂基类行；
#         file-reference-local 注入 agents + workingDirectory（提示段还要 read 工具在位）；
#         tool-fs 注入 tools + fs + systemPrompt + workingDirectory；
#         session-reference 注入 sessionQuery（session-query-sqlite 提供）。
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'

    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

    - id: tools
      name: '@deepseek-ai/dsh-tools'

    - id: tool-executor-native
      name: '@deepseek-ai/dsh-tool-executor-native'

    - id: session
      name: '@deepseek-ai/dsh-session'

    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'

    - id: agent
      name: '@deepseek-ai/dsh-agent'

    - id: llm
      name: '@deepseek-ai/dsh-llm'

    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # ── fs 与工作目录：tool-fs / file-reference-local 的 inject 依赖 ───────
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'

    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'

    # ── S1 存储域：路由（storage）+ 后端（json）+ 领域语义（domain）────────
    # backend 必填：没有 universally correct 的介质，部署必须显式选择。
    - id: storage
      name: '@deepseek-ai/dsh-storage'

    - id: storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js dshHomePath('storages')

    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json

    # ── S2 附件：LocalAttachmentStore  extends AttachmentStore，一行即服务 ───
    - id: attachment-local
      name: '@deepseek-ai/dsh-attachment-local'

    # ── S3 凭据：LocalCredentialProvider extends CredentialProvider ─────────
    # 文档在 DSH_HOME/.credentials.yaml；watch 默认开，外部编辑热发布。
    - id: credentials-local
      name: '@deepseek-ai/dsh-credentials-local'

    # ── S4 文件引用：LocalFileReferenceService extends FileReferenceService ──
    - id: file-reference-local
      name: '@deepseek-ai/dsh-file-reference-local'

    # 只开 read/read_image：write/edit 关掉，本示例不改文件。
    - id: tool-fs
      name: '@deepseek-ai/dsh-tool-fs'
      config:
        write: false
        edit: false

    # ── S5 跨会话引用：会话读取面五行（同 dsh-session-demo 配方）───────────
    - id: session-log-deepseek
      name: '@deepseek-ai/dsh-session-log-deepseek'

    # session-log-deepseek 注入 deepseekLlmApiExtensions；缺这一行它永远 pending。
    - id: deepseek-llm-api-extensions
      name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'

    - id: session-persistence-jsonl
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js dshHomePath('sessions')
        compression: none

    # openAt: never = 不落 SQLite 索引文件；精确读/列表/表面照常可用。
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never

    - id: session-title
      name: '@deepseek-ai/dsh-session-title'
      config:
        fallbackMaxWords: 5
        fallbackMaxBytes: 40
        maxTitleBytes: 80

    # 引用服务：显式字节预算，不依赖模型路由的 context window 估算。
    - id: session-reference
      name: '@deepseek-ai/dsh-session-reference'
      config:
        maxReferenceBytes: 65536
```

三个值得注意的装配决定：

- **storage 三层分工**：`storage` 只管路由（哪个域走哪个后端），`storage-json` 是介质
  （`root` 指到 `DSH_HOME/storages`），`storage-domain` 是领域语义（schema/版本/表）。
  `backend: json` 必填——rc.3 明确拒绝「默认后端」的想法。
- **local 一行即服务**：三个 local provider 都 `extends` 各自的服务基类并自己注册服务，
  patch 里**没有** `dsh-attachment` / `dsh-credentials` / `dsh-file-reference` 基类行
  （它们只作为类型与 `credentialRef` 等工具函数的来源存在于 package.json）。
- **会话读取面复用 dsh-session-demo 配方**：五行缺一不可，`session-query-sqlite` 用
  `openAt: never` 不落索引文件（这也是本示例在 Bun 下无需任何补丁的原因之一——
  `node:sqlite` 根本不会被打开）。

## 3. 实测输出

`npm start`（Node v26.12.1）完整输出，原文粘贴：

```text
runtime = node v26.12.1

=== S1 存储域：schema 校验 ===
put/get：STORAGE-DOMAIN-OK-21
update 后：STORAGE-DOMAIN-OK-21（已更新）（表内 1 条）
脏记录重开：code=invalid-record（table=notes, key=n2）
backup-and-skip 重开：表内 1 条（坏记录已挪走），c1 仍在=true
落盘文件：.dsh-home\storages\storage_demo_notes.json

=== S2 附件：字节与引用分离 ===
引用形状：attachmentId=sha256:b5b153203… name=note.txt bytes=19
宿主路径读回：19 字节，内容一致=true
同字节重存：id 相同=true

=== S3 凭据：解析而不暴露 ===
文件层：source=file，值长度=13
环境层：source=env，值长度=12
文件与环境同名：source=file（托管存储优先）
不存在的引用：undefined（fail closed）
热轮换：新值长度=13，source=file（进程未重启）

=== S4 文件引用 ===
@src/in 候选：src/index.ts(file), src/plugins(directory)
系统提示含文件引用指引：true（read 工具在位）

=== S5 跨会话引用 ===
候选 2 条，含源会话：true（label=请记住标记 STORAGE-REF-MARKER-13，）
快照进上下文：true，含标记：true
自引用：code=SESSION_REFERENCE_SELF_REFERENCE

STORAGE_DEMO_OK
```

`npm run start:bun`（Bun 1.4.4）除首行 `runtime = bun 1.4.4` 外**逐行一致**（24 行，
`Compare-Object` 验证；attachmentId 是内容寻址 sha256，天然确定）。输出留档在
[runtime-out-node.txt](runtime-out-node.txt) 与 [runtime-out-bun.txt](runtime-out-bun.txt)。
**Bun 裸跑即绿，无需任何补丁**：不挂 ptc-runtime/subprocess，SQLite `openAt: never`。

## 4. 逐场景机制

### S1 存储域：schema 校验发生在重开边界

`defineDomain({name, version, tables})` 声明领域，`domainTable(z.object(...))` 给每张表
一个 zod schema；`storageDomain.open(spec)` 收 **spec 对象**而不是名字——「领域长什么样」
和「打开它」绑在一起。`KvTable` 提供 get/put/delete/update/entries/keys/size，
`update` 是读-改-写一体（回调拿当前值、返回新值）。

rc.3 的真实边界与直觉相反：**`put` 不做运行时 zod 校验**——类型系统挡住正常调用，
绕过类型的脏数据（示例里 `as never`）能进介质。校验发生在 **`open()` 加载存量记录时**：
`parseRecord` 失败抛 `DomainError`，`code='invalid-record'`，`detail` 带 `{table, key}`
精确定位。所以纪律是「脏数据进得了介质，但进不了下一次打开的领域」。

对可丢弃的派生数据有第二条策略 `invalidRecords: 'backup-and-skip'`：坏记录挪走、记日志、
照常打开。但它**需要 `layout: 'per-record'`**（每条记录一份文档才有东西可挪）；
默认 single 布局没有 backupRecord，回退到拒绝。示例用第二个领域 `storage_demo_cache`
演示这条策略，主领域保持 single。`Domain.close()` 后名字释放，可以立刻重开。

### S2 附件：不可变字节与引用分离

`attachments.saveFile({data: Uint8Array, name})` 返回 `FileAttachmentRef`：
`attachmentId` 是**内容寻址**的不透明 id（`sha256:…`），不是路径也不是 bearer URL——
日志里只有它。`fileHostPath(ref)` 向本地后端要宿主路径，读回的字节与写入逐字节一致；
同样的字节再存一次得到**同一个 id**（去重）。字节落在 `DSH_HOME/attachments/v1`。

### S3 凭据：解析而不暴露

`credentials.resolve(credentialRef(name))` 返回 **`{value, source} | undefined`**
（rc.1 是裸字符串，rc.3 加了来源层）。示例演示四条纪律：

- **分层**：`source='file'`（`DSH_HOME/.credentials.yaml`）与 `source='env'`（进程环境）；
- **托管存储优先**：同名引用文件层赢——用户显式保存的不被环境顶掉；
- **fail closed**：不存在的引用返回 `undefined`，不抛错也不猜值；
- **热轮换**：外部改写 yaml，watch（默认开，debounce 100ms）热发布，下一次 `resolve`
  拿到新值，**进程不重启**。

日志纪律：只打印 `source` 与值长度，值本身永不落日志。

### S4 文件引用：@ 提及的发现缝

`fileReferences.list(agent, query, signal)` 是 @ 语法背后的发现服务，返回
`{path, kind: 'file'|'directory'}[]`。配套的提示段 `context:file-reference` 是
**条件渲染**：`read` 工具在位才给模型 @ 语法指引——所以 patch 里挂了 `tool-fs`
（只开 read/read_image）。能力与指引同生共死，模型不会拿到一个用不了的语法。

### S5 跨会话引用：快照按预算进上下文

先用脚本化适配器给源会话播种一条真实 turn（人类消息带 `STORAGE-REF-MARKER-13`），
`whenIdle` + `sessions.flush` 落盘。然后另一条会话做引用方：

- `sessionReferenceResolver.listCandidates(viewer)` 列出候选（**排除自己**，按 cwd 亲和排序）；
- `prepare(viewer, content, [{sessionId}], route)` 把源会话快照渲染成
  `additionalContext`（一条 UserMessage，按**不可信内容**对待），显式
  `maxReferenceBytes: 65536` 预算让它不依赖模型路由的 context window 估算；
- 引用自己抛 `code='SESSION_REFERENCE_SELF_REFERENCE'`——引用别的会话才有意义。

## 5. 坑（全部实测踩过）

1. **基类 + local 双挂 = 重复注册**。首跑报 `service "attachments" has been registered`：
   local provider 是基类子类、自己注册服务。patch 只挂 local 一行。
2. **「脏数据进不去」是过时描述**。rc.3 `put` 不做运行时校验，断言 `put` 抛错会拿到
   `code=undefined`；正确的演示是脏记录 close 后**重开**触发 `invalid-record`。
3. **backup-and-skip 在 single 布局下静默回退到拒绝**。必须 `layout: 'per-record'`。
4. **`.credentials.yaml` 必须 `version: 1` + `refs:` 嵌套**。旧扁平布局被明确拒绝。
5. **`resolve` 返回 `{value, source}` 不是字符串**（rc.1→rc.3 变化），直接当字符串用会
   拿到 `[object Object]`。
6. **凭据文档要在 boot 前就位**：provider 启动时读取；热轮换靠 watch，首读不靠。
7. **提示段条件渲染**：不挂 tool-fs（read 不在位）时 `context:file-reference` 段没有
   文本，「系统提示含 @ 指引」断言会失败——这不是 bug，是设计。
8. **S5 候选数受残留污染**：boot 前 `rmSync` 清掉 `DSH_HOME/sessions` 与 `storages`，
   否则上次运行的会话会进候选列表、落盘清单会多出旧文件。
9. **session-reference 的运行时依赖比 patch 面宽**：`dsh-compaction` /
   `dsh-output-retention` / `dsh-typert-protocol` 是硬依赖（非 optional peer），
   package.json 必须带上，否则 import 即失败。
10. **`assert()` 不做 TS 类型收窄**： narrowing 用 `if (!x) throw`，别指望自定义
    assert 之后 `x` 自动非空。
11. **koffi 安装脚本被拦无碍**：npm allowScripts 拦下 koffi@3.1.1 的 install script，
    但本示例不触发它的加载路径（SQLite `openAt: never`），双运行时照常全绿。
12. **Windows 跳过凭据文件 mode 检查**：credentials-local 的 POSIX 权限检查在 win32
    直接 return，别在 Windows 上期待 0600 断言。

## 6. 从零复现

```text
dsh-storage-demo/
├── package.json              # 40 依赖，全部精确 pin
├── tsconfig.json             # NodeNext + allowImportingTsExtensions
├── cordis.yml                # 空树 []
├── cordis.patch.yml          # 24 行装配（上文全文）
├── .gitignore                # node_modules/ .dsh-home/
└── src/
    ├── index.ts              # 五场景，约 285 行
    └── plugins/
        └── scripted-adapter.ts  # 离线文本路由（24 行）
```

版本面：`@deepseek-ai/*` 0.2.2-rc.3（npm `next` 通道）、`@deepseek-ai/cordis` 4.1.0、
cordis-plugin-timer 1.2.0、loader/include/group 1.1.0、zod 4.6.6、
typescript 5.9.3、@types/node 22.10.2。运行时：Node ≥ 22.18（原生 TS type stripping，
实测 v26.12.1）或 Bun ≥ 1.4.4（实测 1.4.4）。

```bash
npm install
npm run typecheck   # tsc 0 错误
npm start           # Node：末行 STORAGE_DEMO_OK
npm run start:bun   # Bun：输出逐行一致
```

不需要 `.env`、不需要 API key、不需要网络。运行时状态全部落在工程内 `.dsh-home/`
（已 gitignore），每次启动自动清理会话与存储残留。

## 7. 小结

- 结构化状态是**四种归属**，不是一个存储：领域记录进存储域、字节进附件、敏感值进凭据、
  指向别处的进引用——日志里只有 id/ref/名字，因此日志可分享而内容仍受保护。
- schema 校验的边界在**重开**而不是写入；凭据的边界在**解析**而不是读取（分层、
  fail closed、热轮换）；引用的边界在**预算与授权**（不可信快照、自引用拒绝）。
- 兄弟示例：[dsh-session-demo](../dsh-session-demo/README.md)（会话日志与读取面配方）、
  [dsh-jobs-demo](../dsh-jobs-demo/README.md)（turn 外机制，同样消费 storage）、
  [dsh-skills-mcp-demo](../dsh-skills-mcp-demo/README.md)（外部能力，凭据缝的另一侧消费者）。
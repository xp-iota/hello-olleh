# dsh 的存储示例

本示例演示结构化状态的四种归属：存储域的 schema 校验、附件的字节与引用分离、凭据的解析而不暴露（含热轮换）、文件引用与跨会话引用。脚本化适配器在 cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。

「把东西存下来」在 dsh 里不是一个存储，而是四种归属不同的状态设施。全部场景离线、不需要 key，S5 的会话 turn 由自带的脚本化适配器播种；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0、`zod` 4.6.6，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识除外——attachmentId 是内容寻址 sha256，天然确定）。

配套文章：[09 宿主与运行面](../../../docs/hello-dsh/09-host-runtime-and-storage.md)（§9.28 `ctx.storage` 四个包、§9.30–9.31 会话持久化与检索、§9.34 存储位置 Harness home）。

## 1 四种状态，一条纪律

> 引用而不是内容——日志里出现的是 id / ref / 名字，真实字节在各自后端里。因此会话日志可以安全分享，而敏感内容仍受授权保护。

| 设施 | 状态归属 | 核心 API | 本示例验证什么 |
|:-----|:---------|:---------|:---------------|
| 存储域 | 插件自己的领域记录 | `defineDomain` + `storageDomain.open` | schema 校验发生在**重开边界**、backup-and-skip、真实落盘 |
| 附件 | 不可变字节 | `attachments.saveFile` / `fileHostPath` | 内容寻址 id、字节逐字节读回、同字节去重 |
| 凭据 | 敏感值 | `credentials.resolve(credentialRef(...))` | `{value,source}` 分层、文件优先环境、fail closed、**热轮换不重启** |
| 引用 | 指向别处的指针 | `fileReferences.list` / `sessionReferenceResolver` | @ 发现缝、条件提示段、跨会话快照进上下文、自引用拒绝 |

旧 M11 模块的三处描述在 rc.3 已过时，本示例全部以实测纠正：

- **put 不做运行时 zod 校验**——校验发生在 `open()` 加载存量记录时；
- **local provider 是服务基类的子类**——只挂 local 一行，再挂基类行会报重复注册；
- **backup-and-skip 需要 per-record 布局**——single 布局没有 backupRecord，回退到拒绝。

## 2 最小树：九行底座 + 两行 fs + 状态设施 + 会话读取面

在 agent-loop 的九行底座（timer / system-prompt / tools / tool-executor-native / session / session-projection / agent / llm / agent-loop）上追加十六行，共 **25 行**：

| 行 id | 包 | 说明 |
|---|---|---|
| `fs-local` | `@deepseek-ai/dsh-fs-local` | tool-fs / file-reference-local 的 inject 依赖 |
| `working-directory` | `@deepseek-ai/dsh-working-directory` | 同上 |
| `storage` | `@deepseek-ai/dsh-storage` | 只管路由：哪个域走哪个后端 |
| `storage-json` | `@deepseek-ai/dsh-storage-json` | 介质；`root: !!js dshHomePath('storages')` |
| `storage-domain` | `@deepseek-ai/dsh-storage-domain` | 领域语义；`backend: json` 必填 |
| `attachment-local` | `@deepseek-ai/dsh-attachment-local` | S2；extends AttachmentStore，一行即服务 |
| `credentials-local` | `@deepseek-ai/dsh-credentials-local` | S3；watch 默认开，外部编辑热发布 |
| `file-reference-local` | `@deepseek-ai/dsh-file-reference-local` | S4；注入 agents + workingDirectory |
| `tool-fs` | `@deepseek-ai/dsh-tool-fs` | 只开 read/read_image（`write: false, edit: false`） |
| `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | S5 会话读取面，同 session-demo 配方 |
| `deepseek-llm-api-extensions` | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 编解码行的隐藏依赖，缺了永远 pending |
| `session-persistence-jsonl` | `@deepseek-ai/dsh-session-persistence-jsonl` | JSONL 落盘，`compression: none` |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | `path: ':memory:'` + `openAt: never`，不落索引文件 |
| `session-title` | `@deepseek-ai/dsh-session-title` | 标题投影（候选 label 用到） |
| `session-reference` | `@deepseek-ai/dsh-session-reference` | `maxReferenceBytes: 65536` 显式字节预算 |
| `scripted-adapter` | `./src/plugins/scripted-adapter.ts` | 自写插件也走声明式，S5 播种用 |

三个值得注意的装配决定：

- **storage 三层分工**：`storage` 只管路由，`storage-json` 是介质，`storage-domain` 是领域语义（schema/版本/表）。`backend: json` 必填——rc.3 明确拒绝「默认后端」的想法，没有 universally correct 的介质，部署必须显式选择。
- **local 一行即服务**：三个 local provider 都 `extends` 各自的服务基类并自己注册服务，patch 里**没有** `dsh-attachment` / `dsh-credentials` / `dsh-file-reference` 基类行——它们只作为类型与 `credentialRef` 等工具函数的来源存在于 package.json。
- **会话读取面复用 dsh-session-demo 配方**：五行缺一不可；`session-query-sqlite` 用 `openAt: never` 不落索引文件，`node:sqlite` 根本不会被打开——这也是本示例在 Bun 下无需任何补丁的原因之一。

## 3 五个场景

### S1 存储域：schema 校验发生在重开边界

`defineDomain({name, version, tables})` 声明领域，`domainTable(z.object(...))` 给每张表一个 zod schema；`storageDomain.open(spec)` 收 **spec 对象**而不是名字——「领域长什么样」和「打开它」绑在一起。`KvTable` 提供 get/put/delete/update/entries/keys/size，`update` 是读-改-写一体（回调拿当前值、返回新值）。

rc.3 的真实边界与直觉相反：**`put` 不做运行时 zod 校验**——类型系统挡住正常调用，绕过类型的脏数据（示例里 `as never`）能进介质。校验发生在 **`open()` 加载存量记录时**：`parseRecord` 失败抛 `DomainError`，`code='invalid-record'`，`detail` 带 `{table, key}` 精确定位。也就是说，脏数据进得了介质，但进不了下一次打开的领域。

对可丢弃的派生数据有第二条策略 `invalidRecords: 'backup-and-skip'`：坏记录挪走、记日志、照常打开。但它**需要 `layout: 'per-record'`**（每条记录一份文档才有东西可挪）；默认 single 布局没有 backupRecord，回退到拒绝。示例用第二个领域 `storage_demo_cache` 演示这条策略，主领域保持 single。`Domain.close()` 后名字释放，可以立刻重开。

### S2 附件：不可变字节与引用分离

`attachments.saveFile({data: Uint8Array, name})` 返回 `FileAttachmentRef`：`attachmentId` 是**内容寻址**的不透明 id（`sha256:…`），不是路径也不是 bearer URL——日志里只有它。`fileHostPath(ref)` 向本地后端要宿主路径，读回的字节与写入逐字节一致；同样的字节再存一次得到**同一个 id**（去重）。字节落在 `DSH_HOME/attachments/v1`。

### S3 凭据：解析而不暴露

`credentials.resolve(credentialRef(name))` 返回 **`{value, source} | undefined`**（rc.1 是裸字符串，rc.3 加了来源层）。示例演示四条规则：

- **分层**：`source='file'`（`DSH_HOME/.credentials.yaml`）与 `source='env'`（进程环境）；
- **托管存储优先**：同名引用文件层赢——用户显式保存的不被环境顶掉；
- **fail closed**：不存在的引用返回 `undefined`，不抛错也不猜值；
- **热轮换**：外部改写 yaml，watch（默认开，debounce 100ms）热发布，下一次 `resolve` 拿到新值，**进程不重启**。

日志纪律：只打印 `source` 与值长度，值本身永不落日志。

### S4 文件引用：@ 提及的发现缝

`fileReferences.list(agent, query, signal)` 是 @ 语法背后的发现服务，返回 `{path, kind: 'file'|'directory'}[]`。配套的提示段 `context:file-reference` 是**条件渲染**：`read` 工具在位才给模型 @ 语法指引——所以 patch 里挂了 `tool-fs`（只开 read/read_image）。能力与指引同进同出，模型不会拿到一个用不了的语法。

### S5 跨会话引用：快照按预算进上下文

先用脚本化适配器给源会话播种一条真实 turn（人类消息带 `STORAGE-REF-MARKER-13`），`whenIdle` + `sessions.flush` 落盘。然后另一条会话做引用方：

- `sessionReferenceResolver.listCandidates(viewer)` 列出候选（**排除自己**，按 cwd 亲和排序）；
- `prepare(viewer, content, [{sessionId}], route)` 把源会话快照渲染成 `additionalContext`（一条 UserMessage，按**不可信内容**对待），显式 `maxReferenceBytes: 65536` 预算让它不依赖模型路由的 context window 估算；
- 引用自己抛 `code='SESSION_REFERENCE_SELF_REFERENCE'`——引用别的会话才有意义。

## 4 运行存储示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`cordis.patch.yml` 全文（25 行清单）：

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

    # 自写插件也走声明式：脚本化适配器全程在位（S5 才用到），随整树 dispose 回收。
    - id: scripted-adapter
      name: ./src/plugins/scripted-adapter.ts
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，脚本化适配器随装配就位：

```ts
const ctx = await boot(
  'dsh-storage-demo', CONFIG,
  loadOverlayPatches('dsh-storage-demo', PATCH),
  undefined, BASE_URL,
)
// 脚本化适配器由 patch 清单声明，boot 后已在位（S5 才用到）。
// ……S1～S5 五个场景……
await ctx.fiber.dispose()
console.log('\nSTORAGE_DEMO_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：五场景全离线，末行 STORAGE_DEMO_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 外逐行一致，归一化比对验证）：

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

输出留档在 [runtime-out-node.txt](runtime-out-node.txt) 与 [runtime-out-bun.txt](runtime-out-bun.txt)。四个值得注意的事实：

- **`invalid-record（table=notes, key=n2）`**：脏记录是 `put` 进去的，拒绝发生在 close 后**重开**——`detail` 精确到表与键；
- **`sha256:b5b153203…` / 19 字节**：内容寻址 id 由字节决定，所以双运行时输出天然一致，同字节重存 id 相同；
- **值长度 13 / 12 / 13**：日志里只有 source 与长度，凭据值本身永不出现；热轮换前后长度都是 13（`file-secret-1` → `file-secret-2`），进程没重启；
- **候选 2 条**：源会话 + S4 建的文件引用会话，引用方自己不在候选里。

## 5 边界与坑

1. **基类 + local 双挂 = 重复注册**。首跑报 `service "attachments" has been registered`：local provider 是基类子类、自己注册服务。patch 只挂 local 一行。
2. **「脏数据进不去」是过时描述**。rc.3 `put` 不做运行时校验，断言 `put` 抛错会拿到 `code=undefined`；正确的演示是脏记录 close 后**重开**触发 `invalid-record`。
3. **backup-and-skip 在 single 布局下静默回退到拒绝**。必须 `layout: 'per-record'`。
4. **`.credentials.yaml` 必须 `version: 1` + `refs:` 嵌套**。旧扁平布局被明确拒绝。
5. **`resolve` 返回 `{value, source}` 不是字符串**（rc.1→rc.3 变化），直接当字符串用会拿到 `[object Object]`。
6. **凭据文档要在 boot 前就位**：provider 启动时读取；热轮换靠 watch，首读不靠。
7. **提示段条件渲染**：不挂 tool-fs（read 不在位）时 `context:file-reference` 段没有文本，「系统提示含 @ 指引」断言会失败——这不是 bug，是设计。
8. **S5 候选数受残留污染**：boot 前 `rmSync` 清掉 `DSH_HOME/sessions` 与 `storages`（index.ts 启动时自动做），否则上次运行的会话会进候选列表、落盘清单会多出旧文件。
9. **session-reference 的运行时依赖比 patch 面宽**：`dsh-compaction` / `dsh-output-retention` / `dsh-typert-protocol` 是硬依赖（非 optional peer），package.json 必须带上，否则 import 即失败。
10. **`assert()` 不做 TS 类型收窄**：narrowing 用 `if (!x) throw`，别指望自定义 assert 之后 `x` 自动非空。
11. **koffi 安装脚本被拦无碍**：npm allowScripts 拦下 koffi@3.1.1 的 install script，但本示例不触发它的加载路径（SQLite `openAt: never`），双运行时照常全部通过。
12. **Windows 跳过凭据文件 mode 检查**：credentials-local 的 POSIX 权限检查在 win32 直接 return，别在 Windows 上期待 0600 断言。
13. 本示例不挂 ptc/subprocess，Bun 无需补丁；会话日志与存储落在本目录 `.dsh-home/`（gitignored），每次启动自动清理会话与存储残留。

## 6 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-storage-demo/
├── package.json              # 40 依赖，全部精确 pin
├── tsconfig.json             # 只做类型检查，不产出 JS
├── .gitignore                # node_modules/ + .dsh-home/
├── cordis.yml                # []：根配置留空
├── cordis.patch.yml          # 25 行装配清单（第 4 节全文）
├── runtime-out-node.txt      # Node 实测输出留档
├── runtime-out-bun.txt       # Bun 实测输出留档
└── src/
    ├── index.ts              # 五场景，284 行
    └── plugins/
        └── scripted-adapter.ts  # 离线文本路由，36 行
```

### package.json（完整版）

```json
{
  "name": "dsh-storage-demo",
  "private": true,
  "type": "module",
  "description": "结构化状态四归属：存储域 schema 校验、附件字节与引用分离、凭据解析而不暴露（含热轮换）、文件引用与跨会话引用。全程离线。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/cordis-plugin-group": "1.1.0",
    "@deepseek-ai/cordis-plugin-include": "1.1.0",
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/cordis-plugin-timer": "1.2.0",
    "@deepseek-ai/dsh-agent": "0.2.2-rc.3",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.3",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.3",
    "@deepseek-ai/dsh-attachment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-attachment-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-compaction": "0.2.2-rc.3",
    "@deepseek-ai/dsh-credentials": "0.2.2-rc.3",
    "@deepseek-ai/dsh-credentials-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-deepseek-llm-api-extensions": "0.2.2-rc.3",
    "@deepseek-ai/dsh-file-reference": "0.2.2-rc.3",
    "@deepseek-ai/dsh-file-reference-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-fs-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-output-retention": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-log-deepseek": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-persistence-jsonl": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-query": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-query-sqlite": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-reference": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-title": "0.2.2-rc.3",
    "@deepseek-ai/dsh-storage": "0.2.2-rc.3",
    "@deepseek-ai/dsh-storage-domain": "0.2.2-rc.3",
    "@deepseek-ai/dsh-storage-json": "0.2.2-rc.3",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-fs": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3",
    "@deepseek-ai/dsh-typert-protocol": "0.2.2-rc.3",
    "@deepseek-ai/dsh-working-directory": "0.2.2-rc.3",
    "zod": "4.6.6"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

tsconfig.json 与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 逐字相同（NodeNext + allowImportingTsExtensions，`include: ["src"]`）。

### src/plugins/scripted-adapter.ts（完整版）

与 agent-loop / session 的同名插件同一契约（`stream()` 产出原始 StreamChunk 协议），但这里是**纯文本变体**：每个 step 直接给最终回答，不调工具——存储示例只需要会话日志里有一条真实的人类消息与助手回答，供跨会话引用读取。

```ts
/**
 * scripted-adapter —— 脚本化 LlmAdapter：离线播种一条真实 turn。
 *
 * 与 dsh-session-demo 的同名插件同一契约（stream() 产出原始 StreamChunk 协议），
 * 这里只保留文本路由：每个 step 直接给最终回答，不调工具——存储示例只需要
 * 会话日志里有一条真实的人类消息与助手回答，供跨会话引用读取。
 *
 * 文件末尾的 name/inject/apply 是 cordis 插件形态：本文件在 cordis.patch.yml
 * 里声明为一行，registerAdapter 内部走 ctx.effect，fiber 销毁时路由自动回收。
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'

export class ScriptedAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: '脚本化（离线演示用）' }
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = '已记录。这条回答由脚本化适配器产出，用于跨会话引用演示。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 32, outputTokens: 24 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'scripted-adapter'
export const inject = ['llm']

export function apply(ctx: Context): void {
  // registerAdapter 内部是 ctx.effect：不需要手动 release，fiber 销毁即回收。
  ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())
}
```

### src/index.ts（完整版）

```ts
/**
 * dsh-storage-demo —— 结构化状态四归属，全部离线：
 *   S1 存储域：schema 校验的领域记录——脏数据在重新打开的边界被拒；
 *   S2 附件：不可变字节与引用分离——日志只存 id，字节在后端；
 *   S3 凭据：解析而不暴露——文件 > 环境分层、缺省 fail closed、热轮换不重启；
 *   S4 文件引用：@ 提及的发现缝 + read 工具在位才渲染的提示段；
 *   S5 跨会话引用：把另一条会话的快照按预算放进当前上下文（recall 形态）。
 * 关键认识：引用而不是内容——日志里出现的是 id，真实字节在各自后端里，
 * 因此日志可以安全分享，而敏感内容仍受授权保护。
 * 脚本化适配器在 cordis.patch.yml 里声明，全程在位（S5 才用到）。
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
// 脚本化适配器由 patch 清单声明，boot 后已在位。
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

await sourceHandle.dispose()
await fileRefHandle.dispose()
await ctx.fiber.dispose()
console.log('\nSTORAGE_DEMO_OK')
```

### 按顺序验证

```bash
npm install             # 40 依赖精确 pin，含 session-reference 的三个硬依赖
#
npm run typecheck       # tsc 0 错误
npm start               # Node：末行 STORAGE_DEMO_OK
npm run start:bun       # Bun：除首行 runtime 标识外逐行一致
```

示例不依赖任何环境变量、端口或外部服务：S3 用到的 `DEMO_*` 环境变量由 index.ts 自己在进程内设置，凭据文档也在 boot 前自动写好。运行时状态全部落在工程内 `.dsh-home/`（已 gitignore），每次启动自动清理会话与存储残留。

## 7 小结

这个示例验证了五件事：

- 存储域的 schema 校验边界在**重开**而不是写入：脏数据进得了介质，进不了下一次打开的领域；backup-and-skip 是 per-record 布局专属的第二条策略；
- 附件是内容寻址的不可变字节：日志里只有 `sha256:…` id，字节在后端，同字节去重；
- 凭据的边界在**解析**：`{value, source}` 分层、文件优先环境、fail closed、watch 热轮换不重启，值永不落日志；
- 文件引用是条件渲染的发现缝：read 工具在位才渲染 @ 指引，能力与指引同进同出；
- 跨会话引用按显式字节预算把别的会话快照放进上下文（不可信内容），自引用被明确拒绝。

兄弟示例：[dsh-session-demo](../dsh-session-demo/README.md)（会话日志与读取面配方）、[dsh-jobs-demo](../dsh-jobs-demo/README.md)（turn 外机制，同样消费 storage）、[dsh-skills-mcp-demo](../dsh-skills-mcp-demo/README.md)（外部能力，凭据缝的另一侧消费者）。
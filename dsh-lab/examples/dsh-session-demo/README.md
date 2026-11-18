# dsh-session-demo：会话日志——append-only 事件流、JSONL 落盘、读取面、恢复

> 独立示例：本目录拷到任何位置，`npm install && npm start` 即可运行（Node ≥ 22.18；`npm run start:bun` 走 Bun）。
> 版本面：`@deepseek-ai/*` **0.2.2-rc.3**、`@deepseek-ai/cordis` **4.1.0**。全部场景离线、不需要 key。
> 本文所有运行输出均为实测粘贴（Node v26.12.1 / Bun 1.4.4，Windows）。

## 1. 问题：唯一事实来源长什么样

dsh 没有独立的"聊天记录数据库"：**会话日志（session log）就是唯一事实来源**。turn/step 边界、消息、工具调用与结果、标题、请求锚点，全部是同一个 append-only 事件流里的记录。围绕它有四个问题：

- 日志的结构与不变量是什么（seq、type、data、surfaceOp）？
- 怎么落盘、怎么从盘上恢复一个 agent？
- 列表页、标题、模型上下文各自读哪个面？
- 哪些事件模型看得见、哪些只是运行时记账？

本示例用脚本化适配器（见 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)）离线播种一条**真实 turn**，然后把六个观察点全部真实触发。

## 2. 最小树：十四行

在 agent-loop 九行基础上追加五行会话设施：

| 行 id | 包 | 说明 |
|---|---|---|
| `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | 官方 v4 编解码；`inject = ['deepseekLlmApiExtensions', 'sessions']` |
| `deepseek-llm-api-extensions` | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 上一行注入的扩展字段——**缺这一行编解码行永远 pending** |
| `session-persistence-jsonl` | `@deepseek-ai/dsh-session-persistence-jsonl` | 落盘后端；config：`root: !!js dshHomePath('sessions')`、`compression: none` |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | 读取面 `ctx.sessionQuery`；`static inject = ['sessions']`；`:memory:` + `openAt: never` |
| `session-title` | `@deepseek-ai/dsh-session-title` | 标题投影；`static inject = ['sessions', 'sessionProjections', 'agents']`；只挂规则回退，不挂 title-llm |

`compression: none` 是刻意的演示选择：默认是 **zstd**（session-persistence-jsonl/src/index.ts:69），这里要肉眼可读的落盘文件。

## 3. 实现代码（`src/index.ts` 节选）

```ts
// 播种：脚本化适配器驱动一个完整 turn（工具步 + 回答步）
const handle = await ctx.agents.create({
  sessionId, meta: { cwd: process.cwd() },
  agentOptions: { provider: 'lab-scripted', model: 'seed' },
})
handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '统计一下这段文本的词数' }], source: { kind: 'user' } }))
await handle.agent.whenIdle()

// S1 精确读：异步快照，seq 从 0 连续递增
const snapshot = await ctx.sessionQuery.readSession(sessionId)

// S2 落盘：flush 是唯一的耐久性检查点入口
const flushed = await ctx.sessions.flush(handle.agent.session)   // true

// S3 列表：live（进程内在位）与 persisted（盘上有）是两个独立标志
const records = await ctx.sessionQuery.listSessions()

// S4 标题：不挂 title-llm 时走首条人类消息的规则回退
const title = await ctx.sessionQuery.readTitle(sessionId)

// S5 模型表面：历史折叠后模型可见的事件序列
const surface = await ctx.sessionQuery.readSurface(sessionId)

// S6 恢复：dispose 之后从日志重建同一个 agent
await handle.dispose()
const resumed = await ctx.agents.resume({ resumeSessionId: sessionId })
```

落盘文件的查找是递归遍历 `.dsh-home/sessions` 找包含本会话 id 的 `.jsonl`——目录按项目路径 slug 组织（见 §4 实测路径）。

## 4. 实测运行输出

`npm start`（Node v26.12.1，`.dsh-home` 为空的首跑）：

```text
runtime = node v26.12.1

=== S1 日志结构与 seq 不变量 ===
事件数：17
类型分布：agent/inbox/spliced×2, turn/start×1, step/start×2, system/message×1, user/message×1, request/header×1, request/context×1, session/title×1, assistant/message×2, tool/call×1, tool/result×1, step/end×2, turn/end×1
seq 连续性校验通过（从 0 开始逐条 +1）

=== S2 JSONL 落盘 ===
sessions.flush 返回：true
落盘文件：.dsh-home\sessions\--D-coding-creative-hello-olleh-dsh-lab-examples-dsh-session-demo--\session-demo-mwkgqvar\session.v4.jsonl（18 行）
首行记录类型：session

=== S3 live-preferred 会话列表 ===
语料会话数：1（live 1 条）
本会话：live=true persisted=true

=== S4 标题投影 ===
当前标题：统计一下这段文本的词数

=== S5 模型表面 ===
表面事件：5 条（system/message×1, user/message×1, assistant/message×2, tool/result×1）

=== S6 从日志恢复 ===
恢复后 agent 身份：session-demo-mwkgqvar（原 session-demo-mwkgqvar）
事件数：恢复前 17 → 恢复后 18

SESSION_DEMO_OK
```

`npm run start:bun`（Bun 1.4.4，同样清空 `.dsh-home` 后首跑）：除首行 runtime 标识与会话 id（每次运行随机）外**逐行一致**，同样以 `SESSION_DEMO_OK` 结束。`npm run typecheck`：退出码 0。

四个值得注意的数字：

- **17 条事件 / 18 行文件**：首行是 `session` 头记录，其后每事件一行——JSONL 名副其实；
- **表面 5 条**：17 条日志事件折叠成 5 条模型可见消息。`turn/start`、`step/*`、`tool/call`、`request/*` 全是运行时记账，**不进模型表面**；`tool/result` 进（模型要看到工具结果）；
- **恢复 17 → 18**：resume 不是丢事件，而是**追加一条恢复锚点**——日志永远只增不减；
- **标题 = 首条人类消息原文**：12 个汉字 36 字节，没超过 `fallbackMaxBytes: 40`，规则回退原样保留。

## 5. 机制解释

### 5.1 append-only 与 seq 不变量

`session.append()` 是唯一写入路径；每条事件带单调递增的 `seq`（从 0 连续）。surface-eligible 事件（消息类）必须带 `surfaceOp` 标记（`'append'` 或 `{ op: 'replace', startSeq, endSeq }`），声明它如何进入模型表面——这是 context-demo 里 pruner 影子计价协议的基础。同步快照直接读 `session.events` 已弃用，新代码一律走 `sessionQuery` 的异步读。

### 5.2 flush 是唯一的耐久性检查点

`ctx.sessions.flush(session)`（core/session/src/index.ts:1422）分发 awaited 的 `session/flush` 事件，JSONL 后端在其中把缓冲的追加批写盘。文档明确要求：**读存储之前必须先 flush**，且必须走这个入口而不是裸发 `ctx.parallel('session/flush', …)`——一个 owner，一条检查点。持久化插件平时异步缓冲，append 本身不做 I/O。

### 5.3 落盘布局与 v4 编码

文件在 `<root>/<项目路径 slug>/<会话 id>/session.v4.jsonl`：项目 slug 把 cwd 的盘符与分隔符拍平成目录名（实测 `--D-coding-creative-…--`）。首行 `session` 头记录携带 header，其后是 v4 编码的事件行——编解码由 session-log-deepseek 注册，它依赖 deepseek-llm-api-extensions 提供的扩展字段。默认物理编码是 zstd（`.jsonl.zstd`），`compression: none` 时是纯文本。

### 5.4 live-preferred 列表与两个标志

`listSessions()` 合并进程内 live 会话与盘上持久化会话：`live` 表示当前进程持有该会话的 agent，`persisted` 表示存储后端有它的文件。两者独立——刚创建未 flush 的会话 live=true / persisted=false；dispose 且 flush 过的会话反过来。列表页优先显示 live 版本（更新），这就是 "live-preferred"。

### 5.5 标题与表面都是投影

标题由 session-title 服务折叠日志产生：有 title-llm 插件时模型摘要优先，失败或未装配时回退到首条人类消息（按 fallbackMaxWords / fallbackMaxBytes 截断）。模型表面（`readSurface`）把日志折叠成模型可见消息序列——它是"历史进入下一次请求"的原料，compaction 的 replace 事件也作用在这个面上。

### 5.6 resume 是重建而不是读取

`agents.resume({ resumeSessionId })`（core/agent/src/index.ts:205、:423）加载持久化日志、重放事件、在原身份上重建 agent 与全部投影，并追加恢复锚点。disposer 是一种**能力**：持有它才能消费这个 agent。恢复后的 agent 与新建的没有任何身份差异——S6 实测 id 完全一致。

## 6. 边界与坑（全部实测踩过）

1. **`ctx.sessionQuery` 需要类型增补导入**：`import type {} from '@deepseek-ai/dsh-session-query-sqlite'` 缺了它，运行正常但 typecheck 报 TS2339（Context 上没有 sessionQuery）。
2. **assert 辅助函数不做类型收窄**：`assert(record !== undefined, …)` 之后 TS 仍认为 record 可能 undefined（TS18048）。需要收窄的地方用显式 `if (x === undefined) throw …`。
3. **编解码行有隐藏依赖**：只挂 session-log-deepseek 不挂 deepseek-llm-api-extensions，前者永远 pending——boot 审计对非 required 行只 warn 不抛，症状是"落盘悄悄不工作"。
4. **语料计数受历史运行影响**：`.dsh-home/sessions` 会累积往次运行的会话，S3 的"语料会话数"随之变化。实测对比前先清空 `.dsh-home`（gitignored，删了不心疼）。
5. **flush 之前读盘是空的**：append 只进内存缓冲；S2 必须先 `sessions.flush` 再找文件。
6. **resume 会多一条事件**：断言"恢复后事件数相等"会误判失败——正确判据是 `>=` 且身份一致。
7. **默认压缩是 zstd**：想 `readFileSync` 直接读落盘内容，config 必须 `compression: none`，否则拿到的是压缩字节。
8. **本示例不挂 ptc/subprocess**，Bun 无需补丁；node:sqlite（`:memory:`）在 Node 26 与 Bun 1.4.4 上都可用（实测）。

## 7. 从零复现

目录结构：

```text
dsh-session-demo/
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules/ + .dsh-home/
├── cordis.yml              # []
├── cordis.patch.yml        # 十四行最小树（见 §2）
└── src/
    ├── index.ts            # 六场景主程序
    └── plugins/
        ├── word-count.ts       # 与 tool-pipeline-demo 相同
        └── scripted-adapter.ts # 与 agent-loop-demo 相同
```

dependencies 在 dsh-agent-loop-demo 的清单上追加五项（均 0.2.2-rc.3）：`@deepseek-ai/dsh-session-log-deepseek`、`@deepseek-ai/dsh-deepseek-llm-api-extensions`、`@deepseek-ai/dsh-session-persistence-jsonl`、`@deepseek-ai/dsh-session-query-sqlite`、`@deepseek-ai/dsh-session-title`。tsconfig.json / devDependencies 与 dsh-boot-demo 相同。

`cordis.patch.yml` 追加段全文：

```yaml
    - id: session-log-deepseek
      name: '@deepseek-ai/dsh-session-log-deepseek'
    - id: deepseek-llm-api-extensions
      name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'
    - id: session-persistence-jsonl
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js dshHomePath('sessions')
        compression: none
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
```

两个插件文件复制 dsh-agent-loop-demo 同名文件，`index.ts` 直接复制本目录同名文件。验证步骤：

```bash
npm install          # 含自动安装的 peer
npm start            # 末行 SESSION_DEMO_OK
npm run start:bun    # 与 Node 逐行一致（随机会话 id 除外）
npm run typecheck    # 退出码 0
```

## 8. 小结

这个示例验证了六件事：

- 会话日志是唯一事实来源：append-only、seq 从 0 连续、surfaceOp 声明表面操作；
- flush 是唯一耐久性检查点；JSONL 按项目 slug / 会话 id 组织，首行头记录；
- live 与 persisted 是两个独立标志，列表 live-preferred；
- 标题与模型表面都是日志的投影：17 条事件折叠成 5 条模型可见消息；
- resume 在原身份上重建 agent 并追加锚点——日志只增不减；
- Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)；下一篇：dsh-trajectory-probe-demo——把事件流渲染成可读的 trajectory。
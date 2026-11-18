# dsh-context-demo：上下文装配与经济学——section、插值、计量、裁剪、溢写、模型表面

> 独立示例：本目录拷到任何位置，`npm install && npm start` 即可运行（Node ≥ 22.18；`npm run start:bun` 走 Bun）。
> 版本面：`@deepseek-ai/*` **0.2.2-rc.3**、`@deepseek-ai/cordis` **4.1.0**。全部场景离线、不需要 key。
> 本文所有运行输出均为实测粘贴（Node v26.12.1 / Bun 1.4.4，Windows）。

## 1. 问题：模型每次请求到底看到什么

上下文窗口有限，于是"模型看到什么"是一门经济学。dsh 把它拆成两层：

- **装配层**：System Prompt 由有序 section 与变量拼装，工具 schema 随 agent 装配，运行时上下文作为快照注入；
- **节流层**：三件配套机制控制进入窗口的字节数——token 计量（token-meter）、超长工具结果裁剪（tool-result-pruner）、大输出溢写（spill-policy）。

本示例把六个观察点全部真实触发，而不是只验证"服务在位"。其中裁剪与溢写各有一个容易误判的挂点，§5 与 §6 如实记录。

## 2. 最小树：十五行

在 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 的十行基础上追加五行：

| 行 id | 包 | 说明 |
|---|---|---|
| `token-meter` | `@deepseek-ai/dsh-token-meter` | `static inject = ['sessionProjections']`；估算器在子路径 `/estimate` 导出 |
| `tool-result-pruner` | `@deepseek-ai/dsh-compaction-tool-result-pruner` | `static inject = ['tokenMeter']`；config：thresholdChars 8192 / headChars 4096 / tailChars 1024 |
| `spill-local` | `@deepseek-ai/dsh-spill-local` | 溢写存储后端，提供 `spillStore` |
| `spill-policy` | `@deepseek-ai/dsh-spill-policy` | `inject = ['tools']`；config：maxInlineTokens 12500 |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | `static inject = ['sessions']`；config：`path: ':memory:'`、`openAt: never`，进程退出即消失 |

另有第二棵树用的 overlay `cordis.noprune.yml`（禁用 pruner，原因见 §5.4）。

## 3. 实现代码

### 3.1 可控大小的工具 `src/plugins/big-text.ts`

```ts
export function makeText(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(' ')
}
// big_text 工具：size='medium' → 3000 词（约 2.6 万字符、6477 token）
//               size='huge'   → 16000 词（约 14.9 万字符、数万 token）
```

词互不相同是刻意的：重复字符会被估算器压得很低，测不出真实压力。medium 超过 pruner 的 8192 字符阈值但低于 spill 的 12500 token 预算；huge 超过 spill 预算。

### 3.2 六个场景（`src/index.ts` 节选）

```ts
// S1 section 装配：注册返回精确的解除函数
const removeSection = ctx.systemPrompt.section({ name: 'demo:context', order: 1500, text: '…' })
const assembly = await ctx.systemPrompt.assemble()   // { sections, tools }
removeSection()                                       // 可逆 effect

// S2 变量插值：装配期求值；未定义变量让 renderPrompt 抛错
const removeVariable = ctx.systemPrompt.variable('demo_stage', () => 'S2')
renderPrompt(await ctx.systemPrompt.assemble())      // 含 {{demo_missing}} 时抛错

// S3 token 估算：子路径导出的纯函数
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
estimateContent([{ type: 'text', text }])

// S4 裁剪：pruner 是会话表面服务——往 session 追加超大 tool/result，再 pruneSession
session.append('tool/result', { turn: 0, step: 0, message: bigMessage }, { surfaceOp: 'append' })
const { pruned, charsRemoved } = ctx.toolResultPruner.pruneSession(session)

// S5 溢写：第二棵树禁用 pruner；调用必须带 agent（spill 需要会话 owner）
const huge = await callTool(ctxB, 'big_text', { size: 'huge' }, handleB.agent)

// S6 模型表面：会话历史折叠成模型可见事件序列
const surface = await ctx.sessionQuery.readSurface(handle.agent.session.id)
```

`callTool` 封装与 dsh-tool-pipeline-demo 完全相同（批接口、JSON 字符串参数、可选 agent）。

## 4. 实测运行输出

`npm start`（Node v26.12.1）：

```text
runtime = node v26.12.1

=== S1 system prompt：section 装配与可逆注册 ===
section 数：4
  [harness:identity] order=?
  [deployment:persona-prefix] order=?
  [demo:context] order=?
  [deployment:persona-suffix] order=?
工具 schema 数：0
移除后 section 已消失（注册是可逆 effect）

=== S2 变量插值：装配期求值，未定义变量直接抛错 ===
插值成功：true
未定义变量按预期报错：unknown prompt variable "{{demo_missing}}" in section "demo:broken"; registered

=== S3 token 估算：estimateContent ===
50 词（339 字符）≈ 89 token
3000 词（25889 字符）≈ 6477 token

=== S4 tool-result-pruner：真实触发会话表面裁剪 ===
pruned 条数：1，charsRemoved = 20730
  seq 0 → 2：25889 → 5159 字符

=== S6 会话历史折叠为模型表面 ===
会话 context-surface-mwkfkbvn 的模型表面事件：0 条

=== S5 spill-policy：真实触发溢写（第二棵树禁用 pruner）===
原始文本 148889 字符 → 模型可见 49932 字符
模型可见头部：word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word1…
模型可见尾部：rd15996 word15997 word15998 word15999 (Omitted 99189 bytes. Full formatted result stored at: C:\Users\feuye\AppData\Local\Temp\dsh-spill-Dlrn60\session-7289f56f42e1\45718f573c3b-big_text.txt. Use read with offset/limit, or grep this path to search within it.)
溢写文件存在 = true（C:\Users\feuye\AppData\Local\Temp\dsh-spill-Dlrn60\session-7289f56f42e1\45718f573c3b-big_text.txt）

CONTEXT_DEMO_OK
```

`npm run start:bun`（Bun 1.4.4）：除首行 runtime 标识、会话 id 与溢写临时目录名（每次运行随机）外**逐行一致**，同样以 `CONTEXT_DEMO_OK` 结束。`npm run typecheck`：退出码 0。

三个值得盯住的数字：

- **S4：25889 → 5159 字符**——head 4096 + tail 1024 + 省略通知，正是 config 的三个数；
- **S5：148889 → 49932 字符**——spill 不是数量级压缩，而是"内联预算内的头尾保留 + 超出部分落盘"（99189 字节进了文件）；
- **S6：0 条**——新建会话还没有任何事件，模型表面是空的；真实 turn 的事件流见 dsh-session-demo 与 dsh-trajectory-probe-demo。

## 5. 机制解释

### 5.1 section 与 variable 都是可逆贡献

`ctx.systemPrompt.section()` / `.variable()` 返回精确的解除函数，注册挂在调用方 fiber 的 effect 链上。装配结果 `assemble()` 是 `{ sections, tools }`：section 按 order 排序合并，工具 schema 来自当前装配范围。S1 的"工具 schema 数：0"是因为没有传 agent——全局视角下这棵最小树没有注册任何工具；带 agent 的装配见 dsh-tool-pipeline-demo S4。

### 5.2 插值失败是硬错误

`renderPrompt` 遇到未注册变量直接抛 `unknown prompt variable "{{demo_missing}}" in section "demo:broken"`，而不是把 `{{x}}` 原样送给模型。上下文里的每个占位符都必须有出处——这和 boot 的 fail-loud 是同一种哲学。

### 5.3 pruner 是会话表面服务，不是 post-execute 监听

这是本示例最重要的纠正（旧教材曾把它描述成执行后拦截）。`ToolResultPruner`（compaction-tool-result-pruner/src/index.ts:44）提供 `pruneSession(session)`：

1. 遍历 session 当前表面的 `tool/result` 节点；
2. 超过 thresholdChars 的，按 head/tail 预算确定性裁剪；
3. **影子计价协议**：先追加一条 `compaction/prune` 事件（用 tokenMeter 给被影子节点计价），再紧挨着追加替换的 `tool/result`，`surfaceOp: { op: 'replace', startSeq, endSeq }` 引用被替换节点（index.ts:160-171）。

替换保留完整事件数据、只改 content，且引用原节点——**重放可以恢复替换输入**。调用方是 compaction-basic：每次请求前 `ctx.get('toolResultPruner')?.pruneSession(agent.session)`（compaction-basic/src/index.ts:303）。所以裁剪发生在"历史进入下一次请求"的路上，不是工具执行的那一刻。

### 5.4 spill 以 prepend 挂链，与 pruner 组合而非竞争

`spill-policy` 的监听器带 `{ prepend: true }`（spill-policy/src/index.ts:151），且第一句是 `await next()`——它先拿到下游整条链的决定，再对结果计价。这意味着：

- pruner 在下游先把超大文本截到 ~5k 字符，spill 看到的已经是小内容，永远到不了 12500 token 阈值；
- 想单独观察 spill，必须禁用 pruner（`cordis.noprune.yml` 的 `disabled: true`）——这是配置层开关的真实用途，不是绕过机制。

spill 自身还有两条硬约束（index.ts:99-103）：结果估算超过 maxInlineTokens 才动手；**必须有会话 owner**（`exec.agent?.session.header.id`），否则 warn 一声保留内联内容。落盘走 `spillStore.saveText()`，文件在系统临时目录的 `dsh-spill-*` 私有根下按会话分目录；模型看到的替换内容是"头 + 尾 + 溢写通知（含精确字节数与文件路径）"，并提示用 read offset/limit 或 grep 取回全文。

### 5.5 模型表面是历史的投影

`sessionQuery.readSurface(sessionId)` 返回会话历史折叠后的模型可见事件序列。SQLite 索引配 `:memory:` + `openAt: never` 时完全在内存里，进程退出即消失——机制演示不需要落盘索引。

## 6. 边界与坑（全部实测踩过）

1. **pruner 不挂 post-execute**：直接调用工具看不到任何裁剪。必须往会话表面追加 `tool/result` 再 `pruneSession`。
2. **`session.append` 要求 surfaceOp 标记**：`tool/result` 是 surface-eligible 事件，缺第三个参数 `{ surfaceOp: 'append' }` 直接抛 `requires a surfaceOp marker`。
3. **spill 需要 agent owner**：`callTool` 不传 agent 时 spill 静默保留内联内容（只有一条 logger.warn）。症状是"大输出怎么没溢写"。
4. **spill 的压缩比不是数量级**：内联预算内的头尾仍保留。断言"压到十分之一以下"会误判失败——正确的判据是"变短了 + 通知里有路径 + 文件存在"。
5. **溢写通知里的路径后面紧跟句号**：用正则提取路径要把句末 `.` 一起剥掉，否则 `existsSync` 差一个字符判 false。
6. **assemble 返回的 section 对象不带可枚举的 order**：打印 `order=?` 不是 bug，排序信息在装配内部；想看顺序直接看 sections 数组的排列。
7. **估算要用互不相同的词**：`'x'.repeat(10000)` 这类重复文本会被估算器压得很低，测不出真实 token 压力。
8. **本示例不挂 ptc/subprocess**，Bun 无需补丁；node:sqlite 在 Node 26 与 Bun 1.4.4 上都可用（实测）。

## 7. 从零复现

目录结构：

```text
dsh-context-demo/
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules/ + .dsh-home/
├── cordis.yml              # []
├── cordis.patch.yml        # 十五行最小树（见 §2）
├── cordis.noprune.yml      # 第二棵树：disabled: true 关掉 pruner
└── src/
    ├── index.ts            # 六场景主程序
    ├── tools.ts            # 单次调用封装（与 tool-pipeline-demo 相同）
    └── plugins/
        └── big-text.ts     # 可控大小文本工具
```

dependencies 在 dsh-tool-pipeline-demo 的清单上追加五项（均 0.2.2-rc.3）：`@deepseek-ai/dsh-token-meter`、`@deepseek-ai/dsh-compaction-tool-result-pruner`、`@deepseek-ai/dsh-spill-local`、`@deepseek-ai/dsh-spill-policy`、`@deepseek-ai/dsh-session-query-sqlite`。tsconfig.json / devDependencies 与 dsh-boot-demo 相同。

`cordis.patch.yml` 追加段全文：

```yaml
    - id: token-meter
      name: '@deepseek-ai/dsh-token-meter'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024
    - id: spill-local
      name: '@deepseek-ai/dsh-spill-local'
    - id: spill-policy
      name: '@deepseek-ai/dsh-spill-policy'
      config:
        maxInlineTokens: 12500
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never
```

`cordis.noprune.yml` 全文：

```yaml
- id: tool-result-pruner
  disabled: true
```

`big-text.ts` 见 §3.1（完整文件在本目录），`tools.ts` 复制 dsh-tool-pipeline-demo 同名文件，`index.ts` 直接复制本目录同名文件。验证步骤：

```bash
npm install          # 78 packages（含自动安装的 peer）
npm start            # 末行 CONTEXT_DEMO_OK
npm run start:bun    # 与 Node 逐行一致（随机 id/临时目录名除外）
npm run typecheck    # 退出码 0
```

## 8. 小结

- [x] System Prompt 是有序 section + 变量的可逆贡献，插值失败是硬错误；
- [x] token 计量有纯函数估算器（`/estimate` 子路径），真实计量发生在每次请求后；
- [x] pruner 裁剪的是**会话表面**：影子计价 + replace 事件，重放可恢复；
- [x] spill 以 prepend + next 与下游组合，需要会话 owner，头尾保留 + 超出落盘；
- [x] 配置层 `disabled: true` 是观察组合机制的正确手段；
- [x] 模型表面是历史的投影，内存 SQLite 即可演示；
- [x] Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)；下一篇：dsh-agent-loop-demo——turn/step 事件与脚本化适配器驱动的循环。
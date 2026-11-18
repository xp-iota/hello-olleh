# dsh 的工具管线示例

本示例演示 dsh 工具管线的五个干预点：注册、可见性、执行前策略、执行、执行后策略。word-count 工具插件在 cordis.patch.yml 里声明（初始禁用），五个场景全部经行句柄的 disabled 开关驱动，代码里没有一处 `ctx.plugin()`。

模型「能调用工具」这件事，在 dsh 里不是一张 `name → function` 字典，而是一条五段可干预管线。全部场景离线、不经过模型、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识除外）。

## 1 权限为什么不能写死在工具实现里

```text
注册（register）→ 可见性（schemas / restrict）→ pre-execute（waterfall）
→ execute → post-execute（waterfall）→ result
```

四个控制面各回答一个问题，且必须分开：

| 控制面 | 问题 | 干预点 |
|---|---|---|
| 注册 | 这个工具存在吗 | `ctx.tools.register` |
| 可见性 | 这个 agent 看得见它吗 | `ctx.tools.restrict` |
| 执行前 | 这次调用放不放行 | `tools/pre-execute`、`ctx.tools.guard` |
| 执行后 | 模型看到的还是原始结果吗 | `tools/post-execute` |

> 同一个工具需要按会话、按 agent、按模式给出不同结论，而工具实现只有一份。

把权限写死在工具实现里是这类系统最常见的架构错误。本示例用一个 `word_count` 工具把四个控制面全部打开。

## 2 最小树：比 boot-demo 多六行

`cordis.patch.yml` 在 [dsh-boot-demo](../dsh-boot-demo/README.md) 的五行基础上追加：

| 行 id | 包 | 为什么需要 |
|---|---|---|
| `session` | `@deepseek-ai/dsh-session` | SessionStore，agent 的会话底座 |
| `session-projection` | `@deepseek-ai/dsh-session-projection` | 提供 `sessionProjections` 服务 |
| `agent` | `@deepseek-ai/dsh-agent` | `AgentRegistry.static inject = ['sessionProjections']`（core/agent/src/index.ts:247） |
| `llm` | `@deepseek-ai/dsh-llm` | agent-loop 的 inject 成员；本示例只用它的 `ToolCallId` 品牌类型 |
| `agent-loop` | `@deepseek-ai/dsh-agent-loop` | **注册 AgentFactory**。`AgentLoop.static inject = ['agents','sessions','llm','tools','systemPrompt','sessionProjections']`（core/agent-loop/src/index.ts:291） |
| `word-count` | `./src/plugins/word-count.ts` | 自写工具插件，`disabled: true`，五个场景由运行时开关驱动 |

倒数第二行是实测踩出来的：只挂 `agent` 不挂 `agent-loop`，`agents.create()` 直接抛 `no agent factory registered (load an agent-loop plugin)`。注册表（agent）与工厂（agent-loop）分离，和 tools 与 tool-executor-native 的分离是同一个设计手法。最后一行是本示例的装配原则：**自写插件也走声明式**，挂载与回收都交给 loader，场景代码只做开关。

## 3 工具插件与单次调用封装

### 工具插件 src/plugins/word-count.ts

```ts
/**
 * word-count —— 最小工具插件（cordis 插件形态）。
 *
 * 三个约定：
 *   - name 只用于诊断/日志，不是工具名；
 *   - inject = ['tools'] 声明依赖，满足后 cordis 才调用 apply；
 *   - 注册是 effect-based 的：插件 fiber 销毁 → 工具自动反注册。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-wordcount'
export const inject = ['tools']

export function apply(ctx: Context): void {
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
}
```

`defineTool` 三段式里藏着一条重要分界：**规范值与渲染内容是两回事**。`execute` 返回 `{words: 3, chars: 31}`（规范值），`render` 把它变成 `"3 词 / 31 字符"`（模型可见内容）。审计、压缩、重放依赖前者，模型只看见后者。

### 单次调用封装 src/tools.ts

0.2.2 起 `ctx.tools.execute()` 的输入是**一整批模型原始调用**（`ToolBatchInput`），`calls` 里是 `ToolCallBlock`，`arguments` 是**模型产出的 JSON 字符串**——这是真实协议形状，不是适配层权宜之计：

```ts
const batch = await ctx.tools.execute({
  calls: [{
    type: 'tool-call',
    id: ToolCallId(`demo-${Date.now().toString(36)}-…`),
    name,
    arguments: JSON.stringify(args),
  }],
  ...(agent === undefined ? {} : { agent }),
  signal: new AbortController().signal,
})
return batch.results[0].result
```

完整封装（`executeTool` / `callTool` / `blocksToText` / `preview`）见第 8 节的 `src/tools.ts` 镜像。

## 4 五个场景

S1 观察注册与回收。word-count 行初始禁用，开关就是 `entry.update({ disabled })`：

```ts
// patch 清单里声明的 word-count 行：按 options.id 找行句柄，
// 场景只做开关，挂载与回收都交给 loader。
function wordCountRow(ctx: Context) {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'word-count')
  if (!entry) throw new Error('cordis.patch.yml 里没有 id=word-count 的行')
  return entry
}

async function setWordCount(ctx: Context, enabled: boolean): Promise<void> {
  await wordCountRow(ctx).update({ disabled: !enabled })
  await ctx.loader.await()
}

// S1：启用 → 工具出现；禁用 → 工具随 fiber 回收
await setWordCount(ctx, true)
// …调用…
await setWordCount(ctx, false)
```

S2～S5 在每个场景前后做同样的开关，中间挂各自的干预点：

```ts
// S2 pre-execute 权限门：waterfall，返回决定即"认领"
const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'word_count') return { kind: 'deny', reason: '本场景规定：word_count 一律拒绝' }
  return next()
})
// …调用被拒…
offPre()   // 监听器挂在根 ctx 上，不随插件 fiber 销毁，必须手动解除

// S3 post-execute 结果变换：accept 的 content 整段替换模型可见内容
const offPost = ctx.on('tools/post-execute', async (exec, result, next) => {
  if (exec.name !== 'word_count') return next()
  return { kind: 'accept', content: [...result.content, { type: 'text', text: '（…补充说明）' }] }
})

// S4 按 agent 收紧：restrict 只能在 scoped context 上调用
const handle = await ctx.agents.create({
  sessionId: SessionId(`pipeline-restrict-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
  setup: agentCtx => { agentCtx.tools.restrict({ allow: ['word_count'] }) },
})
const scoped = ctx.tools.schemas(handle.agent)   // 只有 word_count
const global = ctx.tools.schemas()               // 全局不受影响

// S5 单调守卫：先放行再拒绝，证明 guard 不能被 allow 覆盖
const offAllow = ctx.on('tools/pre-execute', async (_exec, next) => next())
const removeGuard = ctx.tools.guard(exec =>
  exec.name === 'word_count' ? '守卫禁止：word_count 在本场景不可用' : undefined)
// …调用被拒…
removeGuard()   // 移除后恢复
```

## 5 机制解释

### 注册是 effect，禁用行即回收

`ctx.tools.register()`（core/tools/src/index.ts:128）把注册挂进调用方 fiber 的 effect 链。行句柄 `update({ disabled: true })` 销毁该行 fiber，工具自动从注册表消失——不需要任何「反注册」代码。热重载不是额外功能，是 cordis effect 的自然结果（对照 cordis-hmr-demo 的插件替换）。

### pre-execute 是 waterfall，四种决定

监听要么给出决定（`allow` / `deny` / `ask` / `cancel`），要么 `next()` 交给下一个监听。返回 `deny` 就「认领」了这次调用，后面的监听不再运行。`deny` 的 `reason` 是**给模型看的**——模型需要知道为什么被拒，才能换个做法。`ask` 走人类审批（见 dsh-hitl-demo），`cancel` 直接中止。

### post-execute 改的是「模型可见内容」，不是规范值

返回 `{kind: 'accept', content}` 整段替换模型可见内容，规范值不变。这就是「模型看到摘要、日志保存全文」的实现位置——结果裁剪与溢出策略都挂在这里。

### restrict 单向收紧，且必须要 scoped context

`tools.restrict()`（core/tools/src/index.ts:162-170）开头就拒绝全局调用：

```text
tools.restrict() requires a scoped context (agent.ctx): a context-global
restriction would mask every agent — deny the tool for the intended agent instead
```

两条安全属性：其一，收紧只影响该 agent 的下一次装配，全局注册表不变（S4 实测「全局仍为 1 个」）；其二，agent 作用域**只能减少**工具，不能凭空增加——否则一个子 agent 就能给自己授权父级没有的能力。空过滤器 `{}` 也直接抛错（「几乎总是配置物化成了空对象的 bug」）。

### guard 的不对称是安全属性

`ctx.tools.guard()` 在**所有** pre-execute 监听之后运行，且**没有 allow 返回值**——只能返回拒绝理由或 `undefined`。S5 先挂一个「一律放行」的监听再挂 guard，调用仍被拒绝：无论前面的监听怎么放行，守卫都能兜住。如果守卫也能「放行」，监听顺序就会变成权限来源，而顺序是配置细节，不该承担安全责任。`guard()` 返回精确的解除函数，调用即恢复。

## 6 运行工具管线示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

```yaml
# 工具管线的最小树：比 dsh-boot-demo 多五行——
# session / session-projection / agent / llm / agent-loop，
# 因为"按 agent 收紧可见性"需要真实的 agent scope，而 agents.create() 需要
# agent-loop 注册的 factory（否则报 no agent factory registered）。
# 依赖链：systemPrompt → tools → tool-executor-native；
#         sessionProjections → agent；
#         agents + sessions + llm + tools + systemPrompt + sessionProjections → agent-loop。
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

    # 配置态 agent 保持空表：本示例的 agent 全部由运行时 agents.create() 创建。
    - id: agent
      name: '@deepseek-ai/dsh-agent'

    - id: llm
      name: '@deepseek-ai/dsh-llm'

    # agent-loop 是 required 行：挂了就必须激活。它注册 AgentFactory，
    # 没有它 agents.create() 直接抛 no agent factory registered。
    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # 自写工具插件也走声明式：初始禁用，五个场景由运行时开关驱动
    - id: word-count
      name: ./src/plugins/word-count.ts
      disabled: true
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`——dsh 生态的声明式装配入口，读 cordis.yml 与 patch 清单建起整棵服务树，与 cordis CLI 读 yml 是同一个思路：

```ts
const ctx = await boot(
  'dsh-tool-pipeline-demo', CONFIG,
  loadOverlayPatches('dsh-tool-pipeline-demo', PATCH),
  undefined, BASE_URL,
)
// ……S1～S5：全部经 wordCountRow(ctx).update({ disabled }) 开关……
await ctx.fiber.dispose()
console.log('\nTOOL_PIPELINE_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：五场景全离线，末行 TOOL_PIPELINE_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 外逐行一致）：

```text
runtime = node v26.12.1

=== S1 注册工具与 effect 回收 ===
启用前工具数：0（word-count 行初始禁用）
启用后新增：word_count
调用结果：3 词 / 31 字符
禁用后工具集合已回收（0 个）

=== S2 pre-execute 权限门 ===
pre-execute 拦截 word_count
模型看到的拒绝原因：Error: 本场景规定：word_count 一律拒绝

=== S3 post-execute 结果变换 ===
返回内容：3 词 / 13 字符 （本次结果由 post-execute 监听补充说明）

=== S4 按 agent 收紧可见工具 ===
全局可见工具数：1
该 agent 可见：word_count（1 个）
全局仍为 1 个（scoped 收紧不外溢）

=== S5 单调守卫：只能拒绝，不能放行 ===
guard 的拒绝原因：Error: 守卫禁止：word_count 在本场景不可用
移除 guard 后恢复：2 词 / 13 字符

TOOL_PIPELINE_OK
```

注意 S1 的「启用前工具数：0」——这棵最小树没有挂任何自带工具的插件（fs/shell/web 都不在），注册表是干净的，正好观察单个工具的完整生命周期。完整 dsh 装配的基础工具是 27 个（rc.3，见 dsh-chat-demo）。

## 7 边界与坑

1. **根 ctx 上的监听器不随插件 fiber 销毁**（本示例实测踩过）：S2 的 deny 监听若不拿 `ctx.on()` 返回的 off 句柄手动解除，会泄漏到 S3——实测症状是 S3 的「补充说明」追加在一条拒绝错误后面。要么手动 off，要么把监听挂进插件 apply（随 fiber 回收）。
2. **`agents.create()` 需要 agent-loop 注册 factory**（实测踩过）：只挂 `agent` 行会抛 `no agent factory registered (load an agent-loop plugin)`。agent-loop 是 required 行，inject 六个服务，最小树必须补齐 llm 行。
3. **`tools.restrict()` 在全局 ctx 上直接抛错**——必须在 `setup(agentCtx)` 这类 scoped context 里调用。
4. **批接口的 `arguments` 是 JSON 字符串**，不是对象。传对象会在 schema 校验阶段失败；`ToolCallId` 是品牌类型，用 `ToolCallId(...)` 构造。
5. **`defineTool` 的 schema 要求**：object 类型必须显式写 `additionalProperties`，必填字段写在各 property 的 `required: true` 上。
6. **`cannot get property "tools" without inject`**：插件没写 `inject: ['tools']`。cordis 的反射代理强制访问控制，这不是可选优化。
7. **行句柄要按 `options.id` 找**：`ctx.loader.resolve(id)` 只查根树，patch 行挂在子树里会报 cannot resolve entry；用 `[...ctx.loader.entries()]` 递归遍历。需要运行时寻址的行必须写显式 `id:`。
8. **本示例不挂 ptc/subprocess**，Bun 无需补丁；`start:bun` 直接 `bun src/index.ts`。

## 8 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-tool-pipeline-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore            # node_modules/ + .dsh-home/
├── cordis.yml            # []：根配置留空
├── cordis.patch.yml      # 十行最小树（见第 6 节全文）
└── src/
    ├── index.ts          # 五场景主程序：boot() + 行开关
    ├── tools.ts          # 单次调用封装
    └── plugins/
        └── word-count.ts # 最小工具插件（见第 3 节全文）
```

### package.json

```json
{
  "name": "dsh-tool-pipeline-demo",
  "private": true,
  "type": "module",
  "description": "工具管线五段：注册与 effect 回收、pre-execute 权限门、post-execute 结果变换、按 agent 收紧可见性、单调守卫。Node 与 Bun 双运行时。",
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
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

### src/tools.ts（完整版）

```ts
/**
 * tools.ts —— 单次工具调用的便利封装。
 *
 * 0.2.2 起 `ctx.tools.execute()` 的输入是一整批模型原始调用（ToolBatchInput，
 * calls 里是 ToolCallBlock，参数为 JSON 字符串），返回 ToolBatchResult。
 * 这里把"单次调用"这层封装固定下来，场景代码只关心一次调用的结果。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** 一次调用的精简结果。 */
export interface CalledTool {
  readonly isError: boolean
  readonly content: string
  /** 成功时的规范值（canonical JSON value）。 */
  readonly value: unknown
}

/** 把 content block 数组拼成一行文本。 */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : `[${block?.type ?? '?'}]`))
    .join(' ')
}

/**
 * 执行一个已注册的工具（不经过模型），返回原生 ToolExecutionResult。
 * 批接口要求 ToolCallBlock.arguments 是模型产出的 JSON 字符串——这是真实协议形状。
 */
export async function executeTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId(`demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        name,
        arguments: args === undefined ? '{}' : JSON.stringify(args),
      },
    ],
    ...(agent === undefined ? {} : { agent }),
    signal: new AbortController().signal,
  })
  const settled = batch.results[0]
  if (settled === undefined) throw new Error(`工具 ${name} 没有返回结果（批次为空）`)
  return settled.result
}

/** 调用一个已注册的工具并压成一行可打印结果。 */
export async function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<CalledTool> {
  const result = await executeTool(ctx, name, args, agent)
  const isError = result.isError === true
  return {
    isError,
    content: blocksToText(result.content),
    value: isError ? undefined : result.value,
  }
}

/** 截断到一行，便于日志。 */
export function preview(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}
```

### src/index.ts（完整版）

```ts
/**
 * dsh-tool-pipeline-demo —— 工具管线五段，全部离线、不经过模型：
 *   S1 注册与 effect 回收；
 *   S2 pre-execute 权限门（waterfall deny）；
 *   S3 post-execute 结果变换（waterfall accept）；
 *   S4 按 agent 收紧可见工具（scoped restrict 不外溢）；
 *   S5 单调守卫：只能拒绝，不能放行。
 * word-count 插件在 cordis.patch.yml 里声明（初始禁用），
 * 五个场景全部通过行句柄的 disabled 开关驱动，不编程式挂插件。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import { blocksToText, callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-tool-pipeline-demo', CONFIG,
  loadOverlayPatches('dsh-tool-pipeline-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

// patch 清单里声明的 word-count 行：按 options.id 找行句柄，
// 场景只做开关，挂载与回收都交给 loader。
function wordCountRow(ctx: Context) {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'word-count')
  if (!entry) throw new Error('cordis.patch.yml 里没有 id=word-count 的行')
  return entry
}

async function setWordCount(ctx: Context, enabled: boolean): Promise<void> {
  await wordCountRow(ctx).update({ disabled: !enabled })
  await ctx.loader.await()
}

// ── S1：注册与回收 ─────────────────────────────────────────────────────────
console.log('\n=== S1 注册工具与 effect 回收 ===')
const before = ctx.tools.schemas().map(schema => schema.name)
console.log(`启用前工具数：${before.length}（word-count 行初始禁用）`)
await setWordCount(ctx, true)
const after = ctx.tools.schemas().map(schema => schema.name)
assert(after.includes('word_count'), 'word_count 未出现在可见工具里')
console.log(`启用后新增：${after.filter(n => !before.includes(n)).join(', ')}`)
const first = await callTool(ctx, 'word_count', { text: 'DeepSeek Harness 里每一次工具调用都是可观察的' })
assert(!first.isError, `工具调用失败：${first.content}`)
console.log(`调用结果：${first.content}`)
await setWordCount(ctx, false)
const recycled = ctx.tools.schemas().map(schema => schema.name)
assert(!recycled.includes('word_count'), '禁用之后工具仍在')
console.log(`禁用后工具集合已回收（${recycled.length} 个）`)

// ── S2：pre-execute 拒绝 ───────────────────────────────────────────────────
console.log('\n=== S2 pre-execute 权限门 ===')
await setWordCount(ctx, true)
// pre-execute 是 waterfall：返回决定就"认领"，调用 next() 交给下一个监听。
// 注意：监听器挂在根 ctx 上，不随插件 fiber 销毁——必须拿 off 句柄手动解除，
// 否则 S2 的 deny 会泄漏到后续场景。
const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'word_count') {
    console.log(`pre-execute 拦截 ${exec.name}`)
    return { kind: 'deny', reason: '本场景规定：word_count 一律拒绝' }
  }
  return next()
})
const denied = await callTool(ctx, 'word_count', { text: 'should be denied' })
assert(denied.isError, 'deny 之后调用不应成功')
console.log(`模型看到的拒绝原因：${denied.content}`)
offPre()
await setWordCount(ctx, false)

// ── S3：post-execute 追加说明 ──────────────────────────────────────────────
console.log('\n=== S3 post-execute 结果变换 ===')
await setWordCount(ctx, true)
const offPost = ctx.on('tools/post-execute', async (exec, result, next) => {
  if (exec.name !== 'word_count') return next()
  // accept 的 content 字段整段替换模型可见内容。
  return {
    kind: 'accept',
    content: [...result.content, { type: 'text', text: '（本次结果由 post-execute 监听补充说明）' }],
  }
})
const appended = await callTool(ctx, 'word_count', { text: 'one two three' })
assert(appended.content.includes('post-execute'), 'post-execute 的补充没有出现在结果里')
console.log(`返回内容：${appended.content}`)
offPost()
await setWordCount(ctx, false)

// ── S4：按 agent 收紧可见工具 ──────────────────────────────────────────────
console.log('\n=== S4 按 agent 收紧可见工具 ===')
await setWordCount(ctx, true)
const all = ctx.tools.schemas().map(schema => schema.name)
console.log(`全局可见工具数：${all.length}`)
const handle = await ctx.agents.create({
  sessionId: SessionId(`pipeline-restrict-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
  setup: agentCtx => {
    // scoped 收紧只影响这个 agent 的下一轮装配。
    agentCtx.tools.restrict({ allow: ['word_count'] })
  },
})
const scoped = ctx.tools.schemas(handle.agent).map(schema => schema.name)
console.log(`该 agent 可见：${scoped.join(', ')}（${scoped.length} 个）`)
assert(scoped.length === 1 && scoped[0] === 'word_count', '收紧后的工具集合不符预期')
const stillAll = ctx.tools.schemas().map(schema => schema.name)
assert(stillAll.length === all.length, '全局工具集合被 scoped 收紧影响了')
console.log(`全局仍为 ${stillAll.length} 个（scoped 收紧不外溢）`)
await handle.dispose()
await setWordCount(ctx, false)

// ── S5：单调守卫 ───────────────────────────────────────────────────────────
console.log('\n=== S5 单调守卫：只能拒绝，不能放行 ===')
await setWordCount(ctx, true)
// 先让 pre-execute 放行，再由 guard 拒绝：证明 guard 不能被 allow 覆盖。
const offAllow = ctx.on('tools/pre-execute', async (_exec, next) => next())
const removeGuard = ctx.tools.guard(exec =>
  exec.name === 'word_count' ? '守卫禁止：word_count 在本场景不可用' : undefined,
)
const blocked = await callTool(ctx, 'word_count', { text: 'blocked by guard' })
assert(blocked.isError, 'guard 拒绝之后调用不应成功')
console.log(`guard 的拒绝原因：${preview(blocksToText(blocked.content))}`)
removeGuard()
const allowed = await callTool(ctx, 'word_count', { text: 'allowed again' })
assert(!allowed.isError, '移除 guard 后应当恢复')
console.log(`移除 guard 后恢复：${allowed.content}`)
offAllow()
await setWordCount(ctx, false)

await ctx.fiber.dispose()
console.log('\nTOOL_PIPELINE_OK')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `@deepseek-ai/dsh-app-boot` 与 `@deepseek-ai/dsh-tools`。
2. `npm start` 打印 S1～S5 五段，末行 `TOOL_PIPELINE_OK`，与第 6 节实测输出逐行一致。
3. `npm run start:bun` 除首行 runtime 标识外逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 9 小结

这个示例验证了八件事：

- 四个控制面分离：注册 / 可见性 / 执行前 / 执行后，权限不写死在工具实现里；
- 规范值与渲染内容分界：execute 返回规范值，render 产出模型可见内容；
- 注册是 effect：行禁用即反注册，热重载不需要额外代码；
- pre/post-execute 都是 waterfall：返回决定即认领，next() 交给下一个；
- restrict 单向收紧、必须 scoped、不外溢全局；
- guard 单调：只能拒绝不能放行，监听顺序不承担安全责任；
- 自写插件也走声明式：patch 清单一行 + 运行时开关，代码里没有 ctx.plugin；
- Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-boot-demo](../dsh-boot-demo/README.md)；下一篇：[dsh-context-demo](../dsh-context-demo/README.md)——system prompt 的 section 装配与 token 经济学。
# 16 · dsh 的委派示例

本示例演示 agent 怎么把工作委派给子 agent：spawn 与 fork 两条通道、会话头归属、真实 `subagent` 工具激活子 agent 跑完自己的 turn、深度预算。word-count 工具与脚本化适配器都在 cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。

全部场景离线、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.5、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识除外）。

## 1 两条委派通道

一个 agent 可以把工作委派给子 agent。两条通道差别很大：

| 通道 | provider | 会话语义 | 适合 |
|:-----|:---------|:---------|:-----|
| spawn | `subagent-spawn-in-process` | 子从零开始，独立上下文 | 分头查资料/改文件 |
| fork | `subagent-fork-in-process` | 子继承父会话前缀（seed） | 接着我这条线索往下做 |

> 差别在**会话层**；归属（谁是谁的子）与预算（最多委派几层）在**运行期层**。

本示例把两层都离线触发，包括真实的 `subagent` 工具激活一个子 agent 并让它跑完自己的 turn。

## 2 最小树：九行底座 + 十行委派栈 + 两个自写插件

在 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md) 的九行底座上追加十行委派栈：

| 行 id | 包 | 说明 |
|---|---|---|
| `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | v4 编解码（持久化的前置依赖） |
| `deepseek-llm-api-extensions` | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 编解码行注入的扩展字段，缺了永远 pending |
| `session-persistence-jsonl` | `@deepseek-ai/dsh-session-persistence-jsonl` | **continuable 子 agent 的硬要求**：没有持久化后端，spawn 激活直接拒绝 |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | 读取面：fork 要读父会话快照做 seed |
| `fs-local` | `@deepseek-ai/dsh-fs-local` | fs 服务：working-directory 的 inject 依赖 |
| `working-directory` | `@deepseek-ai/dsh-working-directory` | 注入 `fs + sessionProjections + systemPrompt` |
| `subagent` | `@deepseek-ai/dsh-subagent` | 委派运行时；`maxDepth` 是 volatile 配置，默认 1 |
| `subagent-spawn` | `@deepseek-ai/dsh-subagent-spawn-in-process` | `providerName: spawn` |
| `subagent-fork` | `@deepseek-ai/dsh-subagent-fork-in-process` | `providerName: fork` |
| `tool-subagent` ×2 | `@deepseek-ai/dsh-tool-subagent` | 同一个包装配两次：`subagent`（spawn）与 `subagent_fork`（fork） |

再加两行自写插件（word-count / scripted-adapter，与 agent-loop 示例逐字相同），共二十一行。依赖链：`subagent` 注入 `workingDirectory + sessionProjections`；spawn/fork provider 注入 `subagents`；`tool-subagent` 注入 `tools + subagents + systemPrompt + sessionProjections`。两条硬约束：不挂 fs-local（或别的 fs 后端），working-directory 缺 fs，subagent 服务永远 pending；continuable 子 agent 要求会话持久化，只挂委派栈不挂持久化后端，`subagent` 工具直接报 `continuable subagents require session persistence`——补 `session-persistence-jsonl` 一行即可，但它的编解码链（session-log-deepseek + deepseek-llm-api-extensions）也要在位。

## 3 五个场景

```ts
// S1 能力面直接可读：两条 provider 的会话语义与预算能力
const provider = ctx.subagents.getProvider('fork')
provider.inheritsParentContext        // true
provider.capabilities.depthLimit      // true

// S2 spawn：rc.3 的子 agent 身份落在会话头元数据
ctx.agents.create({ sessionId, meta: { cwd, origin: 'subagent', delegationDepth: 1 } })

// S3 fork：parentSession + isSeeded + 显式 seed
ctx.agents.create({
  sessionId,
  meta: { cwd, parentSession: parent.id, isSeeded: true, origin: 'subagent', delegationDepth: 1 },
  seed: parentSnapshot.events,
  inheritedEventCount: parentSnapshot.events.length,
})

// S4 真实委派工具：立即返回 activation，子在后台独立跑
await callTool(ctx, 'subagent', { description, prompt }, parent)
ctx.subagents.rootOf(child) === parent   // manager 管理的激活才能回溯

// S5 深度预算：深度 1 的子再委派 → provider 拒绝
await callTool(ctx, 'subagent', { description, prompt }, child)   // exceeds maxDepth
```

## 4 机制解释

### 两个工具、两条 provider

`tool-subagent` 是「一个包装、一个 provider、一个工具」：装配两次才有 `subagent`（spawn）与 `subagent_fork`（fork）。provider 的能力面直接可读：`inheritsParentContext` 区分两条通道的会话语义，`depthLimit` 表示它能执行深度预算。

### spawn：身份落在会话头

rc.3 里 `agents.create()` 没有 `parentAgent` 字段，也没有 `roots()` 枚举 API——子 agent 身份是**会话头元数据**：`meta: { origin: 'subagent', delegationDepth: 1 }`。父会话没有 origin，子是 `subagent`；深度记录在会话头，可回放、可审计。

### fork：seed 前缀

先让父会话跑一个真实脚本化 turn（17 条事件），再建 fork：`meta: { parentSession, isSeeded: true, origin: 'subagent', delegationDepth: 1 }` 加 `seed: parentSnapshot.events` 与 `inheritedEventCount`。子会话 18 条事件 = 17 条继承前缀 + 1 条自己的出生记录，前缀逐条同型。**设了 isSeeded 却不给 seed，会话构造直接失败**——自称继承却拿不出前缀是自相矛盾的。

### 真实委派工具

`callTool(ctx, 'subagent', { description, prompt }, parent)` 走完整管线：工具立即返回 `{ kind: 'activation', name: 'agent-1' }`，子在后台独立跑。子继承父的兼容模型路由（这里是 `lab-scripted / delegator`），跑完自己的 turn：18 条事件、1 个 turn、1 次 tool/call——与父会话完全独立。工具激活的子是 **manager 管理的激活**，所以 `ctx.subagents.rootOf(child)` 能沿委派链回溯到父（S2 那种 registry 直建的子没有运行期 owner，rootOf 会抛 `UNAUTHORIZED`——两种归属机制不要混用）。

### 深度预算

`maxDepth: 1`（volatile 配置，默认就是 1）：深度 1 的子 agent 再调 `subagent` 工具，provider 在委派时执行预算，拒绝消息是 `subagent depth 2 exceeds maxDepth 1`。预算不是建议，是每次委派都过的检查。

## 5 运行委派示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

```yaml
# 委派的最小树：九行 base + 十行委派栈。
# 模型侧不挂任何真实 provider：脚本化 LlmAdapter 与 word-count 工具
# 都是自写插件，声明在末尾两行，全程在位。
# 依赖链：subagent 注入 workingDirectory + sessionProjections；
#         working-directory 注入 fs + sessionProjections + systemPrompt → 需要 fs-local 提供 fs 服务；
#         spawn/fork provider 注入 subagents；tool-subagent 注入 tools + subagents + systemPrompt + sessionProjections；
#         continuable 子 agent 要求会话持久化 → session-persistence-jsonl（及其日志编解码链）。
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

    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # ── 委派栈十行 ────────────────────────────────────────────────────────
    # 会话日志的官方 v4 编解码 + 它依赖的 DeepSeek 扩展字段（缺了编解码行永远 pending）。
    - id: session-log-deepseek
      name: '@deepseek-ai/dsh-session-log-deepseek'

    - id: deepseek-llm-api-extensions
      name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'

    # continuable 子 agent 的硬要求：没有持久化后端，spawn 激活直接拒绝。
    - id: session-persistence-jsonl
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js dshHomePath('sessions')
        compression: none

    # 会话读取面：fork 场景要读父会话快照做 seed 前缀。
    # openAt: never = 不落 SQLite、不做全文索引；精确读照常可用。
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never

    # fs 服务：working-directory 的 inject 依赖（本示例不做沙箱，见 dsh-sandbox-demo）。
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'

    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'

    # 委派运行时：maxDepth 是 volatile 配置，默认 1（子 agent 不能再委派）。
    - id: subagent
      name: '@deepseek-ai/dsh-subagent'
      config:
        maxDepth: 1

    # 两条进程内 provider：spawn 从零开始，fork 继承父会话前缀。
    - id: subagent-spawn
      name: '@deepseek-ai/dsh-subagent-spawn-in-process'
      config:
        providerName: spawn

    - id: subagent-fork
      name: '@deepseek-ai/dsh-subagent-fork-in-process'
      config:
        providerName: fork

    # 同一个 tool-subagent 包装配两次：一次 spawn 一次 fork，各注册一个工具。
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent

    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork

    # 自写插件也走声明式：工具与脚本化适配器全程在位，随整树 dispose 回收。
    - id: word-count
      name: ./src/plugins/word-count.ts

    - id: scripted-adapter
      name: ./src/plugins/scripted-adapter.ts
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，工具与适配器随装配就位。类型增补靠导入：`ctx.subagents` 来自 `import type {} from '@deepseek-ai/dsh-subagent'`，`ctx.sessionQuery` 来自 session-query-sqlite，都不能省：

```ts
const ctx = await boot(
  'dsh-subagent-demo', CONFIG,
  loadOverlayPatches('dsh-subagent-demo', PATCH),
  undefined, BASE_URL,
)
// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。
// ……S1～S5：provider 能力面、spawn、fork、真实委派、深度预算……
await ctx.fiber.dispose()
console.log('\nSUBAGENT_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：五场景全离线，末行 SUBAGENT_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 外逐行一致）。一个确定化细节：工具枚举顺序跨运行时不一致（Bun 的 Map 迭代序与 Node 不同），打印工具列表前先 `.sort()`，否则双运行时输出无法逐行对比：

```text
runtime = node v26.12.1

=== S1 委派工具与 provider ===
委派工具：subagent, subagent_fork
provider spawn：inheritsParentContext=false，depthLimit=true
provider fork：inheritsParentContext=true，depthLimit=true

=== S2 spawn：独立子 agent ===
子 agent 已创建：会话头 origin=subagent，delegationDepth=1，父 origin=(无)，注册表可见=true
子 agent 与父 agent 已释放

=== S3 fork：继承父会话前缀 ===
父会话事件数：17
fork 事件数：18，继承前缀：17，前缀逐条同型：true

=== S4 真实 subagent 工具 ===
工具返回：isError=false，kind=activation，name=agent-1，started subagent agent-1
子 agent 跑完：事件 18 条，turn × 1，tool/call × 1
rootOf(子)===父：true

=== S5 深度预算 ===
subagents.resolveMaxDepth() = 1
深度 1 再委派：isError=true，Error: subagent depth 2 exceeds maxDepth 1

SUBAGENT_OK
```

三个值得注意的事实：

- **S3 的 18 = 17 + 1**：fork 不是引用父会话，而是把前缀真实复制进子会话日志——`inheritedEventCount` 精确记录继承长度，前缀可回放、可审计；
- **S4 的 activation**：委派工具不等子跑完，立即返回子的名字；子继承父的模型路由，在后台跑完自己的 turn，父子的会话完全独立；
- **S5 的拒绝发生在 provider**：深度预算不是工具层的建议，是每次委派都过的检查，超限直接变成模型可见的工具错误。

## 6 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-subagent-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore            # node_modules/ + .dsh-home/
├── cordis.yml            # []：根配置留空
├── cordis.patch.yml      # 二十一行最小树（见第 5 节全文）
└── src/
    ├── index.ts          # 五场景主程序：boot() + 两条通道 + 归属与预算
    ├── tools.ts          # callTool 单次调用封装（与 hitl-demo 逐字相同）
    └── plugins/
        ├── word-count.ts       # 最小工具插件（与 tool-pipeline-demo 逐字相同）
        └── scripted-adapter.ts # 脚本化适配器（与 agent-loop-demo 逐字相同）
```

### package.json

```json
{
  "name": "dsh-subagent-demo",
  "private": true,
  "type": "module",
  "description": "委派：spawn 独立子 agent 与 fork 继承父会话前缀、rootOf() 归属、真实 subagent 工具激活子 agent 并跑完脚本化 turn、深度预算守卫。Node 与 Bun 双运行时。",
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
    "@deepseek-ai/dsh-agent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.5",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.5",
    "@deepseek-ai/dsh-deepseek-llm-api-extensions": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.5",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-log-deepseek": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-persistence-jsonl": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-query-sqlite": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subagent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subagent-fork-in-process": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subagent-spawn-in-process": "0.2.2-rc.5",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-subagent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.5",
    "@deepseek-ai/dsh-working-directory": "0.2.2-rc.5"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

tsconfig.json 与 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md) 逐字相同；`tools.ts` 直接复制 [dsh-hitl-demo](../14-dsh-hitl-demo/README.md) 同名文件（该 README 第 7 节有全文镜像）；`word-count.ts` 与 `scripted-adapter.ts` 复制 agent-loop 示例同名文件。也可以从 [dsh-session-demo](../12-dsh-session-demo/README.md) 复制脚手架（它已带持久化 + 读取面），再按第 2 节补齐委派栈。

### src/index.ts（完整版）

```ts
/**
 * dsh-subagent-demo —— 委派（delegation），全部离线（脚本化 LlmAdapter，不需要 key）：
 *   S1 委派工具与 provider：subagent / subagent_fork 两个工具、spawn / fork 两条 provider；
 *   S2 spawn：registry 直建子 agent，会话头记录 origin/深度归属；
 *   S3 fork：父会话先跑一个真实 turn，子会话带 seed 前缀 + inheritedEventCount；
 *   S4 真实委派工具：callTool('subagent') 激活子 agent，子继承父的模型路由跑完自己的 turn；
 *   S5 深度预算：maxDepth=1 时，深度 1 的子 agent 再委派被 provider 拒绝。
 * 关键认识：spawn 与 fork 的差别在会话层——独立上下文 vs 继承前缀；归属与预算在运行期层。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'
import type {} from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { callTool, preview } from './tools.ts'

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
  'dsh-subagent-demo', CONFIG,
  loadOverlayPatches('dsh-subagent-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const userMsg = (text: string) =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

const suffix = Date.now().toString(36)
const makeAgent = (tag: string, model: string) =>
  ctx.agents.create({
    sessionId: SessionId(`subagent-${tag}-${suffix}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'lab-scripted', model },
  })

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

// ── S1：委派工具与 provider ────────────────────────────────────────────────
console.log('\n=== S1 委派工具与 provider ===')
{
  const names = ctx.tools.schemas().map(schema => schema.name)
  const delegationTools = names.filter(name => name === 'subagent' || name === 'subagent_fork').sort()
  console.log(`委派工具：${delegationTools.join(', ')}`)
  assert(delegationTools.length === 2, '两个委派工具都应当注册')
  for (const providerName of ['spawn', 'fork']) {
    const provider = ctx.subagents.getProvider(providerName)
    if (provider === undefined) throw new Error(`断言失败：provider ${providerName} 未注册`)
    console.log(`provider ${providerName}：inheritsParentContext=${provider.inheritsParentContext}，depthLimit=${provider.capabilities.depthLimit}`)
  }
}

// ── S2：spawn——独立子 agent 与运行期归属 ───────────────────────────────────
console.log('\n=== S2 spawn：独立子 agent ===')
{
  const handle = await makeAgent('s2', 's2')
  const child = await ctx.agents.create({
    sessionId: SessionId(`subagent-s2-child-${suffix}`),
    // rc.3 的子 agent 身份落在会话头元数据：origin + delegationDepth。
    meta: { cwd: process.cwd(), origin: 'subagent', delegationDepth: 1 },
  })
  // registry 直建的子 agent：归属落在会话头（origin + delegationDepth），
  // 运行期 rootOf() 只认 manager 管理的激活（见 S4）。
  const childHeader = await ctx.sessionQuery.readSession(child.agent.id)
  const parentHeader = await ctx.sessionQuery.readSession(handle.agent.id)
  const listed = ctx.agents.list().some(agent => String(agent.id) === String(child.agent.id))
  console.log(`子 agent 已创建：会话头 origin=${childHeader.session.origin}，delegationDepth=${childHeader.session.delegationDepth}，父 origin=${parentHeader.session.origin ?? '(无)'}，注册表可见=${listed}`)
  assert(childHeader.session.origin === 'subagent' && childHeader.session.delegationDepth === 1, '会话头应当记录子 agent 身份与深度')
  assert(parentHeader.session.origin === undefined && listed, '父应当是普通会话，子应当在注册表里')
  await child.dispose()
  await handle.dispose()
  console.log('子 agent 与父 agent 已释放')
}

// ── S3：fork——继承父会话前缀 ───────────────────────────────────────────────
console.log('\n=== S3 fork：继承父会话前缀 ===')
{
  const handle = await makeAgent('s3', 'fork-parent')
  const parent = handle.agent
  // 先让父会话跑一个真实 turn，才有前缀可继承。
  parent.followup(userMsg('统计一下这段文本的词数'))
  await parent.whenIdle()
  const parentSnapshot = await ctx.sessionQuery.readSession(parent.id)
  console.log(`父会话事件数：${parentSnapshot.events.length}`)

  // fork 的语义在会话层：parentSession + isSeeded + 显式 seed。
  // 设了 isSeeded 却不给 seed，会话构造直接失败——自称继承却拿不出前缀是自相矛盾。
  const forked = await ctx.agents.create({
    sessionId: SessionId(`subagent-s3-fork-${suffix}`),
    meta: {
      cwd: process.cwd(),
      parentSession: parent.id,
      isSeeded: true,
      origin: 'subagent',
      delegationDepth: 1,
    },
    seed: parentSnapshot.events,
    inheritedEventCount: parentSnapshot.events.length as never,
  })
  const snapshot = await ctx.sessionQuery.readSession(forked.agent.id)
  const prefixMatches = parentSnapshot.events.every((event, i) => snapshot.events[i]?.type === event.type)
  console.log(`fork 事件数：${snapshot.events.length}，继承前缀：${snapshot.inheritedEventCount}，前缀逐条同型：${prefixMatches}`)
  assert(snapshot.inheritedEventCount === parentSnapshot.events.length, '继承前缀长度不符')
  assert(prefixMatches, 'fork 前缀应当与父会话逐条同型')
  await forked.dispose()
  await handle.dispose()
}

// ── S4：真实委派工具——激活子 agent 并跑完它自己的 turn ─────────────────────
console.log('\n=== S4 真实 subagent 工具 ===')
const delegHandle = await makeAgent('s4', 'delegator')
let child: Agent
{
  const parent = delegHandle.agent
  // 工具立即返回 activation（子 agent 的名字），子在后台独立跑。
  const started = await callTool(ctx, 'subagent', {
    description: '统计词数',
    prompt: '统计一下这段文本的词数，然后给出结论。',
  }, parent)
  const value = started.value as { kind?: string; name?: string } | undefined
  console.log(`工具返回：isError=${started.isError}，kind=${value?.kind}，name=${value?.name}，${preview(started.content, 160)}`)
  assert(!started.isError && value?.kind === 'activation', '委派工具应当返回 activation')

  const found = ctx.agents.list().find(agent => String(agent.id) !== String(parent.id))
  if (found === undefined) throw new Error('断言失败：子 agent 未出现在注册表里')
  child = found
  // 子继承父的兼容路由（lab-scripted / delegator），跑的是它自己的会话与 turn。
  await child.whenIdle()
  const childSnapshot = await ctx.sessionQuery.readSession(child.id)
  const toolCalls = childSnapshot.events.filter(event => event.type === 'tool/call').length
  const turns = childSnapshot.events.filter(event => event.type === 'turn/start').length
  console.log(`子 agent 跑完：事件 ${childSnapshot.events.length} 条，turn × ${turns}，tool/call × ${toolCalls}`)
  assert(turns === 1 && toolCalls === 1, '子 agent 应当独立跑完一个脚本化 turn')
  assert(String(child.id) !== String(parent.id), '子会话必须独立于父会话')
  // 工具激活的子是 manager 管理的激活：rootOf() 沿委派链回溯到活根。
  const root = ctx.subagents.rootOf(child)
  console.log(`rootOf(子)===父：${root === parent}`)
  assert(root === parent, 'rootOf 应当回溯到父 agent')
}

// ── S5：深度预算——深度 1 的子 agent 不能再委派 ─────────────────────────────
console.log('\n=== S5 深度预算 ===')
{
  console.log(`subagents.resolveMaxDepth() = ${ctx.subagents.resolveMaxDepth()}`)
  // 深度预算由 provider 在每次委派时执行：子深度 1 再委派 → 深度 2 超限被拒。
  const blocked = await callTool(ctx, 'subagent', {
    description: '再委派一层',
    prompt: '试着再委派一个子 agent。',
  }, child)
  console.log(`深度 1 再委派：isError=${blocked.isError}，${preview(blocked.content, 100)}`)
  assert(blocked.isError && blocked.content.includes('exceeds maxDepth'), '深度预算应当拒绝超限委派')
  await delegHandle.dispose()
}

await ctx.fiber.dispose()
console.log('\nSUBAGENT_OK')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `@deepseek-ai/dsh-subagent` 与 `@deepseek-ai/dsh-tool-subagent`。
2. `npm start` 打印 S1～S5 五段，末行 `SUBAGENT_OK`，与第 5 节实测输出逐行一致。
3. `npm run start:bun` 除首行 runtime 标识外逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 7 小结

这个示例验证了五件事：

- spawn 与 fork 的差别在会话层：独立上下文 vs seed 继承前缀（`inheritedEventCount` 精确记录继承长度，前缀可回放、可审计）；
- 归属有两套机制：会话头元数据（origin/delegationDepth，持久）与 manager 激活（rootOf，运行期）；registry 直建只有前者，工具激活两者都有；
- 深度预算由 provider 在每次委派时执行，`maxDepth` 默认 1；
- continuable 委派以会话持久化为前提——委派不是临时对象，是可恢复的工作；
- 自写插件走 patch 清单声明，Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-hitl-demo](../14-dsh-hitl-demo/README.md)；下一篇：[dsh-storage-demo](../19-dsh-storage-demo/README.md)——配置、数据与持久化。兄弟示例：[dsh-session-demo](../12-dsh-session-demo/README.md)（会话读取面与持久化）、[dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md)（子 agent 跑的 turn 循环）。
# dsh-tool-pipeline-demo：工具管线五段——注册、可见性、执行前后策略与单调守卫

> 独立示例：本目录拷到任何位置，`npm install && npm start` 即可运行（Node ≥ 22.18；`npm run start:bun` 走 Bun）。
> 版本面：`@deepseek-ai/*` **0.2.2-rc.3**、`@deepseek-ai/cordis` **4.1.0**。全部场景离线、不经过模型、不需要 key。
> 本文所有运行输出均为实测粘贴（Node v26.12.1 / Bun 1.4.4，Windows）。

## 1. 问题：权限为什么不能写死在工具实现里

模型"能调用工具"这件事，在 dsh 里不是一张 `name → function` 字典，而是一条**五段可干预管线**：

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

把权限写死在工具实现里是这类系统最常见的架构错误：同一个工具需要按会话、按 agent、按模式给出不同结论，而工具实现只有一份。本示例用一个 `word_count` 工具把四个控制面全部打开。

## 2. 最小树：比 boot-demo 多五行

`cordis.patch.yml` 在 [dsh-boot-demo](../dsh-boot-demo/README.md) 的五行基础上追加：

| 行 id | 包 | 为什么需要 |
|---|---|---|
| `session` | `@deepseek-ai/dsh-session` | SessionStore，agent 的会话底座 |
| `session-projection` | `@deepseek-ai/dsh-session-projection` | 提供 `sessionProjections` 服务 |
| `agent` | `@deepseek-ai/dsh-agent` | `AgentRegistry.static inject = ['sessionProjections']`（core/agent/src/index.ts:247） |
| `llm` | `@deepseek-ai/dsh-llm` | agent-loop 的 inject 成员；本示例只用它的 `ToolCallId` 品牌类型 |
| `agent-loop` | `@deepseek-ai/dsh-agent-loop` | **注册 AgentFactory**。`AgentLoop.static inject = ['agents','sessions','llm','tools','systemPrompt','sessionProjections']`（core/agent-loop/src/index.ts:291） |

最后两行是实测踩出来的：只挂 `agent` 不挂 `agent-loop`，`agents.create()` 直接抛 `no agent factory registered (load an agent-loop plugin)`。注册表（agent）与工厂（agent-loop）分离，和 tools 与 tool-executor-native 的分离是同一个设计手法。

## 3. 实现代码

### 3.1 工具插件 `src/plugins/word-count.ts`

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-wordcount'   // 只用于诊断，不是工具名
export const inject = ['tools']        // 满足后 cordis 才调用 apply

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

### 3.2 单次调用封装 `src/tools.ts`

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

完整封装（`executeTool` / `callTool` / `blocksToText` / `preview`）见本目录 `src/tools.ts`。

### 3.3 五个场景（`src/index.ts` 节选）

```ts
// S1 注册与回收：ctx.plugin() 返回 fiber，dispose 后工具自动消失
const fiber = await ctx.plugin(wordCount)
// …调用…
await fiber.dispose()

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

## 4. 实测运行输出

`npm start`（Node v26.12.1）：

```text
runtime = node v26.12.1

=== S1 注册工具与 effect 回收 ===
注册前工具数：0
注册后新增：word_count
调用结果：3 词 / 31 字符
dispose 后工具集合已回收（0 个）

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

`npm run start:bun`（Bun 1.4.4）：除首行 `runtime = bun 1.4.4` 外**逐行一致**，同样以 `TOOL_PIPELINE_OK` 结束。`npm run typecheck`：退出码 0。

注意 S1 的"注册前工具数：0"——这棵最小树没有挂任何自带工具的插件（fs/shell/web 都不在），注册表是干净的，正好观察单个工具的完整生命周期。完整 dsh 装配的基础工具是 27 个（rc.3，见 dsh-chat-demo）。

## 5. 机制解释

### 5.1 注册是 effect，卸载时工具自动回收

`ctx.tools.register()`（core/tools/src/index.ts:128）把注册挂进调用方 fiber 的 effect 链。`ctx.plugin()` 返回 fiber，`fiber.dispose()` 之后工具自动从注册表消失——不需要任何"反注册"代码。热重载不是额外功能，是 cordis effect 的自然结果（对照 cordis-hmr-demo 的插件替换）。

### 5.2 pre-execute 是 waterfall，四种决定

监听要么给出决定（`allow` / `deny` / `ask` / `cancel`），要么 `next()` 交给下一个监听。返回 `deny` 就"认领"了这次调用，后面的监听不再运行。`deny` 的 `reason` 是**给模型看的**——模型需要知道为什么被拒，才能换个做法。`ask` 走人类审批（见 dsh-hitl-demo），`cancel` 直接中止。

### 5.3 post-execute 改的是"模型可见内容"，不是规范值

返回 `{kind: 'accept', content}` 整段替换模型可见内容，规范值不变。这就是"模型看到摘要、日志保存全文"的实现位置——结果裁剪与溢出策略都挂在这里。

### 5.4 restrict 单向收紧，且必须要 scoped context

`tools.restrict()`（core/tools/src/index.ts:162-170）开头就拒绝全局调用：

```text
tools.restrict() requires a scoped context (agent.ctx): a context-global
restriction would mask every agent — deny the tool for the intended agent instead
```

两条安全属性：其一，收紧只影响该 agent 的下一次装配，全局注册表不变（S4 实测"全局仍为 1 个"）；其二，agent 作用域**只能减少**工具，不能凭空增加——否则一个子 agent 就能给自己授权父级没有的能力。空过滤器 `{}` 也直接抛错（"几乎总是配置物化成了空对象的 bug"）。

### 5.5 guard 的不对称是安全属性

`ctx.tools.guard()` 在**所有** pre-execute 监听之后运行，且**没有 allow 返回值**——只能返回拒绝理由或 `undefined`。S5 先挂一个"一律放行"的监听再挂 guard，调用仍被拒绝：无论前面的监听怎么放行，守卫都能兜住。如果守卫也能"放行"，监听顺序就会变成权限来源，而顺序是配置细节，不该承担安全责任。`guard()` 返回精确的解除函数，调用即恢复。

## 6. 边界与坑

1. **根 ctx 上的监听器不随插件 fiber 销毁**（本示例实测踩过）：S2 的 deny 监听若不拿 `ctx.on()` 返回的 off 句柄手动解除，会泄漏到 S3——实测症状是 S3 的"补充说明"追加在一条拒绝错误后面。旧 lab 的 runner 给每个阶段独立 fiber 所以没暴露；独立示例里要么手动 off，要么把监听挂进插件 apply（随 fiber 回收）。
2. **`agents.create()` 需要 agent-loop 注册 factory**（实测踩过）：只挂 `agent` 行会抛 `no agent factory registered (load an agent-loop plugin)`。agent-loop 是 required 行，inject 六个服务，最小树必须补齐 llm 行。
3. **`tools.restrict()` 在全局 ctx 上直接抛错**——必须在 `setup(agentCtx)` 这类 scoped context 里调用。
4. **批接口的 `arguments` 是 JSON 字符串**，不是对象。传对象会在 schema 校验阶段失败；`ToolCallId` 是品牌类型，用 `ToolCallId(...)` 构造。
5. **`defineTool` 的 schema 要求**：object 类型必须显式写 `additionalProperties`，必填字段写在各 property 的 `required: true` 上。
6. **`cannot get property "tools" without inject`**：插件没写 `inject: ['tools']`。cordis 的反射代理强制访问控制，这不是可选优化。
7. **本示例不挂 ptc/subprocess**，Bun 无需补丁；`start:bun` 直接 `bun src/index.ts`。

## 7. 从零复现

目录结构：

```text
dsh-tool-pipeline-demo/
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules/ + .dsh-home/
├── cordis.yml              # []
├── cordis.patch.yml        # 十行最小树（见 §2）
└── src/
    ├── index.ts            # 五场景主程序
    ├── tools.ts            # 单次调用封装
    └── plugins/
        └── word-count.ts   # 最小工具插件
```

`package.json` 的 dependencies（devDependencies 同 dsh-boot-demo：typescript 5.9.3 + @types/node 22.10.2；tsconfig.json 亦同）：

```json
{
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
}
```

`cordis.patch.yml` 全文：

```yaml
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
```

`word-count.ts` 见 §3.1，`tools.ts` 与 `index.ts` 直接复制本目录同名文件。验证步骤：

```bash
npm install          # 49 packages（含自动安装的 peer）
npm start            # 末行 TOOL_PIPELINE_OK
npm run start:bun    # 与 Node 逐行一致（首行 runtime 标识除外）
npm run typecheck    # 退出码 0
```

## 8. 小结

这个示例验证了八件事：

- 四个控制面分离：注册 / 可见性 / 执行前 / 执行后，权限不写死在工具实现里；
- 规范值与渲染内容分界：execute 返回规范值，render 产出模型可见内容；
- 注册是 effect：fiber.dispose() 即反注册，热重载不需要额外代码；
- pre/post-execute 都是 waterfall：返回决定即认领，next() 交给下一个；
- restrict 单向收紧、必须 scoped、不外溢全局；
- guard 单调：只能拒绝不能放行，监听顺序不承担安全责任；
- 两个实测坑：根 ctx 监听器泄漏、agents.create 需要 agent-loop factory；
- Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-boot-demo](../dsh-boot-demo/README.md)；下一篇：[dsh-context-demo](../dsh-context-demo/README.md)——system prompt 的 section 装配与 token 经济学。
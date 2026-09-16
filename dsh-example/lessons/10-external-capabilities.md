# 第 10 课 · 外部能力接入：数据优先，协议其次

> **本课任务**：给 Agent 接一个外部能力，并先回答"它该是一份数据，还是一个插件？"——把一份
> `SKILL.md` 注册进真实 `ctx.skills`、渲染后注入下一步上下文，再用同一段 diff 做注入前后的
> 真实作答对照；然后跑通跨进程 MCP、检查 Webhook 的组合边界、装配动态 Cordis 扩展、读默认模型路由。
> **运行命令**：`cd dsh-example && npm run M10`
> **你将看到**：A 组（不注入 skill）`第一行是结论 = false | 清单条目数 = 0`，B 组（注入后）
> `第一行是结论 = true | 清单条目数 = 4`、`严重性顺序 = ["正确性","正确性","安全","风格"]`；
> MCP 场景 `5 词 / 34 字符（来自 MCP server 进程）`，换掉可执行文件后以
> `mcp-client(offline_missing): initial connection or tool synchronization failed` fail loud。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

M10 要建立一个判断：**外部能力首先是数据，只有需要执行逻辑时才升级成插件。**

| 能力种类 | 它是什么 | 本课对应实现 |
|---|---|---|
| **Skill（数据）** | 一份 YAML frontmatter + Markdown 正文的知识资产 | [`impl/01-skill-code-review.ts`](../M10-external-capabilities/impl/01-skill-code-review.ts)、[`assets/SKILL.md`](../M10-external-capabilities/assets/SKILL.md) |
| **MCP 协议** | 另一个进程里的工具，经 `tools/list` 同步进 `ctx.tools` | [`impl/02-mcp-client.ts`](../M10-external-capabilities/impl/02-mcp-client.ts)、[`assets/mcp-word-count-server.mjs`](../M10-external-capabilities/assets/mcp-word-count-server.mjs) |
| **Webhook（Host 平面）** | 由宿主进程托管规则与依赖，不是本模块能自造的服务 | [`impl/03-webhook-runtime.ts`](../M10-external-capabilities/impl/03-webhook-runtime.ts) |
| **动态 Cordis 扩展** | 运行时执行面 + 把插件树操作暴露成模型工具 | [`impl/04-cordis-extensions.ts`](../M10-external-capabilities/impl/04-cordis-extensions.ts) |
| **默认模型** | Webhook 创建 Agent 所需的 provider/model 路由 | [`impl/05-agent-default-model.ts`](../M10-external-capabilities/impl/05-agent-default-model.ts) |

判据只有一条：**这份外部能力有没有副作用、要不要生命周期与故障边界？**
没有 → 写成 Skill（零行 TypeScript，改完立即生效）；有 → 才写插件（需要装配、需要 fail loud）。

```bash
cd dsh-example && npm run M10
```

---

## 2. 真实输出

```text
████ M10 · 外部能力接入：知识、协议、Webhook 与动态扩展 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M10.1 · 注册、发现并注入代码审查 Skill ────
① 模型在目录里发现的 skill:
   name    = code-review-checklist | source = project-dsh | provider = runtime
   何时该用 = Use when the user asks for a code review of a diff, PR, or recent change, to give a consistent, prioritized review instead of ad-hoc nitpicking.

② 调用 skill：渲染正文并 inject 到下一步的模型可见上下文
   inbox.nextStep 待认领 = 1

③ 跑一个真实 turn：主循环在 step 边界认领，清单随请求进入模型可见上下文
   已被认领（nextStep 清空）  = true
   模型可见投影里有 skill 消息 = true (source=skill-invocation)
   其正文带清单的输出格式要求 = true
   本轮 step 数 = 1 | 模型回复 = "结论：阻断\n[正确性] src/cart.ts:3 — 循环从 i=1 开始且条件为 i<=items.length，会"
REAL_STAGE_OK M10.1 calls=1 ms=21045 in=0 out=2048 finish=max-tokens "结论：阻断 [正确性] src/cart.ts:3 — 循环从 i=1 开始且条…"

──── M10.2 · 跨进程 MCP：真实成功往返与明确拒绝 ────
① 实际成功：拉起真实 MCP stdio server，并同步它的工具
   模型可见的 MCP 工具: [ 'mcp__local_word_count__mcp_word_count' ]
   tools/call 真实往返: 5 词 / 34 字符（来自 MCP server 进程）
   dispose 之后工具被回收: true

② 明确拒绝：换成不存在的可执行文件 → 启动失败并 fail loud
   mcp: {
  transport: 'stdio',
  networkUsed: false,
  failLoud: true,
  reason: 'mcp-client(offline_missing): initial connection or tool synchronization failed'
}
REAL_STAGE_OK M10.2 calls=1 ms=645 in=0 out=78 finish=stop

──── M10.3 · 检查 Webhook Host-plane 组合边界 ────
webhookRuntime boundary: {
  required: [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry'
  ],
  missing: [
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry'
  ],
  loaded: false,
  reason: 'Host-plane dependencies stay explicit in an offline teaching profile'
}
REAL_STAGE_OK M10.3 calls=1 ms=468 in=0 out=67 finish=stop

──── M10.4 · 装配动态 Cordis 扩展工具 ────
extensions: {
  dynamicRunner: 'DynamicCordisRunnerService',
  inspectRegistry: 'CordisInspectRegistryService',
  tools: [
    'cordis_inspect_list',
    'cordis_inspect_query',
    'cordis_inspect_self',
    'cordis_define',
    'cordis_run',
    'cordis_stop',
    'cordis_undefine'
  ]
}
REAL_STAGE_OK M10.4 calls=1 ms=885 in=0 out=118 finish=stop

──── M10.5 · 配置 Webhook 所需默认模型路由 ────
agentDefaultModel: { provider: 'anthropic-compat', model: 'fuyao-coding' }
REAL_STAGE_OK M10.5 calls=1 ms=608 in=0 out=87 finish=stop

──── M10.d · 专项真实演示：注入 SKILL.md 前后的真实作答对照 ────
目标模型: anthropic-compat / fuyao-coding （真实 HTTP + SSE）

① A 组：不注入 skill
   ## 结论
   
   不建议合并。这个 diff 把两处原本能正常工作的代码都改坏了：`total` 有明确的越界/漏项 bug，`applyCoupon` 引入了任意代码执行漏洞。两者都没有带来任何收益。
   
   ## 1. `total`：循环边界写错
   
   - **从 `i = 1` 开始**：漏掉 `items[0]`，结果少算第一件商品。
   - **条件用 `i <= items.length`**：最后一次访问 `items[items.length]`，这是越界索引，值为 `undefined`，再读 `.price` 会抛 `TypeError`。
   
   （……中略：A 组继续用 Markdown 长文展开 `applyCoupon` 的 eval 注入、`?? 0` 兜不住异常、
   原型链污染，以及「## 3. 其他」「## 建议」两节，共约 50 行。此处只保留开头与两条代表性发现……）
   
   → 第一行是结论 = false | 清单条目数 = 0

② B 组：注入 SKILL.md 正文（同一段 diff、同一句请求）
   结论：阻断
   [正确性] src/cart.ts:3 — 循环 `i = 1` 起跳过了 `items[0]`，且 `i <= items.length` 会访问越界的 `items[items.length]`，`undefined.price` 直接抛 TypeError，两处叠加导致 total 必然报错 — 改为 `for (let i = 0; i < items.length; i++)`，或直接保留原 `reduce`
   [正确性] src/cart.ts:8 — 从 `COUPONS[code]` 改为 `COUPONS.code` 改变了取值语义，含 `-`、空格等非标识符字符的券码不再命中 — 维持方括号查表，若担心键名应改用 `Map` 或显式白名单
   [安全] src/cart.ts:8 — `eval('COUPONS.' + code)` 把外部传入的 `code` 拼进 eval，可执行任意 JS（如 `code = "x; doSomethingBad()"`），同时 `__proto__`/`constructor` 可穿透原型链 — 恢复 `COUPONS[code] ?? 0`，或改用 `Object.hasOwn(COUPONS, code) ? COUPONS[code] : 0`
   [风格] src/cart.ts:3 — 用命令式循环替换 `reduce` 没有带来可读性或性能收益，反而引入了边界错误 — 保持原实现
   → 第一行是结论 = true | 清单条目数 = 4
   → 严重性顺序 = ["正确性","正确性","安全","风格"]
REAL_STAGE_OK M10.d calls=2 ms=18210 in=0 out=2975 finish=stop "结论：阻断 [正确性] src/cart.ts:3 — 循环 `i = 1` 起…"

REAL_MODULE_OK M10 stages=6 calls=7 failed=0
```

**对照自己的输出**：最后一行必须出现 `REAL_MODULE_OK M10 stages=6 calls=7 failed=0`。
本课的核心证据在 M10.d 那两行：`第一行是结论 = false | 清单条目数 = 0` 与
`第一行是结论 = true | 清单条目数 = 4`——**同一段 diff、同一句请求，只差一次注入**。

---

## 3. 判断规则：数据优先，需要执行逻辑才升级为插件

文档把这条规则写成"两条扩展路径的区别"，见
[04 § 4.1](../../docs/hello-dsh/04-extensions-and-ecosystem.md)：

- **Skill 是内容，插件是机制**：Skill 改完立即生效、零行 TypeScript；插件需要装配、重启与生命周期管理。
- **选哪个**：要新增一种**能力接缝**（新的 provider / consumer）就写插件；只是给模型加一份
  **可发现的操作说明**就用 Skill。

M10 的五个实现文件正好把这条线画出来了：

| 文件 | 行数 | 性质 |
|---|---|---|
| [`impl/01-skill-code-review.ts`](../M10-external-capabilities/impl/01-skill-code-review.ts) | 88 | **数据 + 消费侧代码**，能力本体是 `assets/SKILL.md` |
| [`impl/02-mcp-client.ts`](../M10-external-capabilities/impl/02-mcp-client.ts) | 3 | 转发真实插件 `dsh-mcp-client` |
| [`impl/03-webhook-runtime.ts`](../M10-external-capabilities/impl/03-webhook-runtime.ts) | 2 | 转发真实插件 `dsh-webhook` |
| [`impl/04-cordis-extensions.ts`](../M10-external-capabilities/impl/04-cordis-extensions.ts) | 11 | **显式装配两个插件** |
| [`impl/05-agent-default-model.ts`](../M10-external-capabilities/impl/05-agent-default-model.ts) | 2 | 转发真实插件 `dsh-agent-default-model` |

后四个 `impl` 是"路由到真实包"的一行文件——它们的存在本身说明：**协议与宿主能力必须是插件，
因为它们要开进程、要处理启动失败、要管依赖顺序**；而代码审查清单只提供流程知识，所以它是数据。

---

## 4. Skill：一条数据资产的完整链路

### 4.1 资产长什么样

打开 [`assets/SKILL.md`](../M10-external-capabilities/assets/SKILL.md)，整份文件只有 15 行：

```markdown
---
name: code-review-checklist
description: Use when the user asks for a code review of a diff, PR, or recent change, to give a consistent, prioritized review instead of ad-hoc nitpicking.
---

# Code Review Checklist

做一次**一致、有优先级**的评审，而不是随手挑刺。

## 输出格式（严格遵守）

1. 第一行只写结论：`结论：可合` / `结论：需改` / `结论：阻断`
2. 之后每条问题占一行：`[严重性] 文件:行 — 问题 — 建议`
3. 严重性只有三档，并按此顺序排列：`正确性` → `安全` → `风格`
4. 不复述 diff，不写开场白和结语。
```

结构就两段：**YAML frontmatter（`name` / `description`）+ Markdown 正文**。
`description` 不是给人看的注释——它就是模型判断"何时该用这个 skill"的唯一依据，
所以它写成了英文的一句话触发条件（见输出里的 `何时该用 = ...`）。
正文里的第 1–3 条正是 M10.d 用来自动判分的硬格式。

### 4.2 五步链路：discover → register → render → inject → claim

链路全部在 [`impl/01-skill-code-review.ts`](../M10-external-capabilities/impl/01-skill-code-review.ts)：

```ts
/** SKILL.md = YAML frontmatter（name / description）+ Markdown 正文。 */
function parseSkillFile(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) throw new Error('SKILL.md 缺少 frontmatter')
  const front: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) front[kv[1]] = kv[2].trim()
  }
  return { name: front.name, description: front.description, content: match[2].trim() }
}

export async function registerSkill(harness: Harness): Promise<SkillDefinition> {
  const path = fileURLToPath(new URL('../assets/SKILL.md', import.meta.url))
  const parsed = parseSkillFile(readFileSync(path, 'utf8'))
  harness.ctx.skills.register({
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    path,
    source: 'project-dsh',
    // 调用策略必须显式给全两个布尔：模型能否自主调用、人能否用 /skill 调用。
    invocation: { modelInvocable: true, userInvocable: true },
  })
  const skill = await harness.ctx.skills.get(parsed.name)
  if (!skill) throw new Error('skill 应当能被取到')
  return skill
}
```

三个必须记住的点：

1. **`invocation` 的两个布尔都要显式给全**：`modelInvocable`（模型能否自主调用）与
   `userInvocable`（人能否用 `/skill` 调用）。漏一个就是一条安静的半开能力。
2. **`register()` 是 effect-based** 的：它挂在插件的 fiber 上，回收与 [第 01 课 · 工具管线](01-tool-pipeline.md)
   的 `ctx.tools.register()` 完全同源。
3. **注册完要回读**：`ctx.skills.get(name)` 拿回的才是注册表里的完整定义。真实产品里这份数据由
   `dsh-skill-filesystem` 这类 provider 从磁盘目录自动发现（`registerProvider`）；示例为了不依赖
   用户的 home 目录布局，直接用 `register()` 喂同一份数据——**消费侧（list / get / render / inject）
   一模一样**。

### 4.3 render → inject → 在 step 边界被认领

```ts
/**
 * "模型调用该 skill"这一步：把 `renderSkillContent` 渲染出的正文经 `agent.inject()`
 * 排进下一步的模型可见上下文（`inbox.nextStep`），由主循环在 step 边界认领。
 */
export function invokeSkill(harness: Harness, skill: SkillDefinition): void {
  harness.agent.inject(userText(
    renderSkillContent(skill),
    { kind: 'skill-invocation', name: skill.name, form: 'instructions' },
  ))
}
```

`agent.inject()` 复用 [第 04 课 · Agent 主循环介入](04-agent-loop-intervention.md) 的 inbox 机制：
**不唤醒、只排队**，消息进 `inbox.nextStep`，由主循环在下一个 step 边界认领。
`scenes/01` 把这五步逐一断言出来：

```ts
console.log('① 模型在目录里发现的 skill:')
for (const summary of await harness.ctx.skills.list()) {
  console.log('   name    =', summary.name, '| source =', summary.source, '| provider =', summary.provider)
  console.log('   何时该用 =', summary.description)
}

console.log('\n② 调用 skill：渲染正文并 inject 到下一步的模型可见上下文')
invokeSkill(harness, skill)
console.log('   inbox.nextStep 待认领 =', harness.agent.inbox.nextStep.length)
```

第 2 节 M10.1 的输出正好是这条链路的证据：

```text
① name    = code-review-checklist | source = project-dsh | provider = runtime
② inbox.nextStep 待认领 = 1
③ 已被认领（nextStep 清空）  = true
   模型可见投影里有 skill 消息 = true (source=skill-invocation)
   其正文带清单的输出格式要求 = true
```

注意 `source = project-dsh` 与 `provider = runtime` 的对照：**source 是这份数据的来源，provider 是
把它发现出来的服务**。示例没有 filesystem provider，所以 provider 显示为运行时。

> **原理对照**：`ctx.skills` 这个 seam 见 [03 § 3.8](../../docs/hello-dsh/03-capability-seams-and-services.md)，
> `skill` 组的四个包见 [04 § 4.2](../../docs/hello-dsh/04-extensions-and-ecosystem.md)。

### 4.4 Skill 只提供流程知识，不执行副作用

整份 `SKILL.md` 里没有任何可执行的东西——它只是文本，被渲染进上下文。**没有副作用、没有生命周期、
不会失败**，所以它不需要是插件。这正是第 3 节那条判据的落地。

M10 把两个很不一样的规模放在一起看：

| 维度 | Skill（本课主线） | MCP / Webhook / Cordis 扩展 |
|---|---|---|
| 形态 | 一份 Markdown | 插件 + 进程/宿主依赖 |
| 失败模式 | 最坏是"模型没照做" | 启动失败、依赖缺失、超时 |
| 需要处理 | 无 | 生命周期、故障边界、fail loud |

---

## 5. M10.d：A/B 对照——数据扩展真的改变了模型行为

M10.1 只证明了"清单送到了"（模型可见投影里有 skill 消息）。**"模型照清单答"必须另证**——
[`run.ts`](../M10-external-capabilities/run.ts) 的 `runSkillCodeReviewMinimax()` 用前后对照来做：

```ts
/** 跑一个真实 turn；withSkill=true 时先把 SKILL.md 正文注入下一步上下文。 */
async function review(sessionId: string, withSkill: boolean): Promise<string> {
  const harness = await createHarness({
    provider: 'anthropic-compat',
    model,
    sessionId: sessionId as SessionId,
  })
  if (withSkill) invokeSkill(harness, await registerSkill(harness))
  const outcome = await harness.runTurn({ prompt: PROMPT })
  await harness.dispose()
  return outcome.text
}

console.log('\n① A 组：不注入 skill')
const plain = await review('demo-review-plain', false)
...
console.log('\n② B 组：注入 SKILL.md 正文（同一段 diff、同一句请求）')
const guided = await review('demo-review-skill', true)
```

两组跑的是**同一段 diff、同一句 `PROMPT`**，唯一差异是 `withSkill`。判分不是靠肉眼，
而是 [`impl/01`](../M10-external-capabilities/impl/01-skill-code-review.ts) 末尾的 `checkFormat()`：

```ts
/** 清单要求的硬格式：第一行是结论，问题行形如 `[严重性] 文件:行 — 问题 — 建议`。 */
export function checkFormat(answer: string): { verdictFirst: boolean; findings: number; severities: string[] } {
  const lines = answer.split('\n').map((line) => line.trim()).filter(Boolean)
  const matches = lines.map((line) => /^\[(正确性|安全|风格)\]/.exec(line)).filter((m) => m !== null)
  return {
    verdictFirst: /^结论：(可合|需改|阻断)/.test(lines[0] ?? ''),
    findings: matches.length,
    severities: matches.map((m) => m![1]),
  }
}
```

它检查的正是 `SKILL.md` 的三条输出格式规则：① 第一行是不是结论；② `[严重性] 文件:行 — …` 形式的
条目有几条；③ 严重性顺序对不对。

### A 组：不注入（真实输出的开头与代表性发现）

```text
   ## 结论
   不建议合并。这个 diff 把两处原本能正常工作的代码都改坏了：`total` 有明确的越界/漏项 bug，
   `applyCoupon` 引入了任意代码执行漏洞。两者都没有带来任何收益。
   ## 1. `total`：循环边界写错
   - **从 `i = 1` 开始**：漏掉 `items[0]`，结果少算第一件商品。
   - **条件用 `i <= items.length`**：最后一次访问 `items[items.length]`，这是越界索引，值为 `undefined`，再读 `.price` 会抛 `TypeError`。
   → 第一行是结论 = false | 清单条目数 = 0
```

A 组答得**内容其实很好**——两处 bug 都找到了，`eval` 注入也说清了。但它用的是模型自己的
Markdown 长文习惯：第一行是 `## 结论` 标题，问题散落在正文里，没有一条 `[严重性] …` 形状的条目。
**知识是对的，形状是错的**——所以 `第一行是结论 = false | 清单条目数 = 0`。

### B 组：注入 SKILL.md 正文（完整清单）

```text
   结论：阻断
   [正确性] src/cart.ts:3 — 循环 `i = 1` 起跳过了 `items[0]`，且 `i <= items.length` 会访问越界的 `items[items.length]`，`undefined.price` 直接抛 TypeError，两处叠加导致 total 必然报错 — 改为 `for (let i = 0; i < items.length; i++)`，或直接保留原 `reduce`
   [正确性] src/cart.ts:8 — 从 `COUPONS[code]` 改为 `COUPONS.code` 改变了取值语义，含 `-`、空格等非标识符字符的券码不再命中 — 维持方括号查表，若担心键名应改用 `Map` 或显式白名单
   [安全] src/cart.ts:8 — `eval('COUPONS.' + code)` 把外部传入的 `code` 拼进 eval，可执行任意 JS（如 `code = "x; doSomethingBad()"`），同时 `__proto__`/`constructor` 可穿透原型链 — 恢复 `COUPONS[code] ?? 0`，或改用 `Object.hasOwn(COUPONS, code) ? COUPONS[code] : 0`
   [风格] src/cart.ts:3 — 用命令式循环替换 `reduce` 没有带来可读性或性能收益，反而引入了边界错误 — 保持原实现
   → 第一行是结论 = true | 清单条目数 = 4
   → 严重性顺序 = ["正确性","正确性","安全","风格"]
```

B 组**逐字满足清单**：第一行 `结论：阻断`；四条问题各占一行、都是 `[严重性] 文件:行 — 问题 — 建议`；
严重性顺序恰好是 `正确性 → 正确性 → 安全 → 风格`。`checkFormat()` 三项全过。

**这就是数据扩展的证据**：没有改一行执行代码、没有加一个工具，只是把一段 Markdown 排进
`inbox.nextStep`，模型的可观察行为就从"散文式长文"变成了"可机器判分的结构化清单"。
[`run.ts`](../M10-external-capabilities/run.ts) 把这条结论写成 fail loud 的断言：

```ts
if (!guidedChecks.verdictFirst || guidedChecks.findings === 0) {
  throw new Error('注入 skill 后模型没有按清单格式作答 —— 数据扩展的效果未被验证')
}
```

**推论**：如果一份流程知识可以用"渲染进上下文的文本"表达，就永远不必为它写插件——
A/B 这一对数字就是这条判断规则的量化依据。

---

## 6. MCP：把另一个进程的工具搬进 `ctx.tools`

M10.2 刻意把**两种结果都跑出来**：成功往返，和启动失败的明确拒绝。

### 6.1 一个真实的 stdio server

[`assets/mcp-word-count-server.mjs`](../M10-external-capabilities/assets/mcp-word-count-server.mjs)
用官方 `@modelcontextprotocol/sdk` 实现，不是玩具桩：

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'local-word-count', version: '1.0.0' })

server.registerTool(
  'mcp_word_count',
  {
    title: '统计词数与字符数（跨进程）',
    description: '统计一段文本的单词数与字符数。实现在另一个进程里，通过 MCP 协议调用。',
    inputSchema: { text: z.string().describe('要统计的文本') },
  },
  async ({ text }) => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    return { content: [{ type: 'text', text: `${words} 词 / ${text.length} 字符（来自 MCP server 进程）` }] }
  },
)

await server.connect(new StdioServerTransport())
```

### 6.2 成功路径：拉起来 → 同步工具 → 真调一次

[`scenes/02-mcp-round-trip.ts`](../M10-external-capabilities/scenes/02-mcp-round-trip.ts) 用
`harness.ctx.plugin(mcpClient, {...})` 起这个子进程，`await` 它就是把"连接 + `tools/list` 同步"
等完：

```ts
const connected = harness.ctx.plugin(mcpClient, {
  transport: 'stdio',
  serverName: 'local_word_count',
  command: process.execPath,
  args: [SERVER],
  env: {},
  cwd: process.cwd(),
  toolCallTimeoutMs: 15_000,
  failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
})
await connected
const visible = harness.visibleTools()
const toolName = visible.find((name) => name.includes('word_count'))
console.log('   模型可见的 MCP 工具:', visible.filter((name) => name.includes('word_count')))
if (!toolName) throw new Error('MCP server 已连接，但它的工具没有同步进 ctx.tools')

const result = await harness.callTool(toolName, { text: 'MCP tools cross process boundaries' })
```

对应的真实输出：

```text
   模型可见的 MCP 工具: [ 'mcp__local_word_count__mcp_word_count' ]
   tools/call 真实往返: 5 词 / 34 字符（来自 MCP server 进程）
   dispose 之后工具被回收: true
```

三个值得停一下的细节：

- **工具名被命名空间化**：`mcp__<serverName>__<toolName>`。同一个 MCP server 的工具不会和本地
  工具撞名，模型看到的也无非是普通工具——文档说得很直接："**MCP 的落点是 `ctx.tools`**，
  外部工具被注册成普通工具，模型看不出它来自远端，权限与审批仍走本地的 tools waterfall"
  （[04 § 4.11](../../docs/hello-dsh/04-extensions-and-ecosystem.md)）。
- **结果真的在另一个进程算的**：`5 词 / 34 字符（来自 MCP server 进程）` 这句话是那个 `.mjs`
  进程自己拼出来的，跨进程回到了主进程。
- **`dispose` 回收工具**：`true`。和第 01 课一样，是 effect-based 的生命周期。

### 6.3 失败路径：宁可 fail loud，不留空工具集

`scenes/02` 立刻换成一个不存在的可执行文件：

```ts
const missing = harness.ctx.plugin(mcpClient, {
  transport: 'stdio',
  serverName: 'offline_missing',
  command: '/definitely/not/a/real/mcp-server',
  args: [],
  env: {},
  cwd: process.cwd(),
  toolCallTimeoutMs: 1_000,
  failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
})
let rejected = ''
try {
  await missing
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error)
}
console.log('   mcp:', { transport: 'stdio', networkUsed: false, failLoud: rejected.length > 0, reason: rejected })
if (!rejected) throw new Error('启动失败没有 fail loud —— 静默留下空工具集是最危险的结果')
```

真实输出：

```text
   mcp: {
  transport: 'stdio',
  networkUsed: false,
  failLoud: true,
  reason: 'mcp-client(offline_missing): initial connection or tool synchronization failed'
}
```

注意 `reason` 的两个组成部分：**`offline_missing` 是 `serverName`**，后面跟统一的失败描述。
出问题时你第一眼就知道是哪个 server 挂了，而不是面对一个空工具集猜。

### 6.4 为什么这条链路全程本机、不需要密钥

`transport: 'stdio'` + `command: process.execPath` + `args: [SERVER]`：起的是本机 Node 子进程，
走的是一根管道。所以输出里 `networkUsed: false`——**不联网、不需要密钥**。
`impl/02-mcp-client.ts` 只有三行，因为协议细节（握手、工具列表同步、schema 转换、错误映射）
都在真实的 `@deepseek-ai/dsh-mcp-client` 里（详见
[04 § 4.12](../../docs/hello-dsh/04-extensions-and-ecosystem.md)）：

```ts
/** 每个 MCP 实例连接一个 server；本教学阶段只走本地进程启动失败的离线边界。 */
export { name, inject, Config, apply } from '@deepseek-ai/dsh-mcp-client'
export type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
```

---

## 7. Webhook、动态 Cordis 扩展与默认模型：宿主面的三件事

这三者是**宿主（Host）平面**的能力：它们的依赖由宿主进程提供，不是本模块自己能造出来的。

### 7.1 Webhook：先老实报告组合边界，不伪造服务

[`scenes/03-check-webhook-boundary.ts`](../M10-external-capabilities/scenes/03-check-webhook-boundary.ts)
一共八行——它**不启动任何服务**，只检查声明的依赖里少了哪些：

```ts
import { createHarness } from '../../runtime/harness.ts'
import WebhookRuntime from '../impl/03-webhook-runtime.ts'

const harness = await createHarness()
const required = [...WebhookRuntime.inject]
const missing = required.filter(key => harness.ctx.get(key) === undefined)
console.log('webhookRuntime boundary:', { required, missing, loaded: false, reason: 'Host-plane dependencies stay explicit in an offline teaching profile' })
await harness.dispose()
```

真实输出：

```text
webhookRuntime boundary: {
  required: [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry'
  ],
  missing: [
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry'
  ],
  loaded: false,
  reason: 'Host-plane dependencies stay explicit in an offline teaching profile'
}
```

`required` 六项、`missing` 五项，`agents` 已经就绪。`loaded: false` 不是失败，而是**如实的边界声明**：
`impl/03-webhook-runtime.ts` 的注释写着"依赖不完整时应保持组合边界，而非伪造服务"。
这正好呼应第 3 节的判据——**宿主能力不能降级成一份数据来假装存在**。

### 7.2 动态 Cordis 扩展：执行面 + 暴露成模型的工具

[`impl/04-cordis-extensions.ts`](../M10-external-capabilities/impl/04-cordis-extensions.ts) 把两个插件
显式装进同一棵树：

```ts
/** 动态 runner 提供 extensions 执行面，tool-cordis 把 inspect/define 生命周期暴露成工具。 */
export const name = 'offline-cordis-extensions'
export const inject = ['tools', 'systemPrompt']
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(DynamicCordisRunnerService, { vmTimeoutMs: 1_000 })
  await ctx.plugin(toolCordis)
}
```

真实输出把两个服务的构造器名字和七个工具都打了出来：

```text
extensions: {
  dynamicRunner: 'DynamicCordisRunnerService',
  inspectRegistry: 'CordisInspectRegistryService',
  tools: [
    'cordis_inspect_list',
    'cordis_inspect_query',
    'cordis_inspect_self',
    'cordis_define',
    'cordis_run',
    'cordis_stop',
    'cordis_undefine'
  ]
}
```

分工很干净：**`DynamicCordisRunnerService` 提供"能跑"的执行面，`tool-cordis` 提供"能看能改"的操作面**。
七个工具恰好覆盖 `inspect`（list / query / self）与 `define`（define / run / stop / undefine）两个阶段。
这就是文档说的自举能力——"模型可以增删自己的能力配置行，也能查询服务是否就绪、依赖是否满足"
（[04 § 4.4](../../docs/hello-dsh/04-extensions-and-ecosystem.md)）。

### 7.3 默认模型：只存路由，不存密钥

Webhook 收到事件后要创建 Agent，就必须知道用哪个 provider/model。M10.5 读的就是这条 Host 路由：

```ts
const harness = await createHarness()
await harness.loadPlugin(AgentDefaultModelConfig, { provider: REAL_PROVIDER, model: realConfig().model })
console.log('agentDefaultModel:', harness.ctx.agentDefaultModel.currentSelection())
```

```text
agentDefaultModel: { provider: 'anthropic-compat', model: 'fuyao-coding' }
```

`impl/05-agent-default-model.ts` 的注释是本节的要点：**"设置服务只保存 provider/model 路由，不持有密钥"**。
密钥属于凭证服务，路由属于默认模型配置——两者分开，默认模型这份配置才能安全地随会话/工作区传递。
产品默认值是 `deepseek-official` / `deepseek-v4-flash`（见
[05 § 5.11](../../docs/hello-dsh/05-startup-and-cordis-runtime.md)），本课因为要真跑，把它覆写成了
`anthropic-compat` / `fuyao-coding`。

---

## 8. 排障：MCP server 连上了，模型却看不到它的工具

### 症状

`tools/list` 之后模型可见工具列表里没有 `mcp__*`，或者干脆空着；模型仍然一本正经地"回答"，
因为它根本不知道有这个工具。最糟的情况是：**程序不报错，只是安静地少了一个工具**。

### 定位

1. 看工具名有没有被命名空间化：正确的形状是 `mcp__<serverName>__<toolName>`
   （本课是 `mcp__local_word_count__mcp_word_count`）。名字对不上，说明你找错了 serverName。
2. 看 `reason` 里有没有 server 名字。像 `mcp-client(offline_missing): ...` 这样带 `serverName`
   的报错才是。

### 原因与修改

最危险的原因不是"报错了"，而是"**错误被吞了**"。把 `failOnStartupError` 打开，
启动失败就会带着 server 名字与原因抛出来，而不是留一个空工具集给模型（
[`scenes/02`](../M10-external-capabilities/scenes/02-mcp-round-trip.ts) 里那句断言就是为它写的）：

```ts
failOnStartupError: true,
```

```ts
if (!rejected) throw new Error('启动失败没有 fail loud —— 静默留下空工具集是最危险的结果')
```

修完之后再跑一次，失败路径应该长这样——`failLoud: true` 且 `reason` 指明是哪个 server：

```text
   mcp: {
  transport: 'stdio',
  networkUsed: false,
  failLoud: true,
  reason: 'mcp-client(offline_missing): initial connection or tool synchronization failed'
}
```

**通用教训**：外部能力的加载是异步的、跨进程的、可能不成功的。凡是不 fail loud 的接缝，
都会退化成"安静地少一样东西"。

---

## 9. 代码在哪

```bash
cd dsh-example && ls M10-external-capabilities/impl M10-external-capabilities/scenes M10-external-capabilities/assets
```

| 文件 | 看哪几处 |
|---|---|
| [`assets/SKILL.md`](../M10-external-capabilities/assets/SKILL.md) | frontmatter 的 `name`/`description`；正文的 4 条输出格式 |
| [`impl/01-skill-code-review.ts`](../M10-external-capabilities/impl/01-skill-code-review.ts) | `parseSkillFile`、`register()` 的 `invocation` 两个布尔、`invokeSkill` 的 `renderSkillContent` + `inject`、`checkFormat` 三项判分 |
| [`scenes/01-inject-skill-into-turn.ts`](../M10-external-capabilities/scenes/01-inject-skill-into-turn.ts) | `skills.list()` 的目录发现；末尾那条"没进上下文就抛错"的 fail loud |
| [`impl/02-mcp-client.ts`](../M10-external-capabilities/impl/02-mcp-client.ts) | 三行转发；真实实现看 `@deepseek-ai/dsh-mcp-client` |
| [`scenes/02-mcp-round-trip.ts`](../M10-external-capabilities/scenes/02-mcp-round-trip.ts) | `ctx.plugin(mcpClient, {...})` 的 `serverName`/`command`/`failOnStartupError`；成功后 `dispose` |
| [`assets/mcp-word-count-server.mjs`](../M10-external-capabilities/assets/mcp-word-count-server.mjs) | 官方 SDK 的 `McpServer` + `StdioServerTransport` + `zod` inputSchema |
| [`impl/03-webhook-runtime.ts`](../M10-external-capabilities/impl/03-webhook-runtime.ts) + [`scenes/03`](../M10-external-capabilities/scenes/03-check-webhook-boundary.ts) | `WebhookRuntime.inject` 的六项依赖；只报边界不造服务 |
| [`impl/04-cordis-extensions.ts`](../M10-external-capabilities/impl/04-cordis-extensions.ts) + [`scenes/04`](../M10-external-capabilities/scenes/04-mount-dynamic-tool.ts) | 两个 `ctx.plugin`；`dynamicCordisRunner` / `cordisInspect` 的构造器名 |
| [`impl/05-agent-default-model.ts`](../M10-external-capabilities/impl/05-agent-default-model.ts) + [`scenes/05`](../M10-external-capabilities/scenes/05-route-default-model.ts) | `currentSelection()` 只回 provider/model |
| [`run.ts`](../M10-external-capabilities/run.ts) | A/B 对照 `review(sessionId, withSkill)`；末尾的格式断言 |

读法：**先读 `assets/` 看数据长什么样，再读 `impl/` 看怎么消费，最后读 `scenes/` 看它怎么被验证**。

---

## 10. 动手练习

### 练习 A：让清单加入一个你自己会踩的坑

在 [`assets/SKILL.md`](../M10-external-capabilities/assets/SKILL.md) 的正文里追加一条格式要求，
例如"每条问题必须标出置信度"；同时把 [`impl/01`](../M10-external-capabilities/impl/01-skill-code-review.ts)
的 `checkFormat` 也加一条对应检查。

**验证命令**

```bash
cd dsh-example && npm run M10
```

**可验证答案**：M10.d 的 B 组输出里出现你新加的字段；A 组不变——因为 A 组根本没有注入这份数据。
这就是"数据扩展"最小可验证的改动闭环：**改 Markdown + 改判分，不改任何一个执行路径**。

### 练习 B：把 MCP 的失败路径换成"连得上但工具为空"

把 [`scenes/02`](../M10-external-capabilities/scenes/02-mcp-round-trip.ts) ② 段的
`command: '/definitely/not/a/real/mcp-server'` 换成一个能启动但立即退出的命令（例如 `command: process.execPath`、
`args: ['-e', 'process.exit(0)']`），再跑：

```bash
cd dsh-example && node M10-external-capabilities/scenes/02-mcp-round-trip.ts
```

**可验证答案**：`failOnStartupError: true` 时它仍然 fail loud（连接/同步失败），`reason` 里带着 `offline_missing`；
如果把 `failOnStartupError` 改成 `false`，程序不再抛错——**你就亲手造出了那个"静默空工具集"**，
这正是本节 fail loud 断言要防的东西。

### 练习 C（进阶）：用 A/B 判据验证"注入位置"对行为的影响

改 [`run.ts`](../M10-external-capabilities/run.ts)，让 B 组不再用 `invokeSkill` 注入正文，
而是把清单文本直接拼进 `PROMPT` 字符串末尾，再跑：

```bash
cd dsh-example && npm run M10
```

**可验证答案**：格式指标可能仍然达标（模型都读到了文本），但 M10.1 的三条断言会失去意义——
`source = skill-invocation` 那条模型可见投影不再存在。**结论**：A/B 对照证明的是"注入的文本改变了
行为"，而 `agent.inject()` + `source: 'skill-invocation'` 证明的是"它走的是一条可观测、可回放的
正规链路"。两者缺一不可。

---

**下一课** → [第 11 课 · 配置与数据设施](11-config-data-infrastructure.md)：schema、revision、storage domain 与各类 Provider 如何让数据可治理且不泄露秘密。

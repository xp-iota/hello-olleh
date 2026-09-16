# 第 01 课 · 工具管线：三个正交控制面

> **本课任务**：给 Agent 加一个 `word_count` 工具，让真实模型自己决定调用它；再分别用权限门、守卫、
> 结果变换、可见性收紧四条通路控制同一次调用。
> **运行命令**：`cd dsh-example && npm run M01`
> **你将看到**：模型自己发出 `word_count` 调用，结果回灌成「7 词 / 49 字符」，模型用一句中文收尾；
> 而 `rm -rf /` 即使被 `pre-execute` 放行，仍被守卫拒绝。

前置：[第 00 课 · 跑起来](00-getting-started.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

工具不是一个函数，是一条链。这一课把这条链拆成三个**互相独立**的控制面：

| 控制面 | 回答的问题 | 本课对应实现 |
|---|---|---|
| **可见性** | 模型能看见哪些工具？ | `impl/04-tool-restrict.ts` |
| **执行前裁决** | 这次调用允许吗？ | `impl/02-permission-gate.ts`、`impl/05-tool-guard.ts` |
| **结果呈现** | 调用结果长什么样？ | `impl/03-result-transform.ts` |

外加一个**注册**面：`impl/01-word-count.ts` 定义工具本身。三个控制面全部独立于工具实现——
这正是本课要建立的核心直觉：**策略不写在工具里**。

```bash
cd dsh-example && npm run M01
```

---

## 2. 真实输出

```text
████ M01 · 工具管线：从注册、可见性到执行前后策略 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M01.1 · 注册工具与 Fiber 回收 ────
① 已注册模型可见工具: [ 'word_count' ]
② canonical value: { words: 4, chars: 27 }
③ render 给模型看: 4 词 / 27 字符
④ dispose 之后工具集合: [] （应为空）
REAL_STAGE_OK M01.1 calls=1 ms=548 in=0 out=69 finish=stop

──── M01.2 · pre-execute 权限门 ────
read_file → isError: false | read_file 已执行: path=a.txt
bash      → isError: true | failure.message: 工具 "bash" 被示例权限门拒绝。
返回给模型的内容: Error: 工具 "bash" 被示例权限门拒绝。
REAL_STAGE_OK M01.2 calls=1 ms=534 in=0 out=56 finish=stop

──── M01.3 · post-execute 结果变换 ────
[audit] 工具 word_count 结束 → ok
规范值 value（未变）: { words: 5, chars: 23 }
模型可见 content（已被转换追加）:
  • "5 词 / 23 字符"
  • "\n[post-execute 策略] 已在结果后追加一条模型可见提示"
REAL_STAGE_OK M01.3 calls=1 ms=1287 in=0 out=73 finish=stop

──── M01.4 · 按 Agent 收紧可见工具 ────
① 全部已注册（全局视角）: [ 'echo', 'read', 'write', 'bash' ]
② 该 agent 可见（已被收紧）: [ 'echo', 'read' ]
③ 调用被收紧的 write → isError: true | Error: unknown tool "write"

④ fail-closed 三连（真实实现的抛错原文）:
   plain context: tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead
   空 filter    : tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)
   未知工具名   : tools.restrict() names unknown global tool "nope"; known global tools: bash, echo, read, write

⑤ restrict 返回的 disposer 精确撤销这一条收紧（同 scope 多条取交集）:
   再叠一条 deny echo → [ 'read' ]
   lift() 撤销这一条  → [ 'echo', 'read' ] （插件那条收紧仍在）

⑥ 插件 fiber.dispose() 之后：
   老 agent 仍被收紧 → [ 'echo', 'read' ]
   —— 因为这条 restrict 是在 `agent.ctx` 上调的，effect 归**那个 agent 的 fiber**，
      随 agent 一起回收；插件 fiber 只拥有它自己注册的那个 session-start 监听器。
   新建的 agent 不再被收紧 → [ 'echo', 'read', 'write', 'bash' ] （监听器已随插件撤销）
REAL_STAGE_OK M01.4 calls=1 ms=766 in=0 out=114 finish=stop

──── M01.5 · 单调守卫：只能拒绝，不能放行 ────
ls -la    → isError: false | bash 已执行: cmd=ls -la
rm -rf /  → isError: true | Error: 命令命中危险模式 "rm -rf"，被单调守卫拒绝
（pre-execute 明明 allow 了，但 guard 是单调最终拒绝，翻不了案）
REAL_STAGE_OK M01.5 calls=1 ms=1081 in=0 out=119 finish=stop

──── M01.d · 专项真实演示：模型自主决定调用 word_count ────
① 推理服务: anthropic-compat / fuyao-coding （真实 HTTP + SSE）
② 模型可见工具: [ 'word_count' ]
③ 用户 query: 请统计这句话的词数和字符数："DeepSeek Harness makes every tool call observable"。必须调用 word_count 工具来算，不要自己数，最后用一句中文报出结果。
④ 模型发起的工具调用:
   → word_count {"text": "DeepSeek Harness makes every tool call observable", "caseSensitive": true}
⑤ 工具结果回灌给模型:
   → isError=false · 7 词 / 49 字符
⑥ 模型最终回答: "根据 word_count 工具统计，这句话共有 7 个单词、49 个字符。"
⑦ 本轮 step 数: 2 （工具调用会多出一步：调用步 + 收尾步）
REAL_STAGE_OK M01.d calls=2 ms=2723 in=0 out=103 finish=stop tools=word_count "根据 word_count 工具统计，这句话共有 7 个单词、49 个字符。"

REAL_MODULE_OK M01 stages=6 calls=7 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M01 stages=6`，且 `M01.d` 那行带 `tools=word_count`。
`step 数 = 2` 是判断"模型真的调了工具"最快的信号——如果它是 1，模型是自己编的答案。

---

## 3. 注册：`defineTool` 的三件套

打开 [`M01-tool-pipeline/impl/01-word-count.ts`](../M01-tool-pipeline/impl/01-word-count.ts)。

```ts
export const name = 'tool-wordcount'   // Cordis 插件标识，不是工具名
export const inject = ['tools']        // 依赖 ctx.tools，满足后 apply 才运行

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'word_count',
    description: '统计一段文本的单词数与字符数。',   // ← 模型看到的说明
    parameters: { text: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', properties: { words: {...}, chars: {...} }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: `${value.words} 词 / ${value.chars} 字符` }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('aborted')
      return { words, chars: args.text.length }
    },
  }))
}
```

三件套的分工是**本课后续两节的前提**：

- **`parameters`** 是模型看到的参数格式。写错了模型就传不对参数。
- **`output.schema`** 是**规范返回值 (canonical value)**——它进审计，是"事实"。
- **`output.render`** 决定这个结果**回灌成什么文本**——那才是模型真正读到的东西。

第 2 节输出里的 `canonical value: { words: 4, chars: 27 }` 与 `render 给模型看: 4 词 / 27 字符`
就是这两者的对照。很多人只改 `execute` 就以为改完了，其实模型看到的是 `render` 的输出。

### 两条会真实抛错的 DSL 约束

真实 `defineTool` 的 schema 不是标准 JSON Schema，两条硬要求：

1. **`object` 必须显式写 `additionalProperties`**；
2. **必填字段写在每个 property 上**（`required: true`），不是 JSON Schema 的 `required` 数组。

### 注册是 effect-based 的

`ctx.tools.register()` 把注册挂在插件的 fiber 上。第 2 节 ④ 行：

```text
④ dispose 之后工具集合: [] （应为空）
```

`fiber.dispose()` 之后工具自动消失，**不需要手写反注册**。热重载、按需装载都由这个性质而来。

> **原理对照**：工具契约见 [07 § 7.10](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)，
> 三段 waterfall 见 [07 § 7.11](../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)。

---

## 4. 可见性：`restrict` 只缩小可见集

打开 [`impl/04-tool-restrict.ts`](../M01-tool-pipeline/impl/04-tool-restrict.ts)。它演示**渐进式披露**：
注册表保持"展示 / 查找 / 执行"三者对齐——被收紧掉的工具，模型看不见，**也调不动**。

第 2 节 M01.4 的三行输出正好构成这条证据链：

```text
① 全部已注册（全局视角）: [ 'echo', 'read', 'write', 'bash' ]   ← 全局定义没变
② 该 agent 可见（已被收紧）: [ 'echo', 'read' ]                  ← 只有这个 agent 的可见集缩小
③ 调用被收紧的 write → isError: true | Error: unknown tool "write"  ← 看不见就调不动
```

### 三条会真实抛错的约束

这是本课最值得记住的部分——它们都是**真实实现的报错原文**，不是风格建议：

| 写法 | 抛错 |
|---|---|
| `ctx.tools.restrict(...)`（插件自己的 plain context） | `tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent` |
| `agent.ctx.tools.restrict({})`（空 filter） | `tools.restrict({}) is a no-op: pass \`allow\` and/or \`deny\` (an empty filter is almost always a materialized-empty-config bug)` |
| `agent.ctx.tools.restrict({ deny: ['nope'] })`（未知名字） | `tools.restrict() names unknown global tool "nope"; known global tools: bash, echo, read, write` |

第一条的理由最值得想清楚：**一条 context-global 的收紧会遮蔽每一个 agent，那不是收紧而是误伤**。
要拒某个 agent 的工具，就用它自己的 `agent.ctx`。

### 同一 scope 多条收紧取交集

```text
再叠一条 deny echo → [ 'read' ]        ← allow 与 deny 求交
lift() 撤销这一条  → [ 'echo', 'read' ] ← disposer 精确撤销这一条
```

`restrict()` 返回 disposer，撤销是**精确到这一条**的，不是重置整个可见集。

### effect 归属：一个容易搞错的地方

```text
⑥ 插件 fiber.dispose() 之后：
   老 agent 仍被收紧 → [ 'echo', 'read' ]
   新建的 agent 不再被收紧 → [ 'echo', 'read', 'write', 'bash' ]
```

看起来矛盾，其实是一致性：那条 `restrict` 是在 **`agent.ctx`** 上调用的，所以 effect 归属**那个
agent 的 fiber**，随 agent 一起回收。插件 fiber 只拥有它自己注册的那个 `agent/session-start` 监听器——
监听器没了，所以**新建的 agent 不再被收紧**；老 agent 的收紧还在。

---

## 5. 裁决：`pre-execute` 可重排，`guard` 单调

这是全课最重要的一个区分。

### `pre-execute` 是可重排的策略 waterfall

打开 [`impl/02-permission-gate.ts`](../M01-tool-pipeline/impl/02-permission-gate.ts)。每个监听者返回类型化决定：

```ts
{ kind: 'allow' }          // 放行
{ kind: 'deny'; reason }   // 拒绝（模型收到 reason）
{ kind: 'ask'; reason? }   // 交给 ctx.approval 询问人类

ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
  if (config.denyList.includes(exec.name)) {
    return { kind: 'deny', reason: `工具 "${exec.name}" 被示例权限门拒绝。` }   // 接盘截链：不调 next()
  }
  return next()   // 转发：交给链上下一个监听者
})
```

第 2 节 M01.2 的输出：

```text
read_file → isError: false                    ← 不在黑名单，转发后放行
bash      → isError: true | 工具 "bash" 被示例权限门拒绝。   ← 命中黑名单，截链拒绝
```

这是**以责任链方式使用 waterfall**：命中就接盘截链，未命中就 `return next()`。但要注意底层毕竟是
waterfall——**下游决定在返回途中仍可被外层再加工，所以 pre-execute 的拒绝不是终点**。

### `guard` 只能拒绝，没有"放行"这个返回值

打开 [`impl/05-tool-guard.ts`](../M01-tool-pipeline/impl/05-tool-guard.ts)：

```ts
const guard: ToolGuard = (exec) => {
  const cmd = (exec.arguments as { cmd?: string } | null)?.cmd ?? ''
  for (const p of config.denyPatterns) {
    if (cmd.includes(p)) return `命令命中危险模式 "${p}"，被单调守卫拒绝`   // 返回 string = 拒绝
  }
  return undefined   // 不置可否，交给链上其它守卫/默认放行
}
ctx.tools.guard(guard)
```

**签名本身就保证了单调性**：`fn` 只返回 `string`（拒绝理由）或 `undefined`（不置可否），
**没有"放行"这个返回值**，所以监听器顺序在结构上无法把已有拒绝改回放行。

M01.5 的场景刻意造了一个"无论如何都放行"的 `pre-execute` 去 sed 翻案：

```ts
ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))   // 试图推翻拒绝
```

结果：

```text
ls -la    → isError: false | bash 已执行: cmd=ls -la
rm -rf /  → isError: true | Error: 命令命中危险模式 "rm -rf"，被单调守卫拒绝
（pre-execute 明明 allow 了，但 guard 是单调最终拒绝，翻不了案）
```

**这条输出就是本课的核心结论**：`guard` 注册在 `pre-execute` **之后**，做单调最终拒绝。
硬红线（危险命令、越权路径）放这里。

---

## 6. 结果呈现：`post-execute` 能改，`result` 只能看

打开 [`impl/03-result-transform.ts`](../M01-tool-pipeline/impl/03-result-transform.ts)。三个结果侧扩展点：

| 扩展点 | 拿到什么 | 能否改变结果 |
|---|---|---|
| `tools/execute` | 可变的 `mutableExec` | 包裹真实派发（超时/重试/指标） |
| `tools/post-execute` | `PostToolDecision` | **能**：替换 `content`/`value`、追加 `additionalContexts` |
| `tools/result` | 最终**不可变**结果 | **不能**：返回类型是 `undefined`，改动被忽略 |

```ts
ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
  if (exec.name === 'word_count') {
    return { kind: 'accept', content: [...result.content, { type: 'text', text: '\n[post-execute 策略] 已追加提示' }] }
  }
  return next()
})
ctx.on('tools/result', (exec, result) => {
  const ok = (result as { isError?: boolean }).isError !== true
  console.log(`[audit] 工具 ${exec.name} 结束 → ${ok ? 'ok' : 'error'}`)
})
```

第 2 节 M01.3 的输出是本课第二重要的证据：

```text
规范值 value（未变）: { words: 5, chars: 23 }                    ← 事实没变
模型可见 content（已被转换追加）:
  • "5 词 / 23 字符"                                              ← 呈现被改了
  • "\n[post-execute 策略] 已在结果后追加一条模型可见提示"
```

**改了呈现，没改事实**。这就是第 3 节那条"canonical value / render 分离"设计的兑现之处。
`result` 的"只能看"则是设计上的 containment：审计/度量这类旁路观测不该有能力改变事实。

---

## 7. 排障：工具注册了，模型却看不见

### 症状

模型答得头头是道，但输出里「模型发起的工具调用」是空的，`step 数` 只有 1。

### 定位

1. 先看输出第二行的**模型可见工具**列表里有没有它。空列表 = 模型根本不知道有这个工具。
2. 再看这个插件是不是在 **agent 建立之后**才装的。

### 原因与修改

`agent/session-start` **只派发一次**。插件比 Agent 晚到，就永远收不到那个事件——如果它的收紧逻辑挂在
这个事件上，就永远不会执行。修法是把插件放进 `createHarness` 的 `plugins` 参数里，让它在 Agent
之前就位（[`scenes/04`](../M01-tool-pipeline/scenes/04-narrow-visible-set.ts) 用的正是这个写法）：

```ts
const harness = await createHarness({
  plugins: [[seedTools], [restrictPlugin, { allow: ['echo', 'read'] }]],   // ← agent 之前
})
```

这个坑的特征很明显——**程序不报错，只是安静地少了一样东西**。

---

## 8. 代码在哪

```bash
cd dsh-example && ls M01-tool-pipeline/impl M01-tool-pipeline/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-word-count.ts`](../M01-tool-pipeline/impl/01-word-count.ts) | `name`/`inject`、`parameters`、`output.schema` + `render`、`exec.signal` 守卫 |
| [`impl/02-permission-gate.ts`](../M01-tool-pipeline/impl/02-permission-gate.ts) | 三值 `PreToolDecision`；命中即"不调 next()" |
| [`impl/03-result-transform.ts`](../M01-tool-pipeline/impl/03-result-transform.ts) | `post-execute` 返回 `{ kind:'accept', content }`；`result` 无返回 |
| [`impl/04-tool-restrict.ts`](../M01-tool-pipeline/impl/04-tool-restrict.ts) | `agent.ctx.tools.restrict`、`WeakSet` 去重、effect 归属注释 |
| [`impl/05-tool-guard.ts`](../M01-tool-pipeline/impl/05-tool-guard.ts) | `ToolGuard` 的 `string \| undefined` 返回类型 |
| [`scenes/01-register-and-dispose.ts`](../M01-tool-pipeline/scenes/01-register-and-dispose.ts) | 最短的一对 scene/impl，适合先读 |
| [`scenes/05-guard-overrides-allow.ts`](../M01-tool-pipeline/scenes/05-guard-overrides-allow.ts) | 那个"总是 allow"的 pre-execute |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。

---

## 9. 动手练习

### 练习 A：让失败带上有用的原因

打开 [`impl/01-word-count.ts`](../M01-tool-pipeline/impl/01-word-count.ts)，在 `execute` 开头加一句：
`text` 去掉空白后为空就抛错。

**验证命令**

```bash
cd dsh-example && node M01-tool-pipeline/scenes/01-register-and-dispose.ts
```

**可验证答案**：这次调用变成 `isError`，且渲染内容以 `Error:` 开头（工具管线把异常归一为错误结果）。
再跑 `npm run M01`，真实模型会拿着这个错误重新组织一句话解释失败原因。

### 练习 B：验证 guard 的单调性

把 [`impl/05-tool-guard.ts`](../M01-tool-pipeline/impl/05-tool-guard.ts) 的 `denyPatterns` 改成
`['ls']`，再跑：

```bash
cd dsh-example && npm run M01
```

**可验证答案**：M01.5 的输出里 `ls -la` 从 `isError: false` 变成 `isError: true`；而那个"总是
allow"的 `pre-execute` 依然翻不了案——**它就是用来证明这一点的**。

### 练习 C（进阶）：观察 effect 归属

在 [`scenes/04`](../M01-tool-pipeline/scenes/04-narrow-visible-set.ts) 的 ⑥ 之后，把新建的 agent 也
装一遍 restrict，再 dispose 插件，观察新旧 agent 的可见集差异。

**可验证答案**：如果收紧是经 `agent.ctx` 调的，它挂在那个 agent 的 fiber 上；插件的 `dispose`
只撤销插件自己注册的监听器，**不动已存在的 agent.ctx 上的收紧**。

---

**下一课** → [第 02 课 · 上下文装配](02-context-assembly.md)：让上下文不再是一根越来越长的字符串。

# safety-guardrail · 安全护栏插件

dsh-lab 唯一的自写策略插件（另一个自写插件是 M03 的 `anthropic-compat` provider）。它挂在工具管线的 `tools/pre-execute` 接缝上：模型发出 tool-call 之后、工具真正执行之前，把这次调用记录下来。当前阶段**只观察、不拦截**——先证明护栏稳定命中，再接拒绝 / 审批 / 参数改写等策略。

## 架构位置

![dsh-lab 三层同心结构](architecture.svg)

三层同心圆：最内层是 cordis 运行时内核（Context / Fiber / Loader 等），中间是 dsh 能力包（agent-loop、tools、llm、session、sandbox），最外层是 dsh-lab 自己的组合层。本插件位于最外层，监听中间层 `tools` 服务暴露的 `pre-execute` 事件，不改动任何内层代码。图内版本标注：dsh 0.2.2-rc.1 · cordis 4.0.5。

## 原理

### 工具管线中的位置

```text
模型输出 tool-call
  → agent-loop 组装 ToolBatchInput
  → dsh-tools 管线
  → tools/pre-execute   ← 本插件在这里观察（当前实现：只打印，不拦截）
  → tools/execute       （真正的工具实现）
  → tools/post-execute
  → tools/result
```

### waterfall 与四种决定

`tools/pre-execute` 是一条 waterfall：每个监听收到 `(exec, next)`，调用 `next()` 表示交给下一个监听，直接返回一个 `PreToolDecision` 则终止传递。决定有四种：`allow` / `deny` / `ask` / `cancel`（见 [index.ts](index.ts) 头部注释，类型来自 `@deepseek-ai/dsh-tools`）。这也是本插件选 pre-execute 而非官方 `ctx.tools.guard()` 的原因：guard 是**单调拒绝**，只能返回拒绝理由；pre-execute 是更完整的策略面，为后续策略留出全部四种决定。

当前 [`decide()`](index.ts) 永远返回 `{ kind: 'allow' }`，护栏只负责「看见」。非 allow 分支已经实现：任何非 allow 的决定都会先留痕（`deny` 附带 `reason`），再把决定返回给管线——这是「谁在什么时候被哪条规则拦下」的唯一证据。

### 日志格式

```text
[safety-guardrail] pre-execute tool=<工具名> agent=<agent id 或 (standalone)> args=<一行 JSON 预览>
```

日志默认写 **stderr**（`sink` 可切 stdout），不打断 REPL 的 stdout 流式渲染。`agent` 为 undefined 时打印 `(standalone)`，对应不经 agent-loop 的直接工具调用。

### 脱敏与参数预览

日志可信的前提是两条：不出现明文密钥，也不因参数过大或含循环引用而搞崩一次工具调用。

- `redactValue()`：递归脱敏，深度上限 8 层；只替换命中键的**值**为 `[REDACTED]`，键名保留，便于看出「这里本来有密钥」。键名先规范化（转小写、去掉非字母数字字符）再做**精确或后缀匹配**：`apiKey` / `api_key` / `access_token` / `clientSecret` 会命中，而 `maxTokens` 不会被 `token` 误伤。
- `previewArguments()`：把参数压成一行 JSON；超过 `previewChars` 截断并加 `…`；序列化失败（如循环引用）输出 `[unserializable]`，绝不抛错。

### 生命周期

插件声明 `inject = ['tools']`：没有工具注册表就没有 pre-execute 事件可听。`apply()` 里用 `ctx.on('tools/pre-execute', …)` 注册监听，fiber 销毁时自动摘除，无需手动清理。

## 装配与配置

插件通过官方 `boot()` + 声明式清单装配，在 [cordis.patch.yml](../../../cordis.patch.yml) 中占一行（89 行之一）：

```yaml
- id: safety-guardrail
  name: './src/plugins/safety-guardrail/index.ts'
  disabled: !!js "process.env.DSH_GUARDRAIL === '0'"
  config:
    previewChars: 240
```

配置项由 schemastery 校验，未显式给出的取默认值：

| 配置 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| `previewChars` | natural | `240` | 参数预览最大字符数，超出截断加省略号 |
| `redactKeys` | string[] | `apiKey`、`api_key`、`authorization`、`cookie`、`credential`、`password`、`secret`、`token` | 需脱敏的键名（规范化后精确/后缀匹配） |
| `sink` | `'stderr' \| 'stdout'` | `stderr` | 日志输出流 |
| `prefix` | string | `[safety-guardrail]` | 日志行前缀 |

设 `DSH_GUARDRAIL=0` 可整行关掉插件，便于对照「有护栏 / 没护栏」的日志。

## 使用示范

### 1. 交互 chat（真实模型，需要 `LLM_API_KEY`）

```bash
npm run chat
```

模型每发起一次工具调用，stderr 就多一行护栏日志，例如：

```text
[safety-guardrail] pre-execute tool=read agent=5cbcb16a-... args={"file_path":"README.md"}
[safety-guardrail] pre-execute tool=pwsh agent=5cbcb16a-... args={"command":"npm test"}
```

### 2. 机制阶段（无需 key）

```bash
npm run M01
```

M01 等机制阶段通过 `src/lab/tools.ts` 的 `callTool()` 走同一棵装配树，护栏日志同样出现；这类阶段在进程内驱动运行时，不需要 `LLM_API_KEY`。

### 3. 关掉护栏做对照

```bash
DSH_GUARDRAIL=0 npm run chat
```

同一任务下 stderr 不再出现 `[safety-guardrail]` 行，其余行为不变。

### 4. Bun 运行时

```bash
npm run chat:bun
npm run M01:bun
```

双运行时行为一致；`npm run verify` 会在 Node 与 Bun 上各跑一遍 typecheck / test / 启动探针。

### 5. 从「观察」升级为「拦截」

只需改 [`decide()`](index.ts)，不需要动装配清单。示例——拒绝包含危险命令的 shell 调用：

```ts
function decide(exec: Readonly<ToolExecution>): PreToolDecision {
  const command = String((exec.arguments as Record<string, unknown>).command ?? '')
  if (exec.name === 'pwsh' && command.includes('rm -rf')) {
    return { kind: 'deny', reason: '危险命令已被护栏拒绝' }
  }
  return { kind: 'allow' }
}
```

返回非 allow 决定时，插件会先打印 `deny tool=… agent=… reason=…` 留痕再拦截；`ask`（转人工审批）与 `cancel`（取消调用）同理可用。

## 验证

```bash
npm test
```

| 断言 | 位置 |
|:--|:--|
| 敏感键值被替换、`maxTokens` 不被误伤、嵌套与数组同样脱敏 | [index.test.ts](index.test.ts) |
| 预览为一行 JSON、超长按 `previewChars` 截断加 `…` | [index.test.ts](index.test.ts) |
| 循环引用输出 `[unserializable]` 不抛错 | [index.test.ts](index.test.ts) |
| 真实装配树中护栏日志**先于**工具函数体执行，且 `secret` 已脱敏为 `[REDACTED]` | [boot.test.ts](../../boot.test.ts)「安全护栏在工具函数体执行前打印日志」 |

## 源码索引

- [index.ts](index.ts)：插件实现（Config / redactValue / previewArguments / decide / apply）。
- [index.test.ts](index.test.ts)：脱敏与预览的纯函数单测。
- [boot.test.ts](../../boot.test.ts)：真实装配树上的顺序与脱敏断言。
- [cordis.patch.yml](../../../cordis.patch.yml)：装配行与 `DSH_GUARDRAIL` 开关。
- [dsh-lab README](../../../README.md)「安全护栏插件」一节：工程级入口说明。
# 14 · dsh 的 guardrail 示例

本示例演示一个自写安全护栏插件的完整策略面：观察、脱敏、留痕，升级为 deny / ask / cancel 四种决定，再对照官方单调 guard。全部装配都在 `cordis.patch.yml`（12 行）里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。**全程离线**——不需要任何 API key，五个场景全部用 `callTool` 直接驱动真实工具管线（与模型步同一条 pre-execute → execute 路径）。基于 `@deepseek-ai/*` 0.2.2-rc.3 与 `@deepseek-ai/cordis` 4.1.0，Node v26.12.1 与 Bun 1.4.4 双运行时实测等价。

配套文章：[07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)（§7.11 三段 waterfall、§7.13 ToolExecution 类型层级、§7.14 ToolsService 注册表）。

## 1 两条缝，能力不对等

「给工具调用加一道安全门」在 dsh 里有两条缝：

| 缝 | 形状 | 能做什么 | 本示例怎么用 |
|:---|:-----|:---------|:-------------|
| `tools/pre-execute` | waterfall，`(exec, next)` | **allow / deny / ask / cancel** 四种决定 | 自写护栏插件挂在这里 |
| `ctx.tools.guard()` | 单调函数，返回拒绝理由或 undefined | 只能拒绝，不能放行；在 pre-execute 之后求值 | S5 对照 |

> 护栏的两个阶段同时可见：**可观测**（allow 的调用打印一行脱敏预览，日志先于工具函数体）与**策略**（deny / ask / cancel 由 config 驱动，任何非 allow 决定先留痕再返回）。策略全部来自配置——改规则不改代码，摘插件不改管线。

架构位置（三层同心圆：cordis 内核 → dsh 能力包 → 本工程的组合层；护栏在最外层监听中间层 `tools` 的 pre-execute 事件，不改任何内层代码）：

![dsh-lab 三层同心结构](architecture.svg)

## 2 最小树：九行底座 + 审批 + 护栏 + 探针工具

`cordis.yml` 是空树 `[]`，全部装配来自 `cordis.patch.yml`，共 12 行：

| 行 id | 包 / 文件 | 角色 |
|:--|:--|:--|
| timer | cordis-plugin-timer | 定时器底座 |
| system-prompt | dsh-system-prompt | agent 创建的前置 |
| tools | dsh-tools | 工具注册表，pre-execute 事件的来源 |
| tool-executor-native | dsh-tool-executor-native | 原生执行器，缺它 execute 报 TOOL_EXECUTOR_UNAVAILABLE |
| session | dsh-session | 会话服务 |
| session-projection | dsh-session-projection | 投影注册表（approvalState 挂在这里） |
| agent | dsh-agent | agents.create / resume |
| llm | dsh-llm | ToolCallId 等协议类型与路由注册表 |
| agent-loop | dsh-agent-loop | agents 空表，本示例不跑模型 turn |
| user-approval | dsh-user-approval | 审批缝，policy: ask |
| safety-guardrail | ./src/plugins/safety-guardrail/index.ts | 自写护栏，策略全在 config |
| probe-tools | ./src/plugins/probe-tools.ts | 六个 demo_* 探针工具 |

护栏的配置面（schemastery 校验，未显式给出的取默认值）：

| 配置 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| `previewChars` | natural | `240` | 参数预览最大字符数，超出截断加 `…` |
| `redactKeys` | string[] | apiKey / api_key / authorization / cookie / credential / password / secret / token | 脱敏键名（规范化后精确/后缀匹配） |
| `sink` | `'stderr' \| 'stdout'` | `stderr` | 日志输出流 |
| `prefix` | string | `[safety-guardrail]` | 日志行前缀 |
| `denyTools` | string[] | `[]` | 直接拒绝的工具名 |
| `denyCommandPatterns` | string[] | `[]` | command 参数命中即拒绝的子串 |
| `askTools` | string[] | `[]` | 需要人工审批的工具名 |
| `cancelTools` | string[] | `[]` | 直接取消的工具名 |

> `decide()` 的优先级即列表顺序：**cancel > deny（名单）> deny（命令模式）> ask > allow**。调用 `next()` 表示交给下一个监听；直接返回决定则终止传递。

## 3 五个场景

### S1 观察与脱敏：日志先于工具函数体

allow 的调用打印一行预览：`pre-execute tool=<名> agent=<id 或 (standalone)> args=<一行 JSON>`。证据链由探针工具产生：每个工具函数体开始时检查「护栏日志是否已写出」（`bodySawGuardrail`），并把执行事实记进 `bodyOrder`。脱敏有两条规则：

- `redactValue()` 递归脱敏（深度上限 8），只替换命中键的**值**为 `[REDACTED]`，键名保留——看得出「这里本来有密钥」。键名规范化（转小写、去非字母数字）后**精确或后缀匹配**：`apiKey` / `access_token` / `clientSecret` 命中，`maxTokens` 不被 `token` 误伤；反过来 `my_api_key` 会命中 `api_key`——规范化后后缀相同。
- `previewArguments()` 超长按 `previewChars` 截断加 `…`；循环引用输出 `[unserializable]`，绝不因日志搞崩一次工具调用。注意这条防线只在纯函数预览里验证：`ToolCallBlock.arguments` 本身是 JSON 字符串，循环参数在 `JSON.stringify` 阶段就抛了，进不了批接口。

### S2 deny：先留痕再拦截

名单拒绝与命令模式拒绝都先打印 `deny tool=… reason=…` 留痕行，再把决定返回管线——这是「谁在什么时候被哪条规则拦下」的唯一证据。被拒绝的工具函数体**绝不执行**（`bodyOrder` 里没有它）。模型看到的是 `Error: <reason>`，turn 照常收尾。优先级有掩盖效应：一个工具同时在 denyTools 名单上又命中命令模式时，reason 永远是名单——想单独观察模式规则，要用不在名单上的干净工具（示例里的 demo_shell）。

### S3 ask：管线自动走 approval 缝

护栏只返回 `{ kind: 'ask', reason }`，**不自己调审批**——管线把 ask 映射为 `approval.request()`（带真实 callId），四种结局一一映射：

| 审批结局 | 工具结果 |
|:---------|:---------|
| 回答器 `allowed-once` | 照常执行 |
| 回答器 `rejected` | deny，`error.info.code = APPROVAL_REJECTED` |
| 无回答器 | fail-closed，`APPROVAL_UNAVAILABLE` |
| 无 agent（standalone 调用） | 没有路由对象，`APPROVAL_UNAVAILABLE` |

关键约束：**审批必须在 open turn 内**。`approval.request()` 检查 approvalState 投影的 `turnOpen`，turn 外直接抛错——审计对（approval/asked + approval/decided）必须被 turn 包住，否则崩溃重载时会留下不完整的垃圾记录。真实部署里 turn 由 agent-loop 打开；本示例直接驱动管线，所以手动 `session.append('turn/start', { turn: 1 })` 把门打开（收尾 append turn/end）。护栏日志带 `agent=<id>`：示例用固定 SessionId（`guardrail-demo-ask`）而不是时间戳后缀，输出才可复现对比。

### S4 cancel：规范取消，不呈现策略拒绝

cancel 与 deny 的区别在模型视角：deny 给模型一条拒绝理由（它能据此改道），cancel 走规范取消结果 `Error: tool call aborted before dispatch`（`error.info = { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' }`），不呈现任何策略身份。函数体同样不执行。注意常量名与值不同：`TOOL_ABORTED_BEFORE_DISPATCH` 常量的值是 `'ABORTED_BEFORE_DISPATCH'`（contracts.ts），断言要写值不是常量名。

### S5 guard 对照：单调拒绝

`ctx.tools.guard()` 注册的守卫在**每个 pre-execute 监听之后**才求值：护栏对 `demo_guarded` 是 allow（日志照打），guard 仍然拒绝。guard 没有 allow 结果，所以监听顺序不能把拒绝翻回放行——这是「单调」的含义。摘除 guard（release）后同一调用立即恢复放行。

## 4 运行 guardrail 示例

前置：`npm install` 一次即可，不需要 `.env`、key 或网络。

根配置全文：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

装配清单全文（`cordis.patch.yml`）：

```yaml
# 安全护栏的最小树：九行 base + 审批服务 + 自写护栏 + 探针工具，共 12 行。
# 本示例不跑模型 turn：全部场景用 callTool 直接驱动工具管线（与模型步同一条
# pre-execute → execute → post-execute 路径），ask 场景需要一个 agent 路由审批。
# 依赖链：safety-guardrail 注入 tools（pre-execute 事件来自工具注册表）；
#         probe-tools 注入 tools；user-approval 注入 sessionProjections（base 已有）。
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

    # ── 审批缝：policy ask = 交给 approval/request waterfall 的回答器组合 ───
    # 护栏返回 { kind: 'ask' } 时，管线自己调 approval.request；无回答器 fail-closed。
    - id: user-approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: ask

    # ── 自写护栏：本地插件一行装配，策略全部来自 config ─────────────────────
    # sink 默认 stderr（不打断 REPL 的 stdout 流式渲染）；演示用 stdout 让
    # 护栏日志与场景输出同流，顺序确定、便于双运行时逐行对比。
    - id: safety-guardrail
      name: './src/plugins/safety-guardrail/index.ts'
      config:
        sink: stdout
        previewChars: 240
        denyTools: [demo_danger]
        denyCommandPatterns: ['rm -rf']
        askTools: [demo_ask]
        cancelTools: [demo_cancel]

    # ── 探针工具：六个 demo_* 工具，函数体记录执行顺序 ──────────────────────
    - id: probe-tools
      name: './src/plugins/probe-tools.ts'
```

`src/index.ts` 的启动核心（完整文件见 §5）：

```ts
const ctx = await boot(
  'dsh-guardrail-demo', CONFIG,
  loadOverlayPatches('dsh-guardrail-demo', PATCH),
  undefined, BASE_URL,
)
```

命令：

```bash
# 安装与类型检查
npm install
npm run typecheck

# 五场景：末行 GUARDRAIL_DEMO_OK
npm start
npm run start:bun

# 纯函数单测：脱敏 / 预览 / 策略优先级
npm test
npm run test:bun
```

实测输出（`npm start`，Node v26.12.1；护栏日志与场景输出同流，顺序即真实顺序）：

```text
runtime = node v26.12.1

=== S1 观察与脱敏 ===
[safety-guardrail] pre-execute tool=demo_echo agent=(standalone) args={"text":"hello guardrail","apiKey":"[REDACTED]","authorization":"[REDACTED]","maxTokens":4096}
echo 结果：echo: hello guardrail
日志先于函数体：true
脱敏：[REDACTED] 在场=true，明文密钥缺席=true，maxTokens 未误伤=true

=== S2 deny：名单与命令模式 ===
[safety-guardrail] deny tool=demo_danger agent=(standalone) reason=tool "demo_danger" is on the guardrail deny list
名单 deny：isError=true，留痕=true
[safety-guardrail] deny tool=demo_shell agent=(standalone) reason=command contains forbidden pattern "rm -rf"
模式 deny：isError=true，reason=Error: command contains forbidden pattern "rm -rf"
函数体从未执行：true

=== S3 ask：审批缝 ===
[safety-guardrail] ask tool=demo_ask agent=guardrail-demo-ask
回答器批准：isError=false（allowed-once → 执行）
[safety-guardrail] ask tool=demo_ask agent=guardrail-demo-ask
回答器拒绝：code=APPROVAL_REJECTED
[safety-guardrail] ask tool=demo_ask agent=guardrail-demo-ask
无回答器：code=APPROVAL_UNAVAILABLE
[safety-guardrail] ask tool=demo_ask agent=(standalone)
无 agent：code=APPROVAL_UNAVAILABLE

=== S4 cancel：规范取消 ===
[safety-guardrail] cancel tool=demo_cancel agent=(standalone)
cancel 结果：Error: tool call aborted before dispatch
函数体未执行：true

=== S5 guard 对照：单调拒绝 ===
[safety-guardrail] pre-execute tool=demo_guarded agent=(standalone) args={}
guard 在场：isError=true（pre-execute 仍 allow，日志 × 1）
[safety-guardrail] pre-execute tool=demo_guarded agent=(standalone) args={}
guard 摘除：isError=false

GUARDRAIL_DEMO_OK
```

Bun（`npm run start:bun`）除首行 `runtime = bun 1.4.4` 外**逐行一致**（归一化比对验证）。`npm run typecheck` 0 错误；`npm test` / `npm run test:bun` 均 **4 pass / 0 fail**。护栏行由 index.ts 的 stdout 包装器收集：包装器必须调用原始 write 透传场景输出，否则场景输出全部消失；`bind(process.stdout)` 保住 this。

6 个值得注意的事实：

- **12** 行装配里有 **2** 行自写插件：护栏与探针工具，都是一行 `name: './src/...'` 挂进清单。
- **6** 个探针工具产生证据链：`bodyOrder`（谁真的执行了）与 `bodySawGuardrail`（日志是否先于函数体）。
- ask 的四种结局全部实测：批准执行、`APPROVAL_REJECTED`、无回答器与无 agent 都 fail-closed 成 `APPROVAL_UNAVAILABLE`。
- deny / cancel 的函数体**从未执行**，且都先留痕再返回。
- guard 对照：pre-execute 仍 allow（日志 × 1），guard 在其后单调拒绝；摘除即放行。
- 双运行时输出除 runtime 行外逐行一致，**Bun 直接跑通，无需任何补丁**。

留档：[runtime-out-node.txt](runtime-out-node.txt) / [runtime-out-bun.txt](runtime-out-bun.txt)。

## 5 从零复现：完整文件与运行路径

前置条件：Node >= 22.18（原生 TS 类型剥离，实测 v26.12.1）或 Bun >= 1.4.4；`npm install` 一次。本示例不依赖任何环境变量、端口或外部服务。

### 目录结构

```text
dsh-guardrail-demo/
├── package.json              # 18 依赖，全部精确 pin
├── tsconfig.json             # NodeNext + allowImportingTsExtensions
├── cordis.yml                # 空树 []
├── cordis.patch.yml          # 12 行装配（§4 全文）
├── architecture.svg          # 三层同心圆（版本标注已更新）
├── .gitignore                # node_modules/ .dsh-home/
└── src/
    ├── index.ts              # 五场景，166 行
    ├── tools.ts              # executeTool / callTool 批接口封装
    └── plugins/
        ├── safety-guardrail/
        │   ├── index.ts      # 护栏本体（Config / redact / preview / decide / apply）
        │   └── index.test.ts # 纯函数单测 ×4
        └── probe-tools.ts    # 六个探针工具 + 顺序证据
```

### package.json（完整版）

```json
{
  "name": "dsh-guardrail-demo",
  "private": true,
  "type": "module",
  "description": "自写安全护栏插件全文落地：pre-execute waterfall 上的观察/脱敏/留痕，升级为 deny/ask/cancel 完整策略面，对照单调 guard。全程离线。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "test": "node --test src/plugins/safety-guardrail/index.test.ts",
    "test:bun": "bun test src/plugins/safety-guardrail/index.test.ts",
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
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3",
    "@deepseek-ai/dsh-user-approval": "0.2.2-rc.3",
    "@deepseek-ai/schemastery": "3.18.5"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

`tsconfig.json` 与 [dsh-agent-loop-demo 的 tsconfig.json](../11-dsh-agent-loop-demo/tsconfig.json) 逐字一致（ES2023 / nodenext / strict / noEmit / allowImportingTsExtensions），不再重复。`cordis.yml` 与 `cordis.patch.yml` 全文见 §4。

### src/index.ts（完整版）

```ts
/**
 * dsh-guardrail-demo —— 自写安全护栏插件的完整策略面，全部离线：
 *   S1 观察与脱敏：allow 的调用打印一行脱敏预览，日志先于工具函数体；
 *   S2 deny：工具名单与危险命令模式，先留痕再拦截，函数体绝不执行；
 *   S3 ask：管线自动走 approval 缝——批准/拒绝/无回答器/无 agent 四条路；
 *   S4 cancel：规范取消结果，不呈现策略拒绝；
 *   S5 guard 对照：官方单调守卫在 pre-execute 之后求值，只能拒绝不能放行。
 * 关键认识：护栏是装配清单里的一行本地插件，策略全部来自 config——
 * 改规则不改代码，摘插件不改管线。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'
import { blocksToText, executeTool } from './tools.ts'
import { bodyOrder, bodySawGuardrail, guardrailLines } from './plugins/probe-tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

// 护栏日志收集器：包装 stdout.write，护栏行（sink: stdout）进数组后照常透传。
// 工具函数体靠这个数组证明「日志先于我」；被拦截的调用靠它证明「谁拦的我」。
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((chunk: Uint8Array | string, ...rest: unknown[]) => {
  const text = String(chunk)
  if (text.includes('[safety-guardrail]')) guardrailLines.push(text.trimEnd())
  return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest)
}) as typeof process.stdout.write

const ctx = await boot(
  'dsh-guardrail-demo', CONFIG,
  loadOverlayPatches('dsh-guardrail-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

/** 取失败结果的结构化错误码（ApprovalError / AbortError 等）。 */
function errorCode(result: { isError?: boolean; error?: { info?: { code?: string } } }): string | undefined {
  return result.isError === true ? result.error?.info?.code : undefined
}

// ── S1：观察与脱敏——日志先于工具函数体 ────────────────────────────────────
console.log('\n=== S1 观察与脱敏 ===')
{
  const result = await executeTool(ctx, 'demo_echo', {
    text: 'hello guardrail',
    apiKey: 'sk-live-123',
    authorization: 'Bearer abc',
    maxTokens: 4096,
  })
  console.log(`echo 结果：${blocksToText(result.content)}`)
  assert(result.isError !== true, 'allow 的调用应当执行')

  const line = guardrailLines.find(l => l.includes('tool=demo_echo')) ?? ''
  console.log(`日志先于函数体：${bodySawGuardrail['demo_echo'] === true}`)
  assert(bodySawGuardrail['demo_echo'] === true, '护栏日志必须先于工具函数体')
  const redacted = line.includes('[REDACTED]')
  const noLeak = !line.includes('sk-live-123') && !line.includes('Bearer abc')
  const budgetIntact = line.includes('"maxTokens":4096')
  console.log(`脱敏：[REDACTED] 在场=${redacted}，明文密钥缺席=${noLeak}，maxTokens 未误伤=${budgetIntact}`)
  assert(redacted && noLeak && budgetIntact, '脱敏预览不符')
}

// ── S2：deny——名单与命令模式，先留痕再拦截 ────────────────────────────────
console.log('\n=== S2 deny：名单与命令模式 ===')
{
  const byList = await executeTool(ctx, 'demo_danger', {})
  const listLine = guardrailLines.find(l => l.includes('deny tool=demo_danger')) ?? ''
  console.log(`名单 deny：isError=${byList.isError === true}，留痕=${listLine.includes('reason=')}`)
  assert(byList.isError === true && listLine.includes('deny list'), '名单拒绝应当留痕并拦截')

  // 模式 deny 用不在名单上的 demo_shell：优先级 cancel > 名单 > 模式，
  // 名单工具永远先被名单拦下，模式规则要用干净工具才能单独看见。
  const byPattern = await executeTool(ctx, 'demo_shell', { command: 'rm -rf /tmp/x' })
  console.log(`模式 deny：isError=${byPattern.isError === true}，reason=${blocksToText(byPattern.content)}`)
  assert(byPattern.isError === true && blocksToText(byPattern.content).includes('forbidden pattern'), '命令模式应当拒绝')
  console.log(`函数体从未执行：${!bodyOrder.includes('demo_danger') && !bodyOrder.includes('demo_shell')}`)
  assert(!bodyOrder.includes('demo_danger') && !bodyOrder.includes('demo_shell'), '被拒绝的工具函数体不应执行')
}

// ── S3：ask——管线自动走 approval 缝 ───────────────────────────────────────
console.log('\n=== S3 ask：审批缝 ===')
const askHandle = await ctx.agents.create({
  sessionId: SessionId('guardrail-demo-ask'),
  meta: { cwd: process.cwd() },
})
{
  const agent = askHandle.agent
  // approval.request() 必须在 open turn 内：审计对（approval/asked + decided）
  // 要被 turn 包住，否则重载时是崩溃尾巴垃圾。真实部署里 turn 由 agent-loop
  // 打开；这里直接驱动管线，所以手动 append turn/start 把门打开。
  agent.session.append('turn/start', { turn: 1 })

  // 回答器批准：ask → allowed-once → 照常执行。
  const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
  const allowed = await executeTool(ctx, 'demo_ask', {}, agent)
  offAllow()
  console.log(`回答器批准：isError=${allowed.isError === true}（allowed-once → 执行）`)
  assert(allowed.isError !== true && bodyOrder.includes('demo_ask'), '批准后应当执行')

  // 回答器拒绝：deny 带 ApprovalError/APPROVAL_REJECTED。
  const offReject = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'rejected')
  const rejected = await executeTool(ctx, 'demo_ask', {}, agent)
  offReject()
  console.log(`回答器拒绝：code=${errorCode(rejected)}`)
  assert(errorCode(rejected) === 'APPROVAL_REJECTED', '拒绝应当带 APPROVAL_REJECTED')

  // 无回答器：fail-closed（unavailable），不是默许。
  const unanswered = await executeTool(ctx, 'demo_ask', {}, agent)
  console.log(`无回答器：code=${errorCode(unanswered)}`)
  assert(errorCode(unanswered) === 'APPROVAL_UNAVAILABLE', '无回答器应当 fail-closed')

  // 无 agent：审批请求没有路由对象，同样降级 unavailable。
  const standalone = await executeTool(ctx, 'demo_ask', {})
  console.log(`无 agent：code=${errorCode(standalone)}`)
  assert(errorCode(standalone) === 'APPROVAL_UNAVAILABLE', '无 agent 应当降级 unavailable')
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

// ── S4：cancel——规范取消结果 ──────────────────────────────────────────────
console.log('\n=== S4 cancel：规范取消 ===')
{
  const cancelled = await executeTool(ctx, 'demo_cancel', {})
  console.log(`cancel 结果：${blocksToText(cancelled.content)}`)
  assert(cancelled.isError === true && errorCode(cancelled) === 'ABORTED_BEFORE_DISPATCH', 'cancel 应当走规范取消结果')
  console.log(`函数体未执行：${!bodyOrder.includes('demo_cancel')}`)
  assert(!bodyOrder.includes('demo_cancel'), '被取消的工具函数体不应执行')
}

// ── S5：guard 对照——单调拒绝，pre-execute 之后求值 ────────────────────────
console.log('\n=== S5 guard 对照：单调拒绝 ===')
{
  // 护栏对 demo_guarded 是 allow（日志照打），但官方 guard 在其后仍然拒绝。
  const release = ctx.tools.guard(exec => (exec.name === 'demo_guarded' ? 'monotonic guard denial' : undefined))
  const guarded = await executeTool(ctx, 'demo_guarded', {})
  const allowLine = guardrailLines.filter(l => l.includes('pre-execute tool=demo_guarded')).length
  console.log(`guard 在场：isError=${guarded.isError === true}（pre-execute 仍 allow，日志 × ${allowLine}）`)
  assert(guarded.isError === true && blocksToText(guarded.content).includes('monotonic guard denial'), 'guard 应当单调拒绝')

  // 摘掉 guard 后同一调用放行——guard 没有 allow 结果，摘除即恢复。
  release()
  const freed = await executeTool(ctx, 'demo_guarded', {})
  console.log(`guard 摘除：isError=${freed.isError === true}`)
  assert(freed.isError !== true, '摘除 guard 后应当放行')
}

await askHandle.dispose()
await ctx.fiber.dispose()
process.stdout.write = originalWrite
console.log('\nGUARDRAIL_DEMO_OK')
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

### src/plugins/probe-tools.ts（完整版）

```ts
/**
 * probe-tools —— 六个探针工具，函数体记录执行顺序。
 *
 * 护栏断言的关键证据在这里产生：每个工具函数体开始时检查「护栏日志是否已经
 * 写出」（guardrailLines 由 index.ts 的 stdout 包装器填充），并把执行事实记进
 * bodyOrder——被拦截的工具绝不应出现在 bodyOrder 里。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'probe-tools'
export const inject = ['tools']

/** index.ts 的 stdout 包装器把护栏日志行推进这里。 */
export const guardrailLines: string[] = []
/** 真正执行过的工具函数体（按顺序）。 */
export const bodyOrder: string[] = []
/** 每个工具函数体开始时，护栏日志是否已在场。 */
export const bodySawGuardrail: Record<string, boolean> = {}

function markBody(tool: string): void {
  bodySawGuardrail[tool] = guardrailLines.some(line => line.includes(`tool=${tool}`))
  bodyOrder.push(tool)
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'demo_echo',
      description: '回显文本；参数里的敏感键用于验证护栏脱敏。',
      parameters: {
        text: { type: 'string', required: true, description: '要回显的文本' },
        apiKey: { type: 'string', description: '敏感键（应被脱敏）' },
        authorization: { type: 'string', description: '敏感键（应被脱敏）' },
        maxTokens: { type: 'number', description: '预算字段（不应被 token 规则误伤）' },
      },
      output: {
        schema: { type: 'object', properties: { echo: { type: 'string', required: true } }, additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: `echo: ${value.echo}` }],
      },
      async execute(args: unknown) {
        markBody('demo_echo')
        return { echo: (args as { text: string }).text }
      },
    }),
  )

  for (const tool of ['demo_danger', 'demo_shell', 'demo_ask', 'demo_cancel', 'demo_guarded'] as const) {
    ctx.tools.register(
      defineTool({
        name: tool,
        description: `策略探针：${tool}。`,
        parameters: {
          command: { type: 'string', description: '可选命令文本（用于危险模式匹配）' },
        },
        output: {
          schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } }, additionalProperties: false },
          render: () => [{ type: 'text', text: `${tool} body ran` }],
        },
        async execute() {
          markBody(tool)
          return { ok: true }
        },
      }),
    )
  }
}
```

### src/plugins/safety-guardrail/index.ts（完整版）

```ts
/**
 * safety-guardrail —— dsh-lab 自己的「安全护栏」插件（完整策略版）。
 *
 * 它挂在 **工具管线的 pre-execute** 接缝上：模型在一步里发出 tool-call 之后、
 * 工具真正执行之前，cordis 会先走一遍 `tools/pre-execute` waterfall。这个插件就是
 * 那条 waterfall 上的一个监听：
 *
 *   模型输出 tool-call
 *     → agent-loop 组装 ToolBatchInput
 *     → dsh-tools 管线
 *     → tools/pre-execute   ← 本插件在这里决策（allow / deny / ask / cancel）
 *     → tools/execute       （真正的工具实现）
 *     → tools/post-execute
 *     → tools/result
 *
 * 护栏的两个阶段在本文件里同时可见：
 *   1. 可观测——allow 的调用打印一行脱敏预览（日志先于工具函数体）；
 *   2. 策略——deny / ask / cancel 由 config 驱动，任何非 allow 决定先留痕再返回。
 * 策略全部来自配置，改规则不需要改代码，也不需要改装配清单。
 *
 * 与官方 `ctx.tools.guard()` 的区别：guard 是**单调拒绝**，只能返回拒绝理由，
 * 且在每个 pre-execute 监听之后才求值；pre-execute 是 waterfall，可 allow / deny /
 * ask / cancel，是更完整的策略面。本插件选 pre-execute，就是为了四种决定都留得住。
 *
 * @module dsh-guardrail-demo/plugins/safety-guardrail
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'safety-guardrail'

/** 依赖 `tools`：没有工具注册表就没有 pre-execute 事件可听。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 参数预览的最大字符数；超出截断并加省略号。 */
  previewChars: number
  /** 需要脱敏的键名（规范化后精确/后缀匹配）。 */
  redactKeys: string[]
  /** 日志写到哪个流：stderr 不打断 REPL 的 stdout 流式渲染。 */
  sink: 'stderr' | 'stdout'
  /** 日志行前缀。 */
  prefix: string
  /** 直接拒绝的工具名。 */
  denyTools: string[]
  /** command 参数命中即拒绝的子串（危险命令模式）。 */
  denyCommandPatterns: string[]
  /** 需要人工审批的工具名（ask → approval 缝）。 */
  askTools: string[]
  /** 直接取消的工具名（不呈现策略拒绝，走规范取消结果）。 */
  cancelTools: string[]
}

export const Config: z<Config> = z.object({
  previewChars: z.natural().default(240),
  redactKeys: z
    .array(z.string())
    .default(['apiKey', 'api_key', 'authorization', 'cookie', 'credential', 'password', 'secret', 'token']),
  sink: z.union(['stderr', 'stdout'] as const).default('stderr'),
  prefix: z.string().default('[safety-guardrail]'),
  denyTools: z.array(z.string()).default([]),
  denyCommandPatterns: z.array(z.string()).default([]),
  askTools: z.array(z.string()).default([]),
  cancelTools: z.array(z.string()).default([]),
})

/** 递归脱敏：只替换匹配键的**值**，键名本身保留，便于看出"这里本来有密钥"。 */
export function redactValue(value: unknown, keys: readonly string[], depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const sensitive = keys.some((needle) => isSensitiveKey(key, needle))
    out[key] = sensitive ? '[REDACTED]' : redactValue(item, keys, depth + 1)
  }
  return out
}

/**
 * 判断一个键是否命中脱敏规则。
 *
 * 先去掉 `_` / `-` 并转小写，再做**精确匹配或后缀匹配**：
 * `apiKey` / `api_key` / `access_token` / `clientSecret` 会命中，而
 * `maxTokens` 不会被 `token` 误伤——否则模型配置里的预算字段也会被涂掉。
 */
function isSensitiveKey(key: string, needle: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedKey = normalize(key)
  const normalizedNeedle = normalize(needle)
  if (normalizedNeedle.length === 0) return false
  return normalizedKey === normalizedNeedle || normalizedKey.endsWith(normalizedNeedle)
}

/** 把工具参数压成一行可读预览；脱敏、截断、绝不因循环引用抛错。 */
export function previewArguments(args: unknown, maxChars: number, keys: readonly string[]): string {
  let text: string
  try {
    text = JSON.stringify(redactValue(args, keys)) ?? '{}'
  } catch {
    text = '[unserializable]'
  }
  if (maxChars <= 0 || text.length <= maxChars) return text
  return text.slice(0, Math.max(0, maxChars - 1)) + '…'
}

/**
 * 决定这次调用怎么处理——策略全部来自 config，顺序即优先级：
 * cancel > deny（名单）> deny（命令模式）> ask > allow。
 * 调用 `next()` 则表示交给下一个监听；直接返回决定则终止传递。
 */
export function decide(exec: Readonly<ToolExecution>, config: Config): PreToolDecision {
  if (config.cancelTools.includes(exec.name)) return { kind: 'cancel' }
  if (config.denyTools.includes(exec.name)) {
    return { kind: 'deny', reason: `tool "${exec.name}" is on the guardrail deny list` }
  }
  const command = String((exec.arguments as Record<string, unknown> | null)?.command ?? '')
  for (const pattern of config.denyCommandPatterns) {
    if (pattern !== '' && command.includes(pattern)) {
      return { kind: 'deny', reason: `command contains forbidden pattern "${pattern}"` }
    }
  }
  if (config.askTools.includes(exec.name)) {
    return { kind: 'ask', reason: `tool "${exec.name}" requires approval` }
  }
  return { kind: 'allow' }
}

/** 挂载护栏：注册一个 pre-execute 监听，fiber 销毁时自动摘除。 */
export function apply(ctx: Context, config: Config): void {
  const emit = config.sink === 'stdout' ? process.stdout : process.stderr

  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = decide(exec, config)
    if (decision.kind !== 'allow') {
      // 任何非 allow 的决定都留痕：这是"谁在什么时候被哪条规则拦下"的唯一证据。
      const reason = decision.kind === 'deny' ? ` reason=${decision.reason}` : ''
      emit.write(
        `${config.prefix} ${decision.kind} tool=${exec.name} agent=${exec.agent === undefined ? '(standalone)' : String(exec.agent.id)}${reason}\n`,
      )
      return decision
    }

    const args = previewArguments(exec.arguments, config.previewChars, config.redactKeys)
    emit.write(
      `${config.prefix} pre-execute tool=${exec.name} agent=${exec.agent === undefined ? '(standalone)' : String(exec.agent.id)} args=${args}\n`,
    )
    return next()
  })
}
```

4 个纯函数单测在 [index.test.ts](src/plugins/safety-guardrail/index.test.ts)（脱敏替换、预览截断、循环引用不抛错、decide 优先级），顺序断言与真实管线行为放在 `src/index.ts` 的 S1–S5，因为那需要真实装配树。

### 按顺序验证

```bash
# 1 安装与类型
npm install
npm run typecheck

# 2 五场景：双侧末行 GUARDRAIL_DEMO_OK，输出除 runtime 行外逐行一致
npm start
npm run start:bun

# 3 单测：双侧 4 pass / 0 fail
npm test
npm run test:bun
```

本示例不依赖任何环境变量、端口或外部服务。

## 6 小结

这个示例验证了 3 件事：

- 护栏是装配清单里的**一行本地插件**：观察与策略都挂在 `tools/pre-execute` waterfall 上，策略全部来自 config，改规则不改代码，摘插件不改管线。
- 四种决定各有处理方式：allow 留脱敏预览、deny 留拒绝理由、ask 交审批缝（必须在 open turn 内）、cancel 走规范取消；官方 guard 是它们之后的单调兜底。
- 证据链可以完全离线构造：探针工具 + stdout 包装器就能证明「日志先于函数体」「被拦的函数体从未执行」，不需要模型参与。

兄弟示例：[dsh-tool-pipeline-demo](../08-dsh-tool-pipeline-demo/README.md)（管线五段机制本身）、[dsh-hitl-demo](../14-dsh-hitl-demo/README.md)（审批缝的完整词汇表与真实 turn 内的工具审批）、[dsh-chat-demo](../21-dsh-chat-demo/README.md)（护栏副本在完整终端里的样子）。
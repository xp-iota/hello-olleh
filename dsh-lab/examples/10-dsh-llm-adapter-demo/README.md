# 10 · dsh 的模型接入示例

本示例演示模型接入层这条接缝：适配器的发现面、`llm/stream` waterfall 的环绕与拦截、合成 SSE 的离线端到端验证、真实网关调用。两个自写适配器都在 cordis.patch.yml 里声明——anthropic-compat 全程在位，scripted-adapter 行初始禁用、S2 用行句柄开关临时启用，代码里没有一处 `ctx.plugin()`。

两条路径分明：机制路径（`npm run mechanism`）跑 S1–S3 全程离线、不需要 key；真实调用路径（`npm start`）的 S4 发起真实 provider 请求，需要本目录 `.env` 里的 `LLM_API_KEY`，缺 key 明确失败（fail loud），绝不静默跳过。版本面 `@deepseek-ai/*` 0.2.2-rc.5、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 机制输出逐行一致（首行 runtime 标识除外），单测两侧各 12 pass / 0 fail。

配套文章：[07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)（§7.2 LlmAdapter、§7.3 llm/stream waterfall、§7.7 错误模型、§7.8 API Key 的处理）。

## 1 一条接缝，三件事

> `ctx.llm.stream()` 是唯一入口：适配器把某个 provider 的线协议翻译成统一的 chunk 协议，`llm/stream` waterfall 环绕每一次调用。换网关只改配置，不改管线。

| 场景 | 问题 | 手段 | 需要 key |
|:-----|:-----|:-----|:---------|
| S1 路由与模型目录 | 适配器的发现面长什么样？ | `listProviders` / `listModels` / `resolveModelInfo` | 否 |
| S2 llm/stream waterfall | 怎样环绕/拦截每次模型调用？ | 脚本化适配器 + waterfall 监听器包流计数 | 否 |
| S3 合成 SSE 端到端 | Anthropic SSE → chunk 的翻译层对不对？ | stub `globalThis.fetch` 喂真实适配器一段合成 SSE | 否 |
| S4 真实调用 | 真网关上整条链路通不通？ | 真实请求 fuyao/MiniMax 兼容网关 | **是** |

自写适配器 `anthropic-compat`（607 行）不是玩具：它处理 system 分离、tool_result 折叠、thinking 签名回放（minimax 严格 / fuyao 宽容两档 vendor 策略）、SSE 事件状态机、用量累计与缓存扣减，并带 12 个单测覆盖 5 个导出纯函数。官方只发布了 DeepSeek 原生路由与 pi-ai 多路由转发，没有任何直接讲 Anthropic Messages + SSE 协议的适配器——亲手写一遍才能真正理解这条接缝。错误翻译按 rc.3 的 `BuiltinLlmFailureCode` 码表：协议/格式类 → `MALFORMED_RESPONSE`，不支持的输入/响应 → `INVALID_RESPONSE`，reasoningEffort 无档位 → `MODEL_UNSUPPORTED`，HTTP 错误 → 模板字符串 `` `HTTP_${status}` ``（401/403 仍是 `AUTH`）。

## 2 最小树：九行底座 + 凭据 + 两个自写适配器

在 agent-loop 的九行底座（timer / system-prompt / tools / tool-executor-native / session / session-projection / agent / llm / agent-loop）上追加三行，共 **12 行**：

| 行 id | 包 | 说明 |
|---|---|---|
| `credentials-local` | `@deepseek-ai/dsh-credentials-local` | 凭据缝；CredentialProvider 子类，一行即服务 |
| `anthropic-compat` | `./src/plugins/anthropic-compat/index.ts` | 自写适配器；`provider/apiKeyEnv/maxTokens` 配置，环境变量可覆盖 |
| `scripted-adapter` | `./src/plugins/scripted-adapter.ts` | `disabled: true` 初始禁用，S2 用行句柄开关临时启用 |

依赖链的关键两点：

1. **适配器注入 `llm`**：`apply()` 里 `ctx.llm.registerAdapter([provider], adapter)`，内部走 `ctx.effect`——路由的注册/注销跟着服务树走，fiber dispose 自动回收。
2. **凭据是机会主义消费**：`resolveApiKey()` 先 `ctx.get('credentials')`，有服务就用 `credentials.resolve(credentialRef(ref))`（rc.3 的 CredentialRef 是品牌化字符串，用 `credentialRef(name)` 构造，不是对象；`resolve()` 返回 `{value, source} | undefined`），没有就回退 `process.env[apiKeyEnv]`。所以 `credentials-local` 这一行可拆可留，机制路径两者都不需要。凭据缺失不在启动期抛错——真正调用模型时才报 `MISSING_CREDENTIAL`，否则连纯本地读都会失败。

## 3 四个场景

### S1 路由与模型目录——发现面

`LlmAdapter` 在 rc.3 只有一个必需方法 `stream()`，其余是可覆写的发现面：`providerInfo()` / `listModels()` / `resolveModel()`。服务侧对应 `ctx.llm.listProviders()` / `listModels(provider)` / `resolveModelInfo(provider, model)`。本适配器公开一个模型（配置里的 `model`，默认 `MiniMax-M3`），`resolveModel` 返回 `{provider, id, name, defaultMaxTokens}`——**rc.3 不再有 `capabilities` 字段**，旧代码的 `as any` 形状会直接 typecheck 失败。

### S2 llm/stream waterfall——环绕每次模型调用

事件签名是 `(options, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>`。两种做法：**调 `next()` 再包一层**是观察/改写（本场景计数 chunk）；**不调 `next()` 直接返回自己的流**是拦截。

脚本化适配器不做临时编程式注册——它在 patch 清单里是一行 `disabled: true`，S2 只拨行句柄的开关，挂载与回收都交给 loader：

```ts
// patch 清单里声明的 scripted-adapter 行：按 options.id 找行句柄，
// S2 只做开关，挂载与回收都交给 loader。
async function setScripted(ctx: Context, enabled: boolean): Promise<void> {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'scripted-adapter')
  if (!entry) throw new Error('cordis.patch.yml 里没有 id=scripted-adapter 的行')
  await entry.update({ disabled: !enabled })
  await ctx.loader.await()
}
```

启用后监听器命中 1 次、经手 5 个 chunk，场景结束再禁用——`off()` 归还监听，行开关归还注册，两条缝都是可逆的。

### S3 合成 SSE 端到端——翻译层的离线验证

stub `globalThis.fetch` 返回一段手工构造的合法 Anthropic Messages SSE（message_start → text block → delta×2 → block_stop → message_delta(end_turn) → message_stop），让**真实适配器**走完整条翻译链路：请求构造（system 分离、归属头、x-api-key）→ SSE 解析（`parseSseData` 跨 chunk 拼行）→ 事件状态机 → chunk 序列。断言四件事：端点是 `/v1/messages`、文本拼接为「你好，护栏。」、finish=stop、用量 12 in / 7 out 从事件累计。这条路径证明翻译层正确性不需要任何网络与 key——S4 失败时它是第一排查现场。归属头的 user-agent 是 rc.3 的硬约定：每个 provider 请求必带，S3 专门断言它在场。

### S4 真实调用——fail loud

缺 `LLM_API_KEY` 时抛出带指引的错误（复制 `.env.example` 为 `.env`，或改跑 `npm run mechanism`），绝不降级成假成功。有 key 时走 `ctx.llm.stream({provider, model, messages, maxTokens: 8192})`，收集 text-delta / reasoning-delta / usage 并断言文本非空。8192 不是随手给的：fuyao 网关的 thinking 预算很顽固，实测 1024 仍然全部花在推理上（330 个 reasoning-delta、finish=max-tokens、零文本），给到 8192 才有正文——这是 provider 特性，两个运行时表现一致，不是适配器 bug，S4 因此固定 8192（与 defaultMaxTokens 一致）。`.env` 由 `src/env.ts` 的手写 24 行加载器读入（不依赖 dotenv 包）：显式导出的进程变量优先于文件，与常见 dotenv 语义一致。

## 4 运行模型接入示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`cordis.patch.yml` 全文（12 行清单）：

```yaml
# 模型接入层的最小树：九行 base + 凭据 + 两个自写适配器，共 12 行。
# 机制路径（S1–S3）全程离线：S2 用脚本化适配器（初始禁用，运行时开关），
# S3 用合成 SSE 喂真实适配器。
# 真实调用（S4）需要 LLM_API_KEY（本目录 .env 或进程环境）。
# 依赖链：anthropic-compat 注入 llm；凭据解析机会主义消费 credentials
#         （ctx.get('credentials')，缺服务时回退进程环境）；
#         credentials-local 是 CredentialProvider 子类，一行即服务。
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

    # ── 凭据缝：适配器的 resolveApiKey 先查这里，再回退进程环境 ─────────────
    - id: credentials-local
      name: '@deepseek-ai/dsh-credentials-local'

    # ── 自写适配器：一行装配注册 anthropic-compat 路由 ──────────────────────
    # baseURL/model/vendor 都能被环境变量覆盖（LLM_BASE_URL / LLM_MODEL / LLM_VENDOR），
    # 切网关不改装配清单。默认指向 MiniMax 官方 Anthropic 兼容端点。
    - id: anthropic-compat
      name: './src/plugins/anthropic-compat/index.ts'
      config:
        provider: anthropic-compat
        apiKeyEnv: LLM_API_KEY
        maxTokens: 8192

    # 脚本化适配器也走声明式：初始禁用，S2 用行句柄的 disabled 开关临时启用。
    - id: scripted-adapter
      name: ./src/plugins/scripted-adapter.ts
      disabled: true
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，两个适配器随装配就位：

```ts
const ctx = await boot(
  'dsh-llm-adapter-demo', CONFIG,
  loadOverlayPatches('dsh-llm-adapter-demo', PATCH),
  undefined, BASE_URL,
)
// 两个适配器由 patch 清单声明：anthropic-compat 全程在位，
// scripted-adapter 行初始禁用，S2 用行句柄开关临时启用。
// ……S1～S4 四个场景……
await ctx.fiber.dispose()
console.log('\nLLM_ADAPTER_OK')
```

机制路径在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm run mechanism       # Node：S1–S3 离线，不需要 key，末行 LLM_ADAPTER_OK
npm run mechanism:bun   # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm run mechanism` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 外逐行一致，归一化比对验证。本机带 `.env`（fuyao 网关），所以 S3 端点跟随 `LLM_BASE_URL`；无 `.env` 的默认形态是 MiniMax 端点）：

```text
runtime = node v26.12.1

=== S1 路由与模型目录 ===
已注册路由：anthropic-compat
模型目录：MiniMax-M3
resolveModelInfo：id=MiniMax-M3，defaultMaxTokens=8192

=== S2 llm/stream waterfall ===
llm/stream 命中：provider=lab-scripted model=seed
waterfall 命中 1 次，经手 5 个 chunk，文本长度=28

=== S3 合成 SSE 端到端（离线）===
线协议端点：http://fuyao-ai-gateway.xiaopeng.link/v1/messages
归属头在场：true，x-api-key 在场=true
翻译结果：text=你好，护栏。，finish=stop，usage=12 in / 7 out

=== S4 真实调用：--mechanism 跳过（机制路径不需要 key）===

LLM_ADAPTER_OK
```

机制输出留档在 [runtime-out-node.txt](runtime-out-node.txt) 与 [runtime-out-bun.txt](runtime-out-bun.txt)。三个值得注意的事实：

- **已注册路由只有 anthropic-compat**：scripted-adapter 行初始禁用，不进发现面——S2 拨开关后 `lab-scripted` 才出现，场景结束再禁用；
- **5 个 chunk / 文本长度 28**：waterfall 包的是真实流，计数与剧本完全对账；
- **12 in / 7 out**：合成 SSE 的 message_start 带 input_tokens=12、message_delta 带 output_tokens=7，翻译层从事件累计用量，不猜不补。

单测与真实调用：

```bash
npm test                # node --test：12 pass / 0 fail
npm run test:bun        # bun test：12 pass / 0 fail
#
cp .env.example .env    # 填入 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_VENDOR
npm start               # Node：S1–S4，S4 真实调用
npm run start:bun       # Bun：同上
```

S4 真实调用（fuyao 网关，`LLM_MODEL=fuyao-coding`）双运行时也都通过，但模型回答与用量**非确定**，只留档不纳入逐行对比（[runtime-out-real-node.txt](runtime-out-real-node.txt) / [runtime-out-real-bun.txt](runtime-out-real-bun.txt)）。另一处非确定：网关不保证回报输入用量——同一次实测 Node 拿到 `43 in`、Bun 拿到 `0 in`，取决于 message_start 事件里有没有 input_tokens；适配器如实翻译，不做假账（S3 合成路径则验证了「有输入用量时累计正确」）。一次实测摘录（Node）：

```text
=== S4 真实调用 ===
请求 anthropic-compat / fuyao-coding
回答：如果 dsh 指某个具体系统，请补充上下文，否则仅凭“dsh”无法确定其工具管线有几段。
推理增量块：162；用量：43 in / 1087 out

LLM_ADAPTER_OK
```

## 5 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-llm-adapter-demo/
├── package.json              # 19 依赖 + 7 scripts，版本全部 pin 死
├── tsconfig.json             # 只做类型检查，不产出 JS
├── .gitignore                # node_modules/ + .dsh-home/ + .env
├── cordis.yml                # []：根配置留空
├── cordis.patch.yml          # 12 行装配清单（第 4 节全文）
├── .env.example              # 真实调用路径的变量模板
├── runtime-out-node.txt      # 机制路径 Node 实测留档
├── runtime-out-bun.txt       # 机制路径 Bun 实测留档
├── runtime-out-real-node.txt # 真实调用 Node 留档（非确定）
├── runtime-out-real-bun.txt  # 真实调用 Bun 留档（非确定）
└── src/
    ├── index.ts              # S1–S4 四场景，200 行
    ├── env.ts                # 手写 .env 加载器，24 行
    └── plugins/
        ├── scripted-adapter.ts       # S2 的离线脚本化适配器，36 行
        └── anthropic-compat/
            ├── index.ts              # 自写适配器，607 行
            └── index.test.ts         # 12 个单测（5 个导出纯函数）
```

### package.json（完整版）

```json
{
  "name": "dsh-llm-adapter-demo",
  "private": true,
  "type": "module",
  "description": "模型接入层：自写 anthropic-compat 适配器（Anthropic Messages + SSE → chunk 协议）、llm/stream waterfall、合成 SSE 离线端到端、真实调用（需 LLM_API_KEY）。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "mechanism": "node src/index.ts --mechanism",
    "mechanism:bun": "bun src/index.ts --mechanism",
    "test": "node --test src/plugins/anthropic-compat/index.test.ts",
    "test:bun": "bun test src/plugins/anthropic-compat/index.test.ts",
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
    "@deepseek-ai/dsh-credentials": "0.2.2-rc.5",
    "@deepseek-ai/dsh-credentials-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.5",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.5",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.5",
    "@deepseek-ai/schemastery": "3.18.5"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

tsconfig.json 与 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md) 逐字相同（NodeNext + allowImportingTsExtensions，`include: ["src"]`）。

### src/env.ts（完整版）

```ts
/**
 * env.ts —— 读本目录 .env（完全独立：不依赖根工程或任何 dotenv 包）。
 *
 * 规则与常见 dotenv 一致：KEY=VALUE 逐行解析，忽略空行与 # 注释，
 * **不覆盖已存在的进程环境**（显式导出优先于文件）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadDotEnv(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const file = resolve(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}
```

### src/plugins/scripted-adapter.ts（完整版）

与 storage 示例的同名插件同一契约、同一纯文本剧本（5 个固定 chunk），只是头注释说明这里的用途是供 waterfall 环绕观察；patch 行 `disabled: true`，S2 用行句柄开关临时启用。

```ts
/**
 * scripted-adapter —— 脚本化 LlmAdapter：离线播种一条真实 turn。
 *
 * 与 dsh-session-demo 的同名插件同一契约（stream() 产出原始 StreamChunk 协议），
 * 这里只保留文本路由：每个 step 直接给最终回答，不调工具——本示例只需要
 * 一条可预测的离线流，供 llm/stream waterfall 环绕观察。
 *
 * 文件末尾的 name/inject/apply 是 cordis 插件形态：本文件在 cordis.patch.yml
 * 里声明为一行（初始禁用），S2 用行句柄的 disabled 开关临时启用/回收。
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

### src/plugins/anthropic-compat/（结构说明）

适配器本体 607 行，全文在 [index.ts](src/plugins/anthropic-compat/index.ts)，这里给结构地图：

- **Config schema**（schemastery）：`provider / baseURL / apiKeyEnv / model / models / maxTokens / anthropicVersion / vendor`，全部有默认值；apply() 里环境变量优先于 yaml（`DSH_MODEL_PROVIDER / LLM_BASE_URL / LLM_MODEL / LLM_VENDOR`），切网关不改装配清单；
- **5 个导出纯函数**（单测对象）：`parseSseData`（逐行解析 SSE data，跨 chunk 拼半行，`[DONE]` 归一，畸形 JSON 抛 `MALFORMED_RESPONSE`）、`splitSystem`（system 消息折进顶层 system）、`toAnthropicMessages`（tool 消息折叠回 tool_result block、失败结果带 is_error、thinking 签名按 vendor 档位回放）、`toAnthropicTool`（只留 name/description/input_schema）、`tokenUsage`（从总量扣缓存读写，不算负数）；
- **AnthropicCompatAdapter 类**：`stream()` 里的 SSE 事件状态机——message_start / content_block_* / message_delta / message_stop 翻译成 StreamChunk 序列，finish reason 只映射成功档位（end_turn/stop_sequence → stop，max_tokens → max-tokens，tool_use → tool-calls）；
- **apply()**：`ctx.llm.registerAdapter([provider], adapter)`；凭据解析放在**每次请求**里做，缺失时抛 `MISSING_CREDENTIAL` 并指明设哪个变量。

[index.test.ts](src/plugins/anthropic-compat/index.test.ts) 用 `node:test` 写 12 个单测覆盖上述 5 个纯函数，`npm test`（node --test）与 `npm run test:bun`（bun test）同一份文件两侧跑。

### .env.example（完整版）

```bash
# 真实调用路径（S4 / npm start）需要这些变量；机制路径（npm run mechanism）不需要。
# 复制本文件为 .env（已 gitignore），填入你自己的网关与 key。
LLM_API_KEY=
# Anthropic 兼容网关基地址（不含 /v1/messages）
LLM_BASE_URL=https://api.minimaxi.com/anthropic
# 供应商风格：minimax（回放 thinking 签名）或 fuyao（允许省略无签名 thinking）
LLM_VENDOR=minimax
LLM_MODEL=MiniMax-M3
# 可选：覆盖注册的路由名
# DSH_MODEL_PROVIDER=anthropic-compat
```

### src/index.ts（完整版）

```ts
/**
 * dsh-llm-adapter-demo —— 模型接入层这条接缝，四个场景：
 *   S1 路由与模型目录：providerInfo / listModels / resolveModel 的发现面；
 *   S2 llm/stream waterfall：环绕每次模型调用的观察/改写缝（脚本化适配器，离线）；
 *   S3 合成 SSE 端到端：stub fetch 喂真实适配器，验证 Anthropic → chunk 翻译层（离线）；
 *   S4 真实调用：需要 LLM_API_KEY（本目录 .env），缺 key 明确失败（fail loud）。
 * 关键认识：ctx.llm.stream() 是唯一入口，适配器把 provider 线协议翻译成 chunk 协议，
 * llm/stream waterfall 环绕它——换网关只改配置，不改管线。
 * 两个自写适配器都在 cordis.patch.yml 里声明；脚本化行初始禁用，S2 用开关临时启用。
 * 机制路径（--mechanism）跑 S1–S3，全程离线；Node 与 Bun 双运行时。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { loadDotEnv } from './env.ts'

loadDotEnv()

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')
const MECHANISM_ONLY = process.argv.includes('--mechanism')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-llm-adapter-demo', CONFIG,
  loadOverlayPatches('dsh-llm-adapter-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

// patch 清单里声明的 scripted-adapter 行：按 options.id 找行句柄，
// S2 只做开关，挂载与回收都交给 loader。
async function setScripted(ctx: Context, enabled: boolean): Promise<void> {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'scripted-adapter')
  if (!entry) throw new Error('cordis.patch.yml 里没有 id=scripted-adapter 的行')
  await entry.update({ disabled: !enabled })
  await ctx.loader.await()
}

const userMessage = { role: 'user' as const, content: [{ type: 'text' as const, text: '用一句中文回答：dsh 的工具管线有几段？' }] }

// ── S1：路由与模型目录——发现面 ────────────────────────────────────────────
console.log('\n=== S1 路由与模型目录 ===')
{
  const providers = ctx.llm.listProviders()
  console.log(`已注册路由：${providers.map(p => p.id).join(', ')}`)
  assert(providers.some(p => p.id === 'anthropic-compat'), '自写路由应当注册成功')

  const models = await ctx.llm.listModels('anthropic-compat')
  console.log(`模型目录：${models.map(m => m.id).join(', ')}`)
  assert(models.length > 0, '适配器应当公开模型目录')

  const info = await ctx.llm.resolveModelInfo('anthropic-compat', models[0].id)
  console.log(`resolveModelInfo：id=${info.id}，defaultMaxTokens=${info.defaultMaxTokens ?? '(未声明)'}`)
  assert(info.id === models[0].id && info.provider === 'anthropic-compat', '模型元数据形状不符')
}

// ── S2：llm/stream waterfall——环绕每次模型调用 ────────────────────────────
console.log('\n=== S2 llm/stream waterfall ===')
await setScripted(ctx, true)
{
  let seen = 0
  let chunks = 0
  // waterfall：拿 next() 的流再包一层（观察/改写）；不调 next() 直接返回自己的流则是拦截。
  const off = ctx.on('llm/stream', (options, next) => {
    seen += 1
    console.log(`llm/stream 命中：provider=${String(options.provider)} model=${String(options.model)}`)
    const upstream = next()
    return (async function* () {
      for await (const chunk of upstream) {
        chunks += 1
        yield chunk
      }
    })()
  })

  const texts: string[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'lab-scripted', model: 'seed', messages: [userMessage] })) {
    if (chunk.type === 'text-delta') texts.push(chunk.text)
  }
  off()
  console.log(`waterfall 命中 ${seen} 次，经手 ${chunks} 个 chunk，文本长度=${texts.join('').length}`)
  assert(seen === 1 && chunks === 5 && texts.join('').length > 0, 'waterfall 应当环绕真实流')
}
await setScripted(ctx, false)

// ── S3：合成 SSE 端到端——stub fetch 喂真实适配器 ──────────────────────────
console.log('\n=== S3 合成 SSE 端到端（离线）===')
{
  // 一段合法的 Anthropic Messages SSE：message_start → text block → delta×2 →
  // block_stop → message_delta(end_turn) → message_stop。
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_stub","model":"stub-model","usage":{"input_tokens":12,"output_tokens":0}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好，"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"护栏。"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n')

  const originalFetch = globalThis.fetch
  let wireUrl = ''
  let wireHeaders: Record<string, string> = {}
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    wireUrl = String(input)
    wireHeaders = (init?.headers ?? {}) as Record<string, string>
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  // 合成路径也需要一个 key 形状的值（只验证翻译层，不发真实请求）。
  const originalKey = process.env.LLM_API_KEY
  process.env.LLM_API_KEY = 'stub-key-offline'

  try {
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'anthropic-compat', model: 'stub-model', messages: [userMessage], maxTokens: 64,
    })) {
      chunks.push(chunk)
    }
    const text = chunks.filter(c => c.type === 'text-delta').map(c => (c as { text: string }).text).join('')
    const finish = chunks.find(c => c.type === 'finish') as { reason: { kind: string } } | undefined
    const usage = chunks.find(c => c.type === 'usage') as { usage: { inputTokens: number; outputTokens: number } } | undefined
    console.log(`线协议端点：${wireUrl}`)
    console.log(`归属头在场：${Object.keys(wireHeaders).some(k => k.toLowerCase() === 'user-agent')}，x-api-key 在场=${'x-api-key' in wireHeaders}`)
    console.log(`翻译结果：text=${text}，finish=${finish?.reason.kind}，usage=${usage?.usage.inputTokens} in / ${usage?.usage.outputTokens} out`)
    assert(wireUrl.endsWith('/v1/messages'), '应当请求 Anthropic Messages 端点')
    assert(text === '你好，护栏。' && finish?.reason.kind === 'stop', 'SSE → chunk 翻译不符')
    assert(usage?.usage.inputTokens === 12 && usage.usage.outputTokens === 7, '用量应当从 SSE 事件累计')
    assert(Object.keys(wireHeaders).some(k => k.toLowerCase() === 'user-agent'), '每个请求必须带归属头')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.LLM_API_KEY
    else process.env.LLM_API_KEY = originalKey
  }
}

// ── S4：真实调用——需要 key，缺 key 明确失败 ───────────────────────────────
if (MECHANISM_ONLY) {
  console.log('\n=== S4 真实调用：--mechanism 跳过（机制路径不需要 key）===')
} else {
  console.log('\n=== S4 真实调用 ===')
  const key = process.env.LLM_API_KEY
  if (key === undefined || key === '') {
    throw new Error(
      '缺少 LLM_API_KEY：S4 要发起真实的 provider 请求。复制 .env.example 为 .env 并填入 key 后重跑；' +
      '只跑机制路径请用 npm run mechanism（不需要 key）。',
    )
  }
  const provider = process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'
  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  console.log(`请求 ${provider} / ${model}`)
  const texts: string[] = []
  let reasoning = 0
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  // 旧 M03.3 用 maxTokens:200，fuyao 网关的模型会把预算花在 thinking 块上导致
  // 空回答——实测 1024 仍然全部花在推理上（finish=max-tokens，无文本），
  // 给到 8192（与适配器 defaultMaxTokens 一致）才有正文；README 如实记录。
  for await (const chunk of ctx.llm.stream({ provider, model, messages: [userMessage], maxTokens: 8192 })) {
    if (chunk.type === 'text-delta') texts.push(chunk.text)
    else if (chunk.type === 'reasoning-delta') reasoning += 1
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  const text = texts.join('')
  assert(text.length > 0, '模型没有返回任何文本（适配器或网络有问题）')
  console.log(`回答：${text.slice(0, 200)}`)
  console.log(`推理增量块：${reasoning}；用量：${usage?.inputTokens ?? '?'} in / ${usage?.outputTokens ?? '?'} out`)
}

await ctx.fiber.dispose()
console.log('\nLLM_ADAPTER_OK')
```

### 按顺序验证

```bash
npm install             # 19 依赖精确 pin
#
npm run typecheck       # tsc 0 错误
npm run mechanism       # Node：S1–S3 离线，末行 LLM_ADAPTER_OK
npm run mechanism:bun   # Bun：除首行 runtime 标识外逐行一致
#
npm test                # node --test：12 pass / 0 fail
npm run test:bun        # bun test：12 pass / 0 fail
```

机制路径不依赖任何环境变量、端口或外部服务。真实调用路径才需要 `.env`（复制 `.env.example` 填 key）；S3 的线协议端点跟随 `LLM_BASE_URL`，留档输出因此随 `.env` 形态变化。

## 6 小结

这个示例验证了四件事：

- 模型接入层的全部接缝就三件：适配器的发现面 + `stream()` 翻译、`llm/stream` waterfall 的环绕/拦截、凭据的机会主义消费——12 行装配即可跑通；
- 声明式装配也能做运行时开关：scripted-adapter 行初始禁用，行句柄的 `disabled` 开关让挂载与回收都交给 loader，场景代码不碰 `ctx.plugin()`；
- 翻译层的正确性可以完全离线验证（合成 SSE + stub fetch），真实调用失败时先跑机制路径定位是翻译层还是网关的问题；
- rc.3 迁移的三处形状变化（错误码表、resolveModel、CredentialRef）都由 typecheck 兜底，`as any` 绕不过去——这正是类型契约的价值。

兄弟示例：[dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md)（stream 的消费端：循环怎样把 chunk 变成会话事件）、[dsh-boot-demo](../07-dsh-boot-demo/README.md)（boot() + 声明式 patch 的装配方式）、[dsh-tool-pipeline-demo](../08-dsh-tool-pipeline-demo/README.md)（模型输出之后的工具管线五段）。
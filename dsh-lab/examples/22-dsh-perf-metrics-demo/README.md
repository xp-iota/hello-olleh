# 22 · dsh 的流式性能与 token 统计示例

本示例演示指标这条接缝：TTFT / TPOT / ITL / E2E 四类时延指标与 token 统计，全部站在官方标准缝上——`dsh-session-stats` 的 sessionStats 投影、`dsh-llm` 持久化的 chunk 时间戳、`dsh-token-meter` 的四个投影与 `deriveTurnTokenUsage()`。示例不挂监听器、不自己计时：时间戳与用量都是 dsh 落会话日志时就记好的事实，这里只做读取、还原与统计。

只跑真实模型调用：需要本目录 `.env` 里的 `LLM_API_KEY`，缺 key 明确失败（fail loud），绝不静默跳过。版本面 `@deepseek-ai/*` 0.2.2-rc.5、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 真实调用都跑到 `PERF_METRICS_OK`，单测两侧各 21 pass / 0 fail。指标数值来自真实流，非确定，只留档不断言具体数字；断言的是口径与守恒关系（自写折叠与官方投影逐字相等）。

配套文章：[06 代理循环与会话日志](../../../docs/hello-dsh/06-agent-loop-and-session-log.md)（§6.6 assistant-stream 两层结构）、[07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)（§7.2 LlmAdapter）、[08 执行服务](../../../docs/hello-dsh/08-execution-services.md)（§8.38 token-meter 与压缩的关系）。

## 1 指标是日志里已经记好的事实

> dsh 的指标实现分两层：采集层在落日志时打时间戳（`TimedStreamChunk`、打包记录 `{type:'text-chunks', time0, dt[], texts[]}`），统计层把全量事件流纯折叠成投影（sessionStats / tokenUsage / contextPressure / contextBreakdown）。读指标不需要在调用路径上插任何代码。

| 指标 | 官方来源 | 本示例的做法 |
|:-----|:---------|:-------------|
| TTFT（首 token 延迟） | `sessionStats.ttftMs / ttftSteps` | S1 直接读投影；S2 逐 step 还原 |
| TPOT（每输出 token 均耗时） | `sessionStats.decodeMs / decodeTokens` | S1 直除（混合口径，见下） |
| ITL（逐 token 间隔分布） | 打包记录的 `dt[]`（无聚合字段） | S2 `expandAssistantStream()` 展开后统计 |
| E2E（turn 端到端） | 无 turn 级字段 | S3 `turn/start → turn/end` 事件墙钟 |
| token 累计 / 上下文压力 / 组成 | token-meter 三个投影 | S4 读投影 + `measure()` |
| 逐 turn 精确用量 | `deriveTurnTokenUsage(events)` | S5 按 turn 切事件喂入 |

两处口径值得先说清：

- **TPOT 是混合口径**：`decodeTokens` 来自 provider 的 `outputTokens`，含 thinking token；解码墙钟覆盖整段生成。所以 TPOT 是"整段生成的平均速度"，纯正文的逐 token 体验看 ITL——ITL 只取 text-delta 的间隔，reasoning-delta 与 tool-call-delta 不算。
- **ITL 的原始数据一直在日志里**：assistant 流落账时按 `time0 + dt[]` 打包（`dsh-llm` 的 assistant-stream 聚合器），`expandAssistantStream()` 无损展开成带时间戳的 delta。相邻 text-delta 的时间差就是 ITL 样本，不需要任何运行时计时。

## 2 最小树：十一行底座 + 两个官方指标包

在 agent-loop 的九行底座（timer / system-prompt / tools / tool-executor-native / session / session-projection / agent / llm / agent-loop）上追加凭据与自写适配器两行，再加两个指标包，共 **13 行**：

| 行 id | 包 | 说明 |
|---|---|---|
| `session-stats` | `@deepseek-ai/dsh-session-stats` | 官方时延投影；注入 `sessionProjections`，注册 `sessionStats` 键 |
| `token-meter` | `@deepseek-ai/dsh-token-meter` | 官方 token 计量；一行挂四个投影 + `ctx.tokenMeter` 服务 |
| `credentials-local` | `@deepseek-ai/dsh-credentials-local` | 凭据缝，与 10 号示例同 |
| `anthropic-compat` | `./src/plugins/anthropic-compat/index.ts` | 自写适配器第三份同源副本（10 / 21 / 22） |

依赖链的关键两点：

1. **两个指标包都只注入 `sessionProjections`**：一行即服务，投影键随注册进表，`ctx.sessionProjections.snapshot(session, keys)` 一次读多个键，返回 `{values, asOfSeq}`。token-meter 对 compaction / llm-retry / image-offload 的依赖都是类型-only，不必装配它们。
2. **`deriveTurnTokenUsage` 的公开入口是 `@deepseek-ai/dsh-token-meter/client` 子路径**：根导出不含它；`./src/*.ts` 路径虽在 exports map 里，但 Node 不对 node_modules 内的 .ts 剥类型。`/client` 导出编译好的 JS，双运行时都可用。

## 3 五个场景

### S1 sessionStats 投影——官方时延口径

`sessionStats` 是全量日志的纯折叠，八个字段：`turns / steps / llmMs / toolMs / ttftMs / ttftSteps / decodeMs / decodeTokens`。TTFT 的边界是 `step/start → 首个非空 delta`（assistant/attempt 先到先记，跨重试保留）；解码是 `首 token → assistant/message`。TPOT 没有独立字段，就是 `decodeMs / decodeTokens` 直除。

### S2 step 明细与 ITL 分布——自写折叠对账官方投影

`src/metrics.ts` 的 `foldStepTimings()` 按同一口径逐 step 折叠出 TTFT / 解码 / 输出 token / ITL 分布（均值 / P50 / P99 / 最大，最近秩法分位）。ITL 用 `assistant/message` 携带的完整流（attempt 可能只是重试前的一段）。**交叉校验是运行期断言**：同一份事件流，自写折叠的 ΣTTFT / Σ解码 / Σ输出token 必须与官方投影逐字相等——口径对齐不靠嘴说，靠等式。

### S3 turn 级 E2E——事件墙钟

官方投影没有 turn 级端到端字段，`foldTurnTimings()` 取 `turn/start → turn/end` 的事件时间差（未闭合的 turn 不计）。断言 ΣE2E ≥ llmMs + toolMs：E2E 覆盖模型与工具时间，差额是循环与落日志开销。

### S4 token-meter——累计、压力、组成、测量

token-meter 注册四个投影键，本场景读三个再调一次服务方法：

- **`tokenUsage`**：会话累计四桶 `uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens`，四桶互斥（reasoning 已含在 output 里，不重复累计）。断言 output 累计与 S2 逐 step 求和一致。
- **`contextPressure`**：`pressureTokens` 是最近一次请求 provider 上报的 prompt 实测（input + cache 读写，不含输出）；`projectedTokens` 在它之上加表面变化的启发式差价，回答"下次请求多大"；`contextWindow` 来自适配器声明（本副本未声明）。
- **`contextBreakdown`**：启发式的 system / tools / messages 组成分解，只看构成不看总量——固定密度估计对 CJK 系统性偏低，所以三个数不加总当总量用。
- **`ctx.tokenMeter.measure(session)`**：沿持久尾部重放当前表面，返回 `{baseline, totalTokens, surfaceTokens, nodes}`；baseline 三档 `none / estimated / usage`，provider 上报足以锚定时才用 usage。

一个如实记录的上报事实：fuyao 网关只在 `message_delta` 里报 `output_tokens`，不报 `input_tokens`——所以四桶里 input/cache 为 0、`pressureTokens=0`。这是上报事实，不是折叠错误；10 号示例的 S4 也记录过同一现象（同一次实测 Node 拿到 43 in、Bun 拿到 0 in）。

### S5 deriveTurnTokenUsage——可证明才给数

`deriveTurnTokenUsage(events)`（token-meter 的 `src/turn-usage.ts`）把一个完整 turn 的持久 attempt 生命周期折叠成逐 attempt 精确用量：含 `reasoningTokens` 与 provider/model 路由归属。契约是 fail-loud 的：任何生命周期边界缺失、usage 不完整、计数不安全、精确总量矛盾，整体返回 `undefined`，不猜。可证明的条件（`normalizeUsage`）：`totalTokens` 在场，或 `cacheReadTokens + cacheWriteTokens` 双桶齐全。

真实流下本示例预期返回 `undefined`：anthropic-compat 副本不上报 `totalTokens`，cache 桶仅在 >0 时携带，网关又缺 input 侧——S5 如实打印这个结果。可证明路径的完整断言在 `src/metrics.test.ts`：合成一条带权威 totalTokens 与全部可选桶的 turn，断言精确数、reasoning、路由归属逐项相等；再删桶、截断 turn，断言返回空。

trajectory 渲染层还有单条消息粒度的五个 token 数（input / output / reasoning / cacheRead / cacheWrite，`packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts`），折叠渲染的对账演示见 [13 号示例](../13-dsh-trajectory-probe-demo/README.md)。

## 4 运行指标示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`cordis.patch.yml` 全文（13 行清单）：

```yaml
# 性能与 token 指标的最小树：十一行 base + 两个官方指标包，共 13 行。
# 与 dsh-llm-adapter-demo 的 base 同源，去掉脚本化适配器（本示例只跑真实模型），
# 加两行指标包，都注入 sessionProjections：
#   session-stats：全量日志折叠成 turns/steps/llmMs/toolMs/ttftMs/ttftSteps/decodeMs/decodeTokens；
#   token-meter：注册 tokenUsage/contextPressure/contextBreakdown/tokenMeasurement 四个投影，
#     并提供 ctx.tokenMeter.measure() 请求压力测量。
# 真实调用需要 LLM_API_KEY（本目录 .env 或进程环境），缺 key 明确失败（fail loud）。
# 依赖链：anthropic-compat 注入 llm；session-stats / token-meter 注入 sessionProjections；
#         凭据解析机会主义消费 credentials（缺服务时回退进程环境）。
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

    # 官方时延投影：一行即服务，注册 sessionStats 键到投影注册表。
    - id: session-stats
      name: '@deepseek-ai/dsh-session-stats'

    # 官方 token 计量：一行挂四个投影 + ctx.tokenMeter 服务。
    # 对 compaction / llm-retry / image-offload 的依赖都是类型-only，不必装配它们。
    - id: token-meter
      name: '@deepseek-ai/dsh-token-meter'

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
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，两条真实 turn 之后从会话事件流读全部指标：

```ts
const ctx = await boot(
  'dsh-perf-metrics-demo', CONFIG,
  loadOverlayPatches('dsh-perf-metrics-demo', PATCH),
  undefined, BASE_URL,
)
// ……两条真实 turn（短回答 + 约 300 字短文），await agent.whenIdle()……
const events = agent.session.snapshotEvents()
const snapshot = ctx.sessionProjections.snapshot(agent.session, [
  'sessionStats', 'tokenUsage', 'contextPressure', 'contextBreakdown',
])
// ……S1～S5 五个场景……
await handle.dispose()
await ctx.fiber.dispose()
console.log('\nPERF_METRICS_OK')
```

运行只需要四条命令（真实调用路径，先备 `.env`）：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
cp .env.example .env    # 填入 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_VENDOR
#
npm start               # Node：两条真实 turn + S1–S5，末行 PERF_METRICS_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1，fuyao 网关 `LLM_MODEL=fuyao-coding`；数值非确定，留档不纳入逐行对比）：

```text
runtime = node v26.12.1
provider = anthropic-compat，model = fuyao-coding

turn 1：短回答
turn 2：约 300 字短文（ITL 样本）

会话 perf-metrics-mwn5iz71：19 条事件

=== S1 sessionStats 投影（官方口径）===
turns=2  steps=2  llmMs=7.7s  toolMs=0ms
ttftMs=4.1s（2 个 step 有首 token，均值 2.1s）
decodeMs=3.6s  decodeTokens=748
TPOT = decodeMs / decodeTokens = 4.8ms/token（吞吐 209.6 token/s）

=== S2 step 明细与 ITL 分布 ===
  turn/step  TTFT      解码      输出token  ITL均值  P50     P99     最大    样本
  1/1        951ms     348ms     131        15ms     16ms    21ms    21ms    12
  2/1        3.2s      3.2s      617        20ms     13ms    271ms   271ms   45
交叉校验通过：ΣTTFT=4.1s、Σ解码=3.6s、Σ输出token=748 与投影一致

=== S3 turn 级 E2E ===
  turn 1：E2E=1.3s（1 步）
  turn 2：E2E=6.4s（1 步）
  ΣE2E=7.7s ≥ llmMs+toolMs=7.7s（差额是循环与落日志开销）

=== S4 token 统计（token-meter）===
会话累计：uncachedInput=0  output=748  cacheRead=0  cacheWrite=0
上下文压力：pressureTokens=0（最近一次请求的 prompt 实测）  projectedTokens=274（下次请求的锚定估计）  contextWindow=(适配器未声明)
  注意：本网关只在 message_delta 里报 output_tokens，不报 input_tokens；
  prompt 侧四桶里的 input/cache 因此为 0——这是上报事实，不是折叠错误。
组成分解（启发式，只看构成不看总量）：system=16  tools=0  messages=420
measure()：baseline=usage  totalTokens=617  surfaceTokens=436（5 个表面节点）

=== S5 deriveTurnTokenUsage（逐 attempt 精确口径）===
  turn 1：undefined——usage 缺 totalTokens 且 cache 桶不全，精确口径无法证明（fail-loud 返回空，不猜）
  turn 2：undefined——usage 缺 totalTokens 且 cache 桶不全，精确口径无法证明（fail-loud 返回空，不猜）
  说明：anthropic-compat 副本不上报 totalTokens，cache 桶仅在 >0 时携带；
  网关若两者都没给，deriveTurnTokenUsage 按契约返回空。可证明路径的完整断言见 src/metrics.test.ts。

PERF_METRICS_OK
```

双运行时留档在 [runtime-out-node.txt](runtime-out-node.txt) 与 [runtime-out-bun.txt](runtime-out-bun.txt)。Bun 1.4.4 同一次装配同样跑到 `PERF_METRICS_OK`，关键数字对照（两次独立真实调用，非确定）：

| 量 | Node 26.12.1 | Bun 1.4.4 |
|:---|:-------------|:----------|
| ttftMs / ttftSteps | 4.1s / 2 | 10.8s / 2 |
| decodeMs / decodeTokens | 3.6s / 748 | 3.4s / 624 |
| TPOT | 4.8ms/token | 5.4ms/token |
| 长 step ITL 样本 / P99 | 45 / 271ms | 42 / 68ms |
| S2 交叉校验 | 逐字相等 | 逐字相等 |
| S5 deriveTurnTokenUsage | undefined ×2 | undefined ×2 |

三个值得注意的事实：

- **交叉校验逐字相等**：自写折叠与官方投影读的是同一条事件流、同一套边界口径，ΣTTFT / Σ解码 / Σ输出token 三个等式在两个运行时都成立；
- **TTFT 的大头在 thinking**：fuyao-coding 是 reasoning 模型，首 token 前的等待包含推理段；ITL 只统计正文 delta，所以 P50 只有十几毫秒而 TTFT 以秒计——两个指标回答的是不同的体验问题；
- **input 桶为 0 与 S5 返回空都是上报事实**：网关缺 input_tokens、适配器不上报 totalTokens，投影与精确折叠都如实反映，不做假账。

单测（离线，不需要 key）：

```bash
npm test                # node --test：21 pass / 0 fail（适配器 12 + 指标 9）
npm run test:bun        # bun test：21 pass / 0 fail
```

## 5 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-perf-metrics-demo/
├── package.json              # 21 依赖 + 5 scripts，版本全部 pin 死
├── tsconfig.json             # 只做类型检查，不产出 JS
├── .gitignore                # node_modules/ + .dsh-home/ + .env
├── cordis.yml                # []：根配置留空
├── cordis.patch.yml          # 13 行装配清单（第 4 节全文）
├── .env.example              # 真实调用的变量模板
├── runtime-out-node.txt      # Node 真实调用留档（非确定）
├── runtime-out-bun.txt       # Bun 真实调用留档（非确定）
└── src/
    ├── index.ts              # S1–S5 五场景，193 行
    ├── metrics.ts            # ITL / step / turn 纯函数折叠，173 行
    ├── metrics.test.ts       # 9 个离线断言（含 deriveTurnTokenUsage 两态）
    ├── env.ts                # 手写 .env 加载器，32 行
    └── plugins/
        └── anthropic-compat/
            ├── index.ts      # 自写适配器第三份同源副本，607 行
            └── index.test.ts # 12 个单测（5 个导出纯函数）
```

### package.json（完整版）

```json
{
  "name": "dsh-perf-metrics-demo",
  "private": true,
  "type": "module",
  "description": "流式性能与 token 统计：真实模型调用下读官方 sessionStats 投影（TTFT/解码时间）与 token-meter 投影（累计用量/上下文压力/组成分解），从持久化 chunk 时间戳算 ITL 分布与 turn 级 E2E，deriveTurnTokenUsage 折叠逐 turn 精确用量。需要 LLM_API_KEY。Node 与 Bun 双运行时。",
  "engines": {
    "node": ">=22.18"
  },
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "test": "node --test src/plugins/anthropic-compat/index.test.ts src/metrics.test.ts",
    "test:bun": "bun test src/plugins/anthropic-compat/index.test.ts src/metrics.test.ts",
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
    "@deepseek-ai/dsh-session-stats": "0.2.2-rc.5",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.5",
    "@deepseek-ai/dsh-token-meter": "0.2.2-rc.5",
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
 * 值两侧的成对引号剥掉（`KEY="a b"` 与 `KEY='a b'` 等价），
 * **不覆盖已存在的进程环境**（显式导出优先于文件）。
 *
 * 与 21-dsh-chat-demo 的 loadDotEnv（src/cli/bin.ts）是同源副本，
 * 两边的解析行为必须一致（差异由根层 check:copies 守卫不了——刻意
 * 各自实现——所以这里把约定写成注释，改一边必须同步另一边）。
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
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}
```

### src/metrics.ts（完整版）

```ts
/**
 * metrics.ts —— 官方 sessionStats 投影没有覆盖的三个指标，纯函数折叠：
 *   ITL（逐 token 间隔）：expandAssistantStream() 把持久化的压缩 chunk 记录
 *     无损展开成带时间戳的 delta，取相邻 text-delta 的间隔做分布；
 *   step 级明细：每个 step 的 TTFT / 解码时间 / 输出 token / ITL，
 *     边界口径与官方投影逐字对齐（step/start → 首个非空 delta → assistant/message）；
 *   turn 级 E2E：turn/start → turn/end 的事件墙钟。
 * 全部输入都是会话事件流本身——不挂监听器、不打时间戳，时间戳是 dsh 落日志时
 * 就记好的（TimedStreamChunk），这里只做还原与统计。纯函数，可单独断言。
 */
import { assistantStreamFirstTokenTime, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** ITL 分布：相邻 text-delta 间隔的样本数与分位。 */
export interface ItlStats {
  readonly samples: number
  readonly meanMs: number
  readonly p50Ms: number
  readonly p99Ms: number
  readonly maxMs: number
}

/** 一个 step 的时延明细；null 表示该 step 没有对应事实（如无首 token）。 */
export interface StepTiming {
  readonly turn: number
  readonly step: number
  readonly ttftMs: number | null
  readonly decodeMs: number | null
  readonly outputTokens: number | null
  readonly itl: ItlStats | null
}

/** 一个 turn 的端到端墙钟与步数。 */
export interface TurnTiming {
  readonly turn: number
  readonly e2eMs: number
  readonly steps: number
}

/** 最近秩法分位数：输入必须已升序排列。 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile：空样本')
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]!
}

/**
 * 一条 assistant 流的 ITL 分布。
 *
 * 只取 text-delta（可见正文的解码间隔）：reasoning-delta 是思考块，
 * tool-call-delta 是参数 JSON，都不属于"逐 token 出正文"的体验口径。
 * 不足两个 delta 就没有间隔可言，返回 null。
 */
export function itlOfStream(stream: readonly AssistantStreamRecord[]): ItlStats | null {
  const times: number[] = []
  for (const timed of expandAssistantStream(stream)) {
    if (timed.chunk.type === 'text-delta') times.push(timed.time)
  }
  if (times.length < 2) return null
  const gaps: number[] = []
  for (let index = 1; index < times.length; index += 1) {
    gaps.push(Math.max(0, times[index]! - times[index - 1]!))
  }
  gaps.sort((a, b) => a - b)
  const meanMs = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  return {
    samples: gaps.length,
    meanMs,
    p50Ms: percentile(gaps, 50),
    p99Ms: percentile(gaps, 99),
    maxMs: gaps[gaps.length - 1]!,
  }
}

/** usage 里的输出 token 数；缺席或非法返回 null（与官方投影同一守卫）。 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 逐 step 时延明细。边界口径与 sessionStats 投影一致：
 * TTFT = step/start → 首个非空 delta（assistant/attempt 先到先记，跨重试保留）；
 * 解码 = 首 token → assistant/message；输出 token 取该消息的 usage。
 * ITL 用 assistant/message 携带的完整流（attempt 可能只是重试前的一段）。
 */
export function foldStepTimings(events: readonly SessionEvent[]): StepTiming[] {
  const out: StepTiming[] = []
  const open = new Map<string, { turn: number; step: number; startTime: number; firstTokenTime: number | null }>()
  const keyOf = (turn: number, step: number) => `${turn}:${step}`
  for (const event of events) {
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    const turn = Number(data.turn)
    const step = Number(data.step)
    switch (event.type) {
      case 'step/start':
        open.set(keyOf(turn, step), { turn, step, startTime: event.time, firstTokenTime: null })
        break
      case 'assistant/attempt': {
        const current = open.get(keyOf(turn, step))
        if (current === undefined || current.firstTokenTime !== null) break
        const stream = data.stream as readonly AssistantStreamRecord[] | undefined
        const first = stream === undefined ? undefined : assistantStreamFirstTokenTime(stream)
        if (first !== undefined) current.firstTokenTime = first
        break
      }
      case 'assistant/message': {
        const current = open.get(keyOf(turn, step))
        if (current === undefined) break
        open.delete(keyOf(turn, step))
        const stream = data.stream as readonly AssistantStreamRecord[] | undefined
        const firstToken = current.firstTokenTime
          ?? (stream === undefined ? undefined : assistantStreamFirstTokenTime(stream))
          ?? null
        const outputTokens = usageOutputTokens(data.usage)
        out.push({
          turn,
          step,
          ttftMs: firstToken === null ? null : Math.max(0, firstToken - current.startTime),
          decodeMs: firstToken === null ? null : Math.max(0, event.time - firstToken),
          outputTokens,
          itl: stream === undefined ? null : itlOfStream(stream),
        })
        break
      }
      default:
        break
    }
  }
  return out
}

/** turn 级 E2E：turn/start → turn/end 的墙钟；未闭合的 turn 不计。 */
export function foldTurnTimings(events: readonly SessionEvent[]): TurnTiming[] {
  const out: TurnTiming[] = []
  const open = new Map<number, { startTime: number; steps: number }>()
  for (const event of events) {
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    const turn = Number(data.turn)
    switch (event.type) {
      case 'turn/start':
        open.set(turn, { startTime: event.time, steps: 0 })
        break
      case 'step/start': {
        const current = open.get(turn)
        if (current !== undefined) current.steps += 1
        break
      }
      case 'turn/end': {
        const current = open.get(turn)
        if (current === undefined) break
        open.delete(turn)
        out.push({ turn, e2eMs: Math.max(0, event.time - current.startTime), steps: current.steps })
        break
      }
      default:
        break
    }
  }
  return out
}

/**
 * TPOT（每输出 token 平均耗时）= 解码墙钟 ÷ provider 报告的输出 token。
 * 注意口径：outputTokens 含 thinking token，而解码墙钟覆盖整段生成，
 * 所以这是"混合口径"的 averages；纯正文的逐 token 体验看 ITL。
 */
export function tpotMs(decodeMs: number, decodeTokens: number): number | null {
  return decodeTokens > 0 ? decodeMs / decodeTokens : null
}
```

### src/metrics.test.ts（完整版）

```ts
/**
 * metrics.test.ts —— 纯函数折叠的离线断言 + deriveTurnTokenUsage 的契约两态。
 *
 * 合成事件序列不依赖网络：时间戳与 usage 都是构造好的事实，
 * 用来钉住口径（TTFT/解码/ITL/E2E 的边界）与官方精确用量的可证明条件。
 * 真实模型下的端到端验证在 src/index.ts（npm start）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { foldStepTimings, foldTurnTimings, itlOfStream, percentile, tpotMs } from './metrics.ts'

/** 合成一条会话事件：seq/time/type/data 四件齐全。 */
function event(seq: number, time: number, type: string, data: unknown): SessionEvent {
  return { seq, time, type, data } as unknown as SessionEvent
}

/** 合成一段打包的 text-delta 流：time0 首 chunk 时间，dt 相邻间隔。 */
function textRun(time0: number, dt: readonly number[], texts: readonly string[]): AssistantStreamRecord {
  return { type: 'text-chunks', time0, index: 0, dt, texts } as AssistantStreamRecord
}

test('percentile 最近秩法：P50/P99 落在真实样本上', () => {
  assert.equal(percentile([10, 20, 30], 50), 20)
  assert.equal(percentile([10, 20, 30], 99), 30)
  assert.equal(percentile([7], 50), 7)
  assert.throws(() => percentile([], 50))
})

test('itlOfStream 从打包记录还原间隔分布', () => {
  // time0=1000，间隔 [10,20,30] → 四个 delta 在 1000/1010/1030/1060。
  const stats = itlOfStream([textRun(1000, [10, 20, 30], ['a', 'b', 'c', 'd'])])
  assert.deepEqual(stats, { samples: 3, meanMs: 20, p50Ms: 20, p99Ms: 30, maxMs: 30 })
})

test('itlOfStream 不足两个正文 delta 返回 null，reasoning 不算正文', () => {
  assert.equal(itlOfStream([textRun(1000, [], ['a'])]), null)
  const reasoning: AssistantStreamRecord = { type: 'reasoning-chunks', time0: 0, index: 0, dt: [5, 5], texts: ['想', '了', '想'] } as AssistantStreamRecord
  assert.equal(itlOfStream([reasoning]), null)
})

test('foldStepTimings 的边界口径：step/start → 首 token → assistant/message', () => {
  const events = [
    event(0, 500, 'turn/start', { turn: 1 }),
    event(1, 1000, 'step/start', { turn: 1, step: 1 }),
    // attempt 先到：首 token 1200 先记下来（跨重试保留的语义）。
    event(2, 1100, 'assistant/attempt', { turn: 1, step: 1, stream: [textRun(1200, [], ['x'])] }),
    event(3, 2000, 'assistant/message', {
      turn: 1, step: 1,
      usage: { inputTokens: 50, outputTokens: 40 },
      stream: [textRun(1200, [10, 10], ['x', 'y', 'z'])],
    }),
    event(4, 2100, 'step/end', { turn: 1, step: 1 }),
    event(5, 3000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const steps = foldStepTimings(events)
  assert.equal(steps.length, 1)
  assert.equal(steps[0]!.ttftMs, 200)
  assert.equal(steps[0]!.decodeMs, 800)
  assert.equal(steps[0]!.outputTokens, 40)
  assert.deepEqual(steps[0]!.itl, { samples: 2, meanMs: 10, p50Ms: 10, p99Ms: 10, maxMs: 10 })
})

test('foldTurnTimings 只计闭合 turn，E2E 是事件墙钟', () => {
  const events = [
    event(0, 1000, 'turn/start', { turn: 1 }),
    event(1, 1010, 'step/start', { turn: 1, step: 1 }),
    event(2, 1900, 'step/end', { turn: 1, step: 1 }),
    event(3, 3000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(4, 4000, 'turn/start', { turn: 2 }),
  ]
  const turns = foldTurnTimings(events)
  assert.deepEqual(turns, [{ turn: 1, e2eMs: 2000, steps: 1 }])
})

test('tpotMs 是解码墙钟除以输出 token，零 token 返回 null', () => {
  assert.equal(tpotMs(800, 40), 20)
  assert.equal(tpotMs(800, 0), null)
})

/** 一条可证明的完整 turn：usage 带权威 totalTokens 与全部可选桶。 */
function provableTurn(): SessionEvent[] {
  const usage = {
    inputTokens: 100, outputTokens: 20, totalTokens: 170,
    cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: 8,
  }
  return [
    event(1, 1000, 'turn/start', { turn: 1 }),
    event(2, 1010, 'step/start', { turn: 1, step: 1 }),
    event(3, 2000, 'assistant/message', {
      turn: 1, step: 1, usage,
      stream: [{ type: 'chunk', time: 2000, chunk: { type: 'usage', usage } }],
      message: { id: 'm-3', role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'anthropic-compat', model: 'MiniMax-M3' } },
    }),
    event(90, 2100, 'step/end', { turn: 1, step: 1 }),
    event(91, 3000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

test('deriveTurnTokenUsage 可证明时给精确数：含 reasoning 与路由归属', () => {
  assert.deepEqual(deriveTurnTokenUsage(provableTurn()), {
    uncachedInputTokens: 100,
    outputTokens: 20,
    totalTokens: 170,
    cacheReadTokens: 50,
    cacheWriteTokens: 0,
    reasoningTokens: 8,
    routes: [{ provider: 'anthropic-compat', model: 'MiniMax-M3' }],
  })
})

test('deriveTurnTokenUsage 缺 totalTokens 又缺 cache 桶时返回空（不猜）', () => {
  const events = provableTurn()
  const message = events[2] as unknown as { data: { usage: Record<string, number>; stream: { chunk: { usage: Record<string, number> } }[] } }
  for (const usage of [message.data.usage, message.data.stream[0]!.chunk.usage]) {
    delete usage.totalTokens
    delete usage.cacheWriteTokens
  }
  assert.equal(deriveTurnTokenUsage(events), undefined)
})

test('deriveTurnTokenUsage 未闭合的 turn 返回空', () => {
  assert.equal(deriveTurnTokenUsage(provableTurn().slice(0, -1)), undefined)
})
```

### src/index.ts（完整版）

```ts
/**
 * dsh-perf-metrics-demo —— 流式性能与 token 统计，全部站在官方标准缝上：
 *   S1 TTFT / TPOT / 时延 totals：读 sessionStats 投影（dsh-session-stats）；
 *   S2 ITL 分布与 step 明细：expandAssistantStream() 还原持久化 chunk 时间戳；
 *   S3 turn 级 E2E：turn/start → turn/end 事件墙钟；
 *   S4 token 累计 / 上下文压力 / 组成分解：token-meter 的三个投影 + measure()；
 *   S5 逐 turn 精确用量：deriveTurnTokenUsage()（可证明才给数，否则返回空）。
 * 时间戳与用量都是 dsh 落会话日志时就记好的，本示例不挂监听器、不自己计时。
 * 需要 LLM_API_KEY（本目录 .env），缺 key 明确失败（fail loud）。Node 与 Bun 双运行时。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-token-meter'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { loadDotEnv } from './env.ts'
import { foldStepTimings, foldTurnTimings, tpotMs } from './metrics.ts'

loadDotEnv()

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const key = process.env.LLM_API_KEY
if (key === undefined || key === '') {
  throw new Error(
    '缺少 LLM_API_KEY：本示例只跑真实模型调用，指标必须来自真实的流。' +
    '复制 .env.example 为 .env 并填入 key 后重跑。',
  )
}

const ctx = await boot(
  'dsh-perf-metrics-demo', CONFIG,
  loadOverlayPatches('dsh-perf-metrics-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`断言失败：${message}`)
}

/** 毫秒格式化：小于 1s 显示 ms，否则显示 s（保留一位）。 */
function ms(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}

const provider = process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'
const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
console.log(`provider = ${provider}，model = ${model}`)

// 两条真实 turn：第一条短回答（TTFT 为主），第二条长正文（ITL 样本充足）。
const sessionId = SessionId(`perf-metrics-${Date.now().toString(36)}`)
const handle = await ctx.agents.create({
  sessionId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider, model },
})
const agent = handle.agent

console.log('\nturn 1：短回答')
agent.followup(createUserMessage({
  content: [{ type: 'text', text: '用一句中文回答：流式输出为什么能改善对话体验？' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

console.log('turn 2：约 300 字短文（ITL 样本）')
agent.followup(createUserMessage({
  content: [{
    type: 'text',
    text: '用中文写一段约 300 字的短文，主题：首 token 延迟与逐 token 间隔分别影响什么体验。不要调用工具，直接回答。',
  }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

const events = agent.session.snapshotEvents()
console.log(`\n会话 ${sessionId}：${events.length} 条事件`)

// ── S1：官方时延投影 sessionStats ─────────────────────────────────────────
console.log('\n=== S1 sessionStats 投影（官方口径）===')
const snapshot = ctx.sessionProjections.snapshot(agent.session, [
  'sessionStats', 'tokenUsage', 'contextPressure', 'contextBreakdown',
])
const stats = snapshot.values.sessionStats
assert(stats !== undefined, '装配了 session-stats 就应当读到 sessionStats 键')
console.log(`turns=${stats.turns}  steps=${stats.steps}  llmMs=${ms(stats.llmMs)}  toolMs=${ms(stats.toolMs)}`)
console.log(`ttftMs=${ms(stats.ttftMs)}（${stats.ttftSteps} 个 step 有首 token，均值 ${ms(stats.ttftMs / Math.max(1, stats.ttftSteps))}）`)
console.log(`decodeMs=${ms(stats.decodeMs)}  decodeTokens=${stats.decodeTokens}`)
const tpot = tpotMs(stats.decodeMs, stats.decodeTokens)
assert(tpot !== null && tpot > 0, '真实 turn 应当有解码时间与输出 token')
console.log(`TPOT = decodeMs / decodeTokens = ${tpot.toFixed(1)}ms/token（吞吐 ${(1000 / tpot).toFixed(1)} token/s）`)
assert(stats.turns === 2 && stats.ttftSteps >= 2 && stats.ttftMs > 0, '两条 turn 都应当记到首 token')

// ── S2：step 明细与 ITL 分布（持久化 chunk 时间戳）────────────────────────
console.log('\n=== S2 step 明细与 ITL 分布 ===')
const steps = foldStepTimings(events)
assert(steps.length === stats.steps, 'step 明细数应当与投影一致')
console.log('  turn/step  TTFT      解码      输出token  ITL均值  P50     P99     最大    样本')
for (const step of steps) {
  const itl = step.itl
  console.log(
    `  ${step.turn}/${step.step}        ` +
    `${step.ttftMs === null ? '-' : ms(step.ttftMs).padEnd(9)} ` +
    `${step.decodeMs === null ? '-' : ms(step.decodeMs).padEnd(9)} ` +
    `${String(step.outputTokens ?? '-').padEnd(10)} ` +
    (itl === null
      ? '（正文 delta 不足两个，无间隔样本）'
      : `${ms(itl.meanMs).padEnd(8)} ${ms(itl.p50Ms).padEnd(7)} ${ms(itl.p99Ms).padEnd(7)} ${ms(itl.maxMs).padEnd(7)} ${itl.samples}`),
  )
}
// 交叉校验：同一份事件流，自写折叠与官方投影的 totals 必须逐字相等。
const sumTtft = steps.reduce((sum, step) => sum + (step.ttftMs ?? 0), 0)
const sumDecode = steps.reduce((sum, step) => sum + (step.decodeMs ?? 0), 0)
const sumTokens = steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0)
assert(sumTtft === stats.ttftMs && sumDecode === stats.decodeMs && sumTokens === stats.decodeTokens,
  `自写折叠与官方投影不一致：ttft ${sumTtft}/${stats.ttftMs}，decode ${sumDecode}/${stats.decodeMs}，tokens ${sumTokens}/${stats.decodeTokens}`)
console.log(`交叉校验通过：ΣTTFT=${ms(sumTtft)}、Σ解码=${ms(sumDecode)}、Σ输出token=${sumTokens} 与投影一致`)
const longStep = steps.find(step => step.itl !== null && step.itl.samples >= 10)
assert(longStep !== undefined, '长回答应当产出至少 10 个 ITL 样本')

// ── S3：turn 级 E2E ───────────────────────────────────────────────────────
console.log('\n=== S3 turn 级 E2E ===')
const turns = foldTurnTimings(events)
assert(turns.length === 2 && turns.every(turn => turn.e2eMs > 0), '两条 turn 都应当闭合且耗时为正')
for (const turn of turns) {
  console.log(`  turn ${turn.turn}：E2E=${ms(turn.e2eMs)}（${turn.steps} 步）`)
}
const e2eTotal = turns.reduce((sum, turn) => sum + turn.e2eMs, 0)
console.log(`  ΣE2E=${ms(e2eTotal)} ≥ llmMs+toolMs=${ms(stats.llmMs + stats.toolMs)}（差额是循环与落日志开销）`)
assert(e2eTotal >= stats.llmMs + stats.toolMs, 'E2E 不应小于模型与工具时间之和')

// ── S4：token-meter 投影与请求压力测量 ────────────────────────────────────
console.log('\n=== S4 token 统计（token-meter）===')
const usage = snapshot.values.tokenUsage
assert(usage !== undefined, '装配了 token-meter 就应当读到 tokenUsage 键')
console.log(`会话累计：uncachedInput=${usage.uncachedInputTokens}  output=${usage.outputTokens}  cacheRead=${usage.cacheReadTokens}  cacheWrite=${usage.cacheWriteTokens}`)
assert(usage.outputTokens === sumTokens, 'tokenUsage 的输出累计应当与逐 step 求和一致')
const pressure = snapshot.values.contextPressure
assert(pressure?.pressureTokens !== undefined, '真实调用上报过 usage 就应当有 pressureTokens 键')
console.log(`上下文压力：pressureTokens=${pressure.pressureTokens}（最近一次请求的 prompt 实测）` +
  `  projectedTokens=${pressure.projectedTokens ?? '(尚无)'}（下次请求的锚定估计）` +
  `  contextWindow=${pressure.contextWindow ?? '(适配器未声明)'}`)
if (pressure.pressureTokens === 0) {
  console.log('  注意：本网关只在 message_delta 里报 output_tokens，不报 input_tokens；')
  console.log('  prompt 侧四桶里的 input/cache 因此为 0——这是上报事实，不是折叠错误。')
}
const breakdown = snapshot.values.contextBreakdown
assert(breakdown !== undefined, '应当读到 contextBreakdown 键')
console.log(`组成分解（启发式，只看构成不看总量）：system=${breakdown.systemTokens}  tools=${breakdown.toolsTokens}  messages=${breakdown.messageTokens}`)
const measurement = ctx.tokenMeter.measure(agent.session)
console.log(`measure()：baseline=${measurement.baseline.kind}  totalTokens=${measurement.totalTokens}  surfaceTokens=${measurement.surfaceTokens}（${measurement.nodes.length} 个表面节点）`)
assert(measurement.totalTokens > 0, '跑过真实 turn 的请求压力应当为正')
if (measurement.baseline.kind !== 'usage') {
  console.log('  baseline 不是 usage：provider 上报不足以锚定（本网关缺 input 桶），退回启发式估计。')
}

// ── S5：逐 turn 精确用量（可证明才给数）───────────────────────────────────
console.log('\n=== S5 deriveTurnTokenUsage（逐 attempt 精确口径）===')
for (const turn of turns) {
  const start = events.findIndex(event => event.type === 'turn/start' && event.data.turn === turn.turn)
  const end = events.findIndex(event => event.type === 'turn/end' && event.data.turn === turn.turn)
  const turnEvents = events.slice(start, end + 1)
  const exact = deriveTurnTokenUsage(turnEvents)
  if (exact === undefined) {
    console.log(`  turn ${turn.turn}：undefined——usage 缺 totalTokens 且 cache 桶不全，精确口径无法证明（fail-loud 返回空，不猜）`)
  } else {
    console.log(`  turn ${turn.turn}：input=${exact.uncachedInputTokens}  output=${exact.outputTokens}  total=${exact.totalTokens}` +
      `  reasoning=${exact.reasoningTokens ?? '(未上报)'}  routes=${exact.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? '(未归属)'}`)
  }
}
console.log('  说明：anthropic-compat 副本不上报 totalTokens，cache 桶仅在 >0 时携带；')
console.log('  网关若两者都没给，deriveTurnTokenUsage 按契约返回空。可证明路径的完整断言见 src/metrics.test.ts。')

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nPERF_METRICS_OK')
```

### .env.example（完整版）

```bash
# 本示例只跑真实模型调用（npm start / npm run start:bun），需要这些变量。
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

### src/plugins/anthropic-compat/（结构说明）

适配器与 [10 号示例](../10-dsh-llm-adapter-demo/README.md)、[21 号示例](../21-dsh-chat-demo/README.md) 是同源副本（完全独立的代价：三份拷贝，漂移由根层 `npm run check:copies` 归一化比对守卫）。结构地图见 10 号示例第 5 节；本示例用到的是它的 SSE 事件状态机与 `tokenUsage()` 用量翻译——cache 桶仅 >0 携带、不上报 totalTokens，这正是 S5 在真实流下返回空的直接原因。maxTokens 固定 8192：fuyao 网关的 reasoning 模型小预算会全花在 thinking 上（10 号示例实测 1024 仍零正文）。

### 按顺序验证

```bash
npm install             # 21 依赖精确 pin
#
npm run typecheck       # tsc 0 错误
npm test                # node --test：21 pass / 0 fail（离线，不需要 key）
npm run test:bun        # bun test：21 pass / 0 fail
#
cp .env.example .env    # 填入 key 与网关
npm start               # Node：真实调用，末行 PERF_METRICS_OK
npm run start:bun       # Bun：同上
```

真实调用依赖 `.env` 与外网网关；指标数值非确定，断言只钉口径与守恒关系。缺 key 时入口在 boot 之前就抛出带指引的错误（文案含「缺少 LLM_API_KEY」，根层 verify 按此签名记为显式 fail-loud 条目）。

## 6 小结

这个示例验证了四件事：

- 时延与 token 指标在 dsh 里是**日志事实的折叠**，不是调用路径上的计时器：sessionStats 与 token-meter 两个官方包各一行装配，投影一次快照读四个键；
- 官方没覆盖的口径（ITL 分布、turn 级 E2E）用纯函数从同一条事件流补齐，交叉校验断言保证与官方投影逐字对齐——自写统计不引入第二套口径；
- token 统计的三个层次各司其职：tokenUsage 管会话累计，contextPressure/contextBreakdown 管"上下文多大、由什么组成"，deriveTurnTokenUsage 管"这一 turn 精确花了多少"——后者可证明才给数，缺失与冲突一律返回空；
- 上报缺失如实呈现：网关不报 input_tokens、适配器不报 totalTokens，投影与精确折叠都不做假账，可证明路径由离线测试钉住。

兄弟示例：[dsh-llm-adapter-demo](../10-dsh-llm-adapter-demo/README.md)（适配器的翻译层与真实调用）、[dsh-trajectory-probe-demo](../13-dsh-trajectory-probe-demo/README.md)（trajectory 折叠渲染与 token 对账）、[dsh-session-demo](../12-dsh-session-demo/README.md)（会话事件流本身）、[dsh-chat-demo](../21-dsh-chat-demo/README.md)（完整交互终端，info 子命令的 boot 探针）。
# dsh-llm-adapter-demo —— 模型接入层：自写适配器与 llm/stream 接缝

一个**完全独立**的可运行工程：把整个目录拷到任何位置，`npm install` 之后即可运行，
不依赖 dsh-lab 根工程、其他示例或任何共享 runtime 层。Node 与 Bun 上都能直接跑通，
无需补丁（本示例不触碰 ptc-runtime 与 subprocess runner 这两条 Bun 缝）。

两条路径分明：

- **机制路径**（`npm run mechanism` / `mechanism:bun`）：S1–S3 全程离线，不需要 key；
- **真实调用路径**（`npm start` / `start:bun`）：S4 发起真实 provider 请求，
  需要本目录 `.env` 里的 `LLM_API_KEY`，缺 key 明确失败（fail loud），绝不静默跳过。

配套文章：[07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)
（§7.2 LlmAdapter、§7.3 llm/stream waterfall、§7.7 错误模型、§7.8 API Key 的处理）。

## 1. 这个示例回答什么问题

dsh 把「模型从哪来」抽象成一条接缝：`ctx.llm.stream()` 是唯一入口，
适配器负责把某个 provider 的线协议翻译成统一的 chunk 协议，
`llm/stream` waterfall 环绕每一次调用。换网关只改配置，不改管线。

| 场景 | 问题 | 手段 | 需要 key |
|:-----|:-----|:-----|:---------|
| S1 路由与模型目录 | 适配器的发现面长什么样？ | `listProviders` / `listModels` / `resolveModelInfo` | 否 |
| S2 llm/stream waterfall | 怎样环绕/拦截每次模型调用？ | 脚本化适配器 + waterfall 监听器包流计数 | 否 |
| S3 合成 SSE 端到端 | Anthropic SSE → chunk 的翻译层对不对？ | stub `globalThis.fetch` 喂真实适配器一段合成 SSE | 否 |
| S4 真实调用 | 真网关上整条链路通不通？ | 真实请求 fuyao/MiniMax 兼容网关 | **是** |

自写适配器 `anthropic-compat`（606 行）不是玩具：它处理 system 分离、
tool_result 折叠、thinking 签名回放（minimax 严格 / fuyao 宽容两档 vendor 策略）、
SSE 事件状态机、用量累计与缓存扣减，并带 12 个单测覆盖 5 个导出纯函数。

## 2. 装配树：11 行 patch

根配置 `cordis.yml` 留空（`[]`），装配全部来自 `cordis.patch.yml`——
九行 base + 凭据缝 + 自写适配器，共 11 行：

```yaml
# 模型接入层的最小树：九行 base + 凭据 + 自写适配器，共 11 行。
# 机制路径（S1–S3）全程离线：S2 用脚本化适配器，S3 用合成 SSE 喂真实适配器。
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
```

依赖链的关键两点：

1. **适配器注入 `llm`**：`apply()` 里 `ctx.llm.registerAdapter([provider], this)`，
   返回的 release 函数在 fiber dispose 时自动调用——路由的注册/注销跟着服务树走。
2. **凭据是机会主义消费**：`resolveApiKey()` 先 `ctx.get('credentials')`，
   有服务就用 `credentials.resolve(credentialRef(ref))`（rc.3 的 CredentialRef 是
   品牌化字符串，不是对象），没有就回退 `process.env[apiKeyEnv]`。
   所以 `credentials-local` 这一行可拆可留，机制路径两者都不需要。

## 3. 实测输出（双运行时逐行一致）

机制路径在 Node v26.12.1 与 Bun 1.4.4 下各跑一遍，排除 `runtime = ` 行后
13 行输出经 `Compare-Object` 验证**逐行一致**。以下为实测全文（无 `.env` 的默认形态）：

```text
=== S1 路由与模型目录 ===
已注册路由：anthropic-compat
模型目录：MiniMax-M3
resolveModelInfo：id=MiniMax-M3，defaultMaxTokens=8192

=== S2 llm/stream waterfall ===
llm/stream 命中：provider=lab-scripted model=seed
waterfall 命中 1 次，经手 5 个 chunk，文本长度=28

=== S3 合成 SSE 端到端（离线）===
线协议端点：https://api.minimaxi.com/anthropic/v1/messages
归属头在场：true，x-api-key 在场=true
翻译结果：text=你好，护栏。，finish=stop，usage=12 in / 7 out

=== S4 真实调用：--mechanism 跳过（机制路径不需要 key）===

LLM_ADAPTER_OK
```

输出留档在 [runtime-out-node.txt](runtime-out-node.txt) 与
[runtime-out-bun.txt](runtime-out-bun.txt)。**Bun 直接跑通，无需任何补丁**。

S4 真实调用（fuyao 网关，`LLM_MODEL=fuyao-coding`）双运行时也都通过，
但模型回答与用量**非确定**，只留档不纳入逐行对比
（[runtime-out-real-node.txt](runtime-out-real-node.txt) /
[runtime-out-real-bun.txt](runtime-out-real-bun.txt)）。一次实测摘录：

```text
=== S4 真实调用 ===
请求 anthropic-compat / fuyao-coding
回答：dsh 的工具管线有 3 段。
推理增量块：479；用量：0 in / 1408 out

LLM_ADAPTER_OK
```

单测：`npm test`（node --test）与 `npm run test:bun`（bun test）各 **12 pass / 0 fail**。

## 4. 逐场景机制

### S1 路由与模型目录——发现面

`LlmAdapter` 在 rc.3 只有一个必需方法 `stream()`，其余是可覆写的发现面：
`providerInfo()` / `listModels()` / `resolveModel()`。服务侧对应
`ctx.llm.listProviders()` / `listModels(provider)` / `resolveModelInfo(provider, model)`。
本适配器公开一个模型（配置里的 `model`，默认 `MiniMax-M3`），
`resolveModel` 返回 `{provider, id, name, defaultMaxTokens}`——
**rc.3 不再有 `capabilities` 字段**，旧代码的 `as any` 形状会直接 typecheck 失败。

### S2 llm/stream waterfall——环绕每次模型调用

事件签名是 `(options, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>`。
两种做法：**调 `next()` 再包一层**是观察/改写（本场景计数 chunk）；
**不调 `next()` 直接返回自己的流**是拦截。场景里临时注册脚本化适配器
`lab-scripted`（5 个固定 chunk），监听器命中 1 次、经手 5 个 chunk，
`releaseScripted()` 与 `off()` 各自归还注册——两条缝都是可逆的。

### S3 合成 SSE 端到端——翻译层的离线验证

stub `globalThis.fetch` 返回一段手工构造的合法 Anthropic Messages SSE
（message_start → text block → delta×2 → block_stop → message_delta(end_turn) → message_stop），
让**真实适配器**走完整条翻译链路：请求构造（system 分离、归属头、x-api-key）→
SSE 解析（`parseSseData` 跨 chunk 拼行）→ 事件状态机 → chunk 序列。
断言四件事：端点是 `/v1/messages`、文本拼接为「你好，护栏。」、
finish=stop、用量 12 in / 7 out 从事件累计。这条路径证明翻译层正确性
不需要任何网络与 key——S4 失败时它是第一排查现场。

### S4 真实调用——fail loud

缺 `LLM_API_KEY` 时抛出带指引的错误（复制 `.env.example` 为 `.env`，
或改跑 `npm run mechanism`），绝不降级成假成功。有 key 时走
`ctx.llm.stream({provider, model, messages, maxTokens: 8192})`，
收集 text-delta / reasoning-delta / usage 并断言文本非空。

## 5. 坑（全部实测）

1. **rc.3 的 LlmError 码表重构了**。旧码 `PROTOCOL` / `UNSUPPORTED` / `PROVIDER` /
   `HTTP` 全部不在 `BuiltinLlmFailureCode` 里，迁移时 typecheck 一次报 11 个错。
   本工程的映射：协议/格式类 → `MALFORMED_RESPONSE`，不支持的输入/响应 →
   `INVALID_RESPONSE`，reasoningEffort 无档位 → `MODEL_UNSUPPORTED`，
   HTTP 错误 → 模板字符串 `` `HTTP_${status}` ``（401/403 仍是 `AUTH`）。
2. **`resolveModel` 形状变化**：rc.3 返回 `{provider, id, name, defaultMaxTokens}`，
   没有 `capabilities`；`listModels(provider)` 带 provider 参数。
3. **CredentialRef 是品牌化字符串**：`credentialRef(name)` 构造，
   不是旧版的 `{kind:'env', name}` 对象；`credentials.resolve()` 返回
   `{value, source} | undefined`。
4. **fuyao 网关的 thinking 预算问题比旧记录更顽固**：旧 M03.3 用 `maxTokens:200`
   空回答；本工程实测 **1024 仍然全部花在推理上**（330 个 reasoning-delta、
   finish=max-tokens、零文本），给到 **8192** 才有正文。这是 provider 特性，
   两个运行时表现一致，不是适配器 bug。S4 因此固定 8192（与 defaultMaxTokens 一致）。
5. **fuyao 网关不回报输入用量**：真实调用的 usage 是 `0 in / N out`——
   message_start 事件里没有 input_tokens。适配器如实翻译，不做假账；
   S3 合成路径则验证了「有输入用量时累计正确」。
6. **S3 的端点跟随 `LLM_BASE_URL`**：环境变量覆盖在 apply() 生效，
   所以带 `.env`（fuyao）与不带（MiniMax 默认）时 S3 打印的线协议端点不同。
   本文留档的机制输出是**无 `.env` 的默认形态**，复现时请先移走 `.env`。
7. **`.env` 加载不覆盖进程环境**：`src/env.ts` 是手写的 24 行加载器
   （不依赖 dotenv 包），显式导出的变量优先于文件——与常见 dotenv 语义一致。
8. **每个 provider 请求必带归属头**：`attributionHeaders()` 的 user-agent
   是 rc.3 的硬约定，S3 专门断言它在场。

## 6. 从零复现

目录树（`node_modules/`、`.dsh-home/`、`.env` 均已 gitignore）：

```text
dsh-llm-adapter-demo/
├── package.json              # 19 个依赖 + 7 个 scripts，版本全部 pin 死
├── cordis.yml                # []，装配全在 patch
├── cordis.patch.yml          # 11 行装配清单（见 §2）
├── tsconfig.json
├── .env.example              # 真实调用路径的变量模板
├── .gitignore
└── src/
    ├── index.ts              # S1–S4 四场景（188 行）
    ├── env.ts                # 手写 .env 加载器（24 行）
    └── plugins/
        ├── scripted-adapter.ts       # S2 的离线脚本化适配器
        └── anthropic-compat/
            ├── index.ts              # 自写适配器（606 行）
            └── index.test.ts         # 12 个单测（5 个导出纯函数）
```

版本面（与 `sources/deepseek-harness/` 快照同版）：

| 项 | 版本 |
|:---|:-----|
| `@deepseek-ai/dsh-*` | 0.2.2-rc.3（npm `next` 通道） |
| `@deepseek-ai/cordis` | 4.1.0 |
| `@deepseek-ai/cordis-plugin-timer` | 1.2.0 |
| `@deepseek-ai/schemastery` | 3.18.5 |
| typescript / @types/node | 5.9.3 / 22.10.2 |
| 实测运行时 | Node v26.12.1、Bun 1.4.4 |

命令（在本目录内）：

```bash
npm install
npm run typecheck        # tsc，0 错误
npm run mechanism        # Node：S1–S3 离线，不需要 key
npm run mechanism:bun    # Bun：同上，输出逐行一致
npm test                 # node --test：12 pass
npm run test:bun         # bun test：12 pass
cp .env.example .env     # 填入 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_VENDOR
npm start                # Node：S1–S4，S4 真实调用
npm run start:bun        # Bun：同上
```

## 7. 小结

- 模型接入层的全部接缝就三件：适配器的发现面 + `stream()` 翻译、
  `llm/stream` waterfall 的环绕/拦截、凭据的机会主义消费——11 行装配即可跑通。
- 翻译层的正确性可以完全离线验证（合成 SSE + stub fetch），
  真实调用失败时先跑机制路径定位是翻译层还是网关的问题。
- rc.3 迁移的三处形状变化（错误码表、resolveModel、CredentialRef）都由 typecheck
  兜底，`as any` 绕不过去——这正是类型契约的价值。

兄弟示例：[dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)（stream 的消费端：
循环怎样把 chunk 变成会话事件）、[dsh-boot-demo](../dsh-boot-demo/README.md)
（boot() + 声明式 patch 的装配方式）、[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)
（模型输出之后的工具管线五段）。
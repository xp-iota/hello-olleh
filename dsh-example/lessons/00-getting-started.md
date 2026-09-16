# 第 00 课 · 跑起来：环境、命令与验收契约

> **本课任务**：把 12 个示例模块里的任意一个真正跑起来，并看懂它的输出结构。
> **运行命令**：`cd dsh-example && npm install && npm run M12`
> **你将看到**：末行输出 `REAL_MODULE_OK M12 stages=5 calls=5 failed=0`。

这一课不涉及任何 DSH 概念。它只解决一件事：**让你能用真实模型跑通第一个模块，并知道"跑通了"长什么样**。
不先做完这一课，后面 12 课的输出都对不上。

---

## 1. 这套工程是什么

`dsh-example/` 用**真实发布**的 `@deepseek-ai/dsh-*` **0.1.5-rc.2** 包和真实 Cordis 运行时，
把 DeepSeek Harness 的 12 个能力方向各做成一个可运行的模块（M01–M12）。

有三件事和常见的"示例仓库"不一样，直接决定了你接下来的体验：

| 事实 | 含义 |
|---|---|
| 每个 `import` 都指向 **npm 公共 registry 上的真实包** | 不是 vendored 快照、不是内部版本；你验证的是真实发布的扩展契约 |
| **没有 mock，没有离线路径** | 每个阶段都会真的调用推理服务；缺密钥就当场失败 |
| 12 个模块共享一套服务装配（`runtime/harness.ts`） | 你只需要关心自己那一个扩展点 |

工程共 **60 个阶段** = 57 个 `scenes/` 场景脚本 + 3 个内联专项演示（M01.d / M03.d / M10.d）。

---

## 2. 前置条件

| 要求 | 为什么 |
|---|---|
| **Node >= 22.18** | 用到原生 TypeScript type stripping（直接 `node xxx.ts`）与 `Promise.withResolvers` |
| 一个可用的推理服务密钥 | 所有阶段都要真实调用模型 |

先确认 Node 版本：

```bash
node --version   # 需要 v22.18.0 或更高
```

如果默认 `node` 太老，`runtime/run-all.sh` 支持用 `DSH_NODE=/path/to/node` 指定新版本。

---

## 3. 配置密钥

配置放在工程根的 `.env`，模板是 [`.env.example`](../.env.example)：

```bash
LLM_API_KEY=
LLM_VENDOR=minimax              # 或 fuyao
LLM_BASE_URL=https://api.minimaxi.com/anthropic
LLM_MODEL=MiniMax-M3
```

[`runtime/harness.ts`](../runtime/harness.ts) 在启动时用 `process.loadEnvFile` 自动加载它：

```ts
export function loadProjectEnv(): void {
  if (envLoaded) return
  envLoaded = true
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url))
  } catch {
    /* 没有 .env：继续读进程环境变量 */
  }
}
```

**缺密钥时会立即抛错，不存在静默退化**：

```ts
export function realConfig(): RealConfig {
  if (cached) return cached
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    throw new Error([
      '真实模式缺少 LLM_API_KEY。',
      '配置来源：工程根 dsh-example/.env（模板见 .env.example，该文件已被 .gitignore 忽略）。',
      '需要三项：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（可选 LLM_VENDOR=minimax|fuyao）。',
    ].join('\n  '))
  }
  ...
}
```

也可以临时注入，不写 `.env`：

```bash
LLM_API_KEY=<your-key> npm run M12
```

---

## 4. 安装并跑第一个模块

```bash
cd dsh-example
npm install
```

先跑 **M12**——它是机制课，不依赖模型的具体回答内容，最适合用来确认环境通了：

```bash
npm run M12
```

> 为什么选 M12 而不是 M01：M01 会检查"模型是否**自主**调用了工具"，对模型行为敏感；
> M12 只观察框架机制，模型只负责 probe 复述。**先用 M12 确认链路，再用 M01 研究模型行为。**

---

## 5. 看懂输出：验收契约

模块输出分三段。以 M12 的第一段为例：

```text
████ M12 · 框架机制本体：事件语义与生命周期资源 ████        ← ① 模块 banner
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M12.1 · 对照五种事件派发模式 ────                        ← ② 阶段分隔
① emit：同步广播，立即返回，不等任何 Promise
  [观察者 A] 看到 hello
  ...
REAL_STAGE_OK M12.1 calls=1 ms=1600 in=0 out=90 finish=stop  ← ③ 阶段结论

──── M12.2 · 验证绑定 Fiber 的可处置定时器 ────
...

REAL_MODULE_OK M12 stages=5 calls=5 failed=0                 ← ③ 模块结论
```

**你只需要认准最后一行**：

```text
REAL_MODULE_OK M12 stages=5 calls=5 failed=0
```

| 字段 | 含义 |
|---|---|
| `stages=5` | 本模块跑完了 5 个阶段 |
| `calls=5` | 一共产生了 5 次真实调用证据 |
| `failed=0` | 没有失败的调用 |

全量跑 `npm run all` 的末行是：

```text
REAL_ALL_OK modules=12 stages=60 provider=anthropic-compat
```

### 阶段分两类，但都必须留下真实证据

这是本工程最重要的一条设计，值得单独说清楚：

| 类型 | 谁驱动模型 | 检查什么 |
|---|---|---|
| `mechanism` | 阶段**入口先跑一次 probe**（完整装配链 + 真实模型），再由场景跑本地机制断言 | 既证明装配链通，又验证机制 |
| `model` | 场景脚本自己发起真实请求 | 模型驱动的行为 |

`mechanism` 阶段的 probe 用的是**复述型指令**——模型没有拒答的理由，所以它只在链路真的断了时才失败。
这就是为什么纯机制阶段（如 M12.1 的派发模式对照）也要求 `calls >= 1`。

[`runtime/harness.ts`](../runtime/harness.ts) 的 `runModule()` 逐阶段校验：

```ts
if (failures.length > 0) throw new Error(`REAL_STAGE_FAIL ${stage.id} ...`)
if (slice.length === 0)  throw new Error(`REAL_STAGE_FAIL ${stage.id} 本阶段没有产生任何 推理服务调用证据`)
if (answered.length === 0) throw new Error(`REAL_STAGE_FAIL ${stage.id} 真实调用返回空文本且无工具调用`)
```

三种失败形态：**调用失败**、**没有调用证据**、**返回空文本且无工具调用**。
`run-all.sh` 还会额外比对 `REAL_STAGE_OK` 的条数与各 `run.ts` 声明的阶段数是否一致。

### 参数会脱敏

真实模式下，写进证据账本的参数先经过 `redact()`——**密钥、endpoint、绝对路径都不落日志**：

```ts
export function redact(value: string): string {
  let out = value
  const key = process.env.LLM_API_KEY
  if (key && key.length > 6) out = out.split(key).join('<redacted-key>')
  out = out.replace(/https?:\/\/[^\s"')]+/g, `<${ENDPOINT_LABEL}>`)
  out = out.replace(/\/(?:Users|home)\/[^\s"')]+/g, '<path>')
  out = out.replace(/x-api-key[^\s,}]*/gi, '<redacted-header>')
  return out
}
```

---

## 6. 全部可用命令

```bash
cd dsh-example

npm install             # 安装依赖
npm run typecheck       # 把所有 run/impl/scenes 编译到真实包自带的 .d.ts 上
npm run coverage:surfaces   # 教材覆盖门禁（要求 >= 50 个扩展面）
npm test                # 对真实 SDK 的冒烟测试与 wire 协议回归测试

npm run M01             # 跑单个模块（M01 … M12）
npm run all             # 12 个模块 60 阶段全量验收
npm run learn -- --list # 精选学习入口
npm run learn -- --tour # 路线：M01 → M02 → M03
```

只想单独跑一个场景（不跑整个模块）：

```bash
node M03-inference-service-access/scenes/wrap-chunk-stream.ts
```

### 时间成本

⚠️ **全量运行会发起 60 次以上模型请求**（每个 `mechanism` 阶段一次 probe），通常需要几十分钟。
本仓库实测 12 个模块串行跑完约 3 分钟（取决于端点速度）；慢的端点可能显著更久。

**学习时不要用 `npm run all`**。按课节单独跑对应模块即可。

---

## 7. 排障：三条最常遇到的错误

### 症状 A：`需要 Node >= 22.18`

```text
需要 Node >= 22.18，当前 v20.x.x
```

**定位**：`node --version`。
**修改**：升级 Node，或用 `DSH_NODE=/path/to/new/node npm run all` 指定。

### 症状 B：`真实模式缺少 LLM_API_KEY`

```text
真实模式缺少 LLM_API_KEY。
配置来源：工程根 dsh-example/.env（模板见 .env.example，...）
```

**定位**：`ls -a dsh-example/ | grep env` 看 `.env` 在不在。
**修改**：`cp .env.example .env` 再填密钥。注意 `.env` 必须在 **`dsh-example/` 目录下**，
不是仓库根目录——`loadProjectEnv()` 按 `import.meta.url` 解析相对路径。

### 症状 C：跑了几十分钟还没结束

**这不是错误**。全量真实验收本来就要发起 60+ 次请求。
**修改**：换单个模块跑 `npm run M12`，或只跑某个场景脚本。

---

## 8. 代码在哪

| 文件 | 作用 |
|---|---|
| [`package.json`](../package.json) | 12 个 npm script + 精确锁定的依赖版本 |
| [`.env.example`](../.env.example) | 真实 provider 配置模板 |
| [`runtime/harness.ts`](../runtime/harness.ts) | 唯一装配枢纽：`createHarness` / `loadPlugin` / `callTool` / `runTurn` |
| [`runtime/llm.ts`](../runtime/llm.ts) | `AnthropicCompatAdapter`（MiniMax / Fuyao 的 Messages + SSE） |
| [`runtime/run-all.sh`](../runtime/run-all.sh) | 全量验收脚本 |
| [`runtime/onboarding.mjs`](../runtime/onboarding.mjs) | `npm run learn` 的精选路线 |

---

## 9. 动手练习

### 练习 A：确认环境

```bash
cd dsh-example && npm run M12
```

**可验证答案**：末行是 `REAL_MODULE_OK M12 stages=5 calls=5 failed=0`。
每个 `REAL_STAGE_OK` 行都有 `calls=` 和 `finish=` 字段。

### 练习 B：观察验收契约如何失败

把 `.env` 临时改名，再跑 M12：

```bash
cd dsh-example && mv .env .env.bak && npm run M12; mv .env.bak .env
```

**可验证答案**：进程非零退出，并打印 `真实模式缺少 LLM_API_KEY` 与配置来源说明。
**它不会静默降级成 mock**——这是本工程刻意的设计。

### 练习 C：只跑一个场景

```bash
cd dsh-example && node M12-framework-mechanisms/scenes/03-observe-pending-state.ts
```

**可验证答案**：输出 `FiberState: { beforeDependency: 'PENDING', afterDependency: 'ACTIVE', afterDispose: 'DISPOSED' }`。
注意它**不打印** `REAL_STAGE_OK`——那行由 `run.ts` 的编排层负责，直接跑场景脚本没有编排层。

---

**下一课** → [第 01 课 · 工具管线](01-tool-pipeline.md)：给 Agent 加一个工具，让真实模型自己决定调用它。

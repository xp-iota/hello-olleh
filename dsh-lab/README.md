# dsh-lab

基于 **DeepSeek Harness 0.2.1-rc.2** 的独立示例工程：12 个能力模块、60 个可运行阶段、一个真正能用的交互式终端，以及 trajectory 记录与查看。

**两套运行时**（Node.js v26.12.1 / Bun 1.4.4，都取各自最新版本）跑同一份阶段清单，判据相同。Bun 有两处需要适配的地方，见[用 Bun 跑](#用-bun-跑)。

不被 `dsh-example/` 依赖，也**不复制**父工程实现——装配全部交给官方 `boot()`，本工程只写配置和教学代码。

## 这是什么

一句话：**把 dsh 的运行时可干预点逐个打开给你看，并且每个都真的能跑。**

- **12 个模块**覆盖工具管线、上下文装配、推理接入、agent 循环、会话持久化、人机交互、执行边界、委派、长任务、外部能力、数据持久化、cordis 装配树；
- **一个 CLI** 用同一个服务树提供聊天、审批、提问、斜杠命令、计划模式、trajectory；
- **0 行手工装配**：`cordis.yml`（空根表）+ `cordis.patch.yml`（约 70 行）就是全部。

## 快速开始

需要**两套运行时任一**，都取各自最新版本：

| 运行时 | 版本 | 通道 | 最低要求 | 取这个版本的原因 |
|---|---|---|---|---|
| Node.js | **v26.12.1** | Current（最新线，非 LTS） | ≥ 22.18 | 原生 TypeScript 类型剥离 + `Promise.withResolvers` |
| Bun | **1.4.4** | 最新稳定 | ≥ 1.4.4 | 1.4.4 起才补齐 `node:util.getSystemErrorMessage` |

两者都锁定在 [`runtime/runtimes.json`](runtime/runtimes.json)，连下载地址一起。`npm run runtime:status` 会把**两边**的解析结果与版本达标情况一起报出来：

```text
运行时状态（清单：runtime/runtimes.json，schema v1）：
  ✓ Node.js v26.12.1（Current 线）
        node.exe
        版本 26.12.1（与清单一致），来源 PATH
  ✓ Bun v1.4.4（最新稳定）
        bun.cmd
        版本 1.4.4（与清单一致），来源 PATH
```

任一边缺失或版本过低都会非零退出，并把原因和升级地址一并打出。也可以分别指定二进制：`DSH_NODE=<path>` / `DSH_BUN=<path>`。

```bash
cd dsh-lab
npm install
npm run runtime:status               # 两套运行时都在不在、版本对不对，两边一起报
```

下面每条都左右各一套，跑哪个都行：

| 目的 | Node.js | Bun |
|---|---|---|
| 类型检查 | `npm run typecheck` | `npm run typecheck:bun` |
| 装配树概况 | `node src/cli/bin.ts info` | `bun src/cli/bin.ts info` |
| 跑第一个模块 | `npm run M01` | `npm run M01:bun` |

配了 `bin` 之后可以直接 `npm run chat` / `npm run M01`（见 `package.json` 的 scripts）。

### 切换运行时：Node ↔ Bun

默认跑 Node；每条命令都有 `:bun` 变体，也可以用 `DSH_RUNTIME` 一次性改掉默认值。两个方向的写法完全对称：

| 用途 | Node.js（默认） | Bun |
|---|---|---|
| 交互式会话 | `npm run chat` | `npm run chat:bun` |
| 列会话 | `npm run sessions` | `npm run sessions:bun` |
| 看 trajectory | `npm run traj` | `npm run traj:bun` |
| 单个模块 | `npm run M01` … `npm run M12` | `npm run M01:bun` … `npm run M12:bun` |
| 全量 60 阶段 | `npm run all` | `npm run all:bun` |
| 单元测试 | `npm test` | `npm run test:bun` |
| 类型检查 | `npm run typecheck` | `npm run typecheck:bun` |
| 直接跑入口 | `node src/cli/bin.ts <子命令>` | `bun src/cli/bin.ts <子命令>` |
| 一次改默认 | — | `DSH_RUNTIME=bun npm run all` |

`DSH_RUNTIME` 只对**不带 `:bun` 后缀**的脚本生效，作为默认值；`:bun` 变体里显式写了 `--runtime bun`，优先级更高，环境变量盖不动它（实测确认）。想跑 Node 就用不带后缀的那条。

```bash
npm run M01:bun                      # 单个模块（Bun）
npm run M01                          # 同一个模块（Node）
DSH_RUNTIME=bun npm run all          # 全量 60 阶段（Bun）
npm run all                          # 全量 60 阶段（Node）
npm run verify                       # 两套运行时并排校验，一条命令跑两边
```

⚠️ `npm run M07 -- --runtime bun` **不行**：`--runtime` 是 npm 自己的配置项，会被截走并报 `EUNKNOWNCONFIG`。两边都用 `DSH_RUNTIME` 或 `:bun` 脚本。

#### 两处适配：Node 原生 vs Bun 补丁

这两处差异都在 dsh 依赖的边界上。Node 侧是原生行为，Bun 侧需要补丁；补丁都在 [`runtime/`](runtime/) 里，**不改 `node_modules`**。

| # | 接缝 | Node.js v26.12.1 | Bun 1.4.4 | 后果 |
|---|---|---|---|---|
| 1 | `node:module.stripTypeScriptTypes` | 原生提供 | **缺这个导出** | `ptc-runtime` 静默不激活，工具数 26 → 25 |
| 2 | 脚本路径后的第一个 `--` | 保留在 `argv` 里 | **吞掉** | M07.2 报 `subprocess runner requires target argv after a private -- delimiter` |

**第 1 处：`stripTypeScriptTypes`**

`@deepseek-ai/dsh-ptc-runtime-node` 在模块顶层 `import { stripTypeScriptTypes } from "node:module"`。Node 有，Bun 没有；Bun 对内置模块的具名导出在**链接期**解析，所以这是加载期 `SyntaxError`，`try/catch` 救不了，`boot()` 只能把该行记成导入失败。

Node 侧不需要做任何事。Bun 侧由 [`runtime/bun-preload.mjs`](runtime/bun-preload.mjs) 用插件的 `onLoad` 把那一行 import 改指到 [`runtime/lib/bun-shim.mjs`](runtime/lib/bun-shim.mjs)，后者用 `Bun.Transpiler` 实现同样的剥离。

上游对输出有**位置假设**——一次性 PTC 会取 `stripped.slice(35, len-2)`，默认前缀正好 35 字符、后缀 `\n}`。因此 shim 必须原样保留两端，不能"顺手美化"：`npm run check:shim` 就是守这条契约的（该命令只在 Bun 下有意义，Node 下会直接拒绝并说明原因）。

**第 2 处：`--` 分隔符**

`dsh-subprocess-local` 用 `process.execPath <runner.js> -- <target argv>` 起一个私有 runner 子进程，子进程要求 `argv[0] === '--'`：

```text
node x.js -- a b  →  process.argv = [execPath, 'x.js', '--', 'a', 'b']   ✅
bun  x.js -- a b  →  process.argv = [execPath, 'x.js', 'a', 'b']         ❌ 少了 --
```

Node 侧行为正确，无需处理。Bun 侧由同一个 preload 在 runner 入口把 `--` 补回索引 2，且**只在 runner 入口生效**（按文件名 + 私有环境变量双重判定），不影响普通脚本的 argv。

**为什么只有 Bun 走 `BUN_OPTIONS`**

预加载必须用 `BUN_OPTIONS` 而不是命令行 `--preload`：runner 是被再 spawn 出来的孙进程，命令行的 preload 到不了那一层，只有环境变量会继承下去。Node 侧不需要任何注入，所以 [`runtime/lib/spawn.mjs`](runtime/lib/spawn.mjs) 对 Node 是干净透传，只对 Bun 设置该变量——两边都不读外部继承来的 `NODE_OPTIONS` / `BUN_OPTIONS`，避免运行环境取决于机器上碰巧装了什么。

## 交互式终端

两套运行时都是一条命令，界面完全相同：

```bash
npm run chat                         # Node
npm run chat:bun                     # Bun
```

```text
dsh-lab · 交互式会话
  session  5cbcb16a-...
  route    anthropic-compat / MiniMax-M3
  tools    26 个

  直接输入问题；/help 看命令；Ctrl-D 退出。

› 帮我看看 dsh-lab 的目录结构
```

`tools 26 个` 这一行是两套运行时共同的判据：Bun 若没打上 `stripTypeScriptTypes` 补丁会变成 25，`npm run verify` 的 boot 项就是盯它。

REPL 提供完整人机交互：

| 能力 | 表现 |
|---|---|
| 对话 | 直接输入，流式渲染（`agent/assistant-stream`） |
| 审批 | 工具要权限时弹 y/n，结论写进日志 |
| 提问 | 模型用 `ask_user_question` 时给编号菜单 |
| 斜杠命令 | `/compact` `/feedback` `/goal` `/permission` `/plan` |
| 本地命令 | `/help` `/traj` `/sessions` `/new` `/model` `/quit` |
| 计划模式 | `/plan` 进入只读探索，`exit_plan_mode` 走审批 |
| 待办 | 模型用 `todo_write` 维护，人类可见 |

**关键设计：没有第二套循环。** REPL 只做两件事——把人的输入塞进 `agent.followup()`，把事件流画出来。turn/step 推进、工具调度、压缩、重试全部由 `dsh-agent-loop` 负责。

管道输入也能用（便于脚本化），两套运行时都支持：

```bash
printf '/help\n/sessions\n/quit\n' | node src/cli/bin.ts chat          # Node
printf '/help\n/sessions\n/quit\n' | bun src/cli/bin.ts chat           # Bun
printf '/help\n/sessions\n/quit\n' | npm run chat                      # Node（经调度器）
printf '/help\n/sessions\n/quit\n' | npm run chat:bun                  # Bun
```

## Trajectory

会话日志是唯一事实来源。`traj` 把它读成人能看的形状（两套运行时输出完全一致）：

```bash
node src/cli/bin.ts sessions                                                     # 列出所有会话（Node）
bun src/cli/bin.ts sessions                                                      # 列出所有会话（Bun）

node src/cli/bin.ts traj <sessionId>                                             # 概览 + turn 大纲 + 逐事件明细（Node）
bun src/cli/bin.ts traj <sessionId>                                              # 同上（Bun）

node src/cli/bin.ts traj <sessionId> --surface                                   # 加上模型表面折叠结果（Node）
bun src/cli/bin.ts traj <sessionId> --surface                                    # 同上（Bun）

node src/cli/bin.ts traj                                                        # 默认看最新一条（Node）
bun src/cli/bin.ts traj                                                         # 同上（Bun）

npm run traj -- <sessionId>                                                     # 经调度器（Node）
npm run traj:bun -- <sessionId>                                                 # 经调度器（Bun）
```

输出示例：

下面是真实输出（由 `node scripts/probe-trajectory.ts` 产生——Bun 下等价的 `bun scripts/probe-trajectory.ts` 结果相同；脚本在进程内注入一个脚本化适配器跑完一个 turn）：

```text
trajectory probe-mvklfjnm
  标题      我们在哪个目录？
  cwd       D:\coding\creative\hello-olleh\dsh-lab
  事件      24 条
  turn      1 个
  工具调用  1 次
  耗时      364ms
  token     2700 in / 42 out

turn 大纲
  #   seq          时间           耗时    步  工具  提示词
   1     4→23    14:33:03.325   355ms   2     1  我们在哪个目录？

事件明细
     0 14:33:03.316  权限预设 workspace-write
     1 14:33:03.320  沙箱模式 workspace-write
     2 14:33:03.320  审批策略 ask
     4 14:33:03.325  turn 1 开始
     6 14:33:03.625  step 1 开始
     8 14:33:03.629  user     我们在哪个目录？
     9 14:33:03.631  context  <system-reminder> The following workspace instructions are relevan…
    10 14:33:03.631  context  Current runtime context. This snapshot supersedes earlier runtime-con…
    11 14:33:03.632  context  <system-reminder> A skill is a reusable set of task-specific instruct…
    16 14:33:03.649  assistant → working_directory
    17 14:33:03.650  tool      working_directory {}
    18 14:33:03.658  result   D:\coding\creative\hello-olleh\dsh-lab
    19 14:33:03.658  step 1 结束
    20 14:33:03.675  step 2 开始
    21 14:33:03.680  assistant 当前工作目录已经查到了。
    22 14:33:03.680  step 2 结束
    23 14:33:03.680  turn 1 结束 (completed)
```

两个渲染细节值得注意，它们都是踩过坑才对的：

- **`user` 行只显示人说的话**。同一条 `user/message` 类型还承载运行时注入的上下文（workspace 指令、runtime context、skills 列表），这些显示为 `context`，不参与 turn 大纲的"提示词"。
- **纯 tool-call 的 assistant 消息渲染成 `→ 工具名`**。只取文本的话它是空行，看上去像模型什么都没说。

读取走官方的 `ctx.sessionQuery`（`readSession` / `readSurface` / `readTitle`），**不用**已弃用的 `snapshotEvents()`。

## 跑模块

```bash
# Node
node src/cli/bin.ts run M01              # 一个模块
node src/cli/bin.ts run M01 --stage 2    # 只跑一个阶段
node src/cli/bin.ts run all              # 全部 60 个阶段

# Bun——同一份阶段清单
bun src/cli/bin.ts run M01               # 一个模块
bun src/cli/bin.ts run M01 --stage 2     # 只跑一个阶段
bun src/cli/bin.ts run all               # 全部 60 个阶段

# 或经 npm 调度器
npm run M01            /  npm run M01:bun
npm run all            /  npm run all:bun
```

每个阶段打印 `REAL_STAGE_OK <id>`，模块全通过时打印 `REAL_MODULE_OK <id>`。失败会打印原因并以非零码退出。

**验证状态**（本机实测，两套运行时结果一致）：

```text
Node.js v26.12.1   59 / 60 个阶段通过
Bun     1.4.4      59 / 60 个阶段通过
唯一失败（两边同一处）：M03.3 真实调用模型 —— reason 见「已知问题」
```

两套运行时逐模块结果完全相同（M01–M12 全部 `REAL_MODULE_OK`），差异只在启动耗时上。

## 12 个模块

| 模块 | 主题 | 阶段 | 需要 key |
|---|---|---|---|
| [M01](M01-tool-pipeline/README.md) | 工具管线：注册、可见性、执行前后策略 | 5 | — |
| [M02](M02-context-assembly-economics/README.md) | 上下文装配与经济学 | 6 | — |
| [M03](M03-inference-service-access/README.md) | 推理服务接入（`anthropic-compat`） | 3 | 1 个阶段 |
| [M04](M04-agent-loop-intervention/README.md) | Agent 循环干预 | 5 | 2 个阶段 |
| [M05](M05-session-surface/README.md) | 会话表面与持久化 | 5 | — |
| [M06](M06-human-in-the-loop/README.md) | 人机交互 | 6 | — |
| [M07](M07-execution-backends/README.md) | 执行后端与边界 | 5 | — |
| [M08](M08-delegation-presets/README.md) | 委派与预设 | 5 | — |
| [M09](M09-long-running-work/README.md) | 长期运行的工作 | 5 | — |
| [M10](M10-external-capabilities/README.md) | 外部能力接入 | 5 | — |
| [M11](M11-config-data-durability/README.md) | 配置、数据与持久化 | 5 | — |
| [M12](M12-cordis-runtime/README.md) | Cordis 运行时与装配树 | 5 | — |

每个模块的 `README.md` 就是那一课：任务 → 真实输出 → 机制 → 排错 → 代码地图 → 练习。

## 配置

```bash
cp .env.example .env
```

| 变量 | 作用 | 默认 |
|---|---|---|
| `LLM_API_KEY` | 模型密钥 | — |
| `LLM_BASE_URL` | Anthropic 兼容端点 | `https://api.minimaxi.com/anthropic` |
| `LLM_MODEL` | 模型名 | `MiniMax-M3` |
| `LLM_VENDOR` | `minimax` / `fuyao` | `minimax` |
| `DSH_MODEL_PROVIDER` | 路由名 | `anthropic-compat` |
| `DSH_PERMISSION_MODE` | 沙箱模式 | `workspace-write` |
| `DSH_LAB_HOME` | harness home | `<项目>/.dsh-home` |
| `DSH_LAB_TEMP` | 沙箱临时根（见下） | 自动探测 |
| `DEEPSEEK_API_KEY` | 官方 DeepSeek 路由 | — |

### 为什么缺 key 会"失败"

`M03.3` 和 `M04.1/M04.2` 是 `model` 阶段。没有 key 时它们**明确失败**并说明原因，而不是假装通过：

```text
✗ M03.3 真实调用一次模型（anthropic-compat）
    缺少 LLM_API_KEY：本阶段要发起真实的 provider 请求。在 dsh-lab/.env 里配置后重跑。
```

一个"没配也能显示成功"的示例工程，等于在教错误的验证方法。

## 运行时状态

全部留在工程内，不污染用户目录：`<项目>/.dsh-home/`（会话、存储、凭据、skill）。用 `DSH_LAB_HOME` 可指向别处做对照实验。

### Windows 上的临时目录

`src/boot.ts` 的 `ensureWritableTemp()` 处理了一个真实的环境坑：沙箱跑命令前要给临时目录加 ACL，而某些机器的 `TEMP`（如 `D:\TEMP`）当前用户没有 `WRITE_DAC`，于是报

```text
sandbox-local windows-acl temp grant materialization failed and its cleanup also failed
```

做法是**真跑一次沙箱自己的授权**来探测，不可用就换到 `%LOCALAPPDATA%\Temp`。`DSH_LAB_TEMP` 可显式指定；设成 `keep` 表示"别碰 TEMP"。

## 工程结构

```text
dsh-lab/
├─ cordis.yml                 # 根表（空）
├─ cordis.patch.yml           # 装配清单（全部 ~70 行）
├─ runtime/                   # 双运行时支撑层
│  ├─ runtimes.json           # 版本锁定（Node 26.12.1 / Bun 1.4.4）
│  ├─ run.mjs                 # 统一调度器：所有 npm script 都经它
│  ├─ verify.mjs              # 两套运行时并排校验
│  ├─ status.mjs              # 解析结果与版本盘点
│  ├─ boot-probe.ts           # 启动探针（19 服务 + 工具数）
│  ├─ check-bun-shim.mjs      # Bun shim 的位置契约校验
│  ├─ bun-preload.mjs         # Bun 加载期补丁（stripTypeScriptTypes + `--`）
│  └─ lib/
│     ├─ runtimes.mjs         # 运行时解析与版本校验
│     ├─ spawn.mjs            # BUN_OPTIONS 注入、.cmd 包装处理
│     └─ bun-shim.mjs         # Bun.Transpiler 实现的 stripTypeScriptTypes
├─ src/
│  ├─ boot.ts                 # boot() 调用点 + 环境兜底
│  ├─ cli/
│  │  ├─ bin.ts               # 子命令：chat / sessions / traj / run / info
│  │  ├─ repl.ts              # 交互式会话
│  │  ├─ traj.ts              # trajectory 读取与展示
│  │  └─ term.ts              # 颜色、readline、流式渲染
│  ├─ lab/
│  │  ├─ runner.ts            # 阶段驱动器（每个阶段一个 fiber）
│  │  ├─ services.ts          # Context 类型增强集中点
│  │  └─ tools.ts             # 工具调用辅助
│  └─ llm/anthropic-compat/   # M03 的适配器插件
├─ M01-tool-pipeline/         # 每个模块：index.ts + README.md
├─ M02-.../ … M12-cordis-runtime/
└─ scripts/
   ├─ probe-boot.ts           # 启动冒烟检查（19 个服务）
   ├─ probe-trajectory.ts     # 注入脚本化适配器跑一个 turn，验证 traj 渲染
   └─ probe-repl.ts           # 同上，验证 REPL 的实时渲染三条路径
```

### 阶段隔离

`src/lab/runner.ts` 给每个阶段一个独立的插件 fiber。这不是风格问题：`ctx.on()` 注册的监听挂在 fiber 上，如果直接挂在根 ctx，M01.2 的"一律拒绝"会活到 M01.5 把整章污染掉。

### 两个探针脚本为什么存在

`probe-trajectory.ts` 和 `probe-repl.ts` 都在进程内注册一个**脚本化 `LlmAdapter`**，让真实 agent 跑完一个完整 turn，然后各自验证一条渲染路径。

它们存在的理由很具体：没有 `LLM_API_KEY` 时，所有会话都只有播种事件，于是 `traj` 的 turn 大纲/工具行/token 列，以及 REPL 的工具行与 turn 收尾行——**这些代码从未被真正执行过**。两个探针一跑，立刻暴露出三个真 bug：

| Bug | 症状 | 原因 |
|---|---|---|
| 事件负载读错位置 | 所有 `user` / `result` 行是空的 | `user/message` 的负载在 `data` 本身，只有 `tool/result` 在 `data.message` |
| `turn/end` 原因未摊平 | 显示 `[object Object]` | `reason` 是 `{kind:'completed'}` 对象，不是字符串 |
| `session/event` 签名读错 | 工具行、turn 收尾行**从不打印** | 它是 `(session, event)` 两个位置参数，不是 `agent/*` 那样的 payload 对象 |

第三个尤其值得记：它**不报错**，只是静默地什么都不显示。这类问题只有真的跑一遍才会发现。

## 验证

两条命令覆盖全部机器判据：

```bash
npm run verify                       # 两套运行时 × 3 项检查，末行 RUNTIMES_VERIFY_OK
npm run check:shim                   # Bun shim 的位置契约（只在 Bun 下有意义）
```

`verify` 在 Node 与 Bun 上各跑一遍，并排打印：

```text
运行时         版本          检查           结果
node        26.12.1     typecheck    ✓ exit 0
node        26.12.1     test         ✓ 23 pass / 0 fail
node        26.12.1     boot         ✓ services ok, tools 26
bun         1.4.4       typecheck    ✓ exit 0
bun         1.4.4       test         ✓ 23 pass / 0 fail
bun         1.4.4       boot         ✓ services ok, tools 26
RUNTIMES_VERIFY_OK runtimes=2 checks=6
```

`boot` 这项专门盯**静默降级**：Bun 缺 `stripTypeScriptTypes` 时，进程照常启动、单测也可能全绿，只是少 1 个工具。把工具数（26）和服务清单变成断言，才抓得住这类问题。反过来，如果 Node 侧哪天少了某个服务，同一项也会立刻报出来——这一项对两边是同一条判据。

逐条跑的话，左右一一对应：

| 检查 | Node.js（默认） | Bun |
|---|---|---|
| 类型检查 | `npm run typecheck` | `npm run typecheck:bun` |
| 单元测试（23 个） | `npm test` | `npm run test:bun` |
| 启动探针（19 服务 + 工具数） | `node runtime/boot-probe.ts` | `bun runtime/boot-probe.ts` |
| trajectory 渲染（真实 turn） | `node scripts/probe-trajectory.ts` | `bun scripts/probe-trajectory.ts` |
| REPL 渲染（真实 turn） | `node scripts/probe-repl.ts` | `bun scripts/probe-repl.ts` |
| 全量 60 阶段（需 key） | `npm run all` | `npm run all:bun` |
| CLI 冒烟 | `printf '/help\n/quit\n' \| npm run chat` | `printf '/help\n/quit\n' \| npm run chat:bun` |

也可以只用一条 `npm run verify` 让两套运行时都跑一遍（typecheck / test / boot 各三项）。

### 已知问题：M03.3 在部分网关上失败

`M03.3` 显式传 `maxTokens: 200`。fuyao 网关的模型先输出 `thinking` 块，200 token 会被思考吃光、`stop_reason` 变成 `max_tokens`，于是没有 `text` 块，阶段报「模型没有返回任何文本」。

这是**阶段代码里写死的预算与具体网关的输出习惯不匹配**，与运行时无关——Node 和 Bun 以完全相同的方式失败，其余 59 个阶段两边都通过（M04.1/M04.2 是真实模型阶段，两边均通过，说明链路本身正常）。

用 MiniMax 或把 `maxTokens` 调大即可通过。本工程不为此改动教学代码；`maxTokens` 出现在 [`M03-inference-service-access/index.ts`](M03-inference-service-access/index.ts)。

## 许可

示例代码，随仓库许可。

# dsh-lab —— 一文一工程的 dsh / cordis 示例集

> - <https://github.com/deepseek-ai/deepseek-harness/tags>
> - <https://github.com/cordiverse/cordis/tags>

## 三层同心结构

自内而外：**cordis**（运行时内核 + built-in 插件系）→ **dsh**（官方能力包，每个都是
cordis 插件）→ **dsh-lab**（22 个独立示例 + 自写插件）。插件分布的读法：官方包与自写件
（`anthropic-compat`、`safety-guardrail`、`word_count` 等）在 cordis 眼里没有区别，
都经各示例的装配清单挂成插件，卸载时 effect 自动回收。

![三层同心结构：cordis → dsh → dsh-lab 及其插件分布](diagrams/stack-rings.svg)

## 示例索引

目录名带分组编号：cordis 系 **01–06**、dsh 系 **07–22**，按下面两表的阅读顺序排列；
根层代跑脚本名保持不带编号（`example:<name>`）。

### Cordis 运行时（6）

| 示例 | 主题 |
|:--|:--|
| [01-cordis-seam-demo](examples/01-cordis-seam-demo/README.md) | seam：服务/事件/配置/ effect 四种接缝 |
| [02-cordis-fiber-demo](examples/02-cordis-fiber-demo/README.md) | fiber：一个插件的一生（生命周期） |
| [03-cordis-events-demo](examples/03-cordis-events-demo/README.md) | 事件：五种派发模式与中间件链 |
| [04-cordis-isolate-demo](examples/04-cordis-isolate-demo/README.md) | isolate：同名服务，两个世界 |
| [05-cordis-loader-demo](examples/05-cordis-loader-demo/README.md) | loader：配置树到 Fiber |
| [06-cordis-hmr-demo](examples/06-cordis-hmr-demo/README.md) | HMR：原位替换，Fiber 身份不变 |

### DeepSeek Harness（16）

| 示例 | 主题 |
|:--|:--|
| [07-dsh-boot-demo](examples/07-dsh-boot-demo/README.md) | boot() 声明式装配：最小树、overlay、fail-loud |
| [08-dsh-tool-pipeline-demo](examples/08-dsh-tool-pipeline-demo/README.md) | 工具管线五段：注册、可见性、执行前后策略 |
| [09-dsh-context-demo](examples/09-dsh-context-demo/README.md) | 上下文装配与经济学：section、计量、裁剪、溢写 |
| [10-dsh-llm-adapter-demo](examples/10-dsh-llm-adapter-demo/README.md) | 模型接入层：自写适配器与 llm/stream 接缝 🔑 |
| [11-dsh-agent-loop-demo](examples/11-dsh-agent-loop-demo/README.md) | Agent 循环干预：turn/step、steer、inbox、取消 |
| [12-dsh-session-demo](examples/12-dsh-session-demo/README.md) | 会话日志：append-only 事件流、JSONL、恢复 |
| [13-dsh-trajectory-probe-demo](examples/13-dsh-trajectory-probe-demo/README.md) | Trajectory 探针：事件流折叠成 turn 大纲 |
| [14-dsh-hitl-demo](examples/14-dsh-hitl-demo/README.md) | 人机协作（HITL）：审批、提问、命令、todo |
| [15-dsh-sandbox-demo](examples/15-dsh-sandbox-demo/README.md) | 执行边界：沙箱、观察策略、权限预设 |
| [16-dsh-subagent-demo](examples/16-dsh-subagent-demo/README.md) | 委派：spawn、fork、归属与深度预算 |
| [17-dsh-jobs-demo](examples/17-dsh-jobs-demo/README.md) | 长期运行：后台任务、目标、PTC、workflow |
| [18-dsh-skills-mcp-demo](examples/18-dsh-skills-mcp-demo/README.md) | 外部能力四形态：skill、工作区指令、MCP、web |
| [19-dsh-storage-demo](examples/19-dsh-storage-demo/README.md) | 结构化状态四归属：存储域、附件、凭据、引用 |
| [20-dsh-guardrail-demo](examples/20-dsh-guardrail-demo/README.md) | 自写安全护栏：从「看见」到四种决定 |
| [21-dsh-chat-demo](examples/21-dsh-chat-demo/README.md) | 完整交互式终端：chat / sessions / traj / info 🔑 |
| [22-dsh-perf-metrics-demo](examples/22-dsh-perf-metrics-demo/README.md) | 流式性能与 token 统计：TTFT / TPOT / ITL / E2E + token-meter 🔑 |

🔑 = 真实模型调用路径需要 `LLM_API_KEY`（示例目录自己的 `.env`，模板见 `.env.example`）。
缺 key 时相关路径**明确失败**（fail-loud），机制路径不受影响
（dsh-perf-metrics-demo 没有机制路径，整体需要 key）。

## 快速开始

安装器与运行器按 DSH 本体的做法：**pnpm 安装 + tsx 加载 Node 侧 .ts**（`bun` 原样跑 TS）。
pnpm 用 Corepack 或 `npm i -g pnpm` 装好即可（版本见 `packageManager` 字段）。

```powershell
pnpm run install:all                # 遍历 22 个示例逐个 pnpm install
pnpm run example:dsh-boot-demo      # 代跑任一示例的 start（Node，经 tsx）
pnpm run example:dsh-boot-demo:bun  # Bun 变体
pnpm run verify                     # 仓库级双运行时校验（见下）
```

也可以直接进入任一示例目录独立操作（这才是常态）：

```powershell
Set-Location examples/21-dsh-chat-demo
pnpm install
pnpm start         # Node --import tsx/esm；pnpm run start:bun 走 Bun
pnpm run typecheck
```

每个示例的脚本面统一：`start` / `start:bun` / `typecheck`，按需另有：

- `test` / `test:bun`：`dsh-chat-demo`（23 条）、`dsh-perf-metrics-demo`（22 条）、`dsh-llm-adapter-demo`（13 条）、`dsh-guardrail-demo`（4 条）；
- `mechanism` / `mechanism:bun`：`dsh-llm-adapter-demo` 的无 key 脚本化适配器路径；
- `info` / `sessions` / `traj`（各带 `:bun`）：`dsh-chat-demo` 的装配探针、会话列表与轨迹回看。

## 双运行时

- **Node ≥ 22.18**（实测 v26.12.1，入口经 `node --import tsx/esm` 加载 .ts）与
  **Bun ≥ 1.4.4** 全部验证等价；`start:bun` 仍是 `bun src/...`，Two 条入口互不叠加。
- 工具链口径与 DSH 本体一致：**pnpm 11.28.5**（`packageManager`，`pnpm-lock.yaml`）+
  **tsx 4.23.15**（每个 dsh 示例的 devDependency）。tsx 只接管 Node 侧的 .ts 加载，
  不做类型检查（`typecheck` 仍由 tsc 把关）；子进程不继承该 loader，仍走 Node 原生类型剥离。
- pnpm 11 的配置只认 `pnpm-workspace.yaml`：每示例一份，只放 `allowBuilds`（放行 esbuild /
  koffi / node-pty 等安装脚本）与 `minimumReleaseAge: 0`（rc 包发布当天可装），
  不声明 `packages`——22 个示例仍是 22 个独立安装域，不做依赖提升。
- Bun 与 dsh 的两条缝（`node:module.stripTypeScriptTypes` 缺失、subprocess runner
  的 `--` 分隔符被吞）由需要它们的三个示例（`dsh-chat-demo`、`dsh-jobs-demo`、
  `dsh-sandbox-demo`）**自带迷你 runtime 层**在加载期修补，
  不改 `node_modules`；根 `runtime/` 保留同一套 shim 与契约校验作为参照。
- `pnpm run runtime:status` 报告两套运行时解析到哪、版本是否达标；
  `pnpm run check:shim` 校验 Bun shim 仍满足上游 `slice(35, -2)` 位置契约。

## 仓库级校验

`pnpm run verify` 遍历 `examples/`，每个示例跑 **typecheck + start（Node + tsx）+ start:bun（Bun）**
共 66 项检查，另加 1 项仓库级静态闸（见下），末行打印：

```text
RUNTIMES_VERIFY_OK runtimes=2 checks=67
```

缺 key 时 🔑 示例的 start 按「明确失败」计入报告（△ 行，设计行为）而非静默跳过——
但 △ 豁免**以报错特征为凭**：只有输出匹配已知缺 key 报错（`缺少 LLM_API_KEY` /
`MISSING_CREDENTIAL`）才计 △；缺 key 却冒出别的报错（代码 bug、缺依赖、Bun 崩溃）
照常 ✗ 并让整轮失败。配好 `.env` 后重跑应转为真实通过。任何非 key 失败都会以
`RUNTIMES_VERIFY_FAILED` 非零退出。

另有 `pnpm run check:copies`：把「成对拷贝的文件应保持一致」变成可执行的漂移守卫——
bun-shim（根/17/21 三份）、spawn（根/21）、bun-preload（根/21）、anthropic-compat
（10/21/22，含测试）、safety-guardrail（20/21，含测试）归一化后逐行比对（17 的 preload
是五缝超集，另做包含性检查），任何副本间漂移非零退出。

`pnpm run check:deprecated` 是**「示例不得调用上游已废弃的 API」守卫**（已并入
`verify` 的首行 `repo check:deprecated`）。事实来源是各示例**已安装**的
`@deepseek-ai/*` 包 `.d.ts` 里的 `@deprecated` 标记——上游新增废弃项时守卫自动跟上，
不靠手抄名单；没装依赖时回落到与 0.2.2-rc.5 对齐的兜底清单。扫描范围是 `dsh-lab/`
全树（源码 + 示例 README），排除 `node_modules/`、`diagrams/`（archify 产物）、
`.dsh-home/`、`.cordis/`。某一**行**里写 `check-deprecated:allow` 即豁免该行；
成段列举时用 `check-deprecated:allow begin` / `check-deprecated:allow end` 包住整段。
豁免用于「故意提到废弃 API 名字」的地方（讲迁移原因时）。当前 rc.5 命中 9 个符号：

<!-- check-deprecated:allow begin -->
`Session.eventAt/snapshotEvents/ownEvents`、`sessionProjections.stateOf/cachedSnapshot`、
`cordis-plugin-timer` 的 `ctx.setTimeout/ctx.setInterval`、`agent/request` waterfall、
`sessionController.page()`。
<!-- check-deprecated:allow end -->

守卫是**两层**：静态层扫源码（上面这条）；运行时层由 `verify` 顺带做——示例实跑输出里
出现上游的废弃警告（`… is deprecated; …`）就算该行失败，用来兜住静态扫不到的**间接**
调用（插件内部、装配时装配的组件自己调了废弃路径）。示例自身不打印 "deprecated" 字样，
不会误伤。

最近一次全量实测（2026-11-19，`@deepseek-ai/*` 0.2.2-rc.5，新增 22-dsh-perf-metrics-demo 后）：
**67 项里 66 项 ✓**（0 个 △），含三个 🔑 示例中两个的真实模型调用（fuyao 网关，Node 与 Bun
均完成带正文的 turn；chat-demo 的 start 是 REPL，stdin=ignore 下读 EOF 退出）；
`check:shim` 3 例全过、`check:copies` 11 对全绿（anthropic-compat 扩为 10/21/22 三份后
由 9 对增至 11 对）。

唯一的 ✗ 是 `17-dsh-jobs-demo start:bun`：与废弃 API 无关，是**环境相关**的既有缺陷——
Bun 侧的 PTC 控制通道补丁（`runtime/lib/bun-control-channel.mjs`）扫句柄空间找 worker
继承的匿名管道，并**假定恰好 1 根**（多于一根就大声报错、不猜）。但 `runtime/run-bun.mjs`
以 `stdio: 'inherit'` 起 bun，Windows 下这会连带继承祖先链的**全部**可继承句柄；在
「PowerShell 等重定向型宿主」下，worker 会继承到 4 根管道，补丁于是抛错退出。控制台
直跑（祖先进程只有控制台句柄）则只有 1 根，能过。要修得改补丁的识别口径
（例如显式传递控制通道句柄，而不是靠"恰好一根"反推），属于独立议题。

曾经的一处**偶发**已随多轮测量改造消除：`22-dsh-perf-metrics-demo` 旧版有「长回答应当
产出至少 10 个 ITL 样本」的硬断言，依赖模型实际输出多长——某次模型把 300 字短文写短了、
text-delta 不足 10 段，该行就红。现在示例默认跑 `PERF_ROUNDS`（默认 3）轮独立会话，
ITL 样本数不设硬门槛：样本不足时分位数如实报空，跨轮汇总只统计有样本的轮，最后给
中位数与极差（TTFT / E2E 的方差在 provider 侧，单次数字不可用于运行时归因）。

## 版本面

依赖按归属分三层，而不是一条单向版本栈：**开发机环境**（仓库不携带——Node/Bun、pnpm 与
registry 出口、Node 侧的 tsx loader）、**框架依赖**（registry 上解析出的精确版本：cordis 双线 +
`@deepseek-ai/*`）、**示例依赖**（22 个示例各自的 `package.json`、`pnpm-lock.yaml` 与
`pnpm-workspace.yaml` 设置、`node_modules`、`runtime/`、`.env`）。两条流向要分开读：虚线是
**安装期**（pnpm install 逐示例解析、落盘成 22 份独立副本，没有 workspace 提升），实线是
**运行期**（`node --import tsx/esm` 执行入口 → `boot()` 装配包树 / cordis loader → 调用 Node
内置 API；`start:bun` 则是 bun 原生跑同一份 .ts）；图底那条长线是「示例跑在开发机运行时上」，
同样属于运行期，不是依赖注入。

![版本与依赖：开发机环境 → 框架依赖 → 示例依赖](diagrams/version-deps.svg)

[交互版](diagrams/version-deps.html) · [IR 源](diagrams/version-deps.architecture.json)

- **安装期**：`pnpm install` 在每个示例目录各跑一次，22 份 `node_modules` 与 `pnpm-lock.yaml`
  互不共享、不提升；版本全部来自 registry 的 next 通道并精确锁定，安装器与 DSH 本体同版
  （pnpm 11.28.5）；每个示例另带 `pnpm-workspace.yaml` 放 `allowBuilds` 与关闭发布冷却。
- **运行期**：`node --import tsx/esm` 跑 `.ts`（与 DSH 的 dev 入口同款；tsx 是每个 dsh 示例的
  devDependency，4.23.15），`start:bun` 走 `bun src/...` 原生 TS——两条入口互不叠加；tsx 不做
  类型检查，类型由 `typecheck` 的 tsc 把关，tsx 也不会传给子进程（子进程仍走 Node 原生剥类型）。
- **例外与缝**：`dsh-invariants` 停在 0.2.0-rc.2（peer 声明 cordis ~4.0.4），由
  `pnpm-workspace.yaml` 的 `peerDependencyRules.allowedVersions` 放行（替代 npm 的
  `legacy-peer-deps`）；Bun 缺 `stripTypeScriptTypes` 与子进程 `--` 两缝，由 3 个示例自带
  `runtime/` 在加载期修补。

版本口径补充：

- **cordis 示例（6 个）**：cordiverse 上游 `cordis` **4.0.0-rc.13**（与 `sources/cordis/` 快照同版），
  插件系按需：`@cordisjs/loader` 1.0.0-rc.10、`include`/`fs`/`hmr` 2.0.0-rc.0、`group` 1.0.1、
  `timer` 1.1.5、`fs-node` 0.1.0。
- **dsh 示例（16 个）**：`@deepseek-ai/*` **0.2.2-rc.5**（npm registry 的 `next` 通道，2026-11-19
  升级；`sources/deepseek-harness/` 源码快照仍为 rc.3，正文分析以快照为准，rc.4/rc.5 的增量
  未回写章节叙述——实测 rc.5 下装配树不变：19 必检服务 + 27 工具、Bun 两条缝形态不变），
  cordis 运行时为 DSH 自携 fork `@deepseek-ai/cordis` **4.1.0**（基于上游 rc.11，与上游
  rc.13 的 Fiber 语义差异见 [`docs/hello-cordis/README.md` § 五](../docs/hello-cordis/README.md)）。
- 工具链与 DSH 本体一致：**pnpm 11.28.5**（`packageManager`）+ **tsx 4.23.15**（各 dsh 示例
  devDependency）。两者都是实际使用的依赖，不再只是“邻接口径”。
- 根层**零依赖**：`runtime/` 全部是零依赖 `.mjs`；业务依赖都在各示例自己的 `package.json`。

## 目录形状

```text
dsh-lab/
├── examples/<NN-name>/     # 22 个独立示例，目录名带分组编号（README.md 即主题文章）
│   ├── package.json        # 只声明本主题用到的依赖，精确锁定；dsh 示例带 tsx devDependency
│   ├── pnpm-lock.yaml      # pnpm 的锁文件（每示例一份，不共享）
│   ├── pnpm-workspace.yaml # pnpm 11 的设置文件：allowBuilds / minimumReleaseAge，不声明 packages
│   ├── tsconfig.json       # noEmit 类型检查
│   ├── cordis.yml          # 需要 YAML 装配的示例：空根表
│   ├── cordis.patch.yml    # 需要 YAML 装配的示例：声明式装配清单
│   ├── src/                # 示例源码（含自写插件与测试）
│   ├── diagrams/           # cordis 系 6 示例：archify SVG/HTML/IR
│   ├── runtime/            # 仅 chat/jobs/sandbox 三示例：Bun 修补迷你调度层
│   ├── .env.example        # 仅三个 🔑 示例：变量模板（.env 已 gitignore）
│   └── .dsh-home/          # dsh 系运行时自管 home（已 gitignore）
├── runtime/                # 根层运行时工具：run/status/verify/install-all/check-bun-shim/check-copies + lib（runtimes/spawn/examples/bun-shim）
└── package.json            # packageManager: pnpm@11.28.5 + example:<name>[:bun] 代跑脚本 + verify 等仓库级命令
```
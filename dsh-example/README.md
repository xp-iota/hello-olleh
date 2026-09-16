# DeepSeek Harness 示例工程 · 12 课自学课程

用**真实发布**的 `@deepseek-ai/dsh-*` **0.1.5-rc.2** 与真实 Cordis 运行时，把 DSH 的 12 个能力方向
各做成一个可运行模块（M01–M12），共 **60 个阶段**。每个 `import` 都指向 npm 公共 registry 上的真实包，
每个阶段都打真实推理服务 —— **没有 mock、没有离线路径**，缺 `LLM_API_KEY` 当场失败。

这套工程配了 **13 课自学课程**：`lessons/00` 教你跑通环境，`lessons/01`–`lessons/12` 每个模块一课。
每课都包含**真实运行输出**、**机制原理**、**常见排障**和**动手练习**，可以脱离讲师自学。

```sh
npm install -g @deepseek-ai/dsh
npx @deepseek-ai/dsh web
```

![12 个方向模块的拓扑](../docs/hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../docs/hello-dsh/diagrams/12-example-topology.html) · IR：[12-example-topology.architecture.json](../docs/hello-dsh/diagrams/12-example-topology.architecture.json) · 结构测量：[OKF graphify reference](../docs/okf/references/01-graphify-dsh-example.md)

- 图谱包含 584 个节点、744 条边、45 个社区，其中 739 条边为 `EXTRACTED`，5 条为 `INFERRED`。
- 60 个阶段 = 57 个 `scenes/` 场景脚本 + 3 个内联专项演示（M01.d / M03.d / M10.d）。
- `createHarness` 是全工程唯一装配枢纽（图谱中度数 66 = 入 62 + 出 4）。

---

## 从哪开始

**第一次来**：按顺序读 [`lessons/00-getting-started.md`](lessons/00-getting-started.md)，
跑通 M12，再回到这份 README 挑路线。

**想建立直觉**（约 15 分钟，3 个模块）：

```bash
cd dsh-example && npm install
npm run learn -- --tour      # M01 工具管线 → M02 上下文装配 → M03 推理服务
```

**想按目标挑**：

| 我现在想做什么 | 学哪几课 | 直接运行 |
|---|---|---|
| 给模型加工具，并控制它的披露与权限 | [01](lessons/01-tool-pipeline.md) | `npm run M01` |
| 管住上下文预算，理解压缩与溢出 | [02](lessons/02-context-assembly.md) | `npm run M02` |
| 换自己的模型 / 看流式协议 | [03](lessons/03-inference-service-access.md) | `npm run M03` |
| 看懂一次 Agent turn，并在边界上干预 | [04](lessons/04-agent-loop-intervention.md) | `npm run M04` |
| 分清"发生过的事"与"模型看见的事" | [05](lessons/05-session-surface.md) | `npm run M05` |
| 让危险操作先问人 | [06](lessons/06-human-in-the-loop.md) | `npm run M06` |
| 接自己的文件系统 / Shell / 沙箱 | [07](lessons/07-execution-backends.md) | `npm run M07` |
| 让模型把任务委派给子代理 | [08](lessons/08-delegation-presets.md) | `npm run M08` |
| 做长任务、后台作业与目标状态机 | [09](lessons/09-long-running-orchestration.md) | `npm run M09` |
| 不写 TypeScript，用 SKILL.md 注入知识 | [10](lessons/10-external-capabilities.md) | `npm run M10` |
| 管配置、存储、附件与凭证 | [11](lessons/11-config-data-infrastructure.md) | `npm run M11` |
| 理解 Cordis 派发语义与 Fiber 生命周期 | [12](lessons/12-framework-mechanisms.md) | `npm run M12` |

---

## 13 课清单

每课的结构一致：**本课任务 → 真实输出 → 机制原理 → 排障 → 代码在哪 → 动手练习**。

| 课 | 模块 | 一句话任务 | 命令 | 阶段数 |
|---|---|---|---|---|
| [00 跑起来](lessons/00-getting-started.md) | — | 跑通环境，看懂验收契约 | `npm run M12` | — |
| [01 工具管线](lessons/01-tool-pipeline.md) | M01 | 三个正交控制面：加工具，并控制披露与权限 | `npm run M01` | 6 |
| [02 上下文装配](lessons/02-context-assembly.md) | M02 | 让上下文不再是一根越来越长的字符串 | `npm run M02` | 6 |
| [03 推理服务接入](lessons/03-inference-service-access.md) | M03 | Provider 路由与流协议：换模型，消费循环不改 | `npm run M03` | 2 |
| [04 循环干预](lessons/04-agent-loop-intervention.md) | M04 | 先观察，再引导：不复制主循环也能干预 | `npm run M04` | 5 |
| [05 会话面](lessons/05-session-surface.md) | M05 | 日志是事实，surface 是投影 | `npm run M05` | 5 |
| [06 人在环路](lessons/06-human-in-the-loop.md) | M06 | 六种人机协议；没人应答就必须拒绝 | `npm run M06` | 6 |
| [07 执行侧后端](lessons/07-execution-backends.md) | M07 | I/O、进程与沙箱边界：工具只提意图 | `npm run M07` | 5 |
| [08 委派与预设](lessons/08-delegation-presets.md) | M08 | 注册了 provider，模型却还不会委派 | `npm run M08` | 4 |
| [09 长任务与编排](lessons/09-long-running-orchestration.md) | M09 | 运行句柄 vs 目标状态机 | `npm run M09` | 4 |
| [10 外部能力接入](lessons/10-external-capabilities.md) | M10 | 数据优先，协议其次：对照注入前后的真实作答 | `npm run M10` | 6 |
| [11 配置与数据设施](lessons/11-config-data-infrastructure.md) | M11 | 分层解析、内容寻址与不读秘密 | `npm run M11` | 6 |
| [12 框架机制本体](lessons/12-framework-mechanisms.md) | M12 | 派发语义与生命周期：副作用随插件回收 | `npm run M12` | 5 |

---

## 环境与配置

要求 **Node >= 22.18**（原生 TypeScript type stripping + `Promise.withResolvers`）；DSH 精确锁定
`0.1.5-rc.2`。配置放工程根 `.env`（模板 [`.env.example`](.env.example)，[`runtime/harness.ts`](runtime/harness.ts)
用 `process.loadEnvFile` 自动加载）：

```bash
LLM_API_KEY=
LLM_VENDOR=minimax              # 或 fuyao
LLM_BASE_URL=https://api.minimaxi.com/anthropic
LLM_MODEL=MiniMax-M3
```

```bash
cd dsh-example
npm install
npm run typecheck            # 编译到真实包自带的 .d.ts 上
npm run coverage:surfaces    # 教材覆盖门禁（要求 >= 50 个扩展面）
npm test                     # 对真实 SDK 的冒烟测试与 wire 协议回归
npm run MXX                  # 跑单个模块
npm run all                  # 12 个模块 60 阶段全量验收
npm run learn -- --list      # 精选入口
```

`runtime/run-all.sh` 支持 `DSH_NODE=/path/to/node` 覆盖 Node 可执行文件。

---

## 验收契约：每个阶段都要留下真实证据

`npm run all` 看的是日志尾部的结论行，不是退出码：

```text
REAL_STAGE_OK M01.1 calls=1 ms=3820 in=12 out=9 finish=stop
REAL_MODULE_OK M01 stages=6 calls=7 failed=0
REAL_ALL_OK modules=12 stages=60 provider=anthropic-compat
```

阶段分两类，口径不同但同样必须留下真实调用证据：

| 类型 | 谁驱动模型 |
|---|---|
| `mechanism` | 阶段入口先跑一次**装配链 probe**（真实模型 + 完整 agent-loop），再由场景跑本地机制断言 |
| `model` | 场景脚本自己用 `runTurn()` / `ctx.llm.stream()` 发起真实请求 |

三种失败形态：**调用失败**、**没有调用证据**、**返回空文本且无工具调用**。任一阶段失败即非零退出。
`run-all.sh` 还比对 `REAL_STAGE_OK` 条数与各 `run.ts` 声明的阶段数是否一致。

参数写进证据账本前先经 `redact()` 脱敏 —— **密钥、endpoint、绝对路径都不落日志**。

⏱️ 全量运行会发起 **60 次以上**模型请求，通常要几十分钟。**自学时不要用 `npm run all`**，
按课节单独跑对应模块即可。

---

## 工程结构

每个模块只有三层，`lessons/` 每课对应一个模块：

```text
dsh-example/
  README.md            ← 本页（课程首页）
  lessons/             ← 13 课自学教材（00 环境 + 01–12 模块）
  package.json         12 个 npm script + 精确锁定的依赖
  .env.example         真实 provider 配置模板
  cordis.yml           把各示例插件组合进一个 agent 的示范配置
  runtime/
    harness.ts         唯一装配枢纽：createHarness / loadPlugin / callTool / runTurn
    llm.ts             AnthropicCompatAdapter（MiniMax / Fuyao 的 Messages + SSE）
    run-all.sh         全量验收：比对 REAL_STAGE_OK 条数与模块数
    onboarding.mjs     npm run learn 的精选路线与交互选择器
  MXX-name/
    README.md          模块速查（观察点、边界）
    run.ts             唯一入口：阶段清单
    impl/*.ts          一种能力一个实现（Provider 侧）
    scenes/*.ts        可运行的观察脚本（Consumer 侧）
    support/assets     共享 helper 或数据资产（按需）
```

调用顺序：

```text
npm script → run.ts → runModule() → executeStage()
→ path 阶段动态导入 scenes/ 脚本，或 run 阶段调用 run.ts 内联函数
→ createHarness() → loadPlugin(impl) → callTool() / runTurn() / ctx.*
```

---

## 四条扩展路径：新行为该放哪

这四类来自 DSH 官方"新行为放哪"的定位方式，**不是按目录互斥分组**；一个模块可以同时走多条路径。

| 路径 | 什么时候用 | 接入方式 |
|---|---|---|
| **按注册** | 向已有 registry 增加工具、命令、任务、preset 或配置项 | 调用 `register()`，并把 disposer 交给 Cordis effect 回收 |
| **按事件** | 在请求、step、turn、工具、会话或文件行为发生时观测/拦截 | 使用 `ctx.on`、`ctx.before` 或 waterfall；不 fork 主循环 |
| **按服务** | 增加或替换一条能力 seam | Definition、Provider、Consumer 三角色完整；Provider 与 Consumer 只依赖 Definition |
| **按数据** | 给模型增加可发现、可渲染的能力说明 | `SKILL.md` 作为数据资产被发现/注册/渲染/注入，内容变化不改主循环 |

实操顺序：**先判断只是内容还是机制 → 机制扩展再判断已有 registry/event 是否足够 → 只有需要可替换
后端时才新建 service seam，并同时设计 Definition、Provider、Consumer。**

"按服务"的形状不是调什么注册函数，而是**继承抽象 cordis Service**：`static inject` / `static Config`
声明依赖与配置，`constructor(ctx, config)` 里先 `super(ctx)` —— 这一步就把自己挂到了 `ctx.<name>`，
并且是 effect-based —— 最后 `export default`。第 02 课的 compaction 与第 07 课的 sandbox 是同一种形状。

---

## 横切：harness 装配了什么

[`runtime/harness.ts`](runtime/harness.ts) 替代真实产品里 **bundle / profile** 的角色，把 core 服务与
本地 seam 后端按依赖顺序装进一个 cordis `Context`：

```text
cordis-plugin-timer  → ctx.timer / timeout / interval / throttle / debounce
dsh-settings         → ctx.settings        （本文件给一个内存 provider 子类）
dsh-session          → ctx.sessions
dsh-system-prompt    → ctx.systemPrompt
dsh-llm              → ctx.llm
dsh-user-approval    → ctx.approval
dsh-tools            → ctx.tools
dsh-commands         → ctx.commands
dsh-skill            → ctx.skills
dsh-subagent         → ctx.subagents
dsh-fs-local         → ctx.fs              （FileSystem seam 的本地后端）
dsh-subprocess-local → ctx.subprocess
dsh-bash-local       → ctx.shell
dsh-jobs-local       → ctx.jobs
dsh-agent            → ctx.agents
dsh-goal             → ctx.goals
dsh-session-projection → ctx.sessionProjections（投影单元；agent-loop 的必需依赖）
dsh-agent-loop       → ctx.agentLoop       （真实 turn/step 主循环 + AgentFactory）
```

它**刻意不默认装载**两个 seam，因为示例自己要当 provider：`CompactionEngine`（第 02 课）与
`SandboxProvider`（第 07 课）。

harness 对外暴露的观察口：`createHarness()` / `loadPlugin()` / `callTool()` / `visibleTools()` /
`assembleContext()` / `runTurn()` / `dispose()`。真实调用证据由 `CountingAnthropicCompatAdapter`
记录，`allEvidence()` 可读。

`npm run coverage:surfaces` 是教材覆盖门禁：核心扩展面 25 + 补充扩展面 34 = **覆盖 59**，门槛 ≥ 50。

---

## 常见误解对照表

写这套示例的过程本身是一次**保真度审计**。以下是真实 `0.1.5-rc.2` 发布包里容易搞错的点，
都在代码注释或课节里标注了依据：

| 直觉 | 真实情况 | 详见 |
|---|---|---|
| 命名空间要用工厂函数铸造 | **0.1.5 起没有 `settingsNamespace()`**，命名空间就是字符串字面量 | [第 11 课](lessons/11-config-data-infrastructure.md) |
| 会有 `assistant/chunk` 事件 | **0.1.5 起没有**：增量内嵌在 `assistant/message` 的 provider 流里；观测流式请看 `llm/stream` | [第 04 课](lessons/04-agent-loop-intervention.md)、[第 03 课](lessons/03-inference-service-access.md) |
| 任意消息事件都能做 surface replace 检查点 | `assistant/message` 的 `sourceEventSeqs` 是 `never`，**必须用 `user/message`** | [第 05 课](lessons/05-session-surface.md)、[第 02 课](lessons/02-context-assembly.md) |
| `system/message` 不进模型可见 surface | 0.1.5 起**进**；只允许它在 surface 节点 0 上被改写 | [第 05 课](lessons/05-session-surface.md) |
| 只装 AgentLoop 就够了 | 它的 `inject` 多了 `sessionProjections`，不装 fiber 停在 **PENDING**，症状是 `no agent factory registered` | [第 12 课](lessons/12-framework-mechanisms.md) |
| `subagents.start()` 返回最终结果 | `SubagentRun` 是**句柄**：结果在 `result` Promise 上等 | [第 08 课](lessons/08-delegation-presets.md) |
| 可以在 turn 外裸调 `approval.request()` | 不变量要求它必须在**打开的 turn 内**，否则重放时是崩溃尾巴 | [第 06 课](lessons/06-human-in-the-loop.md) |
| 取消和失败是同一种错误 | 都是 `isError`，靠 `error.info.code` 区分 `ABORTED_BEFORE_DISPATCH` / `ABORTED` | [第 07 课](lessons/07-execution-backends.md) |
| 沙箱可以"尽力而为" | 要么返回可强制执行的 argv，要么 fail-closed 抛错 | [第 07 课](lessons/07-execution-backends.md) |
| 一个 context 可以装两个同类后端 | 装第二个抛 `service "sandbox" has been registered at <...>`，换后端要先 dispose 旧的 | [第 07 课](lessons/07-execution-backends.md) |
| `serial` 和 `bail` 只是同步/异步之分 | `bail` 不 await，会把未决 Promise 当作截链值直接返回 | [第 12 课](lessons/12-framework-mechanisms.md) |

---

## 与其他文档集的分工

| 位置 | 回答的问题 | 形态 |
|---|---|---|
| [`docs/hello-dsh/`](../docs/hello-dsh/README.md) | 源码怎么实现、在哪一行 | 按章节编排的长文 |
| **`dsh-example/`（本目录）** | 怎么亲手跑一遍、原理是什么 | 13 课自学教材 + 可执行示例 |
| [`docs/okf/`](../docs/okf/index.md) | 结论是什么、凭什么这么说、什么时候过期 | 带 provenance 的 OKF v0.2 知识包 |
| [`iota-example/`](../iota-example/README.md) | 同编号方向在另一框架里如何对位 | 13 课自学教材 + 可执行对照 |

逐模块对照见 [12 · 与 iota 跨框架对照](../docs/hello-dsh/12-iota-cross-framework-comparison.md)。

---

**开始** → [第 00 课 · 跑起来](lessons/00-getting-started.md) ｜ **最短路线** → `npm run learn -- --tour`

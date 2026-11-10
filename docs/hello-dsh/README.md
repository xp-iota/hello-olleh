---
title: "DeepSeek Harness 源代码全面分析（中文）"
---
# DeepSeek Harness 源代码全面分析（中文）

本目录是对 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的系统性源码分析。正文形成于 `0.1.5-rc.2` 历史快照；当前 `sources/deepseek-harness/` 已同步到 `dsh-v0.1.5-rc.2`（`fb2c4b9e`），根包和四个发布 manifest 均声明 `0.1.5-rc.2`。

> **Source baseline:** DeepSeek Harness `dsh-v0.1.5-rc.2` (`fb2c4b9e`)。**文中的行号、API 形状与符号索引都以这份源码快照为准**。
> 配套工程 [`dsh-lab/`](../../dsh-lab/README.md) 跑在更新的 **`0.2.2-rc.1`** 发布线上——它与正文基线不是同一版本，差异集中列在 [§ 五 配套工程](#五配套工程-dsh-lab) 一节。

## 零基础先跑：15 分钟建立直觉

先别从 11 篇源码分析顺序硬啃。用真实发布包跑三个方向模块，再带着输出回来看原理：

```bash
cd dsh-lab
npm install
npm run M01      # 工具管线
npm run M02      # 上下文装配
npm run M03      # 推理服务
```

⚠️ **这一步需要模型 API Key**：M03 的 model 阶段会真的打推理服务，缺 `LLM_API_KEY` 会**明确失败**（不静默降级）；机制类阶段不需要 key。Key 放在 `dsh-lab/.env`（已 gitignore）。

这条路线依次演示三个方向模块：

1. **M01 工具管线**：注册与披露工具，并在执行前后组合策略；
2. **M02 上下文装配**：组织 Prompt section、变量、预算与压缩；
3. **M03 推理服务**：替换 LLM Provider，并用统一 `StreamChunk` 消费输出。

每个阶段跑前会显示"观察什么"，跑后给出"刚验证了什么、实现在哪、对应文档、下一步"。想按目标选择而不是跑完整路线：

| 我现在想做什么 | 直接运行 | 跑完读 |
|---|---|---|
| 给模型加工具或策略 Hook | `npm run M01` | [07 § 7.10–7.14](07-request-pipeline-llm-tools-and-prompts.md) |
| 修改 System Prompt 与上下文预算 | `npm run M02` | [07 § 7.18](07-request-pipeline-llm-tools-and-prompts.md) |
| 接自己的模型 | `npm run M03` | [03 § 3.1](03-capability-seams-and-services.md) |
| 看懂一次 Agent turn | `npm run M04` | [06 § 6.4](06-agent-loop-and-session-log.md) |
| 不写 TypeScript 做 Skill | `npm run M10` | [04 § 4.1](04-extensions-and-ecosystem.md) |
| 理解 Cordis 事件与 Fiber | `npm run M12` | [05 § 5.17](05-startup-and-cordis-runtime.md) |

完整命令与 12 个方向模块索引见 [`dsh-lab/README.md`](../../dsh-lab/README.md)。每条命令都有 `:bun` 变体（`npm run M01:bun`），`DSH_RUNTIME=bun` 可一次改默认；Node 与 Bun 跑的是**同一份阶段清单、同一套判据**。建议形成固定循环：**先跑 → 对照 `M0X-*/index.ts` → 回读对应章节 → 改一个值再跑**。

### 配套工程结构与工具调用回路

下面两张图分别展示 12 个方向模块的组织方式，以及接入推理服务后一次工具调用的流程。
**两图都按当前 `dsh-lab/` 重画**：装配层是 `cordis.yml` + `cordis.patch.yml` + 官方 `boot()`，不再有手写的 `createHarness`。

![配套工程拓扑](diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](diagrams/12-example-topology.html)　·　
IR 源：[12-example-topology.architecture.json](diagrams/12-example-topology.architecture.json)

- **装配只有一份清单**：`cordis.yml` 是空表 `[]`（11 行全是注释），`cordis.patch.yml` 450 行、**89 条 `- id:` 行**，`boot()` 来自官方 `@deepseek-ai/dsh-app-boot`。
- **模块与阶段**：12 个模块 · 60 个阶段 · 每个模块一个 `index.ts`，由 `src/lab/runner.ts` 驱动；`npm run all` 缺 `LLM_API_KEY` 立即失败，没有 mock 或离线回退。
- **provider 只有一处自写**：自写的是 `src/llm/anthropic-compat/index.ts` 的 `AnthropicCompatAdapter`，其余走 24 个官方 `@deepseek-ai/dsh-*` 服务包；沙箱实测是官方 `LocalSandboxProvider`（M07.3）。
- **依赖图谱（2026-10-23 实测）**：对 `dsh-lab/` 重新建图得 **51 文件 · 396 节点 · 600 边 · 32 社区**；`EXTRACTED` 537 条、`INFERRED` 63 条；`diagnose multigraph --directed` 0 dangling / 0 self-loop / 0 duplicate。
  **dsh-lab 没有旧工程那种单一装配枢纽**——12 个模块都 import `src/lab/runner.ts`，无一 import `boot.ts`，`bootLab` 度数只有 9；而 `cordis.yml` / `cordis.patch.yml` 在 AST 图上贡献 **0 个节点**（tree-sitter 不覆盖 YAML），所以"装配来自清单"这件事**图上验不出来**，只能读文件与 `rg -c`。
  旧数字（169 文件 / 584 节点 / 744 边 / 45 社区 / 枢纽度数 66）是对**已删除的旧工程**的建图，只作历史记录保留在 [OKF 知识包的 graphify 参考](../okf/references/01-graphify-dsh-lab.md) 的历史小节里。

![一次工具调用的完整回路](diagrams/12-example-minimax-loop.svg)

交互版：[12-example-minimax-loop.html](diagrams/12-example-minimax-loop.html)　·　
IR 源：[12-example-minimax-loop.sequence.json](diagrams/12-example-minimax-loop.sequence.json)

- **工具侧已实跑**：`npm run M01` 注册前工具数 26，`word_count` 执行返回「3 词 / 31 字符」，`dispose` 之后回到 26 个。
- **协议层有单测覆盖**：`npm test` 23/23 通过，其中包含"连续 tool 消息折叠"与"SSE 逐行解析"两条。
- ⚠️ **模型侧待实跑复核**：本图里模型那一段（`tool_use` 块形态、`stop_reason`、第二次请求的线上报文）是**读代码得出**的，不是实跑结论——M03.3 在本网关失败（`maxTokens: 200` 被 `thinking` 块吃掉），且 `chat` 路径另有 `INVALID_MODEL_INFO` 的模型元数据问题。工具侧与协议侧的断言则都是实跑/单测确认过的。
- **一次工具调用等于两步**：第一步模型只发调用意图；结果回灌后才有第二步收尾。
  ⚠️ "step 数正好是 2"是旧版示例的实测结论，**本版没有再实测**——本图不再声称这个数字。

这两张图背后的结论沉淀在 [dsh-lab 知识包](../okf/index.md)（OKF v0.2，带来源、验证方式与过期时间）。

> ⚠️ **读这套文档前请先读 [cordis 文档集](../hello-cordis/README.md)**（至少 03 Fiber + 04 Context + 05 Service 三篇）。DSH 完全建立在 cordis 之上——不懂 cordis 读 DSH 会处处卡住。
>

## 一、当前同步快照与分析基线

| 当前项 | 值 |
|---|---|
| 当前 tag | `dsh-v0.1.5-rc.2` |
| 当前 commit | `fb2c4b9e698e30edb738bca4cf0618587db7d203` |
| 当前源码版本 | `0.1.5-rc.2` |
| 配套工程 npm 版本 | `0.2.2-rc.1`（`dsh-lab/` 锁定的发布线） |
| 配套工程 cordis | `4.0.5`（快照内 vendored 的是 `4.0.2`） |

### 当前仓库事实

- 当前 commit：`fb2c4b9e698e30edb738bca4cf0618587db7d203`
- 工作区共有 290 个 package manifests；272 个发布包声明 `0.1.5-rc.2`，其余工具和 vendored 包使用各自版本。
- Node.js 要求：`^22.19.0 || >=24.0.0`
- Package manager：`pnpm@11.7.0`
- Vendored Cordis：`4.0.2`
- 配套 `dsh-lab/` 锁定的是**更新的 `0.2.2-rc.1` 发布线**（cordis `4.0.5`）。**它与上面的源码快照不是同一版本**：正文讲的是 `0.1.5-rc.2` 的代码，配套工程跑的是 `0.2.2-rc.1` 的发布包，两者的契约差异集中列在 [§ 五](#五配套工程-dsh-lab)。

⚠️ **README 首屏的声明**：

> DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

`AGENTS.md` 更进一步（[10 § 10.9](10-testing-and-engineering.md)）：**后端拒绝旧的磁盘格式，`SESSION_FORMAT_VERSION` 保持 `0` 且无兼容承诺**。

> 规模统计（56 万行代码、测试占 45%、49 个包组的逐组行数）见 [01 § 1.3](01-overview.md)；
> 五分钟看懂一次对话的流转见 [01 § 1.4](01-overview.md)；
> vendored cordis 分叉的量化见 [01 § 1.6](01-overview.md) 与 [05 § 5.14](05-startup-and-cordis-runtime.md)。
> 本索引不重复这三处。

### 项目状态与风险

| 事实 | 含义 |
|---|---|
| 官方标记为 developer preview | API 与磁盘格式仍会发生破坏性变化 |
| `SESSION_FORMAT_VERSION` 仍为 `0` | 后端不承诺兼容旧的会话格式 |


## 二、术语约定

| 术语 | 一句话解释 | 展开 |
|---|---|---|
| **Cordis** | DSH 的插件运行时；提供 Context、Fiber、Service、Event 与配置树 | [05 启动与 Cordis 落地](05-startup-and-cordis-runtime.md) |
| **seam（能力接缝）** | 由 Definition、Provider、Consumer 三个角色组成的可替换能力边界 | [03 § 3.1](03-capability-seams-and-services.md) |
| **Definition / Provider / Consumer** | 分别定义契约、提供实现、消费能力；换 Provider 即可改变产品行为 | [03 § 3.1–3.2](03-capability-seams-and-services.md) |
| **Profile / Bundle** | Profile 是最终运行配置，Bundle 是可叠加的能力包；二者通过 cordis patch 合成 | [05 § 5.1–5.3](05-startup-and-cordis-runtime.md) |
| **turn / step** | turn 是一次用户轮次，包含零个或多个 step；step 是一次模型请求及其工具调用 | [06 § 6.1](06-agent-loop-and-session-log.md) |
| **surface / `surfaceOp`** | 会话日志投影给模型或 UI 的有序表面，以及 append/replace 等变换操作 | [06 § 6.15](06-agent-loop-and-session-log.md) |
| **fail-closed** | 权限、沙箱或能力缺失时默认拒绝，而不是静默放行 | [08 § 8.23](08-execution-services.md) |

## 三、篇目表

文档按读者问题组织为 12 篇：

| # | 篇目 | 回答什么 |
|---|---|---|
| 01 | [项目概览](01-overview.md) | DSH 是什么、整体规模与读前必知事实 |
| 02 | [代码结构地图](02-codebase-map.md) | 包如何组织、依赖如何分层、想改一项能力应从哪里进入 |
| 03 | [能力缝 Seam 与服务全景](03-capability-seams-and-services.md) ⭐ | Definition / Provider / Consumer 三角色与 seam 全表 |
| 04 | [扩展与生态](04-extensions-and-ecosystem.md) | Skill、Hook、插件、MCP/ACP 与 SDK 怎样扩展系统 |
| 05 | [启动流程与 Cordis 落地](05-startup-and-cordis-runtime.md) | profile/bundle、配置树、Fiber 与服务装配 |
| 06 | [Agent 循环与会话日志](06-agent-loop-and-session-log.md) ⭐ | turn/step 如何推进，模型可见事实如何写入日志 |
| 07 | [请求管线](07-request-pipeline-llm-tools-and-prompts.md) ⭐ | LLM、工具与 System Prompt 如何组装、发出和返回 |
| 08 | [执行侧服务](08-execution-services.md) | 文件、Shell、沙箱、子代理与压缩的契约和安全边界 |
| 09 | [宿主与运行面](09-host-runtime-and-storage.md) | Web、网关、编排、存储与类型系统 |
| 10 | [测试与工程实践](10-testing-and-engineering.md) | 覆盖率、快照回放、CI 与工程纪律 |
| 11 | [关键调用链速查](11-call-chain-reference.md) | 核心链路、事件、符号、配置与症状路由 |
| 12 | [与 iota 跨框架对照](12-iota-cross-framework-comparison.md) | M01–M12 的可迁移语义、教学补齐和结构性边界 |

## 四、阅读路线

![DSH 系列阅读路线](diagrams/00-dsh-reading-path.svg)

**DSH 系列阅读路线** — [交互版](diagrams/00-dsh-reading-path.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/00-dsh-reading-path.architecture.json)

- **cordis 是前置知识**：DSH 的每个能力都是 cordis Service · 不懂 Fiber 与 Context 会读不动 05 篇之后 · 建议先花时间读 cordis 03 与 04
- **两篇重点**：03 能力缝解释整个架构的组织原则 · 04 扩展与生态给出全部扩展点地图 · 读完这两篇就能自己找路
- **11 篇是索引**：按调用链组织，便于回查 · 读完任一篇都可以随时跳回 · 配合各篇的源码行号使用

### 按身份选路

| 你是 | 建议路线 |
|---|---|
| **想给 DSH 写插件** | [03](03-capability-seams-and-services.md)（seam 全表）+ [07](07-request-pipeline-llm-tools-and-prompts.md)（工具与提示）+ [配套工程 dsh-lab](../../dsh-lab/README.md) + 官方 `docs/cookbook/` |
| **想改 agent 主循环** | [06](06-agent-loop-and-session-log.md) 精读；但更可能应该用 `agent/*` 事件（[06 § 6.8](06-agent-loop-and-session-log.md)） |
| **在排查线上问题** | [11 § 11.10](11-call-chain-reference.md) 症状路由表 |
| **关心"上下文怎么管的"** | [06 § 6.12](06-agent-loop-and-session-log.md) → [07 § 7.18](07-request-pipeline-llm-tools-and-prompts.md) → [08 § 8.32](08-execution-services.md) → [09 § 9.28](09-host-runtime-and-storage.md) |
| **关心安全边界** | [08 § 8.17](08-execution-services.md) → [08 § 8.11](08-execution-services.md) → [08 § 8.4](08-execution-services.md) |
| **想接自己的模型 / 沙箱 / 文件系统** | [07 § 7.2](07-request-pipeline-llm-tools-and-prompts.md)（1 个方法）/ [08 § 8.18](08-execution-services.md)（1 个）/ [08 § 8.2](08-execution-services.md)（13 个），各配一个可跑示例 |
| **做前端集成** | [09 § 9.1](09-host-runtime-and-storage.md) 起读整篇 |
| **用程序驱动 dsh** | [04 § 4.18](04-extensions-and-ecosystem.md)（Python SDK）或 [04 § 4.13](04-extensions-and-ecosystem.md)（ACP） |
| **只想看工程实践** | [10](10-testing-and-engineering.md)（100% 覆盖率门禁、agent 笔记） |
| **想比较 DSH 与 iota** | [12](12-iota-cross-framework-comparison.md) → 两侧同编号模块 → 稳定符号证据表 |

## 五、配套工程 dsh-lab

本仓库带一套**能真跑**的配套工程：[`dsh-lab/`](../../dsh-lab/README.md)。
它的每一个 `import` 都指向 npm 公共 registry 上真实发布的 `@deepseek-ai/*` 包（版本线 `0.2.2-rc.1`），
`src/boot.ts` 调官方 `@deepseek-ai/dsh-app-boot` 的 `boot()`，把 `cordis.yml`（**空根表**）+ `cordis.patch.yml`（**唯一装配清单**，89 条行）组合成真实服务树（含真实 `dsh-agent-loop` 主循环），
"模型"那一处是本工程**唯一自写的 provider**——`AnthropicCompatAdapter`，打真实推理服务（需 `LLM_API_KEY`）。

> ⚠️ **配套工程与正文基线不是同一版本**：正文分析的是 `0.1.5-rc.2` 源码快照（`fb2c4b9e`），配套工程跑的是 `0.2.2-rc.1` 发布包。
> 跨版本契约差异记在配套工程的代码注释里——例如 `src/llm/anthropic-compat/index.ts` 开头逐条列了 0.1.5 → 0.2.1 的四处 `LlmAdapter` 变化（工具结果成为独立 `role: 'tool'` 消息、必须带 `attributionHeaders()`、`providerInfo()`/`listModels()`/`resolveModel()`、`purpose` 标记）。
> 配套工程**不手写装配**：`cordis.patch.yml` 里 89 条行中 87 条是官方包、2 条是自写插件（`anthropic-compat`、`safety-guardrail`）；压缩、沙箱、溢写都走官方包，**不再有"刻意留空再由示例补上"的缝**。

| 文档章节 | 配套工程里的可跑点 |
|---|---|
| [03 § 3.1](03-capability-seams-and-services.md) seam 三角色 | M03 · 推理服务接入 |
| [03 § 3.8](03-capability-seams-and-services.md) seam 全表 | M02 · M03 · M05 · M07 · M08 · M09 · M10 · M11 |
| [04 § 4.1](04-extensions-and-ecosystem.md) 扩展路径 · [§ 4.3](04-extensions-and-ecosystem.md) hooks | M10.2 · 现场写一个 skill · M04.2 · 在 turn 结束前 steer |
| [05 § 5.1](05-startup-and-cordis-runtime.md) profile/bundle · [§ 5.17](05-startup-and-cordis-runtime.md) cordis 原语 | [`cordis.yml`](../../dsh-lab/cordis.yml) · [`cordis.patch.yml`](../../dsh-lab/cordis.patch.yml) · M12.1 · 可逆 effect |
| [06 § 6.4](06-agent-loop-and-session-log.md) `turn()` · [§ 6.8](06-agent-loop-and-session-log.md) `agent/*` · [§ 6.9](06-agent-loop-and-session-log.md) Inbox | M04.1 · M04.2 · M04.3 |
| [06 § 6.12](06-agent-loop-and-session-log.md) 不变量 · [§ 6.15](06-agent-loop-and-session-log.md) `surfaceOp` · [§ 6.19](06-agent-loop-and-session-log.md) fork | M05.1 · M05.2 · M05.4 · M08.3 |
| [07 § 7.2](07-request-pipeline-llm-tools-and-prompts.md) `LlmAdapter` · [§ 7.3](07-request-pipeline-llm-tools-and-prompts.md) `llm/stream` | [`anthropic-compat`](../../dsh-lab/src/llm/anthropic-compat/index.ts) · M03.2 |
| [07 § 7.10](07-request-pipeline-llm-tools-and-prompts.md) `ToolDefinition` · [§ 7.11](07-request-pipeline-llm-tools-and-prompts.md) 三段 waterfall · [§ 7.14](07-request-pipeline-llm-tools-and-prompts.md) 注册表 | M01.1 · M01.2 · M01.3 · M01.5 · M01.4 |
| [07 § 7.18](07-request-pipeline-llm-tools-and-prompts.md) 四类注册 · [§ 7.26](07-request-pipeline-llm-tools-and-prompts.md) assemble waterfall | M02.1 · M02.2 |
| [08 § 8.2](08-execution-services.md) `FileSystem` · [§ 8.11](08-execution-services.md) `ShellExecutor` | M07.1 · M07.2 |
| [08 § 8.18](08-execution-services.md) `confine` · [§ 8.21](08-execution-services.md) 审批链 | M07.3 · M07.4 · M07.5 · M06.2 |
| [08 § 8.27](08-execution-services.md) 子代理驱动 · [§ 8.33](08-execution-services.md) · [§ 8.34](08-execution-services.md) 压缩 | M08.1 · M08.2 · M02.3 · M02.5 |
| [09 § 9.17](09-host-runtime-and-storage.md) settings · [§ 9.20](09-host-runtime-and-storage.md) Jobs · [§ 9.23](09-host-runtime-and-storage.md) Goal | M11.1 · M09.1 · M09.2 |

💡 写这套配套工程的过程本身是一次**保真度审计**：真实发布包与快照 `fb2c4b9e` 之间的若干 API 差异
（`{{name}}` 占位语法、`approval.request()` 的轮内约束、`ctx.tools.execute` 取代 `call`、
`SubagentRun` 是句柄而非结果、`assistant/message` 必须带 model 来源……）
都记在配套工程的适配层注释与 [`dsh-lab/README.md`](../../dsh-lab/README.md) 里。

## 六、主题对齐矩阵

| 统一主题 | Cordis 地基 | DeepSeek Harness | 配套工程 |
|---|---|---|---|
| 定位与代码地图 | [Cordis 01](../hello-cordis/01-overview-and-design-philosophy.md) · [02](../hello-cordis/02-code-structure-and-package-boundaries.md) | [01 项目概览](01-overview.md) · [02 代码结构地图](02-codebase-map.md) | [`cordis.yml`](../../dsh-lab/cordis.yml) · [`cordis.patch.yml`](../../dsh-lab/cordis.patch.yml) |
| 生命周期与服务 | [Cordis 03 Fiber](../hello-cordis/03-fiber-model.md) · [04 Context](../hello-cordis/04-context-and-reflect-proxy.md) · [05 Service](../hello-cordis/05-service-registration-and-dependency-resolution.md) | [03 Seam](03-capability-seams-and-services.md) · [05 启动](05-startup-and-cordis-runtime.md) | [M03.2 · 环绕 llm/stream](../../dsh-lab/M03-inference-service-access/README.md) · [M12.1 · 可逆 effect](../../dsh-lab/M12-cordis-runtime/README.md) |
| 事件与扩展 | [Cordis 06 Events](../hello-cordis/06-event-system-and-waterfall.md) | [04 扩展](04-extensions-and-ecosystem.md) · [06 Agent](06-agent-loop-and-session-log.md) · [07 请求管线](07-request-pipeline-llm-tools-and-prompts.md) | [M04.2 · 在 turn 结束前 steer](../../dsh-lab/M04-agent-loop-intervention/README.md) · [M12.3 · 行 id 与 patch 覆盖](../../dsh-lab/M12-cordis-runtime/README.md) · [M01.2 · 权限门](../../dsh-lab/M01-tool-pipeline/README.md) |
| 配置、装配与热更新 | [Cordis 07 Loader](../hello-cordis/07-loader-and-configuration-tree.md) · [08 HMR](../hello-cordis/08-hmr.md) | [05 启动与 Cordis](05-startup-and-cordis-runtime.md) | [`cordis.patch.yml`](../../dsh-lab/cordis.patch.yml) · [M12.3 · 行 id 与 patch 覆盖](../../dsh-lab/M12-cordis-runtime/README.md) |
| Agent 状态与请求管线 | [Cordis 03–06](../hello-cordis/03-fiber-model.md) | [06 Agent 与会话](06-agent-loop-and-session-log.md) · [07 LLM/工具/提示](07-request-pipeline-llm-tools-and-prompts.md) | [M04.1 · 观察 turn 边界](../../dsh-lab/M04-agent-loop-intervention/README.md) · [M05.1 · 日志不变量](../../dsh-lab/M05-session-surface/README.md) · [M03.3 · 真实调用一次模型](../../dsh-lab/M03-inference-service-access/README.md) |
| 执行、安全与宿主 | [Cordis 03–07](../hello-cordis/03-fiber-model.md) | [08 执行侧](08-execution-services.md) · [09 宿主与运行面](09-host-runtime-and-storage.md) | [M06.2 · 三种审批结果](../../dsh-lab/M06-human-in-the-loop/README.md) · [M07.1 · 沙箱内写文件](../../dsh-lab/M07-execution-backends/README.md) · [M07.3 · 沙箱模式](../../dsh-lab/M07-execution-backends/README.md) |
| 测试、速查与排障 | [Cordis 09](../hello-cordis/09-call-chain-reference.md) | [10 测试](10-testing-and-engineering.md) · [11 速查](11-call-chain-reference.md) | [配套工程索引与批量运行](../../dsh-lab/README.md) |

## 七、Mermaid 配色图例

| 颜色 | 语义 | 在 DSH 里指 |
|---|---|---|
| 🔵 蓝 `#E3F2FD` | 入口 / 用户面 | `dsh` CLI、Agent 输入、Service Definition |
| 🩵 青 `#E0F7FA` | 执行 | Agent 驱动、工具 body、LLM 流 |
| 🟠 橙 `#FFF3E0` | 调度 / 策略 | Inbox、waterfall 拦截、`*-policy` 包 |
| 🟢 绿 `#E8F5E9` | 状态 / Provider | session 日志、Provider 实现、投影缓存 |
| 🔴 红 `#FFEBEE` | 核心风险点 | turn/step 主循环、三段管线、沙箱、抛错路径 |
| ⚪ 灰蓝 `#ECEFF1` | 数据结构 | 事件类型、配置、Consumer 工具 |
| 🌸 粉 `#FCE4EC` | 基础设施 | host / client / CI |
| 💛 米黄 `#FFFDE7` | 提示 / 判断 | 决策节点、💡 说明 |

## 八、阅读约定

| 约定 | 说明 |
|---|---|
| **路径缩写** | `P/` = `packages/`；各篇篇首声明自己用到的专用缩写（`AL/`=`P/core/agent-loop/src/`、`AG/`=`P/core/agent/src/`、`S/`=`P/core/session/src/`、`T/`=`P/core/tools/src/`、`SP/`=`P/core/system-prompt/src/`、`SC/`=`P/core/scope/src/`、`AB/`=`P/boot/app-boot/src/`、`L/`=`P/llm/llm/src/`、`V/`=`vendor/cordis/src/`…） |
| **行号** | 对应快照 `fb2c4b9e`，**已逐条比对源码核实**（267 处 `文件:行号` 引用全部复核，个别区间端点可能 ±1）。上游迭代极快，建议以符号名检索；统一符号行号索引见 [11 § 11.6](11-call-chain-reference.md) |
| **章节编号** | `N.M`，N 为篇号 |
| **💡 提示块** | 反直觉事实、设计取舍、常见踩坑 |
| **📐 配套示例块** | 该节对应的可跑示例（`dsh-lab/`），含关键代码片段与实测输出。**读的时候注意口径**：配套工程与正文基线不是同一版本，且它只覆盖了一部分断言——凡是块里写着"**以本快照的源码分析为准**"的，说明那条断言在配套工程里**没有可跑对照**（原因通常是该阶段在 `0.2.1` 已改写、或对应服务未挂载） |
| **测试** | 测试与工程机制以 [10](10-testing-and-engineering.md) 为主篇；各篇只保留与主题直接相关的测试描述 |
| **⭐ 标记** | 全系列最核心的 5 篇（03、06、07 + cordis 的 03、04） |
| **交叉引用** | 篇内相对链接；跨文档集用 `../hello-cordis/`。只引用本仓库内实际存在的文档，可用 `python3 scripts/check_doc_links.py` 校验 |

## 九、文档集定位

DSH **自带极完整的一手文档**：`docs/` 下 215 篇 md（含 105 篇 `.zh.md` 中文版）、`AGENTS.md` = `CLAUDE.md`（149 行）、`.agents/notes/` 1372 篇设计笔记。**完整清单与优先阅读顺序见 [01 § 1.8](01-overview.md)。**

![官方文档、本文档集与配套工程的分工](diagrams/00-docs-division.svg)

**官方文档、本文档集与配套工程的分工** — [交互版](diagrams/00-docs-division.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/00-docs-division.architecture.json)

- **三者的选择**：想知道怎么用与怎么扩展就读官方 · 想知道怎么实现与代码在哪就读这里 · 想立刻跑一个就看配套工程
- **官方文档已很完整**：subsystems 有 92 篇，user 26 篇 · cookbook 与 cordis-tutorial 各 16 篇 · 并且一半有中文版
- **示例装的是真实包**：依赖发布到 npm 的 deepseek-ai 系列包 · 不是 vendored 快照 · 因此能验证真实的扩展契约

## 十、这套文档不做什么

- **不替代官方文档**。`docs/architecture.md`（129 行）与 `AGENTS.md`（149 行）是必读的一手材料，本文档集多处直接引用并标注来源。
- **不逐个覆盖这 221 个包**。`client` 一个组就 137889 行；11 篇给的是**架构骨架 + 关键类定位**，不是 API 手册。
- **不做性能分析**。文中的量级判断来自代码结构与注释，不是实测。
- **不追踪上游变化**。**DSH 迭代极快**（快照附近有多个 release commit）。这是快照式分析，后续变化应以 § 一的 commit 为基线做增量复核。
- **未深入的部分**：`client` 组内部的 React 实现细节、`host/apiproxy`（8571 行）的逐模块拆解、`typert/generator`（6245 行）的生成算法、`sandbox-windows-acl`（2530 行）的 ACL 细节。这些篇目给了定位与设计意图，没有逐行拆解。

---

**开始阅读** → [01 项目概览](01-overview.md) ｜ **想直接动手** → [配套工程 dsh-lab](../../dsh-lab/README.md)

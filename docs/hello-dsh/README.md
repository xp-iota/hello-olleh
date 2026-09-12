---
layout: default
title: "DeepSeek Harness 源代码全面分析"
permalink: /docs/hello-deepseek-harness/
---

# DeepSeek Harness 源代码全面分析（中文）

本目录是对 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的系统性源码分析。所有结论均基于源码实读，文中引用的路径均相对于源码根目录。

## 零基础先跑：15 分钟建立直觉

先别从 11 篇源码分析顺序硬啃。用真实发布包跑三个离线示例，再带着输出回来看原理：

```bash
cd dsh-example
npm install
npm run learn -- --tour
```

这条路线不需要模型 API Key，会依次演示：

1. **工具**：把 `word_count` 注册成模型可见能力，调用后再随 Fiber 销毁；
2. **Prompt**：把一段规则注册进 System Prompt，并观察顺序与配置覆盖；
3. **Hook**：在工具执行前放行 `read_file`、拒绝 `bash`，把原因结构化返回给模型。

每一步运行前都会显示“观察什么”，运行后会给出“刚验证了什么、实现在哪、对应文档、下一步”。想按目标选择而不是跑完整路线：

| 我现在想做什么 | 直接运行 | 跑完读 |
|---|---|---|
| 给模型加一个工具 | `npm run learn -- --example 01` | [07 § 7.10](07-请求管线-LLM工具与提示.md) |
| 修改 System Prompt | `npm run learn -- --example 02` | [07 § 7.18](07-请求管线-LLM工具与提示.md) |
| 加权限或策略 Hook | `npm run learn -- --example 03` | [07 § 7.11](07-请求管线-LLM工具与提示.md) |
| 接自己的模型 | `npm run learn -- --example 05` | [03 § 3.1](03-能力缝与服务全景.md) |
| 看懂一次 Agent turn | `npm run learn -- --example 06` | [06 § 6.4](06-Agent循环与会话日志.md) |
| 不写 TypeScript 做 Skill | `npm run learn -- --example 08` | [04 § 4.1](04-扩展与生态.md) |

完整命令与 26 个示例索引见 [`dsh-example/README.md`](../../dsh-example/README.md)。建议形成固定循环：**先跑 → 对照 `index.ts` → 回读对应章节 → 改一个值再跑**。

### 示例工程的结构与一条真实回路

下面两张图分别回答「26 个示例怎么组织」和「换成真实推理服务后一次工具调用怎么走」。
第一张的结构数字来自 graphify 建图，第二张的 step 数与词数来自实测输出，都不是示意值。

![示例工程的真实拓扑](diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](diagrams/12-example-topology.html)　·　
IR 源：[12-example-topology.architecture.json](diagrams/12-example-topology.architecture.json)

- **星形结构是 graphify 量出来的**：488 节点 537 边 57 社区，仅统计示例工程源码；`createHarness` 度数 32，是唯一枢纽；533 条边 `EXTRACTED`，4 条 `INFERRED`。
- **示例为什么能这么短**：装配成本一次性付在 runtime 层；示例只写自己那一个扩展点；换真实模型不改业务代码，只改 provider。
- **两个缝故意留空**：压缩与沙箱不给默认后端，逼示例自己实现 provider，这正是能力缝三角色的最小演示。

![一次 word_count 工具调用的完整回路](diagrams/12-example-minimax-loop.svg)

交互版：[12-example-minimax-loop.html](diagrams/12-example-minimax-loop.html)　·　
IR 源：[12-example-minimax-loop.sequence.json](diagrams/12-example-minimax-loop.sequence.json)

- **工具没有为对接模型改一行**：示例 01 注册的 `defineTool` 原样复用；只把 provider 从 mock 换成 `minimax-m3`；schema 汇入提示由 `systemPrompt` 负责。
- **证据取自会话日志**：`tool-call` 与 `tool-result` 都从 `session.events` 读；不依赖适配器自报调用成功；模型不调工具时脚本直接抛错。
- **一次工具调用等于两步**：第一步模型只发调用意图；结果回灌后才有第二步收尾；实测 step 数正好是 2。

这两张图背后的结论沉淀在 [dsh-example 知识包](../okf/index.md)（OKF v0.2，带来源、验证方式与过期时间）。

> ⚠️ **读这套文档前请先读 [cordis 文档集](../hello-cordis/README.md)**（至少 03 Fiber + 04 Context + 05 Service 三篇）。DSH 完全建立在 cordis 之上——不懂 cordis 读 DSH 会处处卡住。
>
> 本仓库内两套文档集的关系见 [docs 总索引](../../README.md)。

## 一、快照与版本

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/deepseek-ai/deepseek-harness` |
| 分支 | `master` |
| **快照 Commit（完整）** | `47f943859bef60e4160492346772ded9b24f765a` |
| **快照 Commit（短）** | `47f94385` |
| 快照提交时间 | `2026-08-13T11:38:46Z` |
| 快照提交标题 | `Merge pull request #2519 from deepseek-harness/feat/npm-public` |
| Commit 链接 | https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a |
| **仓库创建时间（API 采集值）** | **2026-08-13T11:56:32Z**（晚于上列快照提交时间 17 分 46 秒，时间关系异常） |
| Stars / Forks / Open Issues | **52912** / 4275 / **0** |
| 源码快照版本 | **`0.1.0-rc.5`**（221 个发布包统一版本 = `packages/` 下 219 个 + `apps/cli`、`apps/web`，见 [02 § 2.1](02-代码结构地图.md)） |
| 示例锁定的 npm 版本 | **`0.1.1-rc.2`**（[配套示例工程](../../dsh-example/README.md)精确锁定） |
| 仓库 tag | **无** |
| 语言 / 许可证 | TypeScript / MIT |
| Node 要求 | `^22.19.0 \|\| >=24.0.0` |
| 包管理 | pnpm **11.7.0** |
| 官网 | https://deepseek.com/harness |
| topics | `cordis`、`dsh`、`dsh-plugin` |

> **双版本口径**：正文、源码路径与行号基于快照 `47f94385`（`0.1.0-rc.5`）；所有 `📐` 配套示例编译并运行在精确锁定的 npm `0.1.1-rc.2` 上。两者契约不一致时，正文解释快照实现，示例 README 记录发布包的实际行为。

💡 Stars / Forks / Open Issues 与仓库创建时间来自快照采集时的网络元数据，无法从源码快照复核；创建时间与 commit 时间的先后关系异常，因此本文不据此推断仓库年龄。其余各项均可在 `sources/deepseek-harness` 快照内自行验证——该快照体积大且不随本仓库提交，需按下述方式自行获取。

**下载方式**：环境策略拦截 `git clone`，源码通过 `api.github.com/repos/deepseek-ai/deepseek-harness/tarball/<sha>` 归档下载（13.7 MB，解压 69 MB）。URL 里锁定完整 SHA，快照精确。

⚠️ **README 首屏的声明**：

> DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

`AGENTS.md` 更进一步（[10 § 10.9](10-测试与工程实践.md)）：**后端拒绝旧的磁盘格式，`SESSION_FORMAT_VERSION` 保持 `0` 且无兼容承诺**。

> 规模统计（56 万行代码、测试占 45%、49 个包组的逐组行数）见 [01 § 1.3](01-项目概览.md)；
> 五分钟看懂一次对话的流转见 [01 § 1.4](01-项目概览.md)；
> vendored cordis 分叉的量化见 [01 § 1.6](01-项目概览.md) 与 [05 § 5.14](05-启动与Cordis落地.md)。
> 本索引不重复这三处。

### 项目状态与风险

| 事实 | 含义 |
|---|---|
| 官方标记为 developer preview | API 与磁盘格式仍会发生破坏性变化 |
| `SESSION_FORMAT_VERSION` 仍为 `0` | 后端不承诺兼容旧的会话格式 |
| 源码快照 `0.1.0-rc.5`，示例使用 `0.1.1-rc.2` | 阅读正文与运行示例时必须区分两套契约 |
| 仓库无 tag、迭代速度快 | 后续复核应以完整 commit SHA 为基线，而不是只看版本名 |

因此本系列采用**双版本口径**：源码判断只引用 `47f94385`；动手验证只引用示例工程锁定的 npm `0.1.1-rc.2`，差异显式记录而不互相覆盖。

## 二、术语约定

| 术语 | 一句话解释 | 展开 |
|---|---|---|
| **Cordis** | DSH 的插件运行时；提供 Context、Fiber、Service、Event 与配置树 | [05 启动与 Cordis 落地](05-启动与Cordis落地.md) |
| **seam（能力接缝）** | 由 Definition、Provider、Consumer 三个角色组成的可替换能力边界 | [03 § 3.1](03-能力缝与服务全景.md) |
| **Definition / Provider / Consumer** | 分别定义契约、提供实现、消费能力；换 Provider 即可改变产品行为 | [03 § 3.1–3.2](03-能力缝与服务全景.md) |
| **Profile / Bundle** | Profile 是最终运行配置，Bundle 是可叠加的能力包；二者通过 cordis patch 合成 | [05 § 5.1–5.3](05-启动与Cordis落地.md) |
| **turn / step** | turn 是一次用户轮次，包含零个或多个 step；step 是一次模型请求及其工具调用 | [06 § 6.1](06-Agent循环与会话日志.md) |
| **surface / `surfaceOp`** | 会话日志投影给模型或 UI 的有序表面，以及 append/replace 等变换操作 | [06 § 6.15](06-Agent循环与会话日志.md) |
| **fail-closed** | 权限、沙箱或能力缺失时默认拒绝，而不是静默放行 | [08 § 8.23](08-执行侧服务-文件Shell沙箱子代理压缩.md) |

## 三、篇目表

26 篇的初版按包组切得很细，同一个主题被拆在多篇里反复交代背景。现在按**读者的问题**收敛成 11 篇：

| # | 篇目 | 行数 | 回答什么 | 原篇目 |
|---|---|---|---|---|
| 01 | [项目概览](01-项目概览.md) | 292 | DSH 是什么、规模、"everything is a plugin"的证据、读前必知五件事 | 01 |
| 02 | [代码结构地图](02-代码结构地图.md) | 382 | `packages/` 下 219 个包怎么组织、六类命名后缀的语义、依赖分层、"想改 X 去哪" | 02 |
| 03 | [能力缝 Seam 与服务全景](03-能力缝与服务全景.md) ⭐ | 381 | **三角色模型**、为什么"换一个 provider 改变整个产品"、两级隔离、seam 全表 | 10 |
| 04 | [扩展与生态：Skill、插件、协议、SDK](04-扩展与生态.md) | 557 | 怎么加能力而不改它：Skill / hooks 桥接 / `tool-cordis` / MCP·ACP / Python SDK | 16 · 17 · 23 |
| 05 | [启动流程与 Cordis 落地](05-启动与Cordis落地.md) | 671 | 敲下 `dsh web` 之后：profile/bundle 分层、fail-loud、以及底下那份 vendored cordis | 03 · 04 |
| 06 | [Agent 循环与会话日志](06-Agent循环与会话日志.md) ⭐ | 779 | 一个 turn 怎么跑（`turn()` 逐句）、跑出来的东西存哪（**Model-visible means logged**） | 05 · 06 |
| 07 | [请求管线：LLM、工具与 SystemPrompt](07-请求管线-LLM工具与提示.md) ⭐ | 864 | 一次模型请求怎么被组装、发出、收回：`ctx.llm` → `ctx.tools` → `ctx.systemPrompt` | 07 · 08 · 09 |
| 08 | [执行侧服务：文件、Shell、沙箱、子代理、压缩](08-执行侧服务-文件Shell沙箱子代理压缩.md) | 1007 | agent 真正"动手"的那几个 seam 各自的契约与 fail-closed 边界 | 11 · 12 · 13 · 14 · 15 |
| 09 | [宿主与运行面：Web、网关、编排、存储、类型](09-宿主与运行面-Web网关编排存储类型.md) | 907 | 把内核交付给人和程序的那一层：前端、网关、五种编排、四条存储、类型系统 | 18 · 19 · 20 · 21 · 22 |
| 10 | [测试与工程实践](10-测试与工程实践.md) | 267 | 测试占 45%、**逐文件 100% 覆盖率门禁**、快照回放、双轨 CI、1372 篇 agent 笔记 | 24 |
| 11 | [关键调用链速查](11-关键调用链速查.md) | 410 | 四条核心链、事件全表、逐包符号表、配置速查、**症状 → 分册路由** | 25 |

合并后的篇目里，章节号已**重新连续编号**（例如原 07/08/09 的小节现在是 7.1…7.27），篇首用 📎 标注了来源。

## 四、阅读路线

![DSH 系列阅读路线](diagrams/00-dsh-reading-path.svg)

**DSH 系列阅读路线** — [交互版](diagrams/00-dsh-reading-path.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/00-dsh-reading-path.architecture.json)

- **cordis 是前置知识**：DSH 的每个能力都是 cordis Service · 不懂 Fiber 与 Context 会读不动 05 篇之后 · 建议先花时间读 cordis 03 与 04
- **两篇重点**：03 能力缝解释整个架构的组织原则 · 04 扩展与生态给出全部扩展点地图 · 读完这两篇就能自己找路
- **11 篇是索引**：按调用链组织，便于回查 · 读完任一篇都可以随时跳回 · 配合各篇的源码行号使用

### 按身份选路

| 你是 | 建议路线 |
|---|---|
| **想给 DSH 写插件** | [03](03-能力缝与服务全景.md)（seam 全表）+ [07](07-请求管线-LLM工具与提示.md)（工具与提示）+ [配套示例工程](../../dsh-example/README.md) + 官方 `docs/cookbook/` |
| **想改 agent 主循环** | [06](06-Agent循环与会话日志.md) 精读；但更可能应该用 `agent/*` 事件（[06 § 6.8](06-Agent循环与会话日志.md)） |
| **在排查线上问题** | [11 § 11.10](11-关键调用链速查.md) 症状路由表 |
| **关心"上下文怎么管的"** | [06 § 6.12](06-Agent循环与会话日志.md) → [07 § 7.18](07-请求管线-LLM工具与提示.md) → [08 § 8.32](08-执行侧服务-文件Shell沙箱子代理压缩.md) → [09 § 9.28](09-宿主与运行面-Web网关编排存储类型.md) |
| **关心安全边界** | [08 § 8.17](08-执行侧服务-文件Shell沙箱子代理压缩.md) → [08 § 8.11](08-执行侧服务-文件Shell沙箱子代理压缩.md) → [08 § 8.4](08-执行侧服务-文件Shell沙箱子代理压缩.md) |
| **想接自己的模型 / 沙箱 / 文件系统** | [07 § 7.2](07-请求管线-LLM工具与提示.md)（1 个方法）/ [08 § 8.18](08-执行侧服务-文件Shell沙箱子代理压缩.md)（1 个）/ [08 § 8.2](08-执行侧服务-文件Shell沙箱子代理压缩.md)（13 个），各配一个可跑示例 |
| **做前端集成** | [09 § 9.1](09-宿主与运行面-Web网关编排存储类型.md) 起读整篇 |
| **用程序驱动 dsh** | [04 § 4.18](04-扩展与生态.md)（Python SDK）或 [04 § 4.13](04-扩展与生态.md)（ACP） |
| **只想看工程实践** | [10](10-测试与工程实践.md)（100% 覆盖率门禁、agent 笔记） |

## 五、配套示例工程

本仓库带一套**能真跑**的示例：[`dsh-example/`](../../dsh-example/README.md)。
它的每一个 `import` 都指向 npm 公共 registry 上真实发布的 `@deepseek-ai/*` 包（版本线 `0.1.1-rc.2`），
`run.ts` 用真实 `@deepseek-ai/cordis` 的 `Context` 装配真实 core 服务（含真实 `dsh-agent-loop` 主循环），
只有"模型"这一处换成一个真实的 `LlmAdapter` 子类以保证离线可跑。

| 文档章节 | 配套示例 |
|---|---|
| [03 § 3.1](03-能力缝与服务全景.md) seam 三角色 | 05 llm-adapter-mock |
| [03 § 3.8](03-能力缝与服务全景.md) seam 全表 | 05 · 13 · 14 · 15 · 16 · 21 · 22 · 23 · 24 · 25 |
| [04 § 4.1](04-扩展与生态.md) 扩展路径 · [§ 4.3](04-扩展与生态.md) hooks | 08 skill · 09 lifecycle-steering |
| [05 § 5.1](05-启动与Cordis落地.md) profile/bundle · [§ 5.17](05-启动与Cordis落地.md) cordis 原语 | `cordis.yml` · 17 dispatch-modes · 26 cordis-timer |
| [06 § 6.4](06-Agent循环与会话日志.md) `turn()` · [§ 6.8](06-Agent循环与会话日志.md) `agent/*` · [§ 6.9](06-Agent循环与会话日志.md) Inbox | 06 telemetry · 09 steering · 19 inbox |
| [06 § 6.12](06-Agent循环与会话日志.md) 不变量 · [§ 6.15](06-Agent循环与会话日志.md) `surfaceOp` · [§ 6.19](06-Agent循环与会话日志.md) fork | 18 session-log |
| [07 § 7.2](07-请求管线-LLM工具与提示.md) `LlmAdapter` · [§ 7.3](07-请求管线-LLM工具与提示.md) `llm/stream` | 05 adapter · 20 stream-intercept |
| [07 § 7.10](07-请求管线-LLM工具与提示.md) `ToolDefinition` · [§ 7.11](07-请求管线-LLM工具与提示.md) 三段 waterfall · [§ 7.14](07-请求管线-LLM工具与提示.md) 注册表 | 01 tool · 03 gate · 07 transform · 12 guard · 11 restrict |
| [07 § 7.18](07-请求管线-LLM工具与提示.md) 四类注册 · [§ 7.26](07-请求管线-LLM工具与提示.md) assemble waterfall | 02 prompt-section · 10 variable-assemble |
| [08 § 8.2](08-执行侧服务-文件Shell沙箱子代理压缩.md) `FileSystem` · [§ 8.11](08-执行侧服务-文件Shell沙箱子代理压缩.md) `ShellExecutor` | 16 fs/subprocess · 24 shell |
| [08 § 8.18](08-执行侧服务-文件Shell沙箱子代理压缩.md) `confine` · [§ 8.21](08-执行侧服务-文件Shell沙箱子代理压缩.md) 审批链 | 25 sandbox · 13 approval |
| [08 § 8.27](08-执行侧服务-文件Shell沙箱子代理压缩.md) 子代理驱动 · [§ 8.33](08-执行侧服务-文件Shell沙箱子代理压缩.md) · [§ 8.34](08-执行侧服务-文件Shell沙箱子代理压缩.md) 压缩 | 15 subagent · 14 compaction |
| [09 § 9.17](09-宿主与运行面-Web网关编排存储类型.md) settings · [§ 9.20](09-宿主与运行面-Web网关编排存储类型.md) Jobs · [§ 9.23](09-宿主与运行面-Web网关编排存储类型.md) Goal | 23 settings · 21 jobs · 22 goals |

💡 写这套示例的过程本身是一次**保真度审计**：真实 `0.1.1-rc.2` 与快照 `47f94385` 之间的若干 API 差异
（`{% raw %}{{name}}{% endraw %}` 占位语法、`approval.request()` 的轮内约束、`ctx.tools.execute` 取代 `call`、
`SubagentRun` 是句柄而非结果、`assistant/message` 必须带 model 来源……）
都记在[示例工程 README 的"常见误解"对照表](../../dsh-example/README.md)里。

## 六、主题对齐矩阵

| 统一主题 | Cordis 地基 | DeepSeek Harness | 可跑示例 |
|---|---|---|---|
| 定位与代码地图 | [Cordis 01](../hello-cordis/01-项目概览与设计哲学.md) · [02](../hello-cordis/02-代码结构与包边界.md) | [01 项目概览](01-项目概览.md) · [02 代码结构地图](02-代码结构地图.md) | [`cordis.yml`](../../dsh-example/cordis.yml) |
| 生命周期与服务 | [Cordis 03 Fiber](../hello-cordis/03-Fiber模型.md) · [04 Context](../hello-cordis/04-Context与Reflect代理.md) · [05 Service](../hello-cordis/05-服务注册与依赖解析.md) | [03 Seam](03-能力缝与服务全景.md) · [05 启动](05-启动与Cordis落地.md) | [05 adapter](../../dsh-example/05-llm-adapter/README.md) · [26 timer](../../dsh-example/26-cordis-timer/README.md) |
| 事件与扩展 | [Cordis 06 Events](../hello-cordis/06-事件系统与Waterfall.md) | [04 扩展](04-扩展与生态.md) · [06 Agent](06-Agent循环与会话日志.md) · [07 请求管线](07-请求管线-LLM工具与提示.md) | [09 lifecycle](../../dsh-example/09-hooks-lifecycle-steering/README.md) · [17 dispatch](../../dsh-example/17-dispatch-modes/README.md) · [20 stream](../../dsh-example/20-llm-stream/README.md) |
| 配置、装配与热更新 | [Cordis 07 Loader](../hello-cordis/07-Loader与配置树.md) · [08 HMR](../hello-cordis/08-HMR热重载.md) | [05 启动与 Cordis](05-启动与Cordis落地.md) | [`cordis.yml`](../../dsh-example/cordis.yml) · [26 timer](../../dsh-example/26-cordis-timer/README.md) |
| Agent 状态与请求管线 | [Cordis 03–06](../hello-cordis/03-Fiber模型.md) | [06 Agent 与会话](06-Agent循环与会话日志.md) · [07 LLM/工具/提示](07-请求管线-LLM工具与提示.md) | [06 telemetry](../../dsh-example/06-agent-events-telemetry/README.md) · [18 session](../../dsh-example/18-session-log/README.md) · [20 stream](../../dsh-example/20-llm-stream/README.md) |
| 执行、安全与宿主 | [Cordis 03–07](../hello-cordis/03-Fiber模型.md) | [08 执行侧](08-执行侧服务-文件Shell沙箱子代理压缩.md) · [09 宿主与运行面](09-宿主与运行面-Web网关编排存储类型.md) | [13 approval](../../dsh-example/13-approval-answerer/README.md) · [16 side-effects](../../dsh-example/16-fs-shell-side-effects/README.md) · [25 sandbox](../../dsh-example/25-sandbox-seam/README.md) |
| 测试、速查与排障 | [Cordis 09](../hello-cordis/09-关键调用链速查.md) | [10 测试](10-测试与工程实践.md) · [11 速查](11-关键调用链速查.md) | [示例索引与批量运行](../../dsh-example/README.md) |

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
| **行号** | 对应快照 `47f94385`，**已逐条比对源码核实**（267 处 `文件:行号` 引用全部复核，个别区间端点可能 ±1）。上游迭代极快，建议以符号名检索；统一符号行号索引见 [11 § 11.6](11-关键调用链速查.md) |
| **章节编号** | `N.M`，N 为**现在的**篇号。合并篇目已重新连续编号，篇首 📎 标注了原篇来源 |
| **💡 提示块** | 反直觉事实、设计取舍、常见踩坑 |
| **📐 配套示例块** | 该节对应的可跑示例（`dsh-example/`），含关键代码片段与实测输出 |
| **测试** | 测试与工程机制以 [10](10-测试与工程实践.md) 为主篇；各篇只保留与主题直接相关的测试描述 |
| **⭐ 标记** | 全系列最核心的 5 篇（03、06、07 + cordis 的 03、04） |
| **交叉引用** | 篇内相对链接；跨文档集用 `../hello-cordis/`。只引用本仓库内实际存在的文档，可用 `python3 scripts/check_doc_links.py` 校验 |

## 九、文档集定位

DSH **自带极完整的一手文档**：`docs/` 下 215 篇 md（含 105 篇 `.zh.md` 中文版）、`AGENTS.md` = `CLAUDE.md`（149 行）、`.agents/notes/` 1372 篇设计笔记。**完整清单与优先阅读顺序见 [01 § 1.8](01-项目概览.md)。**

![官方文档、本文档集与示例工程的分工](diagrams/00-docs-division.svg)

**官方文档、本文档集与示例工程的分工** — [交互版](diagrams/00-docs-division.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/00-docs-division.architecture.json)

- **三者的选择**：想知道怎么用与怎么扩展就读官方 · 想知道怎么实现与代码在哪就读这里 · 想立刻跑一个就看示例工程
- **官方文档已很完整**：subsystems 有 92 篇，user 26 篇 · cookbook 与 cordis-tutorial 各 16 篇 · 并且一半有中文版
- **示例装的是真实包**：依赖发布到 npm 的 deepseek-ai 系列包 · 不是 vendored 快照 · 因此能验证真实的扩展契约

## 十、这套文档不做什么

- **不替代官方文档**。`docs/architecture.md`（129 行）与 `AGENTS.md`（149 行）是必读的一手材料，本文档集多处直接引用并标注来源。
- **不逐个覆盖这 221 个包**。`client` 一个组就 137889 行；11 篇给的是**架构骨架 + 关键类定位**，不是 API 手册。
- **不做性能分析**。文中的量级判断来自代码结构与注释，不是实测。
- **不追踪上游变化**。**DSH 迭代极快**（快照附近有多个 release commit）。这是快照式分析，后续变化应以 § 一的 commit 为基线做增量复核。
- **未深入的部分**：`client` 组内部的 React 实现细节、`host/apiproxy`（8571 行）的逐模块拆解、`typert/generator`（6245 行）的生成算法、`sandbox-windows-acl`（2530 行）的 ACL 细节。这些篇目给了定位与设计意图，没有逐行拆解。

---

**开始阅读** → [01 项目概览](01-项目概览.md) ｜ **想直接动手** → [配套示例工程](../../dsh-example/README.md)

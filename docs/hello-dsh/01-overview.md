---
title: "项目概览"
---
# 项目概览

> **本篇回答**：DSH 是什么、"Everything is a Plugin"在代码里怎么落地、规模与版本的真实情况、以及读这个仓库前必须知道的五件事。
> **路径缩写**：`P/` = `packages/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：1.1–1.3 定位、版本与规模 → 1.4–1.5 一次对话的流转与三个核心概念 → 1.6–1.7 vendored cordis 分叉与必知五件事 → 1.8–1.9 一手文档清单与阅读路线。
>
> 📎 **来源**：本篇对应初版第 01 篇；主题与篇号保持不变。

## 1.1 一句话定位

DeepSeek Harness（`dsh`）是 DeepSeek 开源的 **agent harness**——一个跑 coding agent 的运行时框架。它的架构主张写在 README 首屏（`README.md:7`）：

> It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

官方引用文献的标题就叫 *DeepSeek Harness: Everything is a Plugin*。`docs/architecture.md:9` 说得更直白：

> Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration.

![没有特权内核的架构差异](diagrams/01-no-kernel.svg)

**没有特权内核的架构差异** — [交互版](diagrams/01-no-kernel.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-no-kernel.architecture.json)

- **特权内核的代价**：内核里的能力无法被替换，只能被配置 · 扩展点由框架作者预先决定 · 没有预留 hook 的地方就改不了
- **DSH 的取法**：连 agent 主循环本身都是一个 cordis 插件 · 于是替换主循环与替换一个工具是同一种操作 · 代价是启动链路更长、配置更显式
- **怎么自己验证**：读 dsh-base bundle 的 cordis.patch.yml · 确认核心能力都以配置行形式出现 · 任何一行都可以被上层 patch 按 id 覆盖

## 1.2 版本与元数据

仓库、分支、快照 commit、Node 与包管理器版本等元信息统一维护在 [索引 § 一](README.md)，不在此重复。stars 之类的网络元数据无法从源码快照复核，不用于判断。README 能确认的是项目状态：

> DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

配合快照事实，说明这是**已连续发布多个 tag、仍在快速迭代**的项目：

- 快照 HEAD 就是 release 合并提交：`38a6a5c965 Merge pull request #8397 from deepseek-harness/worktree-release-dsh-0.2.2-rc.3`（2026-11-13）——发布准备在独立 git worktree 分支里生成，再并回主线。
- 发布是**显式人工动作**：`release-publish.yml` 只接受 `workflow_dispatch`，注释明确说 "publication is an explicit, reviewed act"，并默认校验 `dsh-v*` tag。
- 官方维护逐版本迁移文档：`docs/upgrade-guide/` 286 篇 md，从 v0.1.7-rc.2 起每个版本一个目录——不再是 0.1.5 时代"格式无兼容承诺"的姿态（见 [10 § 10.9](10-testing-and-engineering.md)）。

## 1.3 规模

| 指标 | 数值 |
|---|---|
| TypeScript（`.ts`，`packages/`+`apps/`） | 5818 文件 / **1245618 行** |
| React（`.tsx`，`packages/`+`apps/`） | 871 文件 / 214609 行 |
| **代码合计（`packages/`+`apps/`）** | **≈ 1460227 行**（`packages/` 1310294 + `apps/` 149933） |
| Markdown（全仓） | 5160 文件 / 468419 行 |
| JSON（全仓） | 3709 文件 / 188860 行 |
| YAML（`.yml`） | 762 文件 / 22676 行（另有 2186 个 `.yaml`，多为 i18n） |
| Python（全仓） | 85 文件 / 21514 行（其中 `python/` 45 文件 / 8780 行） |
| **`package.json`** | **414 个**；workspace 包 379（`packages/*/*` 374 + `apps/*` 5），380 个声明 `0.2.2-rc.3` |
| 顶层脚本（`scripts/`） | 374 个顶层条目（365 文件 + 9 子目录） |
| 根 `package.json` 的 scripts | **205 条** |

顶层目录体积与布局见 [02 § 2.1](02-codebase-map.md)。

### 各包组代码行数（`.ts` + `.tsx`，含 spec 与生成物）

| 组 | 行数 | 组 | 行数 |
|---|---|---|---|
| **client** | **396936** | ssh | 6580 |
| **experimental** | **255143** | goal | 6128 |
| api | 71158 | terminal | 6084 |
| session | 52304 | lsp | 5967 |
| **core** | **50758** | bundle | 5656 |
| llm | 42716 | workflow | 5600 |
| subagent | 37382 | acp | 5352 |
| boot | 35715 | document | 5136 |
| extensions | 30960 | storage | 5032 |
| test-support | 25267 | attachment | 4551 |
| typert | 20679 | team | 4284 |
| fs | 18312 | deliverables | 3245 |
| subprocess | 17412 | spill | 3133 |
| shell | 16507 | workspace | 3033 |
| util | 15358 | preset | 2510 |
| context | 15004 | plan | 2251 |
| session-query | 14597 | feedback | 2130 |
| schedule | 11977 | settings | 1505 |
| sandbox | 11427 | identity | 205 |
| sdk | 10305 | guard | 978 |
| web | 9948 | todo | 946 |
| host | 9900 | telemetry | 940 |
| mcp | 9390 | browser-use | 113 |
| compaction | 9120 | computer-use | 113 |
| ptc-runtime | 9009 | | |
| credentials | 8725 | | |
| skill | 8552 | | |
| interaction | 7346 | | |
| jobs | 6902 | | |

共 **53 组**（`ls packages` 实测）。`apps/` 5 个产品装配包共 149933 行（web 80172 · desktop 48496 · cli 17767 · plugin-market-generator 2538 · desktop-host 960），不在上表；`scripts/` 另有 86891 行 TypeScript。

测试口径：**2531 个 spec / 742352 行，占 `packages/`+`apps/` 代码（1460227 行）约 51%**（`*.spec.ts(x)`；`scripts/` 下另有 177 个 spec 不计）。展开见 [10 § 10.1](10-testing-and-engineering.md)。

从这张表可以读出两条判断：

💡 **`client` 一个包组就占 396936 行（约 27%），`experimental` 试验层占 255143 行（63 包）**——Web 前端与试验能力分别是整个 agent 内核（`core` 50758 行）的 7.8 倍与 5 倍。这是大型 agent 项目的常见形态：核心机制小，外围能力大。

💡 **`core` 只占约 3.5%**，但它定义了整套架构的契约。**读 DSH 从 `core` 读，别从 `client` 读。**

## 1.4 五分钟看懂一次对话的流转

主循环实现：`P/core/agent-loop/src/agent.ts`

![从用户输入到 turn/step 循环](diagrams/01-request-loop.svg)

**从用户输入到 turn/step 循环** — [交互版](diagrams/01-request-loop.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-request-loop.architecture.json)

- **Inbox 是唯一入口**：四种投递方式最终都落进同一个 Inbox · preStep 统一从 Inbox claim · 因此人类输入与程序注入走同一条路
- **历史来自日志投影**：会话历史不是内存里的数组 · 由 session.deriveMessages() 从事件日志算出 · 因此可以随时重放与修复
- **主循环实现位置**：P/core/agent-loop/src/agent.ts 共 751 行（`turn()` `:333`、`preStep()` `:289`、`step()` `:441`）· turn 包含多个 step · 有 tool call 就回到 preStep 继续下一 step

详见 [06 篇](06-agent-loop-and-session-log.md)（turn/step）与 [06 篇](06-agent-loop-and-session-log.md)（事件日志）。

## 1.5 三个核心概念

![三个核心概念：Profile、Seam、日志](diagrams/01-three-concepts.svg)

**三个核心概念：Profile、Seam、日志** — [交互版](diagrams/01-three-concepts.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-three-concepts.architecture.json)

- **分层顺序是确定的**：profile 按序叠加它列出的每个 bundle · 各 bundle 按序叠加，然后 profile patch · 再叠 home patch，最后是命令行 --patch · 底层就是 cordis include 的 applyPatches
- **六个内置 bundle、五个 profile 模板**：dsh-base 550 行 patch（99 条 `- id:` 行），列出全部基础行 · dsh-web-app 620 行按 id 覆盖并加浏览器应用 · dsh-headless 46 行一次性 runner · 新增 acp-app 23 / sdk-app 87 / sdk-minimal 179 三个 bundle；profile 模板为 acp / web / headless / sdk / sdk-minimal 五个（`P/util/official-bundles/src/bundles.ts:10-25` 的 `PROFILE_TEMPLATES`）
- **bundle 可退役、可替换**：`RETIRED_BUNDLES`（`bundles.ts:37-41`）记录不再随安装发布的 bundle（如 `dsh-experimental-schedule-bundle`），app-boot 会把它们从既有 profile 移除；`INSTALLATION_OWNED_PROFILE_TUPLES`（`:32`）负责把旧 release 写死的组合自动替换成当前模板
- **Seam 三角色缺一不可**：Definition 声明接口，不含实现 · Provider 提供实现，可有多个候选 · Consumer 通常是模型可见的工具；换 provider 就换掉整个产品形态

详见 [05 篇](05-startup-and-cordis-runtime.md)、[03 篇](03-capability-seams-and-services.md)。

> 📐 **这三个概念都能立刻上手跑**：本仓库的 [配套工程 dsh-lab](../../dsh-lab/README.md) 有 21 个完全独立的一文一工程示例（cordis 6 + dsh 15），
> 全部装在**真实发布的 `@deepseek-ai/*` npm 包**上（`0.2.2-rc.3`，与正文快照同版）——
> profile/bundle 看 [`cordis.yml`](../../dsh-lab/examples/21-dsh-chat-demo/cordis.yml) 与 [`cordis.patch.yml`](../../dsh-lab/examples/21-dsh-chat-demo/cordis.patch.yml)，
> seam 看 [M03 · 推理服务接入](../../dsh-lab/examples/10-dsh-llm-adapter-demo/README.md) / [M07.3 · 沙箱模式](../../dsh-lab/examples/15-dsh-sandbox-demo/src/index.ts)，
> 三类事件域看 [M04.1 · 观察 turn 边界](../../dsh-lab/examples/11-dsh-agent-loop-demo/src/index.ts) / [M04.2 · 在 turn 结束前 steer](../../dsh-lab/examples/11-dsh-agent-loop-demo/src/index.ts) / [M01.2 · 权限门](../../dsh-lab/examples/08-dsh-tool-pipeline-demo/src/index.ts)。

## 1.6 ⚠️ DSH 用的 cordis 是 vendored 的分叉

这是读 DSH 前**必须知道**的一件事，也是本文档集的一个实测发现。

DSH 把 cordis 全家桶 vendor 进 `vendor/` 并 rescope 到 `@deepseek-ai/*`：

| `vendor/` 下的包 | DSH 版本 | 上游对应版本 |
|---|---|---|
| `@deepseek-ai/cordis` | **4.1.0** | `cordis@4.0.0-rc.11` |
| `@deepseek-ai/cordis-plugin-loader` | 1.1.0 | `@cordisjs/plugin-loader@1.0.0-rc.8` |
| `@deepseek-ai/cordis-plugin-hmr` | 1.1.0 | `@cordisjs/plugin-hmr@1.0.15` |
| `@deepseek-ai/cordis-plugin-include` | 1.1.0 | `@cordisjs/plugin-include@1.1.1` |
| `@deepseek-ai/cordis-plugin-group` | 1.1.0 | `@cordisjs/plugin-group@1.0.0` |
| `@deepseek-ai/cordis-plugin-timer` | 1.2.0 | `@cordisjs/plugin-timer@1.1.4` |
| `@deepseek-ai/cordis-plugin-logger-console` | 1.1.0 | `@cordisjs/plugin-logger-console@1.0.0` |
| `@deepseek-ai/cosmokit` | 1.9.0 | `cosmokit@1.8.1` |
| `@deepseek-ai/schemastery` | 3.19.0 | `schemastery@3.18.0` |

上游版本与源码 commit 以 `vendor/README.md` 的清单表为准（rc.1 曾存在的 `vendor/cordis-rc11-upgrade-plan.md` 升级计划文件，在升级到 4.1.0 后已删除）。

`pnpm-workspace.yaml` 用 `overrides` 强制指向本地：

```yaml
overrides:
  '@deepseek-ai/cosmokit': 'link:vendor/cosmokit'
  '@deepseek-ai/schemastery': 'link:vendor/schemastery'
```

### 分叉有多大

`vendor/cordis/src` 共 **2811 行**（9 个文件：`fiber.ts` 820 · `reflect.ts` 436 · `events.ts` 371 · `registry.ts` 337 · `utils.ts` 294 · `logger.ts` 276（rc.3 新增，日志服务进 core）· `context.ts` 146 · `service.ts` 115 · `index.ts` 16）。分叉不再靠手工对表维护——`vendor/README.md` 逐条记录 V1–V14 差异：**V7 明说差异大头是 JSDoc enrichment（"Comment-only; no code changes"）**，实质代码加固集中在 fiber（V6，"closes three reentrant disposal gaps"）。

三处 fiber 加固仍在，但第三处在 rc.3 被**重写**了：

| vendor 加固 | 位置 | 作用 |
|---|---|---|
| `effectInertia` WeakMap + `runDisposable()` | `vendor/cordis/src/fiber.ts:112`、`:114` | 记录每个 disposable 的在途卸载任务，等待 wrapper 卸载时也等嵌套的异步 teardown |
| `emitPluginDisposed()` | `vendor/cordis/src/fiber.ts:120` | 派发 `internal/plugin` 时**逐个 try/catch 每个监听器**（同步与 Promise 都兜），一个坏监听器不会破坏所有权清理 |
| `_configRevision` 代次计数 | `fiber.ts:210`（声明）、`:656`（reload 递增）、`:791-800`（update 竞态判定） | 取代 0.1.5 的"`_config` 保留原始配置 + 每次激活前 `_resolveConfig()` 重解析"：现在用配置代次号判定 reload/update 竞态，`_resolveConfig` 已不存在 |

💡 **含义**：[cordis 文档集](../hello-cordis/README.md) 分析的是**上游 4.0.0-rc.10**。机制、API、语义与 DSH 基本一致（DSH fork 基于 rc.11，差异以注释与文档为主），可以放心用来理解 DSH。但**行号不能直接套用**——vendor 版 `fiber.ts` 已到 820 行。[05 篇](05-startup-and-cordis-runtime.md) 给出两边的对照。

💡 **`scripts/` 里有配套校验**：`check-vendor-manifest.sh`、`rescope-vendor.ts`、`cordis-core-api.ts` + spec、`gen-cordis-api.ts`——DSH 用脚本锁住 vendored cordis 的 API 表面，防止无意分叉。

## 1.7 读这个仓库前必须知道的五件事

![读这个仓库前必须知道的五件事](diagrams/01-five-facts.svg)

**读这个仓库前必须知道的五件事** — [交互版](diagrams/01-five-facts.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-five-facts.architecture.json)

- **先读官方再读这里**：上游 docs 的 subsystems 有 138 篇（69 主题 × en/zh）· cookbook 26 篇、cordis-tutorial 16 篇 · 另有 `docs/upgrade-guide/` 286 篇逐版本迁移 · 本文档集补的是实现细节与调用链
- **包名后缀对照**：无后缀是 Service Definition · -local / -sandbox / -ssh 是 Provider · tool- 前缀是模型可见工具，command- 是人类命令
- **374 个包怎么读**：按组读，不要按包读 · 先定位 core 组的十个包 · 再按需下钻到具体能力组（experimental 组 63 包是试验层，别从它读起）

## 1.8 上游一手文档清单（优先读这些）

| 文档 | 行数 | 内容 |
|---|---|---|
| **`docs/architecture.md`** | 171 | **必读**。cordis 底座、profile/bundle、core 包表、三类事件域、turn 流程、seam、"Where new behavior goes"映射表（`:144` 起，22 行映射） |
| `docs/cordis-primer.md` | — | cordis 入门 |
| `docs/cordis-tutorial/` | 16 md | cordis 教程 |
| `docs/cordis-api/` | 11 md | cordis API 参考（脚本生成） |
| `docs/agent-lifecycle.md` | — | agent 生命周期时序图 |
| `docs/tool-execution-pipeline.md` | — | 工具执行管线 |
| `docs/capability-seams.md` | — | 能力接缝图谱 |
| `docs/event-producer-consumer.md` | — | 事件生产者/消费者全表 |
| `docs/config-catalog.md` / `docs/tool-catalog.md` | — | 配置与工具目录（脚本生成） |
| `docs/module-graph.md` / `graph-atlas.md` | — | 模块依赖图 |
| `docs/persistence-catalog.md` | — | 持久化目录 |
| `docs/glossary.md` | — | 术语表 |
| `docs/defensive-patterns/` | 6 md | 防御式编程模式（rc.3 从单文件扩成目录，配 zh） |
| **`docs/upgrade-guide/`** | 286 md | **逐版本迁移指南**（v0.1.7-rc.2 起每版本一目录）；版本纪律的事实源 |
| `docs/session-format-status.md` | — | 会话格式版本状态（`SESSION_FORMAT_VERSION = 4`） |
| `docs/api-gateway.md`、`cli-help.md`、`development.md`、`testing.md`、`rescope.md`、`experimental-persistence-catalog.md`、`deepseek-llm-api-wire-extensions.md`、`web-styling.md`、`ui-radius.md` | — | 专题单页（网关 / CLI / 开发 / 测试 / rescope / 实验性持久化 / DeepSeek API 扩展 / 前端样式规范） |
| `docs/subsystems/` | 138 md | 逐子系统契约（69 主题 × en/zh） |
| `docs/cookbook/` | 26 md | 扩展指南（加包 / 加工具 / 加 LLM 适配器 / 加会话格式版本 / 加 settings 卡片） |
| `docs/postmortem/` | 10 md | 事故复盘 |
| `docs/user/` | 42 md | 用户指南（rc.3 重组为 `develop/` + `guide/` 两区） |
| `AGENTS.md` = `CLAUDE.md` | 189 | 给 agent 的仓库约定（`CLAUDE.md` 为符号链接） |

💡 **本文档集的定位**：官方文档讲"契约是什么、怎么扩展"；本文档集讲**"实现在哪一行、为什么这样实现、跑起来的实际路径"**，并补上官方没有的**跨仓库视角**（DSH ↔ cordis 的对应关系）。

## 1.9 阅读路线

五个阶段的推荐路线（🅐 地基 → 🅑 核心概念 → 🅒 内核 → 🅓 能力与运行面 → 🅔 工程与速查）
以及「按身份选路」表统一维护在 [索引 § 四 阅读路线](README.md)，不在此重复。


---

**返回** ← [索引](README.md) ｜ **下一篇** → [02 代码结构地图](02-codebase-map.md)：`packages/` 下 374 个包怎么组织、六类命名后缀的语义、"想改 X 去哪"。

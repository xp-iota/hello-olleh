---
title: "项目概览"
---
# 项目概览

> **本篇回答**：DSH 是什么、"Everything is a Plugin"在代码里怎么落地、规模与版本的真实情况、以及读这个仓库前必须知道的五件事。
> **路径缩写**：`P/` = `packages/`。行号对应快照 `fb2c4b9e`。
>
> 🧭 **本篇导览**：1.1–1.3 定位、版本与规模 → 1.4–1.5 一次对话的流转与三个核心概念 → 1.6–1.7 vendored cordis 分叉与必知五件事 → 1.8–1.9 一手文档清单与阅读路线。
>
> 📎 **来源**：本篇对应初版第 01 篇；主题与篇号保持不变。

## 1.1 一句话定位

DeepSeek Harness（`dsh`）是 DeepSeek 开源的 **agent harness**——一个跑 coding agent 的运行时框架。它的架构主张写在 README 第一行：

> It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis).

![没有特权内核的架构差异](diagrams/01-no-kernel.svg)

**没有特权内核的架构差异** — [交互版](diagrams/01-no-kernel.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-no-kernel.architecture.json)

- **特权内核的代价**：内核里的能力无法被替换，只能被配置 · 扩展点由框架作者预先决定 · 没有预留 hook 的地方就改不了
- **DSH 的取法**：连 agent 主循环本身都是一个 cordis 插件 · 于是替换主循环与替换一个工具是同一种操作 · 代价是启动链路更长、配置更显式
- **怎么自己验证**：读 dsh-base bundle 的 cordis.patch.yml · 确认核心能力都以配置行形式出现 · 任何一行都可以被上层 patch 按 id 覆盖

## 1.2 版本与元数据

仓库、分支、快照 commit、stars、Node 与包管理器版本等元信息统一维护在 [索引 § 一](README.md)，不在此重复。

💡 **GitHub API 采集值显示 52912 stars，但“仓库创建时间”晚于快照 commit 17 分 46 秒，时间关系异常。** 这两项都属于无法从源码快照复核的网络元数据，不用于判断仓库年龄。README 能确认的是项目状态：

> DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

配合 `0.1.5-rc.2` 与当前发布 tag，说明这是**刚公开、快速迭代中**的项目。快照里最近几个 commit 就是 `release(dsh): 0.1.5-rc.2`、`build(release): publish the dsh family publicly`——公开发布刚完成。

## 1.3 规模

| 指标 | 数值 |
|---|---|
| TypeScript（`.ts`） | 2319 文件 / **497489 行** |
| React（`.tsx`） | 259 文件 / 66633 行 |
| **代码合计** | **≈ 564122 行** |
| Markdown | 2355 文件 / 169055 行 |
| JSON | 689 文件 / 42153 行 |
| YAML（`.yml`） | 150 文件 / 8228 行（另有 1086 个 `.yaml`，多为 i18n） |
| Python | 19 文件 / 4286 行 |
| **发布包 / `package.json`** | **221 / 228**（221 = `packages/*/*` 219 + `apps/*` 2；余 7 个为 `@fixture/*` 测试夹具） |
| 顶层脚本（`scripts/`） | 145 个顶层条目（142 文件 + 3 子目录） |
| 根 `package.json` 的 scripts | **123 条** |

顶层目录体积与布局见 [02 § 2.1](02-codebase-map.md)。

### 各包组代码行数（`.ts` + `.tsx`）

| 组 | 行数 | 组 | 行数 |
|---|---|---|---|
| **client** | **137889** | terminal | 5721 |
| **core** | **40745** | lsp | 5496 |
| subagent | 24466 | hooks | 4933 |
| host | 22412 | sdk | 4471 |
| session | 21442 | api | 4415 |
| llm | 20414 | schedule | 4298 |
| extensions | 20251 | subprocess | 4256 |
| typert | 14561 | interaction | 4199 |
| test-support | 13344 | boot | 4081 |
| fs | 13044 | code-runtime | 3963 |
| session-query | 12283 | settings | 3897 |
| shell | 10405 | preset | 3794 |
| context | 10251 | jobs | 3699 |
| sandbox | 9040 | storage | 3400 |
| compaction | 8032 | mcp | 3322 |
| workflow | 7700 | examples | 2858 |
| e2b | 6630 | util | 2204 |
| skill | 6242 | feedback | 2155 |
| web | 5985 | workspace | 2147 |
| goal | 5786 | plan | 2028 |

其余：credentials 1819 · acp 1658 · spill 1473 · bundle 1410 · guard 1021 · todo 1003 · attachment 909 · runtime-diagnostics 540 · identity 248。

测试口径：**766 个 spec / 254848 行，占代码 45%**（`packages/` + `apps/` 下的 `*.spec.ts(x)`；`scripts/` 下另有 45 个不计）。展开见 [10 § 10.1](10-testing-and-engineering.md)。

从这张表可以读出两条判断：

💡 **`client` 一个包组就占 137889 行（占全部代码 24%）**——Web 前端比整个 agent 内核（`core` 40745 行）大 3.4 倍。这是大型 agent 项目的常见形态：核心机制小，外围能力大。

💡 **`core` 只占 7%**，但它定义了整套架构的契约。**读 DSH 从 `core` 读，别从 `client` 读。**

## 1.4 五分钟看懂一次对话的流转

主循环实现：`P/core/agent-loop/src/agent.ts`

![从用户输入到 turn/step 循环](diagrams/01-request-loop.svg)

**从用户输入到 turn/step 循环** — [交互版](diagrams/01-request-loop.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-request-loop.architecture.json)

- **Inbox 是唯一入口**：四种投递方式最终都落进同一个 Inbox · preStep 统一从 Inbox claim · 因此人类输入与程序注入走同一条路
- **历史来自日志投影**：会话历史不是内存里的数组 · 由 session.deriveMessages() 从事件日志算出 · 因此可以随时重放与修复
- **主循环实现位置**：P/core/agent-loop/src/agent.ts 共 496 行 · turn 包含多个 step · 有 tool call 就回到 preStep 继续下一 step

详见 [06 篇](06-agent-loop-and-session-log.md)（turn/step）与 [06 篇](06-agent-loop-and-session-log.md)（事件日志）。

## 1.5 三个核心概念

![三个核心概念：Profile、Seam、日志](diagrams/01-three-concepts.svg)

**三个核心概念：Profile、Seam、日志** — [交互版](diagrams/01-three-concepts.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-three-concepts.architecture.json)

- **分层顺序是确定的**：profile 按序叠加它列出的每个 bundle · 各 bundle 按序叠加，然后 profile patch · 再叠 home patch，最后是命令行 --patch · 底层就是 cordis include 的 applyPatches
- **三个内置 bundle**：dsh-base 451 行 patch，列出全部基础行 · dsh-web-app 424 行，按 id 覆盖并加浏览器应用 · dsh-headless 35 行，一次性 runner 不起 server
- **Seam 三角色缺一不可**：Definition 声明接口，不含实现 · Provider 提供实现，可有多个候选 · Consumer 通常是模型可见的工具；换 provider 就换掉整个产品形态

详见 [05 篇](05-startup-and-cordis-runtime.md)、[03 篇](03-capability-seams-and-services.md)。

> 📐 **这三个概念都能立刻上手跑**：本仓库的 [配套示例工程](../../dsh-example/README.md) 有 12 个方向模块（60 个可跑阶段），
> 全部装在**真实发布的 `@deepseek-ai/*` npm 包**上（`0.1.5-rc.2`）——
> profile/bundle 看 [`cordis.yml`](../../dsh-example/cordis.yml)，
> seam 看 [M03 · 推理服务接入](../../dsh-example/M03-inference-service-access/README.md) / [M07.3 · sandbox](../../dsh-example/M07-execution-backends/impl/03-sandbox-seam.ts)，
> 三类事件域看 [M04.1 · telemetry](../../dsh-example/M04-agent-loop-intervention/impl/01-agent-events-telemetry.ts) / [M04.2 · lifecycle](../../dsh-example/M04-agent-loop-intervention/impl/02-lifecycle-steering.ts) / [M01.2 · 权限门](../../dsh-example/M01-tool-pipeline/impl/02-permission-gate.ts)。

## 1.6 ⚠️ DSH 用的 cordis 是 vendored 的分叉

这是读 DSH 前**必须知道**的一件事，也是本文档集的一个实测发现。

DSH 把 cordis 全家桶 vendor 进 `vendor/` 并 rescope 到 `@deepseek-ai/*`：

| `vendor/` 下的包 | DSH 版本 | 上游对应版本 |
|---|---|---|
| `@deepseek-ai/cordis` | **4.0.2** | `cordis@4.0.0-rc.10` |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.2 | `@cordisjs/plugin-loader@1.0.0-rc.5` |
| `@deepseek-ai/cordis-plugin-hmr` | 1.0.16 | `@cordisjs/plugin-hmr@1.0.15` |
| `@deepseek-ai/cordis-plugin-include` | 1.0.6 | `@cordisjs/plugin-include@1.0.4` |
| `@deepseek-ai/cordis-plugin-group` | 1.0.1 | `@cordisjs/plugin-group@1.0.0` |
| `@deepseek-ai/cordis-plugin-timer` | 1.1.3 | `@cordisjs/plugin-timer@1.1.2` |
| `@deepseek-ai/cordis-plugin-logger-console` | 1.0.1 | `@cordisjs/plugin-logger-console@1.0.0` |
| `@deepseek-ai/cosmokit` | 1.8.2 | `cosmokit@1.8.1` |
| `@deepseek-ai/schemastery` | 3.18.1 | — |

`pnpm-workspace.yaml` 用 `overrides` 强制指向本地：

```yaml
overrides:
  '@deepseek-ai/cosmokit': 'link:vendor/cosmokit'
  '@deepseek-ai/schemastery': 'link:vendor/schemastery'
```

### 分叉有多大

`vendor/cordis/src` 共 **2693 行**，上游 `packages/core/src` 是 **1848 行**——**多 845 行（46%）**。但去掉空行与注释后：

| 文件 | 上游有效代码 | vendor 有效代码 | 差异 |
|---|---|---|---|
| `fiber.ts` | 419 | **535** | **+116** |
| `reflect.ts` | 245 | 246 | +1 |
| `events.ts` | 150 | 145 | −5 |
| `registry.ts` | 180 | 181 | +1 |
| `service.ts` | 69 | 69 | 0 |
| `context.ts` | 68 | 68 | 0 |
| `utils.ts` | 236 | 229 | −7 |

💡 **845 行差异里约 740 行是 JSDoc 注释**，实际代码只多约 106 行，且**几乎全集中在 `fiber.ts`**。DSH 给 vendored cordis 加了完整的文档注释，并对 fiber 做了三处实质加固：

| vendor 新增 | 位置 | 作用 |
|---|---|---|
| `effectInertia` WeakMap + `runDisposable()` | `vendor/cordis/src/fiber.ts:112`、`:114` | 记录每个 disposable 的在途卸载任务，等待 wrapper 卸载时也等嵌套的异步 teardown |
| `emitPluginDisposed()` | `vendor/cordis/src/fiber.ts:120` | 派发 `internal/plugin` 时**逐个 try/catch 每个监听器**（同步与 Promise 都兜），一个坏监听器不会破坏所有权清理 |
| `_config` 字段 + `_resolveConfig()` | `vendor/cordis/src/fiber.ts:192`、`:641` | 保留**未校验的原始配置**，**每次激活前重新解析**（`:655`）——上游只在构造时校验一次 |

💡 **含义**：[cordis 文档集](../hello-cordis/README.md) 分析的是**上游 4.0.0-rc.10**。机制、API、语义与 DSH 完全一致（有效代码差异 <3%），可以放心用来理解 DSH。但**行号不能直接套用**——vendor 版因为加了注释，行号整体后移。[05 篇](05-startup-and-cordis-runtime.md) 给出两边的对照。

💡 **`scripts/` 里有配套校验**：`check-vendor-manifest.sh`、`rescope-vendor:check`、`cordis-core-api.ts` + `.spec.ts`、`gen-cordis-api.ts`——DSH 用脚本锁住 vendored cordis 的 API 表面，防止无意分叉。

## 1.7 读这个仓库前必须知道的五件事

![读这个仓库前必须知道的五件事](diagrams/01-five-facts.svg)

**读这个仓库前必须知道的五件事** — [交互版](diagrams/01-five-facts.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-five-facts.architecture.json)

- **先读官方再读这里**：上游 docs 的 subsystems 有 92 篇，user 26 篇 · cookbook 16 篇、cordis-tutorial 16 篇 · 本文档集补的是实现细节与调用链
- **包名后缀对照**：无后缀是 Service Definition · -local / -sandbox / -e2b 是 Provider · tool- 前缀是模型可见工具，command- 是人类命令
- **219 个包怎么读**：按组读，不要按包读 · 先定位 core 组的七个包 · 再按需下钻到具体能力组

## 1.8 上游一手文档清单（优先读这些）

| 文档 | 行数 | 内容 |
|---|---|---|
| **`docs/architecture.md`** | 129 | **必读**。cordis 底座、profile/bundle、core 包表、三类事件域、turn 流程、seam、"新行为放哪"映射表 |
| `docs/cordis-primer.md` | — | cordis 入门 |
| `docs/cordis-tutorial/` | 16 md | cordis 教程 |
| `docs/cordis-api/` | 11 md | cordis API 参考（脚本生成） |
| `docs/agent-lifecycle.md` | — | agent 生命周期时序图 |
| `docs/tool-execution-pipeline.md` | — | 工具执行管线 |
| `docs/capability-seams.md` | — | 能力接缝图谱 |
| `docs/event-producer-consumer.md` | — | 事件生产者/消费者全表 |
| `docs/config-catalog.md` | — | 配置字段目录（脚本生成） |
| `docs/tool-catalog.md` | — | 工具目录（脚本生成） |
| `docs/module-graph.md` / `graph-atlas.md` | — | 模块依赖图 |
| `docs/persistence-catalog.md` | — | 持久化目录 |
| `docs/glossary.md` | — | 术语表 |
| `docs/defensive-patterns.md` | — | 防御式编程模式 |
| `docs/subsystems/` | 92 md | 逐子系统契约（约 30 个主题 × en/zh/i18n） |
| `docs/cookbook/` | 16 md | 扩展指南（加包 / 加工具 / 加 LLM 适配器 / 加 Chat 节点） |
| `docs/postmortem/` | 10 md | 事故复盘 |
| `docs/user/` | 26 md | 用户指南 |
| `AGENTS.md` = `CLAUDE.md` | 149 | 给 agent 的仓库约定 |

💡 **本文档集的定位**：官方文档讲"契约是什么、怎么扩展"；本文档集讲**"实现在哪一行、为什么这样实现、跑起来的实际路径"**，并补上官方没有的**跨仓库视角**（DSH ↔ cordis 的对应关系）。

## 1.9 阅读路线

五个阶段的推荐路线（🅐 地基 → 🅑 核心概念 → 🅒 内核 → 🅓 能力与运行面 → 🅔 工程与速查）
以及「按身份选路」表统一维护在 [索引 § 四 阅读路线](README.md)，不在此重复。


---

**返回** ← [索引](README.md) ｜ **下一篇** → [02 代码结构地图](02-codebase-map.md)：`packages/` 下 219 个包怎么组织、六类命名后缀的语义、"想改 X 去哪"。

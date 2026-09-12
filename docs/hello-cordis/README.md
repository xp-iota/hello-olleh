---
layout: default
title: "Cordis 源代码全面分析"
permalink: /docs/hello-cordis/
---

# cordis 源代码全面分析（中文）

本目录是对 [cordiverse/cordis](https://github.com/cordiverse/cordis) 的系统性源码分析。所有结论均基于源码实读，文中引用的路径均相对于源码根目录。

> **先读这里再决定要不要往下**：cordis 是一个**元框架**，实现只有 **4015 行**（核心包 1848 行）。它本身不提供任何业务能力，只提供"如何组装能力、并且能安全拆掉"的机制。
>
> 它最重要的下游是 **[DeepSeek Harness](../hello-dsh/README.md)**（`dsh`，52912 stars）——DSH 的"Everything is a Plugin"架构完全建立在 cordis 之上。**想读懂 DSH，必须先读懂 cordis 的 Fiber 与 Service 模型。**
>
> 本仓库内两套文档集的关系见[仓库根 README](../../README.md)。

## 一、快照与版本

> 后续更新本分析时，请以下表的 commit 为基准做 `git diff`，即可知道哪些结论需要复核。

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/cordiverse/cordis` |
| 分支 | `main` |
| **快照 Commit（完整）** | `8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4` |
| **快照 Commit（短）** | `8cc9e33f` |
| 快照提交时间 | `2026-08-13T13:48:18Z` |
| 快照提交标题 | `chore: update readme (#45)` |
| Commit 链接 | https://github.com/cordiverse/cordis/commit/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4 |
| 核心包版本 | **`cordis@4.0.0-rc.8`** |
| 仓库 tag | **无**（版本管理靠 package.json） |
| 语言 / 许可证 | TypeScript / MIT |
| 创建时间 | 2022-05-17（已迭代 4 年） |
| Stars / Forks / Open Issues | 1818 / 82 / 22 |
| 作者 | Shigma `<shigma10826@gmail.com>` |
| 配套论文 | [cordiverse/paper](https://github.com/cordiverse/paper)《A Programming Paradigm for Spatiotemporal Composability》 |
| 官方文档 | [cordis-primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)（托管在 DSH 文档站） |
| 运行时依赖 | 仅 2 个：`@standard-schema/spec`、`cosmokit` |
| 包管理 / 构建 | yarn 4.14.1 + [yakumo](https://github.com/shigma/yakumo) 3.2.1 |

💡 上表中的 Stars / Forks / Open Issues（以及上文 DSH 的 stars）是快照采集时（2026-08）的网络数据，**无法从源码快照复核**，引用时请注意时效；其余各项均可在 `sources/cordis` 快照内自行验证。

**下载方式**：环境策略拦截 `git clone`，源码通过 `api.github.com/repos/cordiverse/cordis/tarball/<sha>` 归档下载（59 KB）。URL 里锁定了完整 SHA，快照精确。

⚠️ **README 首屏的警告**：

> Cordis is under active development. The API is not yet stable and may change without notice.

### 规模统计

| 指标 | 数值 |
|---|---|
| TS 文件 / 总行数 | 58 / **8365**（含仓库根 `vitest.config.ts` 10 行；`packages/` 内为 57 / 8355） |
| **实现**（`*/src/*`） | 27 文件 / **4015 行** |
| **测试**（`*/tests/*`） | 30 文件 / **4340 行** |
| 测试 / 实现比 | **1.08**（测试多于实现） |

各包实现行数见 [01 § 1.2](01-项目概览与设计哲学.md)；核心包 9 个文件的逐文件行数与对应篇目见 [02 § 2.3](02-代码结构与包边界.md)。本索引不重复这两张表。

### 项目状态与风险

| 事实 | 含义 |
|---|---|
| 核心包 `4.0.0-rc.8` | 第 4 个大版本仍在 rc 阶段 |
| `loader@1.0.0-rc.5` | 关键外围包同样是 rc |
| **仓库无任何 git tag** | 版本靠 package.json，无发布快照可对照 |
| README 明示 API 不稳定 | 会不通知即变更 |
| 22 个 open issue | 活跃但未收敛 |
| 4 年迭代（2022-05 起） | 不是新玩具，但也未定型 |
| 源码里有 `FIXME internal/fiber-info` | `fiber.ts:359` —— `internal/status` 事件形态待改 |

⚠️ **一个重要观察**：DSH 的 `dsh-base` bundle 里引用的是 **`@deepseek-ai/cordis-plugin-timer`** 与 **`@deepseek-ai/cordis-plugin-hmr`** —— **`@deepseek-ai/` 作用域**，说明 DSH **fork 了 cordis 的插件包**。读 DSH 时要留意两者可能已有分叉（见 [DSH 05 篇](../hello-dsh/05-启动与Cordis落地.md)）。本文档集分析的是 **cordiverse 上游版本**。

## 二、术语约定

| 术语 | 一句话解释 | 展开 |
|---|---|---|
| **db** | 本系列统一的**示例服务名**（虚构的数据库服务），用于讲解 service / inject / isolate 等机制；cordis 源码中并不存在名为 `db` 的服务（其测试里用的是 `foo` / `bar` / `logger` / `counter` 等占位名）。凡文中出现 `ctx.db`、`inject: ['db']`、`id: db` 均属举例，可替换为任意服务名 | [01 § 1.3](01-项目概览与设计哲学.md)、[04 § 4.1](04-Context与Reflect代理.md) |
| **HMR** | Hot Module Replacement（模块热替换）：文件变化时只替换受影响的插件、进程尽量不退出；在 cordis 里由 `@cordisjs/plugin-hmr` 实现，依赖框架的可逆生命周期 | [08 HMR 热重载](08-HMR热重载.md) |
| **trap** | JavaScript `Proxy` handler 上拦截 `get` / `set` / `has` 等操作的方法，中文常译「代理陷阱」；本系列统一写作 `get` / `set` / `has` trap，与 bug 无关 | [04 § 4.1](04-Context与Reflect代理.md) |

## 三、篇目表

| # | 篇目 | 行数 | 关键内容 |
|---|---|---|---|
| 01 | [项目概览与设计哲学](01-项目概览与设计哲学.md) | 238 | 元框架定位、时空可组合性、四个核心抽象、与其它插件系统的对比、读源码前必知的六件事 |
| 02 | [代码结构与包边界](02-代码结构与包边界.md) | 270 | 9 个包的依赖方向、core 的 9 文件、四服务自举顺序、三种"树"的关系、为什么只要 1848 行 |
| 03 | [Fiber 模型](03-Fiber模型.md) ⭐ | 430 | `effect()` 的双重身份、四种有效返回形态 + 两种边界、**epoch 字符串**、6 态机与 `inertia` 锁、子 Fiber 是父的 effect、长堆栈 |
| 04 | [Context 与 Reflect 代理](04-Context与Reflect代理.md) ⭐ | 438 | Proxy 的 `get` / `set` / `has` trap、`then` 保留字、三种派生、沿 fiber 链查找的三种失败、Symbol 作键的隔离、**traceable 与 shadow**、mixin |
| 05 | [服务注册与依赖解析](05-服务注册与依赖解析.md) | 359 | 四种插件形态、`@Inject()` 双目标装饰器、`provide` 的 setup/teardown 顺序、**`notify()` 级联引擎**、Service 七符号 |
| 06 | [事件系统与 Waterfall](06-事件系统与Waterfall.md) | 275 | 5 种派发模式、`isBailed` 的坑、**waterfall 原理全解（§ 6.3：契约 / 逐行解剖 / 执行语义 / 轨迹 / Koa 与责任链对照）**、`internal/listener` 劫持、8 个 internal 事件 |
| 07 | [Loader 与配置树](07-Loader与配置树.md) | 431 | `EntryOptions` 全字段、`update()` 决策树、**`applyPatches` 三条语义**、原子写、**isolate realm 7 步算法**、6 case 自卸载判定 |
| 08 | [HMR 热重载](08-HMR热重载.md) | 278 | HMR 定义、三条变更路径、**accepted/declined 传播**、五阶段 partialReload、**Node 22/24 缓存差异**、双层回滚 |
| 09 | [关键调用链速查](09-关键调用链速查.md) | 469 | 五条核心链、symbols 全表、逐文件符号表、**错误消息对照表**、配置速查、症状路由、spec 映射 |

## 四、阅读路线

![cordis 系列阅读路线](diagrams/00-reading-path.svg)

**cordis 系列阅读路线** — [交互版](diagrams/00-reading-path.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/00-reading-path.architecture.json)

- **03 与 04 互相依赖**：建议 03 先粗读，读完 04 再回头精读 03 · Fiber 的 effect 依赖 Context 的派生语义 · Context 的动态解析又依赖 Fiber 的 store
- **两篇重点占全书一半难度**：03 Fiber 模型是 486 行的心脏 · 04 Context 与 Reflect 是 Proxy 元编程的集中区 · 其余各篇都建立在这两篇之上
- **09 是索引不是正文**：按调用链组织，便于回查 · 附错误信息到成因的对照表 · 读完任一篇都可以随时跳回

### 按身份选路

| 你是 | 建议路线 |
|---|---|
| **想读懂 DSH，被迫先学 cordis** | [03](03-Fiber模型.md) + [04](04-Context与Reflect代理.md) + [05](05-服务注册与依赖解析.md) 精读，[06](06-事件系统与Waterfall.md) § 6.3（waterfall）必读，[07](07-Loader与配置树.md) § 7.5（applyPatches）必读，其余略读 |
| **要写 cordis 插件** | [03 § 3.2-3.3](03-Fiber模型.md)（effect 用法）+ [05 § 5.7](05-服务注册与依赖解析.md)（Service 基类）+ [06](06-事件系统与Waterfall.md) |
| **在排查插件不启动/不卸载** | [09 § 9.4](09-关键调用链速查.md) 错误对照表 → [03 § 3.5](03-Fiber模型.md) 状态机 |
| **要改 cordis 本体** | 全读，且**先读对应的 spec**（[09 § 9.9](09-关键调用链速查.md) 有映射表） |
| **只想理解设计思想** | [01](01-项目概览与设计哲学.md) + [03 § 3.4](03-Fiber模型.md)（epoch）+ [04 § 4.4-4.5](04-Context与Reflect代理.md)（Symbol 作键） |
| **在做配置驱动的应用** | [07](07-Loader与配置树.md) 全读 + [08](08-HMR热重载.md) |

## 五、配套示例工程

本仓库的 [`dsh-example/`](../../dsh-example/README.md) 虽以 DSH 为主，也包含直接验证 cordis 原语的最小程序。示例精确锁定 `@deepseek-ai/*@0.1.1-rc.2`；因此它们验证的是 DSH 发布包所携带的 cordis 契约，与本文分析的 cordiverse 上游快照 `8cc9e33f` 需按“双版本口径”对照阅读。

| Cordis 主题 | 配套示例 | 观察点 |
|---|---|---|
| Context / 插件装配 | [`cordis.yml`](../../dsh-example/cordis.yml)、[`26-cordis-timer`](../../dsh-example/26-cordis-timer/README.md) | 配置树如何挂插件、插件卸载时如何回收 effect |
| Fiber / 可逆副作用 | [`26-cordis-timer`](../../dsh-example/26-cordis-timer/README.md) | 定时器作为 effect 注册，Fiber 卸载后不再继续触发 |
| Service / 依赖与作用域 | [`05-llm-adapter`](../../dsh-example/05-llm-adapter/README.md)、[`11-tool-restrict`](../../dsh-example/11-tool-restrict/README.md) | Provider 注入、Consumer 解析、scope 限制 |
| Events / waterfall | [`17-dispatch-modes`](../../dsh-example/17-dispatch-modes/README.md)、[`20-llm-stream`](../../dsh-example/20-llm-stream/README.md) | 五种派发模式与 waterfall 包装链 |
| 生命周期 / 清理 | [`09-hooks-lifecycle-steering`](../../dsh-example/09-hooks-lifecycle-steering/README.md)、[`26-cordis-timer`](../../dsh-example/26-cordis-timer/README.md) | 监听器与定时器随插件生命周期撤销 |

> 📐 各章的对应示例也会直接放在相关小节；运行环境、命令与预期输出以[示例工程 README](../../dsh-example/README.md)为准。

## 六、主题对齐矩阵

| 统一主题 | Cordis | DeepSeek Harness | 可跑示例 |
|---|---|---|---|
| 定位与代码地图 | [01](01-项目概览与设计哲学.md) · [02](02-代码结构与包边界.md) | [DSH 01](../hello-dsh/01-项目概览.md) · [02](../hello-dsh/02-代码结构地图.md) | [`cordis.yml`](../../dsh-example/cordis.yml) |
| 生命周期与服务 | [03 Fiber](03-Fiber模型.md) · [04 Context](04-Context与Reflect代理.md) · [05 Service](05-服务注册与依赖解析.md) | [DSH 03 Seam](../hello-dsh/03-能力缝与服务全景.md) · [05 启动](../hello-dsh/05-启动与Cordis落地.md) | [05 adapter](../../dsh-example/05-llm-adapter/README.md) · [26 timer](../../dsh-example/26-cordis-timer/README.md) |
| 事件与扩展 | [06 Events](06-事件系统与Waterfall.md) | [DSH 04 扩展](../hello-dsh/04-扩展与生态.md) · [06 Agent](../hello-dsh/06-Agent循环与会话日志.md) · [07 请求管线](../hello-dsh/07-请求管线-LLM工具与提示.md) | [09 lifecycle](../../dsh-example/09-hooks-lifecycle-steering/README.md) · [17 dispatch](../../dsh-example/17-dispatch-modes/README.md) · [20 stream](../../dsh-example/20-llm-stream/README.md) |
| 配置、装配与热更新 | [07 Loader](07-Loader与配置树.md) · [08 HMR](08-HMR热重载.md) | [DSH 05 启动与 Cordis](../hello-dsh/05-启动与Cordis落地.md) | [`cordis.yml`](../../dsh-example/cordis.yml) · [26 timer](../../dsh-example/26-cordis-timer/README.md) |
| 执行与安全边界 | [03](03-Fiber模型.md) · [05](05-服务注册与依赖解析.md) · [06](06-事件系统与Waterfall.md) | [DSH 08 执行侧服务](../hello-dsh/08-执行侧服务-文件Shell沙箱子代理压缩.md) | [13 approval](../../dsh-example/13-approval-answerer/README.md) · [16 side-effects](../../dsh-example/16-fs-shell-side-effects/README.md) · [25 sandbox](../../dsh-example/25-sandbox-seam/README.md) |
| 测试、速查与排障 | [09 速查](09-关键调用链速查.md) | [DSH 10 测试](../hello-dsh/10-测试与工程实践.md) · [11 速查](../hello-dsh/11-关键调用链速查.md) | [示例索引与批量运行](../../dsh-example/README.md) |

## 七、Mermaid 配色图例

全系列按**组件职责**统一配色，与本仓库其它文档集一致：

| 颜色 | 语义 | 在 cordis 里指 |
|---|---|---|
| 🔵 蓝 `#E3F2FD` | 入口 / 用户面 | `ctx`、`ctx.plugin()`、公开 API |
| 🩵 青 `#E0F7FA` | 执行 | `_execute()`、插件代码运行 |
| 🟠 橙 `#FFF3E0` | 调度 / 事件 | EventsService、waterfall、EntryGroup |
| 🟢 绿 `#E8F5E9` | 状态 / 服务表 | `store`、`_disposables`、traceable |
| 🔴 红 `#FFEBEE` | 核心风险点 | Fiber 状态机、epoch、抛错路径 |
| ⚪ 灰蓝 `#ECEFF1` | 数据结构 | `EntryOptions`、`Plugin.Runtime`、Symbol 表 |
| 🌸 粉 `#FCE4EC` | 基础设施 | loader / include / hmr 三个外围包 |
| 💛 米黄 `#FFFDE7` | 提示 / 判断 | 决策节点、注释框、💡 说明 |

## 八、阅读约定

| 约定 | 说明 |
|---|---|
| **路径缩写** | `C/` = `packages/core/src/`，`L/` = `packages/loader/src/`，`I/` = `packages/include/src/`，`H/` = `packages/hmr/src/` |
| **行号** | `文件:行号` 对应快照 `8cc9e33f`，**已逐条比对源码核实**（个别边界如函数结束行可能 ±1）。上游演进后会整体偏移，建议以符号名检索；统一行号索引见 [09 § 9.3](09-关键调用链速查.md) |
| **章节编号** | `N.M`，N 为篇号（如 § 3.4 在第 03 篇） |
| **💡 提示块** | 点出反直觉事实、设计取舍、常见踩坑 |
| **📐 配套示例块** | 该节对应的可跑示例（`dsh-example/`），用于对照发布包的实际契约 |
| **测试 spec** | 「想确认什么 → 读哪个 spec」映射表统一在 [09 § 9.9](09-关键调用链速查.md) |
| **导航行** | 每篇末尾有上/下篇链接 |
| **⭐ 标记** | 全系列最核心的两篇（03、04） |

## 九、文档集定位

官方 [cordis-primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer) 侧重“怎么用”；本文档集侧重“怎么实现、为什么这样实现、代码在哪一行”。两者与配套示例形成三层关系：

| 层次 | 回答的问题 | 入口 |
|---|---|---|
| 官方 primer | API 怎么用、基础概念是什么 | [cordis-primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer) |
| 本文档集 | 机制如何落到 Fiber / Context / Service / Event 源码 | [01 项目概览](01-项目概览与设计哲学.md) |
| 配套示例 | 发布包里的实际契约怎么跑 | [`dsh-example`](../../dsh-example/README.md) |

本文档集也是阅读 DSH 的地基层：先掌握 [03 Fiber](03-Fiber模型.md)、[04 Context](04-Context与Reflect代理.md)、[05 Service](05-服务注册与依赖解析.md)，再进入 [DeepSeek Harness 文档集](../hello-dsh/README.md)。

## 十、这套文档不做什么

- **不替代官方 primer**。[cordis-primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer) 讲"怎么用"；本系列讲"怎么实现的、为什么这样实现、代码在哪一行"。
- **不覆盖 `create` 与 `logger-console`**。前者是脚手架（314 行），后者是日志导出器（137 行），都不涉及核心机制。`logger.ts` 的 246 行也只在 [02](02-代码结构与包边界.md) 略提。
- **不做性能基准**。文中提到的复杂度（如 `notify` 的 O(总 Fiber 数)）来自代码结构分析，不是实测。
- **不追踪上游每日变化**。快照式分析，靠 § 一 的 commit 做增量复核。

---

**开始阅读** → [01 项目概览与设计哲学](01-项目概览与设计哲学.md)

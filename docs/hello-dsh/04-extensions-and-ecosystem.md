---
title: "扩展与生态：Skill、插件、协议、SDK"
---
# 扩展与生态：Skill、插件、协议、SDK

> **本篇回答**：怎么给 DSH 加能力而不改它。四条路径按"要不要写代码"排开：**Skill**（纯 Markdown 数据包，模型自己发现）、**hooks 桥接**（兼容 Claude Code / Codex 的钩子配置）、**Extensions**（让 cordis 插件树本身成为可操作对象，含让模型改自己运行时的工具）、**协议与 SDK**（MCP / ACP 两个方向相反的协议，加把 dsh 当子进程驱动的 Python SDK）。
> **路径缩写**：`P/` = `packages/`，`PY/` = `python/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：4.1–4.10 扩展机制与插件生态 → 4.11–4.17 MCP / ACP / Host / API → 4.18–4.26 Python SDK 与多语言运行时 → 4.27 `experimental` 组：生态的试验田。
>

## 4.1 两条扩展路径的区别

> 📐 **配套可跑示例**：[M10.1 · 发现文件系统 skill](../../dsh-lab/M10-external-capabilities/index.ts) 与
> [M10.2 · 现场写一个 skill](../../dsh-lab/M10-external-capabilities/index.ts) 是"按数据扩展"的完整样本
> （一个 `SKILL.md`，零行 TypeScript）：M10.2 把这份 Markdown 现场写进
> `.dsh-home/skills/lab-demo-skill/SKILL.md`，再由真实的 `ctx.skills` 把它发现出来——
> 目录即能力，正文按需加载，不占常驻上下文。


![两条扩展路径：插件与 Skill](diagrams/04-two-extension-paths.svg)

**两条扩展路径：插件与 Skill** — [交互版](diagrams/04-two-extension-paths.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-two-extension-paths.architecture.json)

- **怎么选**：要新增一种能力接缝就写插件 · 只是给模型加一份可发现的操作说明就用 Skill · Skill 改完立即生效，插件需要重启
- **Skill 的组成**：skill 定义能力与渲染规则 · skill-filesystem / skill-office 两个 provider 分别从文件系统与 Office 文档发现 skill · tool-skill 让模型能列出并调用
- **类比**：Skill 相当于 Claude Code 的 skills 与 slash commands · 插件相当于扩展宿主本身 · 前者是内容，后者是机制

## 4.2 `skill` 组的 5 个包

| 包 | src 行数 | 角色 |
|---|---|---|
| `skill-filesystem` | 1063 | Provider（**从文件系统加载 skill**） |
| **`skill`** | **868** | Service Definition（`ctx.skills`） |
| `tool-skill` | 451 | Consumer（模型调用 skill 的工具） |
| `skill-office` | 141 | Provider（**新**：Office 文档 skill，配合 `document/office-kit`） |
| `tool-workspace-dependencies` | 322 | 工具（**新**：声明 workspace 依赖） |

💡 **0.1.5 时 `skill-filesystem` 是唯一的 provider**，本篇当时还预言"将来可以有 `skill-remote`、`skill-registry` 等"。rc.3 兑现了一半：`skill-office` 成为第二个 provider（Office 文档作为 skill 来源），experimental 里还有 `skill-badge`（60 行，已从本组迁出，见 § 4.27）。seam 结构继续兑现。

💡 **`skill-badge`（90 行 → 60 行）迁到了 `packages/experimental/skill-badge`**：给 UI 提供"这个 skill 的标识/图标"信息，配合 `client/ui-skill` 子包。UI 徽章不算核心能力，进试验田。

## 4.3 `hooks` 三包：兼容其它 agent 的钩子协议（已迁入 experimental）

> 📐 **配套可跑示例**：[`M04.2 · 在 turn 结束前 steer`](../../dsh-lab/M04-agent-loop-intervention/index.ts) 演示这些桥接器最终落到的那组拦截点
> （`agent/session-start` · `pre-step` · `request` · `turn-stopping`），并在轮末用 `agent.steer()` 真的多跑了一个 step。


rc.3 的一个组织信号：`packages/hooks/` 组**不存在了**，三包整体迁入 `packages/experimental/{hook-protocol,hooks-claude-code,hooks-codex}`（src 合计 1650 行）：

| 包 | src 行数 | 作用 |
|---|---|---|
| `hook-protocol` | 748 | 钩子协议定义 |
| **`hooks-claude-code`** | 488 | **兼容 Claude Code 的 hooks** |
| **`hooks-codex`** | 414 | **兼容 Codex 的 hooks** |

💡 **"搬进 experimental"本身就是结论**：兼容竞品钩子被降级为试验性能力——官方文档把稳定面留给了自己的事件系统（`agent/*`、`tools/*`），hooks 桥接退到"降低迁移成本"的从属位置（详见 § 4.27）。

💡 **这是与 [08 § 8.27](08-execution-services.md) 呼应的另一处"兼容竞品"**：
- `subagent-claude-code` / `subagent-codex`：把竞品当**执行后端**
- `hooks-claude-code` / `hooks-codex`：让**为竞品写的 hooks 在 DSH 里能跑**

💡 **迁移成本策略**：用户已有的 Claude Code hooks 配置不需要重写。这是很务实的生态策略——降低切换门槛。

## 4.4 `extensions` 组：cordis 树本身成为对象

`packages/extensions/`（src 合计 25959 行，比 0.1.5 的 16090 涨了 61%）：

| 包 | 行数 | 作用 |
|---|---|---|
| **`tool-cordis`** | **11304** | **让模型操作 cordis 插件树的工具** |
| `cordis-client-runner` | 9245 | 在 client 侧跑 cordis 树 |
| `cordis-host-runner` | 3391 | 在 host 侧跑 cordis 树 |
| `ui-cordis` | 2019 | 前端的插件树查看/编辑器 |

![让模型和人都能操作插件树](diagrams/04-cordis-self-hosting.svg)

**让模型和人都能操作插件树** — [交互版](diagrams/04-cordis-self-hosting.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-cordis-self-hosting.architecture.json)

- **模型与人共用一套底座**：tool-cordis 是模型侧入口 · ui-cordis 是人类侧入口 · 两者都读写同一棵插件树
- **两个 runner 的差异**：host runner 跑在 Node 进程里 · client runner 跑在浏览器里 · 后者要绕开模块加载与文件系统限制，因此代码更多
- **这是自举能力**：模型可以增删自己的能力配置行 · 也能查询服务是否就绪、依赖是否满足 · 相当于把 cordis 的运维面开放给了 agent

💡 **为什么 client-runner 比 host-runner 大**：浏览器里没有文件系统、没有 `node:module` 的内部 loader（cordis 的 loader 依赖它，[cordis 08 § 8.4](../hello-cordis/08-hmr.md)），所以要另做一套模块解析与加载。

## 4.5 插件管理器与市场

0.1.5 的这一节叫"插件市场：`plugin-inventory`"，当时的结论是"插件发现靠 GitHub topic + npm，没有中心化市场"。rc.3 把这件事做成了体系——插件本身成为被管理的对象（[03 § 3.8](03-capability-seams-and-services.md) 的"seam 的第四种形态"）：

| 包 | src 行数 | 角色 |
|---|---|---|
| `boot/plugin-manager` | 3877 | `ctx.pluginManager`：当前 profile 的插件与 bundle 管理（安装、启停、状态上报） |
| `boot/plugin-market` | 1858 | `ctx.pluginMarket`：拉取并校验用户配置的市场索引 |
| `util/plugin-market-index` | 445 | 市场索引格式（`apps/plugin-market-generator`（1453 行）生成官方索引） |
| `host/plugin-inventory` | 198 | 插件清单（host 组；前端 `ui-settings-plugin-inventory`） |

💡 **三个入口共用一套底座**：CLI 的 `dsh plugin` 子命令（`apps/cli/src/args.ts:188`，转发参数到 profile 目录里的 pnpm）、模型侧的 `tool-plugin-manager`、前端 的 `ui-plugin-manager` / `ui-plugin-market`。`dsh-base` patch 的头两行插件行就是 `tool-plugin-manager` 与 `plugin-manager`（`base/cordis.patch.yml:16-22`），`docs/architecture.md:29` 明说 "Base includes Plugin Manager for Web and agents"——**插件管理是 base 的一部分**。

💡 **`dsh plugin --profile x add <package>`** 仍是 `loadProfile` 抛错时提示的命令（[05 § 5.4](05-startup-and-cordis-runtime.md)）。配合 profile 目录本身就是 pnpm workspace（`PROFILE_PNPM_WORKSPACE`，`AB/profile.ts:184`），**用户能直接 `pnpm add` 第三方插件包**。

💡 **`dsh-plugin` 仍是 GitHub topic**（README.md:46）：

> Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.

**发现仍靠 GitHub topic + npm，但安装、启停、索引校验有了正式服务**——市场是"目录 + 管理器"，不是中心化商店。

## 4.6 `preset` 组：能力集打包

`packages/preset/`（src 合计 1187 行）：`agent-preset`（30）+ `agent-preset-registry`（1082，**新**，`ctx.agentPresets` 的 owner）+ `persona`（75）。

💡 **agent preset 是"给一个会话不同能力集"的载体**（[03 § 3.10](03-capability-seams-and-services.md)）。它是一段 cordis 配置（含 group 行 + `isolate` 声明）。

💡 **`persona` 单独一个包**对应 `PERSONA_SECTION`（[07 § 7.20](07-request-pipeline-llm-tools-and-prompts.md)）——人格可以打包分发。

## 4.7 `feedback` 与 `identity`

| 组 | 包 | 作用 |
|---|---|---|
| `feedback`（686 行） | `command-feedback`（196）、`message-feedback`（490） | 用户反馈（capability 图：分别落 `ctx.sessionFeedback` / `ctx.messageFeedback`） |
| `identity`（100 行） | `anonymous-user-id` | **匿名用户 id** |

💡 **`anonymous-user-id` 只有 100 行**（0.1.5 是 248 行），且组名叫 `identity`。这是遥测/反馈需要的最小身份标识——**刻意做成匿名的**。

## 4.8 `runtime-diagnostics`：已删除

0.1.5 的 `P/runtime-diagnostics/invariants`（540 行）连同全仓 219 个 `invariant.ts` 约定在 rc.3 **整体删除**（实测 `find packages -name invariant.ts` 为 0；`packages/runtime-diagnostics` 组不存在）。

💡 **不变量约定改为文档与测试承担**：防御模式文档化在 `docs/defensive-patterns/`（已成目录），各包不变量由自己的 spec 承担。与 [02 § 2.5](02-codebase-map.md)、[10 § 10.6](10-testing-and-engineering.md) 联动。

## 4.9 `util` 组：23 个小工具包

`packages/util/`（0.1.5 是 7 个小包；rc.3 扩到 23 个）。原来 7 个：

| 包 | 作用 |
|---|---|
| `atomic-write` | 原子写文件（对照 [cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md) 的 `.tmp` + rename） |
| `brand` | 品牌类型（nominal typing） |
| `home-paths` | Harness home 路径解析 |
| `launch-environment` | 启动环境 |
| `native-command` | 原生命令 |
| `output-retention` | 输出保留策略 |
| `timeout` | 超时工具 |

新增 16 个：`chunked-list`、`code-language`、`crypto`、`deque`、`error`、`file-drag`、`http-proxy`、`lazy-require`、`official-bundles`、`package-manifest`、`plugin-detail`、`plugin-market-index`、`ripgrep`、`time`、`values`、`workspace-path`。

💡 **`atomic-write` 与 `output-retention` 单独成包**说明这两件事在多处被需要：前者用于所有配置/状态落盘，后者用于工具输出的截断策略（与 `spill`、`compaction-tool-result-pruner` 相关）。

💡 **新增包里最值得注意的是 `official-bundles`**：profile 模板治理（`PROFILE_TEMPLATES` 五模板、`RETIRED_BUNDLES`、`INSTALLATION_OWNED_PROFILE_TUPLES`）住在 util 组——"profile 由模板安装"成了可退役、可迁移的正式机制（[05 篇](05-startup-and-cordis-runtime.md)）。`plugin-market-index`（445 行）则配合 § 4.5 的市场体系；`ripgrep` 配合 [03 § 3.1](03-capability-seams-and-services.md) 提到的 `tool-fs-search`（打包 rg 二进制）。

## 4.10 扩展点全景

> 📐 **配套可跑示例**：这张全景表里的每个扩展点都有对应示例，逐条映射见
> [配套工程 README 的能力索引](../../dsh-lab/README.md)（12 个方向模块、60 个阶段，全部跑在真实 `@deepseek-ai/*` 发布包上，版本线 `0.2.2-rc.1`）。


把前面各篇的扩展点汇总（对应 `docs/architecture.md` 的映射表 + 本文档集的发现）：

![按事件扩展的六组扩展点](diagrams/04-extension-events.svg)

**按事件扩展的六组扩展点** — [交互版](diagrams/04-extension-events.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-extension-events.architecture.json)

- **emit 与 waterfall 的区别**：emit 型只能观测，不能改结果 · waterfall 型可以改写参数、替换返回值或短路 · 扩展前先确认目标事件是哪一种
- **最常用的三个切入点**：tools 的三段 waterfall 用于审批与改写工具调用 · llm/stream 用于替换或包裹模型调用 · system-prompt/assemble 用于注入上下文
- **对应上游文档**：这份清单对应 docs/architecture.md 的扩展点映射 · 每组事件的完整签名在各章节展开 · 策略包只依赖事件，不依赖实现

---

> 📎 **以下承接原「17 MCP 与 ACP 协议集成」。**
> 本篇讲 DSH 对两个外部协议的接入：**MCP**（Model Context Protocol，作为客户端消费外部工具）与 **ACP**（作为服务端暴露 agent 能力）。方向相反，值得对照看。
> 路径缩写：`P/` = `packages/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。

## 4.11 两个协议的方向相反

![MCP 与 ACP 的方向相反](diagrams/04-mcp-vs-acp.svg)

**MCP 与 ACP 的方向相反** — [交互版](diagrams/04-mcp-vs-acp.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-mcp-vs-acp.architecture.json)

- **两个协议角色相反**：MCP 里 DSH 是客户端，去消费别人的工具 · ACP 里 DSH 是服务端，被别人驱动 · 因此两者可以同时启用而不冲突
- **MCP 的落点是 ctx.tools**：外部工具被注册成普通工具 · 模型看不出它来自远端 · 权限与审批仍走本地的 tools waterfall
- **ACP 只面向自动化**：注释里明确写了 automation-only · 人机交互界面由 host/webserver 负责 · 两者分工清晰

## 4.12 `mcp-client`（1986 行）

`P/mcp/mcp-client/src/`（14 个文件，比 0.1.5 的单文件拆细了：connection、transport、probe、status、tools、templates 等）：

| 符号 | 行号 | 说明 |
|---|---|---|
| `export const name = 'mcp-client'` | 40 | 插件名 |
| `'mcp-client.serverName'` effect label | 233 | |
| `'mcp-client.connection'` effect label | 251 | |

💡 **两个 effect label 揭示了结构**：一个 effect 管"服务器名字"的注册，另一个管"连接"。都是 cordis effect（[cordis 03 § 3.2](../hello-cordis/03-fiber-model.md)），所以**卸载插件即断开连接、摘掉工具**。

💡 **`mcp` 组不再只有一个包**：rc.3 扩成三包——`mcp-manager`（652 行，`ctx.mcpManager`：按 settings 配置调和 mcp-client 实例、聚合连接状态）与 `mcp-resources`（223 行，`ctx.mcpResources`：把 MCP 资源变成连接方 scope 里的共享资源工具）。MCP 从"一个消费方"长成了带管理面的接入层。

💡 **1986 行的量级**说明它处理了 MCP 的协议细节：传输（stdio/SSE）、握手、工具列表同步、schema 转换、错误映射。

## 4.13 `acp`（1781 行）：automation-only 服务端

`P/acp/acp/src/index.ts`（src 七个文件：codec、content、index、mcp、model-control、session、updates）。这个包的注释信息密度很高。

| 符号 / 注释 | 行号 | 内容 |
|---|---|---|
| `@module @deepseek-ai/dsh-acp` | 9 | |
| `export const name = 'acp'` | 59 | |
| **"Mount the automation-only ACP server"** | **92** | |
| 注入作用域注释 | 97 | "ACP handlers execute **outside this plugin's injection scope**, so capture the ..." |
| disposed 检查 | 114 | `if (closed) throw internalError('the ACP bridge has been disposed')` |
| `session/update` 失败告警 | 129 | `logger.warn('acp: session/update failed: ...')` |
| **权限请求注释** | **155** | 见下 |

### 三个值得注意的设计

![ACP 实现里三个值得注意的设计](diagrams/04-acp-designs.svg)

**ACP 实现里三个值得注意的设计** — [交互版](diagrams/04-acp-designs.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-acp-designs.architecture.json)

- **第二条是最容易踩的坑**：handler 执行时 ctx 的注入链已经不同 · 在 handler 里现取服务会拿到错误的视图 · 必须在插件激活期就把引用捕获进闭包
- **为什么会这样**：cordis 的 traceable 让 ctx 属性访问依赖调用方 · ACP handler 由外部请求触发，不在插件调用栈上 · 于是访问链断了
- **权限通道的定位**：它不是给人看的确认弹窗 · 而是给上游 agent 的机器可读策略接口 · 因此响应格式是结构化的，不含展示文案

### `codec.ts` 与 `content.ts` 的转换函数

0.1.5 的三个转换函数里只剩一个还在 `codec.ts`；prompt 侧搬去了 `content.ts`，并从"转成文本"升级为"准入"：

| 函数 | 位置 | 方向 | 作用 |
|---|---|---|---|
| `turnEndToStopReason` | `codec.ts:14` | DSH → ACP | 把 `TurnEndReason`（[06 § 6.4](06-agent-loop-and-session-log.md)）映射成 ACP 的 stop reason |
| `admitAcpPrompt` | `content.ts:123` | ACP → DSH | 校验并准入 ACP prompt（不支持的类型报 `AcpContentError`） |
| `supportsAcpImagePrompts` | `content.ts:89` | 能力探测 | 是否支持图像 prompt |
| `assistantBlockToAcp` | `content.ts:214` | DSH → ACP | 把 assistant 内容块映射回 ACP |

💡 **"诚实检测"从函数名转进了类型**：`content.ts` 的 `AcpContentFailureKind`（`'invalid' | 'internal'`，`:22`）把"协议桥接必然有能力差异"做成了显式错误分类——比 0.1.5 的 `promptHasUnsupportedContent` 布尔检查更硬。

💡 **`turnEndToStopReason` 把 DSH 的七种 turn 结束原因**（`completed` / `aborted` / `blocked` / `error` / `max-tokens` / `interrupted` / `forked`，`S/types.ts:206-236`）映射到 ACP 的词汇表——比 0.1.5 多出的 `interrupted` 与 `forked` 是 loop 从不现场发出的标记（崩溃合成 / fork 边界补记）。

## 4.14 协议的快照测试：`session-snapshot`

`P/test-support/acp-snapshot` 在 rc.3 已不在（test-support 组现为 8 包），由 `P/test-support/session-snapshot` 接棒——包描述明说它是 "Session-log snapshot core with **an ACP protocol adapter**, expected-output normalization, and fixture invariants"：会话日志快照成了核心，ACP 只是它的一个协议适配器。配套的 `vitest.snapshot.config.ts` 仍在（完整机制见 [10 § 10.4](10-testing-and-engineering.md)）。

💡 **给协议桥接做快照测试是正确做法**：协议交互的报文格式必须稳定，快照能捕获无意的变更。

💡 **`examples/acp-demo` 与 `examples/jsonrpc-demo` 都没了**：0.1.5 的顶层 `examples/` 与 `packages/examples` 组整体删除。根 `package.json` 的 demo 脚本换成 `demo:ptc`（`scripts/demo-ptc.mjs`）与 `demo:inspector`（`--patch ./packages/experimental/inspector/cordis.source.patch.yml`，`:213-214`）——演示对象从"协议桥接"换成了 PTC 与运行时检视。

## 4.15 `host` 组：9 个包

`packages/host/`（src 合计 4492 行；**`apiproxy`（8571 行）已删除**）：

| 包 | src 行数 | 作用 |
|---|---|---|
| **`open-in-app`** | **1668** | 在系统应用里打开（**新**，全组最大） |
| `webserver` | 862 | HTTP/WS 服务器（capability 图：plain `node:http` 载体 + 命名路由注册） |
| `directory-picker-native` | 781 | 原生目录选择器 |
| `directory-picker-browse` | 324 | 浏览式目录选择器 |
| `directory-picker-auto` | 217 | 自动选择实现 |
| `plugin-inventory` | 198 | 插件清单（§ 4.5） |
| `frontend-static` | 167 | 静态资源服务 |
| `directory-picker` | 154 | Definition |
| `product-telemetry-otel` | 121 | 产品遥测（**新**，OTLP/HTTP 出口；`ctx.productTelemetry`） |

💡 **0.1.5 的结论是"`webserver` 只有 325 行而 `apiproxy` 有 8571 行（26 倍），难的是把 DSH 的能力安全地代理出去"。rc.3 拆掉了这个 26 倍**：`apiproxy` 整体删除，"鉴权 / 映射 / 流转发"按资源分域拆进 `packages/api/` 的 9 个包（§ 4.16，与 [09 篇](09-host-runtime-and-storage.md) 联动）。`webserver` 涨到 862 行但仍只是"起个 HTTP 服务"；API 复杂度住进了 api 组。

💡 **`directory-picker` 仍是一个四包 seam**：definition（154）+ 三个 provider（native 781 / browse 324 / auto 217）。前端对应 `ui-directory-picker-native` 与 `ui-directory-picker-browse`。**选目录这件小事也做成了可替换的**——因为 Electron/浏览器/终端环境的实现完全不同。

## 4.16 `api` 组：9 个包

`packages/api/`（src 合计 24542 行，是 0.1.5 两包 1807 行的 13.6 倍——旧 `apiproxy` 的职责搬到了这里）：

| 包 | src 行数 | 作用 |
|---|---|---|
| **`session-controller`** | **9413** | Session 命令、冷读、durable-event 跟随、Agent 激活策略 |
| `gateway` | 5691 | API 网关（`dsh-base` patch 里 id 为 `typert-gateway`，`:52`） |
| `terminal-controller` | 2857 | 用户终端进程与屏幕恢复 |
| `workspace-controller` | 1960 | Workspace 命令与重连安全的状态投递 |
| `workspace-files` | 1624 | workspace 根内的文件读取与变更流 |
| `remote-access` | 1073 | 非属主 Peer 的方法级访问控制（`ctx.remoteAccess`） |
| `job-controller` | 994 | 后台任务观察流 |
| `remotes` | 469 | 远端连接 |
| `settings-controller` | 461 | 设置面（读永远脱敏、拒绝分类） |

💡 **`dsh-base` 的 patch 里 `typert-gateway` 用的仍是 `@deepseek-ai/dsh-api-gateway`**（`base/cordis.patch.yml:52-53`；[05 § 5.11](05-startup-and-cordis-runtime.md)）。id 叫 `typert-gateway` 说明它与 TypeRT（[09 篇](09-host-runtime-and-storage.md)）紧密相关——**网关的接口是由 TypeRT 的类型注册表驱动的**；`remote-access` 也进了 base patch（`:57`）。

## 4.17 三个协议接口的对照

| 维度 | MCP | ACP | DSH SDK |
|---|---|---|---|
| DSH 的角色 | **客户端**（消费） | **服务端**（暴露） | **两端都有** |
| 包 | `mcp-client`（1986，另有 manager/resources） | `acp`（1781） | `sdk/{client,protocol,server}`（3045） |
| 用途 | 引入外部工具 | 被自动化驱动 | DSH↔DSH 通信 |
| 对应 subagent provider | — | `subagent-acp`（747） | `subagent-dsh-sdk`（561） |
| 对应 profile / bundle | — | `acp` 模板（`acp-app` bundle） | `sdk` / `sdk-minimal` 模板 |
| 测试支持 | — | `test-support/session-snapshot`（ACP 适配器） | `python/sdk/tests`（§ 4.22） |

💡 **`sdk` 组有 client / protocol / server 三个包**（[04 篇](04-extensions-and-ecosystem.md)），是 DSH 自己的协议。Python SDK（`python/sdk`）也基于它。rc.3 还给 ACP 与 SDK 各配了官方 profile 模板——协议不止是包，还是开箱的产品形态（[05 篇](05-startup-and-cordis-runtime.md)）。

---

> 📎 **以下承接原「23 Python 与多语言 SDK」。**
> 本篇讲 DSH 怎么被别的语言驱动：`sdk` 组三包（TS 侧协议）、Python SDK 两包（把 dsh 当子进程 + JSON-RPC over stdio）、以及单文件 exe 打包。
> 路径缩写：`P/` = `packages/`，`PY/` = `python/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。

## 4.18 两层结构

![SDK 的两层结构](diagrams/04-sdk-two-layers.svg)

**SDK 的两层结构** — [交互版](diagrams/04-sdk-two-layers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-sdk-two-layers.architecture.json)

- **protocol 是唯一的共享契约**：client 与 server 都只依赖它 · Python 侧按同一协议重新实现 · 于是跨语言不需要代码生成
- **Python 分成两个发行包**：sdk 是纯 Python 客户端 · sdk-runtime 装的是预编译的 DSH 可执行文件 · 两者版本对应，缺一不可
- **高低两层 API**：高层是 turns API，面向常见用法 · 低层是 JSON-RPC 客户端，可完全控制 · 需要自定义流程时降到低层

💡 **选 stdio JSON-RPC 而非 HTTP 的理由**：把 dsh 当子进程驱动时，stdio 天然有生命周期绑定（父进程退出子进程也退）、无需端口分配、无需鉴权。与 MCP 的 stdio 传输、LSP 的 stdio 传输是同一套思路。

## 4.19 Python SDK 的 6 个模块

`PY/sdk/src/deepseek_harness/`（1447 行，0.1.5 是 5 模块 873 行）：

| 文件 | 行数 | 职责 |
|---|---|---|
| **`client.py`** | **735** | 低层 JSON-RPC 客户端（占 51%） |
| **`api.py`** | **335** | 高层 turns API |
| **`office.py`** | **219** | **新**：本地 Office 渲染 / 转换 / 重算（不经 agent，配合 `document/office-kit`） |
| `models.py` | 107 | 数据模型 |
| `__init__.py` | 28 | 导出 |
| `errors.py` | 23 | 错误类型 |

`PY/sdk-runtime/src/deepseek_harness_runtime/`：`__init__.py` 222 行 + `_resources.py` 116 行。

💡 **两层 API 设计**（README 明确说 "High-level turns API and lower-level JSON-RPC client"）：
- `api.py`（335 行）：面向"跑一个 turn"的高层用法
- `client.py`（735 行）：面向"精确控制协议交互"的低层用法

💡 **`office.py` 是 rc.3 的新故事**：SDK 可以不经 agent、Session、模型请求就调用 Office runtime（`python/sdk/README.md:13`）——`document/office-kit` 这条新能力线一直铺到了 Python 侧。

💡 **`models.py` 只有 107 行**——Python 侧的数据模型很薄，因为大部分结构直接用 dict（JSON-RPC 传过来的）。

## 4.20 运行时选择契约

`PY/sdk/README.md` 的关键段（rc.3 的措辞比 0.1.5 更硬）：

> It launches the bundled `dsh` CLI with `--profile sdk`; the selected profile owns the JSON-RPC server, agent composition, credentials, persistence, tools, and shutdown behavior.
>
> Every launch requires an explicit Harness home. Pass `dsh_home` or provide a non-empty `DSH_HOME` in the child environment. **The SDK deliberately never discovers `~/.dsh`.**

![SDK 的运行时与配置契约](diagrams/04-sdk-channel-contract.svg)

**SDK 的运行时与配置契约** — [交互版](diagrams/04-sdk-channel-contract.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-sdk-channel-contract.architecture.json)

- **与 boot() 的契约一致**：DSH 启动必须有 config path，见 05 篇 § 5.5 · Python SDK 没有例外 · 差别只在谁来提供这份配置
- **这是 fail-closed 的延伸**：runtime 拒绝在缺配置时启动 · 便利层只允许加默认值，不允许跳过校验 · 同一原则见 08 篇 § 8.23
- **runtime 永远是启动出来的**：SDK 启动 bundled `dsh` CLI（`--profile sdk`）· 版本匹配由 wheel 依赖保证 · Harness home 必须显式给出，SDK 刻意不去发现 `~/.dsh`

## 4.21 单文件 exe：`sdk-runtime` 的打包

`pnpm-workspace.yaml` 把 `python/sdk-runtime` 列为 workspace 成员，注释说明用途：

> Deploy root of the single-exe build: a pure dependency manifest whose closure is what the exe bundles and what the Python runtime distributes.

![用空包的依赖闭包定义打包范围](diagrams/04-exe-packaging.svg)

**用空包的依赖闭包定义打包范围** — [交互版](diagrams/04-exe-packaging.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-exe-packaging.architecture.json)

- **这个做法的好处**：不需要手工维护打包白名单 · 加依赖即自动进入打包范围 · 漏掉依赖会在构建期暴露而不是运行期
- **配套脚本**：scripts/build-python-release.py 构建 wheel · scripts/check-macos-deployment-target.py 校验最低系统版本 · PY/sdk-runtime/hatch_build.py 是 hatch 构建钩子
- **为什么用空包**：空包只表达依赖关系，不引入额外代码 · 它的闭包就是运行时的最小充分集 · 语义清晰且可被工具直接计算

## 4.22 Python 侧的测试

`PY/sdk/tests/`（0.1.5 是 7 个文件；rc.3 目录下 31 个条目——26 个 `test_*` 自动测试 + 2 个手动冒烟 + 1 个 `run_installed_commands.py` 脚本，另加 `expected/` 与 `fixtures/` 两个数据目录）：

| 文件 | 作用 |
|---|---|
| `test_client.py` | 客户端 |
| `test_smoke_model.py` | 冒烟（模型调用） |
| `test_runtime_resolution.py` | **运行时解析**（§ 4.20 的契约） |
| `test_bundled_runtime.py` | **打包的运行时** |
| `test_release_version.py` | **版本一致性** |
| `test_macos_deployment_target.py` | macOS 部署目标 |
| `manual_sdk_agent_smoke.py`、`manual_sdk_shutdown_smoke.py` | **手动**冒烟（文件名带 `manual_`，不自动跑） |
| 另 20 个 `test_*` | `test_approval*`（2）、`test_office*`（3）、`test_plan_*`（4）、`test_goal_*`（3）、`test_commands_runtime`、`test_cot_translation_projection`、`test_user_questions`、`test_working_directory`、`test_resume`、`test_run`、`test_account_provider_snapshot`、`test_command_attachments_runtime` |

根目录有 `pytest.ini`（[02 § 2.9](02-codebase-map.md)）。

💡 **`test_release_version.py` 对应 `.gitlab-ci.yml` 的校验**（`.gitlab-ci.yml:20`）：

```
test "$CI_COMMIT_TAG" = "python-v$DSH_VERSION" || { echo "Tag $CI_COMMIT_TAG does not match package.json version $DSH_VERSION"; exit 1; }
```

**tag 必须等于 `package.json` 的 version** —— 双重校验（CI 脚本 + Python 测试）。

💡 **`manual_` 前缀是一种约定**：需要真实模型调用/网络的测试不自动跑，避免 CI 依赖外部服务。

💡 **测试面跟着新能力走**：`test_office*` 对应 § 4.19 的 `office.py`，`test_plan_*` / `test_goal_*` 对应 plan / goal 域，`test_approval*` 对应审批协议——Python SDK 已经从"最小驱动器"长成覆盖面可观的客户端。

## 4.23 `subagent-dsh-sdk`：SDK 的自用

`P/subagent/subagent-dsh-sdk`（561 行，[08 § 8.27](08-execution-services.md)）。

💡 **DSH 用自己的 SDK 把另一个 dsh 实例当作 subagent**。这是"协议自洽"的检验：如果 SDK 好用，自己就会用它。

## 4.24 三种对外协议的最终对照

| 维度 | MCP | ACP | **DSH SDK** |
|---|---|---|---|
| DSH 角色 | 客户端 | 服务端 | **两端** |
| 传输 | stdio / SSE | JSON-RPC | **行分隔 JSON-RPC over stdio** |
| TS 包 | `mcp-client`（1986） | `acp`（1781） | `sdk/{client,protocol,server}`（3045） |
| 其它语言 | — | — | **Python（1447 行 + runtime 载体）** |
| 对应 subagent provider | — | `subagent-acp`（747） | `subagent-dsh-sdk`（561） |
| profile 模板 | — | `acp`（acp-app bundle） | `sdk` / `sdk-minimal` |
| 发布物 | — | — | 2 个 PyPI 包 + 单文件 exe |
| CI | — | `session-snapshot` 快照测试 | `build-exe-for-python-sdk.yml` + `python-release.yml` + `ci-python.yml` + GitLab CI |

💡 **只有 DSH SDK 有多语言实现**。MCP 与 ACP 是"接别人的协议"，SDK 是"定自己的协议"，所以只有后者需要跨语言客户端。

💡 **对照表之外还有第四条对外通道：SSH**（`packages/ssh`，[03 § 3.3](03-capability-seams-and-services.md)）。它不是驱动 DSH 的协议，而是把远端主机整个变成执行世界的传输层——fs / subprocess / sandbox 三个 provider 骑在同一条 `ctx.ssh` 连接上，helper 在对端用受信的本地 provider 执行文件系统与进程请求（`docs/subsystems/ssh.md`）。

## 4.25 `native/system` 的对照

另一个"独立发布的多平台组件"（[08 § 8.19](08-execution-services.md)）。0.1.5 的 `native/landlock-run` 在 rc.3 变成了 `native/system`（`@deepseek-ai/node-addon-system` v0.1.2，**BSD-3-Clause**）：从一个单用途 Landlock 启动器扩成**双入口的系统原语库**——`landlock-run`（Linux 进程圈禁）+ `flock`（POSIX 写锁，`tryLockExclusive(fd)`），平台包四份（darwin / linux × arm64 / x64）：

| 维度 | `native/system` | `sdk-runtime` |
|---|---|---|
| 语言 | Node addon + 平台预编译二进制 | Node（打包成 exe） |
| 发布 | npm（入口包 + 4 个平台包，独立 release 流水线） | PyPI（wheel 带二进制） |
| 平台选择 | npm 的 `os`/`cpu` 字段 | wheel 的 platform tag |
| 无回退策略 | **无安装期编译** → probe 报 unusable → fail closed（"Neither path compiles or silently grants unsupported behavior"） | — |
| 契约文档 | `docs/cli-contract.md` + `docs/flock-contract.md` | `PY/sdk-runtime/README.md` |
| CI | `node-addon-system.yml` + `node-addon-system-release.yml` | `build-exe-for-python-sdk.yml` + `python-release.yml` |

💡 **两者都采用"预编译多平台二进制 + 薄入口包"模式**，这是 Node/Python 生态分发原生组件的标准做法。flock 的加入说明 rc.3 把"会话写锁"也下沉到了系统层——`native/system/README.md`："Session write locks"。

## 4.26 `examples`：已删除

0.1.5 的顶层 `examples/` 与 `packages/examples` 组（acp-demo、jsonrpc-demo、agent-spine-demo，2858 行）在 rc.3 **整体删除**——示例代码不再单独成组，演示职责交给了根 `package.json` 的 demo 脚本（`demo:ptc`、`demo:inspector`，`:213-214`）与 profile 模板（`acp` / `sdk` / `sdk-minimal`）。

💡 **ACP 基于 JSON-RPC**，SDK 也用 JSON-RPC——裸协议交互不再有独立 demo，`test-support/remote-mock`（Typert Remote 流量的 mock）与 session-snapshot 承担了协议参考的角色。

## 4.27 `experimental` 组：生态的试验田

rc.3 最大的组织新概念：**63 个子包**（0.1.5 没有这个组）住在 `packages/experimental/`，既是"新能力的孵化器"，也是"降级能力的养老院"：

| 类别 | 包 |
|---|---|
| 兼容桥 | `hook-protocol` / `hooks-claude-code` / `hooks-codex`（§ 4.3）、`claude-code-mods`、`webhook` / `webhook-github`（`ctx.webhookRuntime`）、`deepseek-chat-import` |
| 新能力试验 | `cua` 家族（cua、cua-bundle、cua-macos、computer-use-cua-driver-*）、`browser-use-*`（playwright-mcp / chrome-devtools-mcp / stagehand-native）、`speech-to-text*` + `voice-input-bundle` + `api-speech-to-text`、`forge` 家族（forge、forge-github、forge-session）、`worktree` / `tool-worktree`、`liveshare` / `liveshare-protocol`、`inspector` / `inspector-profile`、`auto-review`、`session-search` / `session-inspector`、`subagent-oar` / `tool-subagent-oar`、`ptc-runtime-python`、推荐与翻译（`creation-recommendations`、`personalized-recommendations`、`plugin-recommendations`、`action-cards`、`translator`）、`webworker-packer` / `webworker-runtime` |
| 降级入住 | `tool-ralph`、`tool-terminal`、`terminal-panel`、`tool-session-query`、`session-title-all-prompts-llm`、`skill-badge`（§ 4.2） |
| bundle 化 | `cua-bundle`、`forge-bundle`、`ralph-bundle`、`terminal-bundle`、`session-titles-bundle`、`badge-skill-bundle`、`cot-translation-bundle`、`plugin-market-bundle`——把试验性能力打包成可整体启停的 bundle |
| 前端 | 8 个 `client-ui-*`（action-cards、claude-code-mods、cot-translation、creation-recommendations、forge、plugin-recommendations、stats、voice-input） |

💡 **seam 先在试验田里长出来**：capability 图（`docs/capability-seams.md`）里 `ctx.forge`、`ctx.worktrees`、`ctx.speechToText` 的 Definition 全部住在 experimental——三角色模型先建好，成熟一个转正一个（`computer-use` / `browser-use` 的定义包已转正到正式组，驱动留在试验田；`team` / `document` 整组转正）。

💡 **hooks 三包从正式组搬进来（§ 4.3）与 skill-badge 一起**，勾勒出这条边界：**稳定面 = 自有事件系统与核心能力；试验田 = 兼容竞品、未定形态、可能退役的一切**。0.1.5 文档把 hooks 当正式生态入口的叙述，在 rc.3 里要按这条边界重读。

---

**上一篇** ← [03 能力缝 Seam 与服务全景](03-capability-seams-and-services.md) ｜ **下一篇** → [05 启动流程与 Cordis 落地](05-startup-and-cordis-runtime.md)：从 `dsh web` 到插件树就绪的完整链路，以及底下那份 vendored cordis。

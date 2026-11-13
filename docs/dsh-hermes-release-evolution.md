# DSH 与 Hermes：从发布说明看两个 harness 的组件演进史

> 横向分析对象：DeepSeek Harness（`@deepseek-ai/dsh`）与 Nous Research Hermes Agent。数据为两者自首个有发布说明的版本以来的 GitHub Releases 正文全文——DSH 37 个版本（2026-08-17 ~ 2026-11-04），Hermes 48 个版本（2026-03-12 ~ 2026-11-10），共 85 份发布说明、2405 条组件变更条目（DSH 957 + Hermes 1448）。
>
> 全文分两部分：**第一部分是重点总结**，只讲 harness 内部组件在功能与概念上发生了哪些迭代与变迁；**第二部分是详情**，给出数据口径、分期、逐组件版本级证据与完整时间线。

---

# 第一部分 · 重点总结：组件发生过什么

## 1.1 一张表看完：14 个组件域，两条收敛到同一形状的曲线

把 85 份发布说明里的组件变更按域归并，两个项目的起点与终点如下。最右列是这次变迁在**概念**上真正改变的东西——它不是功能清单，而是「这个组件在系统里的身份」。

| 组件域 | DSH：起点 → 终点 | Hermes：起点 → 终点 | 概念跃迁 |
|---|---|---|---|
| 启动与组装 | `app-boot` 直接组装 → 全形态统一经 `dsh --profile`，bundle 组成有序 patch 栈，官方清单再抽成 `dsh-official-bundles` | 单实例 CLI 启动 → Profiles 多实例隔离 → 每机一个多路复用网关服务所有 profile | **应用 → 宿主** |
| 会话与状态 | SQLite 后端 → `Session.events` 全量数组 → `seq`/`eventAt`/`snapshotEvents` 按需读 → `SessionHandle` + 单进程锁 + 格式 v2/v3/v4 → projection 异步持有 | `sessions.json` 分散 JSON → `state.db` 单库 → 移除全部第二写者 → canonical session authority（admission + 回执 + 租约 + epoch 栅栏） | **数据结构 → 单一权威** |
| **Agent 主循环** | max-tokens 截断后会话可续 → 动态提示词不破坏 KV Cache → 模型选择在提示词组装与 pre-step 前固定 | 16k 行 `run_agent.py` → 14 个内聚模块 → `TurnContext`/`TurnRunner`/`finalize_turn` 接缝；超时改活动驱动 | **巨石 → 接缝化引擎** |
| 推理接入 | DeepSeek 适配器收敛为 Messages-only（移除 Chat Completions 与 protocol 选项）→ 模型目录随版本更替 | 集中 `call_llm` 路由 → Transport ABC（Anthropic/ChatCompletions/Responses/Bedrock）→ `ProviderProfile` 插件 → MoA 成为虚拟模型 | **if/else → 多态传输 + 虚拟模型** |
| **工具执行** | 单一工具层带展示模式（`native`/`ptc`/`both`）→ 移除 `both` → 原生与 PTC 拆为按 Agent 作用域选择的插件 + 按步骤条件启用 | 十个 `browser_*` 工具 → 只留 `browser_exec`；约 19 个低频工具 → `tool_search` 按需加载 | **静态清单 → 运行时解析** |
| **沙箱与执行后端** | 多后端（含 E2B）→ 移除 E2B、`confine`/`start` 改可取消异步 → 明示「不保证隔离」 | 去依赖（原生 Modal SDK 替换 swe-rex）→ 后端可插拔（Singularity 外迁插件）→ 宣示 OS 级隔离即安全边界 | **内置防线 → 可插拔 + 责任外移** |
| **子代理与多 agent** | 单向 `report` → `send_message` 双向 → steer/队列/编辑/停止 → `spawn_teammate` 团队 → `subagent_oar` 外延到本机 Codex/Claude CLI | 子代理迭代预算独立 → Kanban swarm 拓扑 → Bot Mode 命名/头像/群聊 → `hermes peer` 跨机 DM → Group Chats 自治路由 | **函数调用 → 有身份的社会成员** |
| 技能与知识资产 | skills 随插件组合包下发、随插件启停更新，未走 provider 化 | 70+ 内置 skills + Hub → Curator 自主评分合并清理 → 58 精简到 44；memory 内置 → provider ABC → 六个 provider 进目录 | **静态资产 → 可自维护的插槽** |
| **插件与分发** | 自注册设置卡片 → 可声明 UI/登录/语言 → `engines.dsh` 版本契约 → 自定义插件索引 | 一等插件架构 → gateway 变插件宿主 → 渠道全部 bundled → 再插件化交付 → Official/Verified/Community 分级市场 | **加工具 → 有治理的分发市场** |
| 前端表面 | 聊天窗 + Detail 面板 → 移除 Detail、右侧 Sidebar 承接 → 终端/Office/浏览器/子代理会话全进侧栏 | CLI → Web Dashboard → React/Ink TUI → 原生 Desktop → Webapp（同一工作区开进浏览器） | **窗口 → 可替换的壳** |
| 协议与集成 | APIProxy 移除、统一 `@Remote` 单向网关 → 双向流 + 二进制 + `RemoteError` → ACP 补齐全功能面 → headless stdout 契约 | MCP 客户端 → 反向作 MCP server → OAuth 2.1 → SDK 2.x 无状态协议 → Connectors 统一「托管应用 + 本地 MCP」 | **单点调用 → 统一接入层** |
| 自动化 | 核心内置 → 拆为可选插件包默认关 → Web 内置 → 宿主级管理（**四次归属翻转**） | `cronjob` 单一工具 → 活动驱动超时 + pre-run 脚本 → 持久 memory/notepad/monitor → 可插拔 provider + 托管 Chronos | **定时脚本 → 调度 agent** |
| 安全与审批 | 公网 WebFetch 默认放行 + SSRF → 按调用方身份的网关授权 → 默认关闭先读防护、放开内网 | 分散危险命令检测 → Tirith 预执行扫描 + 审批策略表 → smart approvals 默认裁决 → 私有安全 worker | **人工逐条 → 默认裁决 + 准入** |
| 发布工程 | 中英双语 + 新增/修复/优化三段 + 每条贡献者署名 | 全量 PR 清单 → 窗口摘要 + 大版本收割；日期 tag（`v2026.x.y`）→ SemVer 稳定流水线 | **变更日志 → 治理信号** |

## 1.2 功能维度：所有组件变更只落在三个动作上

957 + 1448 条变更看下来，功能层面的动作不是散点，而是三个动词——**拆、收、固**。

### 1.2.1 拆：外置化与插槽化

外置化是把能力从核心搬到插件层。DSH 搬出 E2B 后端、invariant 诊断导出、Inspector、自动化任务、工作树独立插件；Hermes 搬出六个内存提供方、Home Assistant/Spotify/Langfuse/TouchDesigner、`mcp serve`、Singularity 沙箱、GitHub Copilot、全部消息适配器、`import-agent`、Camofox。Hermes 这一步做得更彻底——`v0.22.0` 一次瘦身让源码从约 106 万行降到 69.8 万行（-34%），`gateway/run.py` 从 34,847 行缩到 5,512 行。

插槽化是把单实现改成「抽象类 + provider 注册」。memory 从内置组件变成 provider ABC（`v0.8.0`），推理提供方从内置列表变成 `plugins/model-providers/`（`v0.13`），沙箱、浏览器、视频、图像、TTS、委派后端依次获得同一形状，官方说法是「新后端 = 一个文件」。DSH 对应的是能力接缝（seam）：插件从「加一个工具」升级为「声明设置卡片、提供方登录、界面语言、整包预置」。

这两件事都**不是单向的**。DSH 的自动化任务在 5 个版本里换了四次归属（核心 → 可选包 → Web 内置 → 宿主级）；Hermes 的渠道适配器走了「核心内置 → 外部安装 → bundled 随包 → 捆绑插件交付」四步。说明「能力该放核心还是插件」没有一次性正确答案，只随分发成本、安装体验与维护负担反复再平衡。

### 1.2.2 收：所有权集中与生命周期化

收的动作有两个方向，指向同一件事——**谁有权改、能持有多久**。

横向是所有权：DSH 在 `0.1.3-alpha.1` 就给会话加了单进程锁，同一 session 至多被一个进程持有；Hermes 在 `v2026.9.11` 移除根 `state.db` 的全部第二写者，`v2026.9.14` 定下「读路径只读、写路径归一」，`v2026.9.21` 引入主机级 gateway 单例锁，`v0.23.0` 让一个网关独占所有会话、其余表面全部降级为客户端。

纵向是生命周期：DSH 把 `Session.events`（数组）换成按需读取的日志 API，再换成由生命周期持有的 `SessionHandle`，`agentLoop.create()` 改异步，Session Projection 的注册也变成「启动时持有异步句柄」；沙箱的 `confine` 与 `ShellExecutor.start` 改可取消异步。Hermes 把「回合」抽成 `TurnContext`/`TurnRunner`，给 worker 加租约与 epoch 栅栏，让 worker 能被 kill 后重新收养。

结果是同一类概念在两边都出现了：**句柄、租约、锁、回执、墓碑、准入**。这些词在更早的个人 Agent 工具里几乎不存在。

### 1.2.3 固：确定性与契约化

确定性是把「交给模型判断」改回「交给代码决定」。Hermes 最典型的一例是 `session_search`：从 aux-LLM 摘要（约 $0.30/次、约 90 秒、且会编造）改为确定性 FTS 三模式检索（约 20ms，4,500× 提升且免费）。此外还有稳定系统提示以换取 prompt cache、压缩改 lean-tail、`tool_search` 按需加载、超时从 wall-clock 改活动驱动。DSH 则是动态系统提示词不破坏 KV Cache、工具按步骤条件声明、模型选择在 pre-step 前固定以保证重试一致性。

契约化是给「可插拔」补上约束。DSH 引入 `engines.dsh` 版本判定、bundle 的 DSH 兼容性检查、「自定义插件市场」更名「自定义插件索引」并排除 private 版本；Hermes 引入 Official/Verified/Community 信任分级、版本门槛、花费上限、OAuth 代登录。`v0.23.1` 那个补丁最能说明契约已成关键组件：插件目录 JSON 超过客户端 2 MiB 上限，导致**所有安装静默回退内置旧目录**，修复是把上限提到 16 MiB。

一句话：**拆让生态长得快，收让状态不出错，固让成本可预测。** 三者交替推进，构成两个项目共同的功能演化节奏。

## 1.3 概念维度：六条反复出现的变迁

上一节讲「怎么改」，这一节讲「改的时候，系统对自己的定义变了什么」。六条都在两个项目里独立出现。

### 1.3.1 核心瘦身，能力外迁

DSH 移出 E2B（`0.1.6`）、invariant 诊断导出（`0.2.1-alpha.1`）、Inspector（`0.1.7-rc.2`）、自动化任务（`0.2.0-rc.1`）、工作树独立插件（`0.2.2-alpha.3`）；Hermes 移出内存提供方、`mcp serve`、Singularity、Copilot、全部消息适配器。两边都把「核心应该多小」当成持续校准的问题，而不是一次性架构决定。

### 1.3.2 单一写者与所有权集中

这是两条独立曲线最惊人的重合。DSH 用单进程 session 锁 + `SessionHandle` + 异步持有的 projection 句柄；Hermes 用 canonical session authority + admission + mutation receipt + turn lease + epoch 栅栏。两边都在 2026 年 9–11 月得出同一结论：**多表面并发写同一会话是不可接受的状态损坏源**。差别只在粒度与词汇——DSH 是进程内锁加生命周期对象，Hermes 是跨表面权威加可重放回执。

### 1.3.3 从「应用」到「宿主」

DSH：所有形态经 Profile 启动 → bundle 声明能力 → 自动化升为 Host 层管理 → GUI 变工作台。Hermes：gateway 变插件宿主 → 每机一个多路复用网关 → 所有表面降为客户端。两边都把「自己是应用」改写成「自己是宿主，前端是可替换的壳」。

### 1.3.4 隔离承诺收缩，责任外移

DSH 两次在发布说明里写「尚未接受安全审计，沙箱、审批与权限控制不保证隔离」，并默认关闭文件修改的先读防护、放开 Web Fetch 内网访问。Hermes 在 `v0.15.0` 明确「以 OS 级隔离作为安全边界，应用层承诺不再视为边界」并移除公开安全公告页，`v0.22.1` 再加「私有安全 worker」显式抑制 skills、memory readers、插件 hooks 与凭据再水化。

两个互不相关的团队，在同一季度得出同一个不受欢迎的结论：**应用层做不出真隔离，只能做准入与审计**。这大概是这一代 harness 最诚实的一次自我修正。

### 1.3.5 身份与会话的生命周期化

DSH：子代理从「一次性任务」变成有 inbox、可 steer、可排队编辑、有 child ID 与 wait 语义的持续实体。Hermes：bot 从「一个适配器」变成有名字、有头像、在花名册里、可群聊互发 DM 的社会成员（`v0.21.0` 自称「诸神集会」）。两者都把 agent 从函数调用变成了**有地址、有状态的参与者**。

### 1.3.6 为缓存与可重放而确定性化

DSH：动态提示词不破坏 KV Cache、模型选择在 pre-step 前固定、工具按步骤条件声明。Hermes：稳定系统提示换 prompt cache、压缩改 lean-tail、`session_search` 从 LLM 摘要改为确定性 FTS。**能用确定性代码做的，就不要交给模型**——这条在两边都反复出现，是成本与可复现性压力下的共同收敛。

## 1.4 两条路径的分野，与五个判读

**路径差异只有一句话：DSH 先立结构再长能力，Hermes 先长能力再补结构。** DSH 在 `0.1.2` 就完成了入口收敛（所有形态统一经 Profile 启动），把结构性决策前置；Hermes 到 `0.22`/`0.23` 才做权威化收拢。代价也对应：Hermes 需要 `state.db` 双写者战役（两个月、44 个 issue）和 `v0.22.2` 重发错误构建的版本来偿还；DSH 则要在 `0.2.2` 承受工具管线插件化的迁移痛。

**判读一：DSH 在收敛，Hermes 在扩张。** fix 占 34% vs 24%、新增占 23% vs 43%，配合 DSH 约两天一版的密度，DSH 更像「边发边还技术债」，Hermes 更像「边发边铺新面」。

**判读二：命名是架构决策的滞后指标。** DSH 的 `Code mode → PTC mode → ptc-runtime` 三段更名，恰好对应它从「预设文案」到「独立进程运行时」的三次实质变化；Hermes 的「MCP 标签页 → Connectors」、relay 授权从 platform 视角转 delivery 视角、「自定义插件市场 → 自定义插件索引」，每次更名背后都是职责或信任模型的改变。看 `renamed` 条目比看 `new` 条目更能读出架构意图。

**判读三：回退是常态，不是事故。** Hermes 明确记录了大量「落地即回退」：Kanban 协作板（`v0.12` 回退、`v0.13` 重做）、Model Council 与 DCP context engine（`v0.21` 窗口内回退）、WS-only gateway、Desktop 建议 pills（`v0.22.4`）。DSH 也有：`SessionEvent.ignorable` 误删后恢复、`both` 展示模式移除、跨行 `$$` 数学块解析回退。发布说明里写清回退，本身就是工程成熟度的标志。

**判读四：发布工程本身在演化，且是信号。** DSH 始终保持双语三段式加署名；Hermes 从「全量 PR 清单」转向「窗口摘要 + 大版本收割」——`v0.22.3` 起明确写「组件变更只以一句话列举、完整说明推迟到 v0.23.0」，版本标识也从日期 tag 过渡到 SemVer 稳定流水线（`v0.21.6` 是首个产物，`v0.21.7` 让源码安装默认跟 tag 而非 main）。**当一个项目的发布说明开始惜字，通常说明它的变更量已超过人类可读的带宽。**

**判读五：终点高度相似。** 核心极薄、能力皆插件、会话单写者、隔离交给 OS、前端只是壳。两个项目在语言、社区与商业模式上完全不同，却在同一年收敛到同一形状——这说明这不是某家的架构品味，而是**Agent harness 这一类软件在规模压力下的必然形态**。

---

# 第二部分 · 详情

## 2.1 数据与口径

| 项 | 内容 |
|---|---|
| 生成时间 | 2026-11-11 |
| DSH 覆盖区间 | 2026-08-17 `dsh-v0.1.0-rc.7` → 2026-11-04 `dsh-v0.2.2-rc.1`，共 37 个 release |
| Hermes 覆盖区间 | 2026-03-12 `v2026.3.12`（v0.2.0） → 2026-11-10 `v0.23.1`，共 48 个 release |
| 数据来源 | 两个仓库的 GitHub Releases 正文全文（`gh api repos/{owner}/{repo}/releases`），非 commit diff |
| 抽取方式 | 85 份发布说明按时间切片，逐份精读后结构化为 `{version, date, headline, changes[{component, change_type, summary}]}`，共 2405 条组件变更条目 |
| 变更类型口径 | `new` 新增能力；`refactored` 重构/职责调整；`renamed` 改名或概念更名；`removed` 移除；`deprecation` 废弃；`behavior` 行为或语义变化；`fix` 修复；`concept` 纯定位宣示 |
| 局限 | 只读发布说明，未核 commit；DSH 在 `0.1.0-rc.7` 之前已有 npm 包（`0.0.1-rc.1`，2026-08-10）但无发布说明，故实际起点为 08-17；Hermes `v0.1.0` 为 pre-public foundation，同样无说明 |

| 项目 | DSH | Hermes |
|---|---|---|
| 版本数 / 时间跨度 | 37 / 约 80 天 | 48 / 约 243 天 |
| 组件变更条目 | 957 | 1448 |
| 平均每版条目 | 约 26 | 约 30 |
| fix | 327（34%） | 353（24%） |
| behavior | 288（30%） | 320（22%） |
| new | 223（23%） | 626（43%） |
| refactored | 82（8.6%） | 113（7.8%） |
| removed / renamed / concept / deprecation | 20 / 11 / 4 / 2 | 23 / 10 / 3 / 0 |

两个口径层面的观察：

- Hermes 存在「滚动补丁 tag + 大版本收割」的发布策略。多个补丁版（`v2026.9.7`、`v0.22.3`、`v0.22.6`、`v0.23.1`）明确写「组件变更只以一句话列举，完整说明推迟到下个 minor」，这会让补丁版的信息密度被压低，但不改变趋势判断。
- DSH 版本序与时间序不完全一致：`0.1.4` 从未存在（0.1.3 直接跳 0.1.5），而 `0.1.5-rc.3` 在 `0.1.7-alpha.2` 之后（09-22）才发布，说明维护线与主线并行推进。

## 2.2 两条弧线的分期

### 2.2.1 DSH：五段式，80 天走完「铺面 → 收敛 → 平台化」

| 阶段 | 版本 | 主题 |
|---|---|---|
| ① 稳定性收尾 | 0.1.0-rc.7 → 0.1.1-rc.2（08-17~08-21） | 多模态基础链路（图片进会话、进上下文预算）、子代理接入 Job Panel |
| ② 架构收敛 | 0.1.2 全线（08-27~09-03） | APIProxy 移除统一 `@Remote`、统一经 Profile 启动、SQLite 后端移除、Code Mode 更名 PTC mode |
| ③ 存储换代 + 工作台成型 | 0.1.3 ~ 0.1.6（09-04~09-17） | `SessionHandle` 生命周期、格式 v2/v3、Detail 面板被 Sidebar 工作台取代、PTC 独立进程化 |
| ④ 插件化架构收敛 | 0.1.7 ~ 0.2.0（09-22~09-29） | 设置与预设迁入 Profile 插件配置、版本契约前身、自动化拆为可选包、桌面集成成熟 |
| ⑤ 平台化重构 + 语义放宽 | 0.2.1 ~ 0.2.2（10-03~11-04） | 工具管线按 Agent 作用域插件化、Cordis 4.1.0、Session Projection 异步持有、防护责任外移 |

### 2.2.2 Hermes：四段式 + 主题命名

Hermes 给大版本起主题名，DSH 从不这么做——这本身就是一种产品姿态差异。已命名的有：`Foundation`（0.14）、`Velocity`（0.15）、`Surface`（0.16）、`Reach`（0.17）、`Judgment`（0.18）、`Quicksilver`（0.19）、`Herald`（0.20）、`Pantheon`（0.21）、`Threshold`（0.22）、`Hearth`（0.23）；非正式命名的还有 `everywhere`（0.9）、`Interface`（0.11）、`Curator`（0.12）、`Tenacity`（0.13）。

| 阶段 | 版本 | 主题 |
|---|---|---|
| ① 铺面 | 0.2 ~ 0.8（03~04） | 多平台网关、MCP 客户端、Skills 生态、集中 provider router、Profiles 多实例、memory 插件化 |
| ② 立边界 | 0.9 ~ 0.13（04~05） | 16 渠道 + Web Dashboard、Ink TUI + Transport ABC、gateway 变插件宿主、Curator 自我维护、Kanban 多 agent 看板 |
| ③ 产品化 + 提速 | 0.14 ~ 0.19（05~08） | PyPI 与懒加载、`run_agent.py` 16k→14 模块、Desktop 一周造出、MoA 升格、首 token -80% |
| ④ 权威化 + 核心瘦身 | 0.20 ~ 0.23（08~11） | canonical session authority、「一个网关独占所有会话」、核心外迁插件、源码 -34%、插件市场治理 |

## 2.3 DSH：逐组件演进

### 2.3.1 启动与组装（boot / profile / bundle / Cordis）

最彻底的一次概念替换发生在这里。DSH 早期还是一个「应用」（`app-boot` 直接组装），到 `0.1.2-alpha.1` 变成「所有形态统一经 `dsh` Profile 启动」——连 Python SDK 和 ACP 模式也不例外，启动入口收敛为单一路径。随后 `0.1.7-alpha.1` 把设置从独立 `settings.yaml` 迁入 Profile 的插件配置（旧文件只尝试导入一次），并把 Agent 预设从目录式改为由插件组合包（bundle）声明和安装，设置页只保留「查看与选择」。到 `0.2.2-alpha.2`，官方组合包列表再抽成独立包 `@deepseek-ai/dsh-official-bundles`，`boot` 与「官方推荐了哪些包」彻底解耦。

概念上完成三级跳：**应用 → Profile 的有序 patch 栈 → 可声明、可分发、有版本契约的 bundle 组合**。底座 Cordis 从 vendored 4.0.2 一路同步到 4.1.0（`0.2.2`），并给 Fiber 补齐 raw / candidate / effective 三态配置访问，使「设置编辑」与「热更新」用同一配置来源——这是把插件的「配置真相」从分散走向归一。

### 2.3.2 会话与存储：全项目最陡的一条曲线

| 版本 | 变化 | 概念含义 |
|---|---|---|
| 0.1.0-rc.8 | 重写 SQLite 后端（不兼容） | 存储层第一次破坏性升级 |
| 0.1.2-alpha.3 | 移除可选 SQLite 后端 | 实现收敛为单一后端 |
| 0.1.2-alpha.4 | `Session.events` → `seq` / `eventAt()` / `snapshotEvents()` 按需读取；`SessionSeq` 与 `SessionLogOffset` 强类型分离 | 历史从「全量暴露的数组」变成「按需读取的日志」 |
| 0.1.3-alpha.1 | `SessionHandle` 生命周期持有、`agentLoop.create()` 异步、单进程 session 锁、格式 v2（不可变相邻 generation 迁移） | 会话从数据结构变成「被独占持有的生命周期对象」 |
| 0.1.5 | 格式 V3，系统提示词纳入消息历史 | 提示词成为历史的一部分，而非旁路配置 |
| 0.1.6 | 弃用同步历史接口 `snapshotEvents`/`eventAt`/`ownEvents` | 读路径全面异步化 |
| 0.1.7 | 格式 V4 + 批量迁移工具 | 格式代际管理工程化 |
| 0.2.2 | Session Projection 注册 API 改为异步持有句柄；创建/恢复/销毁的事件顺序与取消清理严格化 | 派生态（projection）也被纳入资源生命周期 |

四个概念跃迁连成一条清晰路径：**数组 → 日志投影 → 有格式代际（不可变 generation）的日志 → 被独占持有的生命周期对象 → 连派生态都需异步持有**。

注意「单进程 session 锁」这一步的意味：DSH 在 2026-09 就已经把「同一会话只能有一个写者」写进了架构约束——与 Hermes 后来（10 月）的 canonical authority 是同一个洞察，只是颗粒度更小。

### 2.3.3 Agent loop：为缓存与可重放而「确定化」

`0.1.5` 引入不破坏 KV Cache 的动态系统提示词，同时把 persona 拆成前缀与后缀两段。`0.1.6` 把 `agent/session-start` 改为异步串行的 `agent/created`，首次模型请求必须等初始化完成。最关键的一步在 `0.2.2-alpha.2`：Agent 在提示词组装与 pre-step 之前就固定本步模型，重试保留同一选择；插件只能通过 `agent.model` 选择模型，`agent/request` 不再允许改路由。

这是职责上收：模型选择从「请求层可变」变为「回合/步骤级确定」。动机写得很直白——为了缓存命中与重试一致性。同一条逻辑在 `0.1.7` 已经出现过（动态工具注入不破坏 KV Cache）。

### 2.3.4 工具执行管线与 PTC：从展示模式到运行时边界

命名史是第一层线索：`Code mode`（`0.1.0-rc.7` 仅英文）→ `PTC mode`（`0.1.2-alpha.1` 全语言统一，旧会话仍可读）→ `ptc-runtime`（`0.1.6`/`0.1.7` 包名与服务名统一，旧名不再兼容）→ 工作流执行器改 `workflow-ptc`（遵循会话文件策略，暂不支持 Python PTC）。

第二层是隔离：`0.1.6` 把 Node PTC 移入独立进程，`process.env` 置空、限制输出与堆内存。PTC 从此不再只是一个「工具展示形态」，而是一个有进程边界的执行环境——`0.2.2-alpha.2` 进一步把控制通道换成 birpc、SSH 协议 v2→v3，并新增 VM Script 模式。

第三层是装配：`0.2.1-alpha.2` 移除工具展示的 `both` 混合模式（只留 `native` 与 `ptc`），`0.2.2-alpha.2` 把原生与 PTC 执行拆成按 Agent 作用域选择的插件，并支持按步骤条件启用，模型声明 / PTC 绑定 / 执行准入三者必须一致；旧 `tools.mode` 与 `DSH_TOOLS_MODE` 环境变量改为配置 overlay。

概念上：**「一个工具层带几种展示模式」→「两种执行形态各自是插件，按 agent 作用域与 step 条件动态装配」**。工具可用性从静态声明变成了运行时解析。

### 2.3.5 沙箱与执行后端：承诺收缩、责任外移

`0.1.1-rc.1` 修掉 Bubblewrap 沙箱经 `/proc/<pid>/root` 的逃逸；`0.1.5` 把 `SandboxProvider.confine` 与 `ShellExecutor.start` 改成可取消的异步接口，且准备时间计入超时；`0.1.6` 移除内置 E2B 后端、Ralph 默认停用；`0.2.0-rc.1` 给 Windows 沙箱加权限诊断与可恢复修复技能。

真正的转向在语义层。`0.1.2-alpha.1` 与 `rc.1` 两次在发布说明里写同一句话：**DSH 尚未接受安全审计，沙箱、审批与权限控制不保证隔离**。到 `0.2.2-alpha.3` 更直接：默认关闭文件修改的「先读后改」与外部修改防护，Web Fetch 放开内网访问。连续三次调整的方向一致——从「内置防护默认开启」退到「防护可关、责任交给部署侧与用户」。

### 2.3.6 子代理与多 agent：从一次性任务到跨 harness 委派

| 版本 | 变化 |
|---|---|
| 0.1.0-rc.7 | Claude Code / Codex 子代理任务接入 Job Panel |
| 0.1.0-rc.8 | 两者变为可按需安装的 Profile Bundle，支持非交互权限模式与命名实例 |
| 0.1.2-alpha.4 | 单向 `report` 工具被 `send_message` 双向消息取代 |
| 0.1.3-alpha.2 | 补齐排队、编辑、删除、Steer、停止 |
| 0.1.5-alpha.2 | 实验性 Agent Teams 上架 npm，`spawn_teammate` 取代 `subagent`/`subagent_fork` |
| 0.1.7-rc.2 | 中文界面统一称「子智能体」 |
| 0.2.1-alpha.2 | 工具立即返回 child ID，配 `session`/`wait`；Agent Team 改 Inbox 直投，移除独立 outbox、自动重试与去重 |
| 0.2.1-alpha.1 | 实验性 Claude Code Mods 兼容层（官方判断：Mods API 大致是 DSH 插件能力的子集） |
| 0.2.2-alpha.3 | `subagent_oar` 把委派边界外延到本机 Codex/Claude CLI |

概念变迁：**一次性任务执行者 → 可持续对话实体（有 inbox、可 steer、可排队编辑）→ 团队拓扑（teammate）→ 跨 harness 的委派边界（把别人的 CLI 当自己的子代理）**。

### 2.3.7 Web GUI：从聊天窗口到工作台

`0.1.2-alpha.1` 会话视图工程按能力分层拆分，并让过程内容默认折叠、token 用量可展开；`0.1.2-alpha.2` 加连接状态显示与自动重连（连接层从静默失败变为可观测）。`0.1.5-alpha.1` 移除 Detail 面板，由右侧 Sidebar 承接；`0.1.6` 一路把终端、Office 预览、浏览器模式、Subagent 会话、提交计划、回合级文件改动审阅都塞进侧栏。

概念上，GUI 从「聊天气泡 + 详情面板」变成**承载多种工作对象的宿主**——这也是 DSH 后续「宿主级管理」（`0.2.2-alpha.3` 把自动化任务升为 Host 层）的前提。

### 2.3.8 插件生态：从「加工具」到「有契约的分发单元」

`0.1.0-rc.7` 插件可自注册设置卡片；`0.1.2-alpha.1` 可添加提供方登录配置、可注册第三方界面语言；`0.1.6-alpha.2` 依赖改为运行时解析、支持运行时卸载，创造模式不再运行时动态定义 Cordis 工具而改走 Plugin Manager 装持久化插件；`0.1.7` bundle 获得有序 patch 加载、locale/图标声明、DSH 版本兼容检查；`0.2.1-alpha.4` 引入 `engines.dsh` 版本契约并开放自定义插件索引源；`0.2.2-alpha.2` 把「自定义插件市场」更名为「自定义插件索引」。

同期也在做减法：`0.2.1-alpha.1` 移除运行时 invariant 插件及各包的 `./invariant` 导出（运行时诊断断言退出插件体系），`0.1.7-rc.2` Inspector 不再默认内置。

概念三级跳：**插件=加工具 → 插件=可声明 UI/设置/语言/提供方/预置的包 → 插件=有版本契约、可分发、可索引的单元**。

### 2.3.9 协议层与远程：收敛为单一网关

`0.1.2-alpha.1` 移除旧 APIProxy，统一到 `@Remote` 网关；`alpha.2` 补 `RemoteError` 统一异常封装；`0.1.7` Remote 升级为双向流并支持二进制传输（工作区读取统一为 `readBytes`）。ACP 侧从「最小可用」补齐到标准功能面（会话控制、模型设置、MCP、权限、取消），`0.2.1-rc.4` 还专门修了「诊断输出混入 stdout」的协议级问题。Headless 的输出契约也明确：进度走 stderr，只有最终结果走 stdout，`0.1.7` 再加 stdin/JSON 事件。

一个容易被忽略的概念变化：`0.2.1-alpha.2` 把 SDK 的默认身份从「编程 Agent」改为「通用 AI Agent」——同一套内核，面向的对象定位变了。

### 2.3.10 遥测：从环境到内容，但守住 opt-in

`0.1.2-alpha.1` 让官方适配器默认随请求上报已启用插件的包名与版本（可关），同时新增可选的 Session 日志增量上传（默认关闭）；`0.1.6` 起会话事件也进入上报范围。方向是遥测粒度从「环境信息」深入到「会话内容」，但每步都保留开关与 opt-in。

## 2.4 Hermes：逐组件演进

### 2.4.1 进程与所有权：全项目最重要的一条线

| 版本 | 变化 |
|---|---|
| 0.6.0（v2026.3.30） | Profiles 多实例隔离，打破「一个安装一个实例」 |
| 0.9.0 | 本地 Web Dashboard 首次出现（第三个入口） |
| 0.16.0 | Desktop 原生应用一周内造出，dashboard 升格为全功能管理面板 |
| v2026.9.21 | 主机级 gateway 单例锁，Desktop 改为附着运行中的 host 后端而非再起一个 |
| 0.22.0 | 每机一个多路复用网关服务所有 profile，取代每 profile 一进程 |
| 0.22.1 | 网关内启动经过认证的共享会话权威（canonical session authority）：admission + 持久 FIFO + mutation receipt |
| 0.23.0 | 一个网关独占所有会话，CLI/TUI/Desktop/ACP/bot/cron 全部降级为客户端 |

这是全项目最彻底的一次职责上移。发布说明把问题写得很具体：此前「CLI、TUI、Desktop、ACP 编辑器、消息 bot 与 cron 各自对同一会话运行自己的 agent 副本，导致消息被写两次或在表面间丢失」。解法是引入一整套分布式系统词汇——准入（admission）、回执（mutation receipt）、租约（turn lease）、epoch 栅栏、墓碑（tombstone）、收养（adopt）。`v0.22.1` 甚至写明「共享会话权威接口契约被冻结」。

概念上：**每个界面各跑一个 agent → 单一权威 + 回执可重放**。这与 DSH 的「单进程 session 锁 + SessionHandle」是同一洞察的两种实现粒度。

### 2.4.2 状态存储：从分散 JSON 到单库单写者

`sessions.json` 与路由索引在 `v2026.7.20` 收敛进 `state.db`（`sessions.json` 降级为可选 legacy 镜像）；`v2026.8.3` 把 19 个 session 键控 dict 合并为 turn / conversation / persistent 三作用域，并抽出 `TurnContext`/`TurnRunner` 接缝。随后是两个月的高强度修补：`v2026.9.11` 移除根 `state.db` 的全部第二写者（hosted-room 状态迁往 `shared-state.db`，dashboard 先只读打开），`v2026.9.14` 让「读路径只读、写路径归一」成为定则，长驻进程不再泄漏重复写句柄。`v0.13` 的 Checkpoints v2 重写状态持久化（真实修剪、磁盘护栏、不再产生孤儿 shadow 仓库）。

概念：**分散 JSON + 各表自便 → 单库 → 单写者 → 作用域模型 → 准入/回执**。

### 2.4.3 Agent 核心循环：从 16k 行巨石到接缝化引擎

`v0.15.0`（Velocity）是分水岭：`run_agent.py` 从 16,083 行降到 3,821 行（-76%），拆成 14 个内聚 `agent/*` 模块（原 `run_conversation` 单函数就有 3,877 行），每处抽取都在 `AIAgent` 上留薄转发器以保证 patch 路径兼容。此后 god-file 拆分成了惯例：`cli.py` `main()` 3297→954（`v2026.6.19`）、`gateway/run.py` 19157→15870（同）→ 到 `v0.22.0` 已是 34,847→5,512。

语义层同步重定义了三件事。超时：`v2026.4.8` 从 wall-clock 改为活动驱动（活跃长任务永不误杀，cron 同改）。迭代预算：父子共享 → 子 agent 独立，上限后来从 90 提到 500。压缩：从「一次性大暂停」改为微压缩 + 主动修剪 + ghost-skill 防御（`v2026.8.3`），并默认转向 lean-tail（`v2026.8.27`）。工具加载：`v0.22.0` 把约 19 个低频工具改为 `tool_search` 按需加载。

### 2.4.4 推理层：从 if/else 到可插拔传输 + 虚拟模型

`v0.2.0` 建立集中 provider router（`resolve_provider_client()` + `call_llm()`/`async_call_llm()`），把视觉、摘要、压缩、轨迹保存全部辅助 LLM 消费收敛到单一路径。`v0.11.0` 抽出 Transport ABC（Anthropic / ChatCompletions / Responses / Bedrock 各自持有格式转换），这是推理侧最大的一次架构调整。`v0.13` 引入 `ProviderProfile` ABC 与 `plugins/model-providers/` 目录，第三方 provider 不必动核心即可插入；到 `v0.22.0` 官方目录里已有 48 个模型提供方类插件。

模型选择入口也走了个来回：`/model` 斜杠命令 → 让位 `hermes model` 子命令（`v0.5.0`）→ `/provider` 别名移除、统一回 `/model`（`v0.13`）。

最值得记的概念变化是 MoA 的身份升级（`v0.18.0`）：从「可开关的模式」变成 `moa provider` 下的虚拟模型，出现在所有模型选择器里与 Claude/GPT/Grok 并列，选中即路由经整个 ensemble；`/moa` 降格为一次性便利入口。

### 2.4.5 插件体系：从「加平台」到「有治理的分发市场」

`v0.3.0` 建立一等插件架构（扩展边界从「改代码」变成「投文件」）；`v0.12.0` 网关转型为插件宿主，Microsoft Teams 成为首个以插件交付的平台（第 19 个渠道）；`v0.13` 插件面扩到推理提供方与通用平台钩子；`v0.18.0` 九个渠道适配器全部转为 bundled。

然后出现了明显的「来回摆动」：bundled 之后，`v0.22.5` 把 `hermes mcp serve` 与 Singularity 沙箱后端移出核心改插件交付，`v0.22.0` 把六个内存提供方与 Home Assistant/Spotify/Langfuse/TouchDesigner 外迁、移除旧插件兼容导入层，`v0.23.0` 再把 GitHub Copilot、全部消息适配器、`hermes mcp-serve`、`hermes import-agent` 插件化，核心内置技能从 58 精简到 44。

治理机制随之成熟（`v0.22.0` / `v0.23.0`）：600 插件目录成为分发中心，引入 Official / Verified / Community 分层、版本门槛、花费上限、OAuth 代登录、插件 OAuth 与自动更新。`v0.23.1` 的补丁很能说明「目录本身已成关键组件」——插件目录 JSON 超过客户端 2 MiB 上限，导致所有安装静默回退内置旧目录，修复是把上限提到 16 MiB。

概念：**插件=加平台 → 插件=宿主可装载的一切 → 插件=有信任分级与配额的分发市场**。

### 2.4.6 Skills：从提示文件到「agent 自己维护的资产」

`v0.2.0` 70+ 内置技能 + Skills Hub，支持按平台启停、按工具可用性条件激活、前置依赖校验。`v0.12.0` 引入自主 Curator 后台代理按周期评分、合并、清理技能库；`v0.13` Curator 子命令化并加写后 lint（让 agent 检查自己的写入），且后台 review 与 curator 都被禁止覆盖内置技能。`v0.16.0` 开始刻意瘦身并引入 environments 门控；`v0.23.0` 内置技能 58→44，Word/PowerPoint/Excel 合并为单个 `microsoft-office`。

概念：**技能=提示文件 → 技能=可门控、可修剪、可被 agent 自己维护的资产**。

### 2.4.7 Memory：插槽化最彻底的一块

`v0.8.0` 把 memory 从内置组件重构为可插拔 provider 插件架构（provider ABC + 插件注册，内置降为默认）；`v0.22.0` 六个内存提供方（Honcho、Supermemory、Hindsight、Mem0、OpenViking、Holographic）全部移出核心进目录。中间还有一次语义降级：`v0.15.0` 把「召回记忆」降格为参考信息而非指令。

概念：**记忆=一个实现 → 记忆=插槽 → 记忆=生态**。

### 2.4.8 安全与审批：从人工逐条到智能裁决 + 边界外移

`v0.2.0` 只有分散的危险命令检测与 `--fuck-it-ship-it` 绕过开关；`v0.5.0` 前后体系化为 Tirith 预执行扫描 + SSRF 防护 + 审批策略表；`v0.17`（Quicksilver）把审批默认改为 smart approvals 自动裁决 + deny 规则兜底。秘密脱敏的默认值在两周内反转两次（`v0.12` 默认关以止住 patch 破坏，`v0.13` 关闭 8 个 P0 时重新默认开）。

最关键的一句宣示在 `v0.15.0`：明确以 OS 级隔离作为安全边界，应用层承诺不再视为边界，同时移除公开安全公告页。到 `v0.22.1` 出现「私有安全 worker」概念——在其中显式抑制 skills、memory readers、插件 providers/hooks 与凭据再水化。

概念：**逐条人工审批 → 默认智能裁决 + 规则兜底 → 隔离交给 OS，应用层只做准入**。这与 DSH 的结论殊途同归。

### 2.4.9 表面（Surfaces）：CLI → 产品 → 多前端

`v0.9.0` 出现本地 Web Dashboard；`v0.11.0` 把交互面重写为 React/Ink TUI + JSON-RPC 后端（`app.tsx` 拆为 event-handler / slash-handler / stores / hooks）；`v0.16.0` 一周内造出原生 Desktop 并把 dashboard 升格为管理面板；`v0.17` 桌面外壳改为 layout-tree 模型（pane/zone/layout 全数据化，贡献驱动）；`v0.23.0` 让 Desktop 工作区以 Webapp 形式开进浏览器标签页。

概念：**终端工具 → 可安装产品 → 同一工作区的多前端**。这与 DSH「GUI 变工作台」是同一方向，但 Hermes 走得更远——它把前端做成了可替换的壳。

### 2.4.10 cron / 自动化：从定时脚本到调度 agent

`v0.3.0` 把多条 cron 命令压成单一 `cronjob` 工具；`v2026.4.8` 超时改活动驱动、支持 pre-run 脚本注入；`v0.20.x` 给 cron 加持久 memory、notepad、monitor 模式（无变化时跳过 LLM）；`v0.17`/`v0.18` 转向可插拔 provider 与托管 Chronos；`v0.22.0` 改为跟随主模型。

概念：**无状态触发器 → 跨运行学习的调度 agent**。对照 DSH：DSH 的自动化任务经历了四次归属翻转（核心内置 → 可选插件包默认关 → Web 内置 → 宿主级管理），Hermes 则是能力不断增强而未反复搬家。这是两个团队在「能力该放哪」上的不同决断风格。

### 2.4.11 多 agent：从并行调用到「agent 社会」

`v0.13` Kanban 以持久多 agent 看板重新落地（心跳、回收、僵尸检测、幻觉门控）；`v0.15.0` Kanban 长出 triage 自动分解 + `kanban swarm` 拓扑（根 + 并行 worker + 门控 verifier + 门控 synthesizer + 共享 blackboard）；`v0.21.0`（Pantheon）Bot Mode 从捆绑插件变成桌面默认的有名字、有头像、可群聊体系，`hermes peer` 让 agent 跨 profile、跨 gateway 互发 DM；`v0.23.0` Group Chats 长出 lead/auto 路由、共享笔记与防 bot 死循环；`v0.22.5`/`v0.23` 委派后端可插拔（按模型映射或 profile 路由）。

发布说明自己给了叙事升级的注脚：`v0.20.0` 让 Hermes 成为「向其他 agent 传话的传令者」，`v0.21.0` 宣示「诸神集会」。概念上，多 agent 从「并行调用 + 接线工程」变成「有身份、有花名册、有群聊的社会」。

## 2.5 结语

DSH 用 80 天走完了「把应用拆成 Profile/bundle 的 patch 栈、把会话变成有锁的生命周期对象、把工具执行拆成按 Agent 作用域装配的插件、把安全承诺退到审计边界」这一整套收敛；Hermes 用 243 天走完了「从 CLI 到多渠道平台到可安装产品、把 memory/渠道/provider/沙箱逐个插槽化、最后用 canonical session authority 把所有表面收编为一个网关的客户端」。

两条路线的终点高度相似：核心极薄、能力皆插件、会话单写者、隔离交给 OS、前端只是壳。差异在路径——DSH 先立结构再长能力，Hermes 先长能力再补结构。而当两个语言、社区与商业模式都不相同的项目在同一年收敛到同一形状时，这更像 **Agent harness 这类软件在规模压力下的必然形态**，而非某家的架构品味。

## 附录：版本级时间线

两张表可用于按版本回查任意一条组件变更的上下文；每条变更的完整结构化记录（component / change_type / summary）保留在抽取结果中，可按组件维度二次导出。

### A. DSH 37 个版本

| 日期 | 版本 | 一句话 |
|---|---|---|
| 2026-08-17 | `v0.1.0-rc.7` | 插件与子代理生态扩展：插件可自注册设置卡片、Claude Code/Codex 子代理任务接入 Job Panel、Code mode 预设开启 PTC mode 更名，并修复 max-tokens 截断会话与 PTY 平台兼容等稳定性问题。 |
| 2026-08-19 | `v0.1.0-rc.8` | 多模态与子代理形态双升级：DeepSeek 适配器可启用原生图片请求、@ 菜单可引用文件与会话，Claude Code/Codex 子代理改为按需安装的 Profile Bundle，SQLite 存储结构不兼容重写。 |
| 2026-08-21 | `v0.1.1-rc.1` | 0.1.1 维护线首个候选：接入 DeepSeek-V4-Flash-Vision-Exp 视觉理解模型，并修复 Bubblewrap 沙箱 /proc/<pid>/root 逃逸漏洞。 |
| 2026-08-21 | `v0.1.1-rc.2` | 图像链路打磨：优先走 Files API 上传并复用已上传文件，图像预处理按模型要求自动缩放与转码。 |
| 2026-08-27 | `v0.1.2-alpha.1` | 0.1.2 架构收敛开端：ACP/Python SDK/子代理模型控制全面补齐，APIProxy 移除并统一 @Remote 网关，公网 WebFetch 默认放开，Code Mode 全面更名 PTC mode。 |
| 2026-08-30 | `v0.1.2-alpha.2` | 连接与错误可观测：界面显示断连状态并支持自动重试/立即重连，Remote 网关统一 RemoteError 异常封装，并恢复 alpha.1 误移除的 SessionEvent.ignorable。 |
| 2026-08-31 | `v0.1.2-alpha.3` | 移除可选的 SQLite Session 持久化后端，并集中修复长会话渲染与图片投递问题。 |
| 2026-09-01 | `v0.1.2-alpha.4` | 子代理 `send_message` 双向消息取代单向 `report` 工具；Session 事件 API 改为按需读取。 |
| 2026-09-02 | `v0.1.2-alpha.5` | 修复从旧版本升级可能导致应用启动失败或会话列表标题丢失的问题。 |
| 2026-09-03 | `v0.1.2-rc.1` | 0.1.2 系列首个候选版本，汇总自 v0.1.1-rc.2 以来的主要变更：ACP 能力补齐、Code Mode 更名 PTC mode、SQLite 后端移除、Remote 网关统一等。 |
| 2026-09-04 | `v0.1.3-alpha.1` | Session 持久化架构改版：生命周期持有的 SessionHandle 与 Session format v2 落地；Web 支持任意类型文件上传。 |
| 2026-09-07 | `v0.1.3-alpha.2` | 可持续子代理补齐消息排队、编辑、Steer 与停止的完整操控面；SDK、Headless、ACP 默认文件编辑工具调整。 |
| 2026-09-08 | `v0.1.5-alpha.1` | 会话格式升级至 V3（系统提示词纳入消息历史），新增不破坏 KV Cache 的动态系统提示词，Web 端以实验性右侧 Sidebar 取代 Detail 面板。 |
| 2026-09-09 | `v0.1.5-alpha.2` | 右侧 Sidebar 扩展为通用文档预览并支持模型显式交付文件；实验性 Agent Teams 包上架 npm，极简 profile 默认工具收敛为仅持久 shell。 |
| 2026-09-10 | `v0.1.5-rc.1` | 0.1.5 首个候选版汇总系列变更并定稿底座：默认模型切换为 DeepSeek-V41-Flash、Web 支持任意文件上传、可继续子代理支持消息排队，Session 持久化重构为生命周期持有的 SessionHandle。 |
| 2026-09-10 | `v0.1.5-rc.2` | 0.1.5 收尾打磨：反馈提交改为弹窗确认并在失败时保留已填内容，交付文件卡片排版与代码文件图标优化。 |
| 2026-09-15 | `v0.1.6-alpha.1` | 侧边栏内置终端、MCP v2 与 SSH 远端工作区落地，新增实验性 Browser/Computer Use/Auto review；DeepSeek 默认切 Messages 协议，PTC 更名 ptc-runtime 并独立进程化，sandbox 接口异步化。 |
| 2026-09-17 | `v0.1.6-alpha.2` | 插件管理页落地（安装、配置、实时启停），侧边栏扩展至 Office 预览、浏览器模式、Subagent 会话与提交计划；插件依赖转向运行时解析，创造模式改为安装持久化插件。 |
| 2026-09-22 | `v0.1.7-alpha.1` | 0.1.7 首个 alpha：以 Cordis 插件体系为核心的架构大调整——设置与 Agent 预设迁入 Profile 插件配置、DeepSeek 适配器收敛到 Messages API、Session 日志升级 V4，并带来会话归档与后台执行等大量新能力。 |
| 2026-09-22 | `v0.1.7-alpha.2` | 以修复与打磨为主的小步版本：解决后台任务/一次性子代理完成后会话停住的问题并默认放开连续唤醒上限，工具结果保留策略从字节预算改为 token 预算。 |
| 2026-09-23 | `v0.1.7-rc.1` | 0.1.7 首个 RC，汇总自 v0.1.5-rc.3 的全部变更：落地 PTC 更名 ptc-runtime、移除 E2B、Ralph 默认停用、agent/created 生命周期重构、同步历史接口废弃等硬性架构调整，同时新增 Web 终端、MCP SDK v2、Headless 增强、SSH … |
| 2026-09-24 | `v0.1.7-rc.2` | 引入定时任务/提醒管理与快捷键自定义，桌面端首次引导与关窗后台运行落地；默认面收紧——定时任务与时间上下文默认关闭、Inspector 不再内置，并支持不破坏 KV Cache 的动态工具注入。 |
| 2026-09-28 | `v0.2.0-rc.1` | 0.2.0 首个 RC：自动化任务从核心拆为可选插件包，Windows 沙箱新增权限诊断与可恢复修复技能，工具调度失败后确立先核实副作用再重试的策略。 |
| 2026-09-29 | `v0.2.0-rc.2` | 桌面端捆绑 dsh 命令并支持菜单栏一键安装（免 Node/pnpm），自动化提醒语义改为可信的用户定时消息，实验性引入异步问答模式。 |
| 2026-10-03 | `v0.2.1-alpha.1` | 0.2.1 系列开场：新增实验性 Claude Code Mods 兼容层与开发者工具组合包，自动化任务收编为 Web 内置能力，并移除运行时 invariant 诊断入口等多项破坏性清理。 |
| 2026-10-09 | `v0.2.1-alpha.2` | 插件与运行时边界大扩容：思考翻译、Git Worktrees、SSH 独立 helper、Session 状态记录接口与 Claude Code/Codex 组合包按需安装落地，同时重构子代理通知、Agent Team 投递与工具展示模式等底层语义。 |
| 2026-10-14 | `v0.2.1-alpha.3` | 转向凭据与兼容性治理：API Key 读取优先级按端分化，SDK 支持 resume，Azure 提供方更名为 azure，并修复会话续接、插件热重载等多个关键问题。 |
| 2026-10-15 | `v0.2.1-alpha.4` | 插件生态治理升级：版本兼容性优先按 engines.dsh 判定，开放自定义插件索引源，自定义模型可在 UI 配置推理等级。 |
| 2026-10-16 | `v0.2.1-alpha.5` | 小型修复版：会话内技能列表随插件启停即时更新，统一各运行形态的模型身份提示，并新增模型标签扩展位。 |
| 2026-10-17 | `v0.2.1-rc.1` | 0.2.1 系列首个候选版本：正文汇总自 v0.2.0-rc.2 以来的全部主要变更；相对 alpha 系列新增插件依赖同步、批量 UI 扩展位、按调用方身份的网关授权与计划审阅轮次语义调整。 |
| 2026-10-17 | `v0.2.1-rc.2` | 适配 DeepSeek-V4.1-Flash-1017 上线，并为网页搜索工具接入 DeepSeek 官方 Search 与 Fetch API。 |
| 2026-10-23 | `v0.2.1-rc.3` | Web GUI 新增插件浏览/创建的「更多」菜单入口，修复会话切换后的草稿丢失，并统一 API Key 模式与账号登录的模型列表更新行为。 |
| 2026-10-28 | `v0.2.1-rc.4` | 修复 ACP 模式下诊断输出混入 stdout 的协议级问题。 |
| 2026-10-28 | `v0.2.2-alpha.2` | 0.2.2 首个 alpha：工具执行管线拆分为按 Agent 作用域的原生/PTC 插件并支持按步骤条件启用，PTC 控制通道升级 birpc/SSH v3 并新增 VM Script 模式，同时引入工作树会话、subagent_oar 等大量实验特性。 |
| 2026-10-30 | `v0.2.1-rc.5` | 优化对话中思考内容的展示效果。 |
| 2026-11-03 | `v0.2.2-alpha.3` | 0.2.2 主线推进：统一变更请求与工作树入口、自动化任务升为宿主级管理、新增 apply_patch 工具、SDK 补齐能力，同时默认关闭文件修改的先读与外部修改防护。 |
| 2026-11-04 | `v0.2.2-rc.1` | 0.2.2 首个候选版本：汇总 rc.5 以来的主要变更并定稿架构——Cordis 升至 4.1.0、Session Projection 注册 API 确立为异步，工具管线/PTC 重构与 apply_patch、工作树会话、宿主级自动化任务等能力一并落地。 |

### B. Hermes 48 个版本

| 日期 | 版本 | 一句话 |
|---|---|---|
| 2026-03-12 | `v2026.3.12` | 从内部项目跃升为全功能 Agent 平台的首次打标版本：216 个合并 PR、63 位贡献者，一举建成多平台消息网关、原生 MCP 客户端、Skills 生态与集中式 provider 路由。 |
| 2026-03-17 | `v2026.3.17` | 流式、插件与 provider 版本：统一 token 级流式输出、一等插件架构、原生 Anthropic 与重建的 provider 系统，外加语音模式、智能审批与持久 shell。 |
| 2026-03-24 | `v2026.3.23` | 平台扩张版本：新增 OpenAI 兼容 API 服务器、6 个新消息适配器、MCP 服务器管理（OAuth 2.1）、@ 上下文引用与网关提示缓存，并伴随 200+ 项修复。 |
| 2026-03-28 | `v2026.3.28` | 加固版本：Hugging Face 成为一等 provider，/model 体系重构并让位 hermes model 子命令，插件生命周期 hooks 补全，原生 Modal SDK 替换，GPT 工具调用强制，加上供应链大清洗与 50+ 安全可靠性修复。 |
| 2026-03-30 | `v2026.3.30` | Profiles 多实例隔离成为核心架构，Hermes 首次反向作为 MCP server 暴露会话，并新增飞书/企业微信渠道与 provider 故障转移链。 |
| 2026-04-03 | `v2026.4.3` | Memory 从内置组件重构为可插拔 provider 插件架构，配合同 provider 凭据池轮换与 gateway 竞态、审批链路的全面加固。 |
| 2026-04-08 | `v2026.4.8` | 后台任务完成自动通知、全平台会话中实时切换模型，并把 agent/cron 超时语义从 wall-clock 重定义为基于实际活动跟踪。 |
| 2026-04-13 | `v2026.4.13` | 『everywhere』版：接入 iMessage 与微信使消息平台达 16 个，上线全新本地 Web Dashboard 与 Fast Mode，并完成迄今最深的一轮跨 16 平台安全加固。 |
| 2026-04-16 | `v2026.4.16` | Tool Gateway 版：Nous Portal 付费订阅即可直用 web 搜索、图像生成、TTS 与浏览器自动化四大工具，零额外 API key。 |
| 2026-04-23 | `v2026.4.23` | Interface 版：交互 CLI 全面重写为 React/Ink TUI，推理接入抽出可插拔 Transport 层（含原生 AWS Bedrock），插件面大扩并新增 QQBot 第 17 平台。 |
| 2026-04-30 | `v2026.4.30` | Curator 版：自主后台 Curator 代理接管技能库的评分、合并与清理，Hermes 开始自我维护；同版网关转型为插件宿主、新增 5 个推理提供方与 2 个消息平台，TUI 可见冷启动减约 57%，秘密脱敏默认改为关闭。 |
| 2026-05-07 | `v2026.5.7` | Tenacity 版：上一版回退的看板以持久多代理协作板（心跳/回收/僵尸检测/幻觉门控）重新落地，配合 /goal 跨轮目标、Checkpoints v2 与重启自动恢复会话保证『把事做完』；安全波关闭 8 个 P0 并把脱敏默认重新开启，Google Chat 成为第 20 个平台，推理提供方插… |
| 2026-05-16 | `v2026.5.16` | 『Foundation Release』：Hermes 登陆 PyPI 并以懒加载浪潮完成安装瘦身，SuperGrok OAuth 与 OpenAI 兼容本地代理上线，Teams/LINE/SimpleX 使消息平台达 22 个。 |
| 2026-05-28 | `v2026.5.28` | 『Velocity Release』：16k 行 run_agent.py 重构为 14 个内聚模块，Kanban 成长为真多 agent 平台，session_search 确定性化且免费，Promptware 防御与 Bitwarden 密管落地。 |
| 2026-05-29 | `v2026.5.29` | v0.15.0 当日热修：修复 loopback 模式下 dashboard 401 无限重载死循环，并把 Docker --insecure 从绑定主机推断改为显式环境变量 opt-in。 |
| 2026-05-29 | `v2026.5.29.2` | 打包热修：wheel 与 sdist 补齐 bundled 插件缺失的 plugin.yaml 清单。 |
| 2026-06-06 | `v2026.6.5` | 「Surface Release」：一周内造出全新原生桌面应用 Hermes Desktop（可直连远程 gateway），web dashboard 升格为全功能管理面板，默认技能集大幅瘦身。 |
| 2026-06-19 | `v2026.6.19` | 「Reach Release」：触达面扩展——新增 iMessage（Photon）、官方 WhatsApp、Raft、SimpleX 渠道，subagent 支持后台运行，memory 工具获得原子批量操作，fleet/relay 能力起步。 |
| 2026-07-01 | `v2026.7.1` | 「Judgment Release」：十二天清零全仓 P0/P1，Mixture-of-Agents 升格为一等可选模型，agent 以证据验证自身完成度，gateway 支持 scale-to-zero 与排水协调。 |
| 2026-07-08 | `v2026.7.7` | 基础设施驱动的滚动补丁 tag：把 v0.18.0 之后约 667 个提交（修复、加固与进行中特性）打包成稳定 tag 供下游 Docker/PyPI 消费，完整 curated 说明整体推迟到 v0.19.0。 |
| 2026-07-08 | `v2026.7.7.2` | 当日热修补丁：WhatsApp 桥接的 Baileys 依赖从钉死的 git commit 改为已发布的 npm 版本，恢复安装与 tagged Docker 构建的可靠性。 |
| 2026-07-20 | `v2026.7.20` | Quicksilver 大版本：以速度为主线（全平台首 token 时间约 -80%、桌面 20+ 性能 PR、推理流默认可见），同时落地 smart approvals 默认化、单 gateway 多 profile 路由、可插拔 SecretSource 与 durable 投递/委派账本。 |
| 2026-07-30 | `v2026.7.30` | 基础设施补丁 tag：汇总 v0.19.0 后约 1000+ PR，以 gateway/语音/桌面/安装器的修复与 salvage 波为主，同时预落地 Buzz(Nostr) channel 与 FLUX3 视频生成；curated 说明推迟到 v0.20.0。 |
| 2026-08-03 | `v2026.8.3` | Herald 大版本：实时对话语音（流式 TTS/barge-in/设备端唤醒词）跨 CLI/桌面/gateway 全面落地；A2A v1.0、签名出站 webhook 与 grounded-citations 研究能力构成新主干，桌面借 artifacts+插件 SDK 升级为平台。 |
| 2026-08-13 | `v2026.8.13` | 纯稳定标签：把 v0.20.0 以来约 656 个 PR（1,444 次提交）的广域稳定化与修复打成一个补丁版供下游消费，组件级细节统一推迟到 v0.21.0 发布。 |
| 2026-08-16 | `v2026.8.16` | 补丁汇总：桌面端多 gateway Connections 注册表与 MCP 健康检查/深链，gateway 持久化模型路由与 Telegram DM topics，LiteLLM Claude prompt caching 与 cron、认证解析加固。 |
| 2026-08-17 | `v2026.8.16.2` | 补丁汇总：MCP 迁移 2.x SDK 并支持无状态协议，Bot Mode（hermes-bots）插件捆绑发行，cron 调度器自愈与会话交接数据丢失修复成批落地。 |
| 2026-08-18 | `v2026.8.18` | 补丁汇总：桌面 SESSIONS\|BOTS 标签侧栏与 Bot Mode 群聊修复，skill 安装引入许可证+安全咨询扫描，cron 媒体发送与 SessionDB 并发修复。 |
| 2026-08-21 | `v2026.8.19` | 补丁汇总：Bot Mode 群房间线程化，零 key Web 层让新装即可搜索，CLI 命令面板与模糊选模型，cron 首次获得持久 memory 与按任务 reasoning effort。 |
| 2026-08-27 | `v2026.8.27` | 补丁汇总：同意门控的真实浏览器 profile 浏览、桌面浏览器独立 OS 窗口与 SSH 远程更新引擎、MCP 目录扩容 50+ 服务器、lean-tail 压缩默认化与 OS keychain 密钥加密。 |
| 2026-08-31 | `v2026.8.31` | Pantheon 大版本：Bot Mode 内置桌面成为有名字、有面孔、可群聊互发的「agent 社会」（新增 hermes peer 跨机 DM），cron 获得记忆与连续性，subagent 可飞行中纠偏，MCP 合并为指挥中心，并完整收编 v0.20.1–v0.20.6 的全部变更。 |
| 2026-09-07 | `v2026.9.7` | 补丁滚动版本：将 v0.21.0 以来主线约 632 个 PR（代码库模块化、文件操作与启动性能、MCP 授权、cron 与委派修复）打成稳定 tag，完整发布说明推迟到 v0.22.0。 |
| 2026-09-11 | `v2026.9.11` | state.db 可靠性战役版本：六个 PR 从根因上修掉 v0.21.0 连接重写引入的第二写者与误判损坏整类问题（关闭 44 个 issue），并落地密码盲化凭证库、SHA 固定插件目录与 Nous 免费层。 |
| 2026-09-14 | `v2026.9.14` | 为让远程网关登录修复尽快到达自动更新的 Cloud agent 而切出的补丁：合并并发刷新防止轮换 refresh token 被 Portal 重用检测吊销整个会话，并消除长驻进程的 state.db 写句柄泄漏。 |
| 2026-09-21 | `v2026.9.21` | 大型滚动补丁：主机级 gateway 单例锁与 Desktop 附着既有后端是本窗口最重要的架构变化，另含统一 connector 安装、CLI stream-json 输出、skills.auto_load 等，细节推迟到 v0.22.0。 |
| 2026-09-24 | `v2026.9.24` | Desktop 插件 SDK 扩展波版本：Connectors 页取代 MCP 标签页、插件工具与技能即时进入所有打开的聊天，另有 Simple/Advanced 界面模式与按 profile 的网关启停控制。 |
| 2026-10-08 | `v0.21.6` | 首个由新稳定发布流水线切出的版本：窗口内带来实时语音转写、语音独立辅助模型、按 profile 的插件隔离宿主与 llama.cpp CUDA 本地推理，并修复 Tenable 报告的 dashboard 认证、不可信仓库 git filter 与邮件网关安全问题。 |
| 2026-10-12 | `v0.21.7` | 更新通道版本化：源码安装默认跟随最新已发布 vX.Y.Z tag 而非 main 逐 commit（Desktop 提供通道开关），同时修复 resume 后 reasoning 丢失与区域防火墙下的更新失败。 |
| 2026-10-14 | `v0.22.1` | 名义上的补丁版（Windows Store/插件目录），实为一次大规模架构收拢：普通网关内启动经过认证的共享会话权威（canonical session authority），CLI/TUI/Desktop/API/Bot/cron/Kanban 等全部表面的会话写入统一改为持久准入+回执落盘，并新… |
| 2026-10-14 | `v0.22.0` | 『门槛』大版本：新装桌面在免费试用模型上直接进入引导式设置对话，配合免账户 Connectors 托管应用接入、一键本地 llama.cpp 模型、稳定 SemVer 发布渠道与签名桌面包，把新用户零 key 带进 Hermes，并汇总 v0.21.1–v0.21.7 补丁。 |
| 2026-10-15 | `v0.22.2` | 重发被错误构建的 0.22.1：gateway 改以 boot epoch + host lock 判定存活、重启后可再次拉起，本地模型长轮次在笔记本上不再中断。 |
| 2026-10-21 | `v0.22.3` | 汇总 v0.22.2 以来约 620 个 PR 的滚动补丁：MCP 进度流、插件 OAuth、CLI 布局刷新、会话自动清理退回 opt-in 等大量组件变更进入稳定线（完整 curated 说明推迟至 v0.23.0）。 |
| 2026-10-21 | `v0.22.4` | 小补丁：移除 Desktop 输入框上方无端出现的建议 pills，并修复插件空依赖确认、WhatsApp 登出后重配对、审批模式 chip 跟随 profile 等问题。 |
| 2026-10-23 | `v0.22.5` | 汇总 81 个 PR：Nous 登录重构为统一设备登录，委派后端可插拔化，hermes mcp serve 与 Singularity 沙箱后端移出核心入插件。 |
| 2026-11-02 | `v0.22.6` | 稳定渠道滚动补丁：打包 v0.22.5 以来约 776 个 PR，窗口内最重要的新能力是网关自有监听器直接提供完整 Webapp；完整精选说明推迟至 v0.23.0。 |
| 2026-11-03 | `v0.22.7` | 稳定渠道滚动补丁：打包约 174 个 PR，重心是 Group Chats 的 lead 路由、共享笔记等自管理能力与 Desktop 体验增强；完整说明推迟至 v0.23.0。 |
| 2026-11-05 | `v0.23.0` | 『Hearth』大版本：确立『一个网关独占所有会话』的架构，Desktop 工作区可由自有网关以 Webapp 形式开进浏览器标签页，同时核心瘦身、大量能力外移为插件并汇总完整文档化 v0.22.1–v0.22.7。 |
| 2026-11-10 | `v0.23.1` | 关键修复补丁：插件目录 JSON 超过客户端 2 MiB 上限导致所有安装静默回退内置旧目录，本版将上限提高到 16 MiB 使 live 目录恢复生效；其余约 618 个 PR 的说明推迟至 v0.24.0。 |

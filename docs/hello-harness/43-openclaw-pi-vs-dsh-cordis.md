---
title: "底座与 agent 的两两对比：pi vs cordis，OpenClaw vs DSH vs Hermes"
---
# 底座与 agent 的两两对比：pi vs cordis，OpenClaw vs DSH vs Hermes

> 基线：pi `v1.1.0`、OpenClaw `v2026.10.2`、cordis `4.0.0-rc.10`、DeepSeek Harness（下文简称 DSH）`dsh-v0.1.5-rc.2`、Hermes Agent `v2026.9.24`（包版本 `0.21.5`）。五个项目分为两层：pi 和 cordis 是底座——只提供机制、不含业务；OpenClaw、DSH、Hermes 是建在底座上（或没用底座）的 agent。本文按层做两两对比：底座一对（pi 对 cordis），agent 三对（OpenClaw 对 DSH、OpenClaw 对 Hermes、DSH 对 Hermes），每对只回答一个问题，不做五个项目混在一起的功能盘点。文中事实全部来自对五个项目源码快照的阅读，引用一律写成"项目名 + 仓库内路径"的纯文本，效率相关的数字来自代码结构与代码注释里的自述测量，未做性能实测。

**目录**

- [1. 底座对比：pi vs cordis——底座应该懂什么](#1-底座对比pi-vs-cordis底座应该懂什么)
- [2. agent 对比一：OpenClaw vs DSH——场所与账本](#2-agent-对比一openclaw-vs-dsh场所与账本)
- [3. agent 对比二：OpenClaw vs Hermes——两种增长，两种信任机制](#3-agent-对比二openclaw-vs-hermes两种增长两种信任机制)
- [4. agent 对比三：DSH vs Hermes——要不要底座](#4-agent-对比三dsh-vs-hermes要不要底座)
- [5. 四个答案放在一起](#5-四个答案放在一起)
- [6. 源码出处](#6-源码出处)

---

## 1. 底座对比：pi vs cordis——底座应该懂什么

两个底座，代码量都不大——pi 的 `pi-agent-core` 约 2.5k 行，cordis 全部实现 4991 行、核心 9 个文件 1874 行、两个运行时依赖——但它们对"底座应该懂什么"给出了恰好相反的回答，这组对比的全部内容都在这个相反上。

**pi 懂 agent，不懂组合。** pi 的核心里全是 agent 领域知识：`StreamFn` 约束模型调用面，`AgentTool` 定义工具执行的五段链路（校验、审批、执行、格式化、结果回填），扩展事件表挂在循环的每个相位上（比如 `prepareNextTurn`，让扩展能在下一轮开始前改写输入）。它为 harness 而生，所以 harness 的契约焊死在核心。但它对"组合"一无所知：单进程一次性生命周期，没有常驻、没有插件装卸、没有配置树。增长方式只有一种——用户在安装期写自己的扩展，而内建扩展允许被同名的第三方实现直接替换，因为内建本来就只是"随包发行的扩展"（pi 的 `CONTRIBUTING.md` 把这条边界写进了制度："PRs that bloat the core will likely be rejected"）。

**cordis 懂组合，不懂 agent。** cordis 核心里没有任何 agent 领域知识——它不知道消息、工具、模型调用为何物。它把全部 1874 行花在组合上：插件（fiber）的 `effect()` 有四种返回形态，epoch 字符串标记每次变更，六态状态机加 `inertia` 锁收口插件的生命周期，让"插件下线"是一个有明确状态迁移的事件，而不是散落各处的清理回调；热更新沿 accepted/declined 决策传播，四阶段 partialReload 只替换受影响的插件，loader 用隔离 realm 装配配置树并打补丁。

这组对比最有说服力的证据，是两个底座各自经受的一次移植，而且两次都成功了：

- pi 的内核被 OpenClaw 原样搬进了常驻网关形态。OpenClaw 的兼容注册表里留着一条 `embedded-pi-agent-sdk-aliases` 记录，注明嵌入式 agent SDK 曾经以 `runEmbeddedPiAgent` / `EmbeddedPi*` 命名（`openclaw: src/plugins/compat/registry-records.ts`）；今天它的嵌入式运行时与 pi 的循环同构，`@earendil-works/pi-tui` 是它仅存的第三方 TUI 依赖。准入门控、failover、压缩恢复、熔断全部加在包装层，内核一行没动。**pi 缺的那一半（组合、常驻）被上层补上了。**
- cordis 被 DSH 以 vendor 形式（收进 `@deepseek-ai` npm 作用域）垫进了 56 万行的 harness。fiber 状态机、realm 隔离、loader 配置树、热更新全部在规模下服役，DSH 还在接缝处加固了三处——fiber 卸载的 effect 清算、插件销毁事件的显式发出、配置的重新解析（`dsh: packages/core/src/fiber.ts` 及其 patch）。**cordis 缺的那一半（领域契约）被上层定义了。**

对 harness 开发者的启发：**底座的可行解法是"只懂一半"——选一个知识域焊死在核心，另一个域彻底为零**。判断一个底座及格不及格，不看它小不小，看两件事：缺的那一半能不能被上层干净地补上（pi 的同名可替换、cordis 的死亡状态机都是对这个问题的回答）；以及被补上的时候，核心要不要返工——上面两次移植，核心都是零返工。

代价也要照实记录：选 pi，你的用户必须是自己写扩展的工程师，而且常驻、多客户端这些能力每家都要重造；选 cordis，你的团队要先学会 epoch、六态状态机、`inertia` 这套规则才有生产力，还要接受它处于 rc 阶段、没有 git tag 的现状。**"只懂一半"不是免费午餐，它把成本转移到了懂另一半的那一方身上。**

## 2. agent 对比一：OpenClaw vs DSH——场所与账本

OpenClaw 和 DSH 是五个项目里工程纪律最重的两个。把它们放在一起比，不是因为它们相似，而是因为它们代表了"承诺如何被强制执行"的两种形态——而分歧来自两个完全不同的用户假设。

**OpenClaw 的核心隐喻是场所，DSH 的核心隐喻是账本。**

OpenClaw 承诺"你的助手，在你的设备上，在你的聊天里"，于是助手是一个场所而不是一件工具——工具被调用时才存在，场所必须一直在。状态所有权因此上收到常驻 Gateway，TUI、控制界面和 20 多个消息通道全部是同一份双 SQLite 数据库的投影客户端。"常在"进一步推出一整套重启算法：关机预算 315 秒（drain 300 秒 + 收尾余量）由 Gateway 和 launcher 从同一个表达式推导各自的超时，保证父进程永远不会在子进程用完自己的时间之前升级到 SIGKILL；启动失败不退出进程，保活等 `openclaw doctor --fix` 来修，因为退出只会喂给 launchd/systemd 一次崩溃重启；crash-loop breaker 记住 24 小时内的异常关机，达到阈值就拒绝自动恢复。它的信任模型同样从部署拓扑推出：入口是不可信的消息平台，所以私聊准入走带外的 pairing 配对码，记忆防投毒不靠内容检测，而是给 SQLite 的记忆行加来源列，把不可信来源结构性挡在长期记忆之外。

DSH 承诺"一切可重建"，于是 `append()` 是 session log 的唯一写入口，"凡是到达模型的东西必须能从日志重建"（"Model-visible means logged"）不是文档告诫，而是 250 行运行时断言，违反直接抛错。它的循环边界也用记账的语言定义：一个 turn 在第一条输入被领取之前开启，在没有任何欠账时关闭（原文 "opens before its first input is claimed and closes once nothing is owed"）。**用"欠账"而不是消息条数定义循环**，于是被拒绝的尝试也能合法落账——它开启并关闭一个零 step 的 turn，进日志、供审计、不花模型配额。

尽管隐喻相反，两者在一批结构选择上高度一致，这批一致比它们的分歧更值得抄：

- **单一写入方。** OpenClaw 把一切写入收进 Gateway 单写方，其余全部是投影；DSH 的 `append()` 是唯一写入口。两家都不靠"到处加锁"解决并发正确性——串行化写入点，读侧全部走投影。
- **失败不许静默。** OpenClaw 用 turn taint 把副作用不明的中断标记出来，恢复时强制走 restart-safe 工具；DSH 的 max-tokens 是 sticky 语义——turn 里任何一个 step 撞了上限，后续正常完成的 step 不能把整个 turn 的结果"洗白"。
- **相关超时从同一表达式推导；运行中的替换必须原子。** 前者就是 OpenClaw 的关机算式。后者见 DSH 的 `AdapterRegistrationHandle`：整组模型路由一次替换，理由写在代码旁——逐个 dispose/register 会出现"部分路由消失"的中间态。

真正的分歧在**执行方式**：OpenClaw 用工具护承诺——`VISION.md` 要求破坏性的配置改动必须在同一个 PR 里带上 doctor 迁移逻辑，激活路径上有专门的边界测试逐条守护；DSH 用断言和门禁护承诺——250 行不变量、100% 覆盖率门禁、快照回放测试，连"我不承诺兼容"都用 `SESSION_FORMAT_VERSION = 0` 写成了机制。**产品用工具护承诺，平台用断言护承诺**——选择依据不是哪个更严格，而是你的用户会不会读你的代码：OpenClaw 的用户装完就走，违规必须被工具拦住而不是被文档劝住；DSH 的用户是内部开发者，断言抛错本身就是最好的文档。

## 3. agent 对比二：OpenClaw vs Hermes——两种增长，两种信任机制

这两个项目的产品形态几乎相同：一个常驻 Gateway 进程，接入 Telegram、Discord、Slack、WhatsApp、Signal 和 CLI，跑在用户自己的设备上，SQLite 存状态。甚至有直接的竞争证据：Hermes 提供从 OpenClaw 的一键迁移，自动导入设置、记忆和技能（落到 `~/.hermes/skills/openclaw-imports/`，`hermes-agent: README.md`）。形态相同、生态位相同的两个系统，分歧集中在两个问题上：**能力从哪里来，以及随之而来的信任问题怎么解。**

**OpenClaw 的增长靠生态。** 能力的单位是人写的插件——174 个内建扩展与第三方插件走同一份契约，ClawHub 负责分发；吸收 Claude/Codex/Cursor 的 bundle manifest 时只取能在自己信任模型内执行的元数据，不执行外来运行时代码。配套的信任机制针对"人写的代码"：typed 插件契约、capability consent 授权门，加上前一节说的记忆来源列——不可信出处被结构性挡在长期记忆之外。整套技术栈都为这套机制服务：Node 运行时、带类型的 WS 协议（wire v4）、双 SQLite forward-only schema（schema 迁移失败时以退出码 78 拒绝启动）。

**Hermes 的增长靠 agent 自己。** 它自称 the self-improving agent：内置一个学习闭环——从自己的使用经验里创建技能（skill）、在使用中改进、被提醒时把知识持久化、跨会话检索自己过去的对话。能力的单位是 agent 在运行时写的 skill 文件，配套的信任机制针对"agent 写的 skill"，形状完全不同：`skill_provenance.py` 用一个 ContextVar 记录写入来源——后台评审进程写的是 `background_review` 哨兵值，用户点名要的是 `foreground`，治理器（curator）只治理自产技能，用户要的技能归用户；外围还有 skill ledger、linter、guard 和 AST 审计一整条质检线（`hermes-agent: tools/skill_provenance.py`、`tools/skill_manager_tool.py` 及同目录）。整套技术栈同样为它的机制服务：Python 标准库加 aiohttp、扁平的 OpenAI 格式消息列表直接 JSON 存储、`prompt_builder` 是无类的模块函数分层组装 system prompt、`MemoryManager` 负责预取和同步两个记忆 provider、MEMORY.md 和 USER.md 两个 markdown 记忆文件带字符上限和写入门控、SessionDB 用 SQLite 加 FTS5 索引做跨会话全文检索。

这组对比的启发，藏在两套信任机制的**形状差**里：

- **能力来源决定信任机制的形状。** 人写的代码是不可信的**输入**——OpenClaw 用构造手段（来源列、授权门、拓扑边界）把不可信出处挡在系统外，不和攻击者比检测能力；agent 自产的 skill 是不可信的**输出**——Hermes 用质检手段（写入来源区分、linter、AST 审计）把自家产出筛一遍再用。同一句"我怎么相信进入系统的能力"，因为能力来源不同，答案一个是**门**，一个是**流水线**。
- **两种机制不能互相套用。** 门的逻辑套在自产技能上会杀死学习回路——agent 不该为自己产出的技能再过一遍人工授权；流水线的逻辑套在外来代码上是不设防——没有人为你 lint 一个恶意插件。如果哪天你的 harness 既吃生态插件又吃自产技能，两个机制都要有，而且各管各的。
- **记忆的格式差是次生差异。** OpenClaw 把记忆结构化进 SQLite 列（来源可以查列），Hermes 把记忆留在 markdown 文件里（人可读、agent 可改）。前者换来可执法的出处记录，后者换来迁移可携带——这正是 Hermes 能一键吃下 OpenClaw 记忆的原因，markdown 没有围墙。**记忆格式的选择不是存储问题，是"你打算让谁来改记忆"的问题。**

## 4. agent 对比三：DSH vs Hermes——要不要底座

DSH 和 Hermes 都把 agent 当"系统"而不是"脚本"来建，但一个站在底座上，一个踩在地上。这组对比回答的问题是 harness 开发者迟早要面对的：**什么时候值得引入一个组合框架，什么时候手写更划算。**

**DSH 的答案是组合式。** 每个能力是一个接缝（seam），由三个角色构成：Definition 定义能力契约，Provider 提供实现，Consumer 消费——换 Provider 即换产品行为。整个系统垫在 vendor 进来的 cordis 上，221 个包、56 万行靠 100% 覆盖率门禁和快照回放测试维持不失控。组合的成本很清楚：每个能力要先学三角色分工、先定义契约；换来的是"第 N 个能力"的边际成本远低于第 1 个，以及一条进阶路——DSH 对 cordis 的三处加固说明底座不合适时**上层可以改，而不是绕**。

**Hermes 的答案是手写式。** Python 标准库而非框架、扁平消息列表而非事件投影、模块函数而非类体系、几乎只有一个正式插件点——`ContextEngine` 这个抽象基类（`should_compress` / `compress` / `update_from_response` 三个方法，从 `plugins/context_engine/<名字>/` 目录动态加载）。循环就是 `run_conversation()` 一个函数：一个用户 turn 等于模型调用、工具分发、重试、压缩、收尾钩子（`hermes-agent: agent/conversation_loop.py`）。手写的成本同样清楚：换记忆策略要动 `MemoryManager` 本体；换来的是任何一个环节都能在一个文件里读完，以及抽象只在被证明需要的地方生长——`ContextEngine` 基类和写入来源 ContextVar 都是"手写系统长出的接口"，它们出现的位置就是系统真正需要接缝的位置。

两边的执行风格也随形态分化，而且都自洽：DSH 的强断言（250 行"模型可见即可重建"的运行时断言）赌的是底座加门禁能挡住组织规模下的漂移；Hermes 的 flat-and-simple（消息直接 JSON 存储、FTS5 直接查）赌的是结构足够简单时不需要那么多执法。两个赌注到今天都没输——这说明"要不要底座"没有普适答案，只有规模函数。

判断题不在"用不用底座"，在这里：**你的第 N 个能力会不会比第 1 个便宜？** 如果你的路线图上能力是垂直叠加的——每家模型一个 Adapter、每个能力一个 Provider，DSH 的形状——组合的成本一次付清、终身受益，上底座；如果能力是水平演化的——同一个循环被反复重写，Hermes 的形状——底座的每一行都是将来要拆的墙，手写加在痛点处长接口更诚实。Hermes 还补了一条常被忽略的注脚：手写路线不是终点站——它的 self-improvement 把"新增能力"这件事本身从开发期搬到了运行期，等于用 agent 的产出绕开了底座要解决的组织问题（见下一节）。

## 5. 四个答案放在一起

四组对比连起来，五个项目排出一条轴——**增长机制**，也就是"新能力由谁、在什么时候写"：

| 项目 | 层 | 新能力由谁写 | 何时写 | 配套信任机制 |
| :--- | :--- | :--- | :--- | :--- |
| pi | 底座 | 用户（工程师） | 安装期，写扩展 | 内建同名可替换、核心拒绝膨胀 |
| cordis | 底座 | 集成方（插件） | 开发期，loader 装配 | epoch 状态机、可拆卸的生命周期 |
| DSH | agent | 组织内部团队 | 开发期，seam 注册 | 契约 + 100% 门禁 + 运行时断言 |
| OpenClaw | agent | 生态第三方 | 安装期，插件分发 | typed 契约 + 授权门 + 来源列 |
| Hermes | agent | **agent 自己** | **运行时**，self-improvement | 写入来源标记 + 质检流水线 |

这条轴上没有哪个位置"更先进"——pi 的用户写扩展、OpenClaw 的生态供给、DSH 的组织分工，都是软件世界的老答案；Hermes 把生产者换成模型，是新答案，但它的质检机制（linter、guard、AST 审计、来源标记）全是从老答案的供应链治理里借来的零件。**变化的是生产者，不变的是"谁写的"必须可判定。**

四条可以带走的东西：

1. **底座只懂一半，用移植验收。** pi 与 cordis 各懂一半且都被成功移植——判断你的底座，看你缺的那一半被上层补的时候，核心要不要返工。
2. **先选隐喻，再选结构。** 场所（OpenClaw）与账本（DSH）推导出的执行方式完全不同——产品用迁移工具护承诺，平台用断言门禁护承诺；选错隐喻，结构会一直跟你对着干。
3. **信任机制的形状跟着能力来源走。** 人写的代码用门（构造性排除），agent 写的 skill 用流水线（质检放行），同一个"谁写的"问题在不同来源下长成不同器官，不要指望一个机制通吃。
4. **要不要底座，是第 N 个能力的成本问题。** 垂直叠加的能力面上底座终身受益，水平演化的循环上手写更诚实；而 agent 自产能力（Hermes 路线）是绕开这道选择题的第三种可能——它把增长机制本身变成了产品功能。

## 6. 源码出处

以下均为各仓库内路径，随基线版本列出，供核对文中事实：

- pi（`v1.1.0`）：`CONTRIBUTING.md`（"PRs that bloat the core will likely be rejected"）、`packages/pi-agent-core/`（StreamFn、AgentTool 五段链、扩展事件表）
- OpenClaw（`v2026.10.2`）：`src/plugins/compat/registry-records.ts`（`embedded-pi-agent-sdk-aliases`——pi 内核移植的直接证据）、`VISION.md`（破坏性改动同 PR 配 doctor 迁移）、Gateway 关机算式与 crash-loop breaker 见 `src/gateway/` 与 launcher 模块
- cordis（`4.0.0-rc.10`）：`packages/core/src/fiber.ts`（epoch、六态状态机、`inertia` 锁）、loader 与 HMR 见 `packages/core/src/loader/`
- DSH（`dsh-v0.1.5-rc.2`）：`docs/architecture.md`（turn/step 的"欠账"定义与 "Model-visible means logged" 原话）、`packages/core/src/fiber.ts` 的三处加固、LlmAdapter 与 `AdapterRegistrationHandle` 见 adapter 模块
- Hermes Agent（`v2026.9.24`）：`README.md`（self-improvement 定位与 OpenClaw 一键迁移）、`tools/skill_provenance.py`（写入来源 ContextVar）、`tools/skill_manager_tool.py` 及同目录（skill 质检线）、`agent/conversation_loop.py`（`run_conversation()`）、`agent/memory_manager.py` 与 `tools/memory_tool_store.py`（MEMORY.md / USER.md、字符上限与写入门控）

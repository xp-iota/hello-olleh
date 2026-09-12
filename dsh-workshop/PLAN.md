# DSH 教学视频工程 — 实施规划 v2（航天工程级）

> 状态：**草案，待 GO/NO-GO 评审**（见 §10）
> 版本：v2（2026-09-12）。v1 存档于 `PLAN.v1.md`。
> v2 变更依据：用户两点修正 —— ①示例去碎片化，同方向能力极致整合；②iota-example 高度对齐 dsh-example，iota-core 缺能力则先补。
> 编制依据：本机源码与工具链实测，全部断言带证据。未实测事项显式标注「未验证」。

---

## 0. v2 相对 v1 的三处结构性修改

| # | v1 | v2 | 原因 |
|---|---|---|---|
| 1 | dsh-example 26 → 38 个示例目录 | **26 → 12 个能力模块** | 用户修正①。38 个目录会把碎片化问题放大一倍；正确做法是按**方向**整合，目录层去碎片、文件层保粒度（§3） |
| 2 | iota-example 20 个示例，自成一套编号 | **与 dsh 同一套 M01–M12 编号**，逐模块三分类对齐 | 用户修正② |
| 3 | 无 iota-core 改动 | 新增 **Segment B′：iota-core 能力补全**，独立分支、独立门禁 | 用户修正②。但只补「类 B」，见 §4 的判据 |

### 0.1 一处必须先讲清的技术前提

用户要求「iota-core 会支持就先完善 iota-core」。取证后结论是：**12 个模块里只有一部分能靠补 iota-core 对齐，另一部分补了就是把 iota 改造成 harness，而这件事 iota 自己的文档已经否决过。**

证据链：

1. **iota 的定位是内核编排层，不是 harness。**
   `docs/architecture/overview.md` 开篇：「在业务应用和不同 Agent 内核之间提供一个统一 runtime，负责 Agent 生命周期、会话历史、运行事件、长期记忆边界、工具/MCP/Skill 注册」。
2. **执行栈不归 iota。**
   `docs/architecture/node-hooks.md` 的原话：「模型调用发生在内核内部（同进程 Hermes 的线程里，或 ACP 子进程里），iota-core 无法替内核承诺什么」。同表标注：模型 Hook 与 Middleware **「ACP 编译期拒绝」**。
3. **钩子面总共 6 个点**（`graph/types.py:62-72`）：
   `NODE_HOOK_POINTS = {pre_api_request, post_api_request, after_node_result, on_node_error}`、
   `NODE_MIDDLEWARE_POINTS = {llm_request, llm_execution}`。其中只有后两个节点 Hook 是「已实现并生效，对所有 executor、所有内核有效」。
4. **实测零命中**：`plan_mode` / `preset` / `webhook` / `sandbox` / `attachment` 各命中 0 个文件；
   `steer` / `followup` / `inbox` / `def inject` 全库 0 处；无事件总线（无 `def emit` / `def on`）；无压缩缝；无 fs / shell 缝。
5. **iota 已否决过自建 harness**：`kernel-replacement.md` §六「在 cordis 上自建 harness —— 等于重写 DSH，产出仍是 TypeScript」；
   `pluggability-cordis-alignment.md` 原则一「借机制，不搬架构」。

因此 v2 采用**三分类判据**（§4.2），并且把「类 C 不对齐」本身变成教学内容 —— 它回答的是学员真正会问的问题：*harness 和 orchestrator 的缝该开在哪一层*。这比强行做出一个形状相同但语义虚假的对齐示例有价值得多。

---

## 1. 任务定义

| 项 | 内容 |
|---|---|
| 目标 | 产出 dsh 教学视频，内容由两个**能真跑**的示例工程支撑 |
| 交付物 1 | `dsh-example/`：升级到 0.1.5-rc.2 源码线 + **26 → 12 模块整合** |
| 交付物 2 | `iota-example/`：与 dsh 同构的 M01–M12 + 三分类对照表 |
| 交付物 2′ | `iota-core` 的类 B 能力补全（**独立分支、独立 MR，需授权**） |
| 交付物 3 | `dsh-workshop/`：讲稿 + PPTX + MP4 |
| 成功判据 | 各段门禁全绿（§6），且交付物 3 每一句论断都能在 1/2 里跑出来 |

**贯穿性原则**（沿用 dsh-example 既有工程风格，不新造）

1. **无模拟层** —— 依赖真实发布包，不写缩样、不打解析钩子。
2. **fail-loud** —— 解析失败抛错并列出已注册项，禁止静默降级。
3. **目录层一个方向，文件层一种能力**（v2 修订自「一个目录一种能力」）。
4. **闸门即证据** —— typecheck 编译到真实 `.d.ts`；test 跑真实 turn 核对不变量。
5. **每阶段独立可验收、独立可回滚。**

---

## 2. 现状勘察摘要（完整版见 `PLAN.v1.md` §1）

| 对象 | 关键事实 | 影响 |
|---|---|---|
| 工具链 | node v26.4.0 / npm 11.17.0 / pnpm / uv 0.12.3 / python3.14.6(homebrew) / ffmpeg+ffprobe 8.1.2 | 齐备 |
| 网络 | npmjs 200；nexus.logan.xiaopeng.local:8081 → 200，44ms | 两侧依赖均可取 |
| dsh 源码 | 0.1.5-rc.2；267 个 package.json / 49 分组；**71 个 `ctx.*` 服务**；**53 篇 `docs/subsystems/*.md`** | 每个模块都有文档锚点 |
| dsh-example | 钉在 0.1.1-rc.2；基线 typecheck 干净 + **7/7 测试通过**；26 目录 / 62 个 `.ts` / 6796 行 | 有干净回归基准 |
| 版本漂移 | `0.1.1-rc.2..HEAD` = **3225 commit / 4870 文件**；subagent +2509/−1827、llm +1038/−176、agent-loop +973/−183、session +695/−866 | A2 主要工作量 |
| npm 陷阱 | dist-tags 实测 `latest = 0.0.1-rc.1`（比现用更老），`next = 0.1.5-rc.2` | 禁用 `@latest` |
| iota-core | v2026.9.8；分支 `feature/640-phase-ii`，工作区干净；remote = 内部 GitLab `cabin-brain/iota-core`；101 个 `test_*.py` | 改它属高风险，见 R-11 |
| iota 可插拔面 | EffectStack / registry disposer / providers 注册表 / capabilities provides-requires / entry-points 均已落地（P0–P3） | M12 可强对齐 |
| iota 缺口 | 无工具管线、无压缩缝、无事件总线、无 steer/inbox、无 fs/shell/sandbox/attachment/webhook/planMode/preset | 见 §4 分类 |
| lusine | doctor 全绿；Remotion 4.0.515 + compositor-darwin-arm64；今日已产出 6.6M MP4 + 278K PPTX | 渲染链路已验证 |
| lusine 缺件 | **`edge-tts` 未安装**；windows-sapi 在 macOS 不可用；qwen3 需外部 runtime | R-03，阻断旁白 |
| 仓库卫生 | `hello-olleh` 工作区脏；SVG 全为 Git LFS 指针（130 B） | A0 前置 |

---

## 3. dsh-example 整合设计（对应修正①）

### 3.1 整合判据

碎片化的根因不是数量，而是**切分维度错了**：现有 26 个目录按「单个 API 调用」切，导致同一条管线被切成 5 段（01 注册 / 11 收紧 / 12 守卫 / 03 前置门 / 07 结果转换），学员必须自己在 5 个目录之间拼出「一次工具调用发生了什么」。

v2 按**能力方向**切，一个模块 = 一条完整叙事链，且每条链在 dsh 官方文档里都有对应锚点（`docs/subsystems/*.md` 53 篇 + `docs/tool-execution-pipeline.md` + `docs/agent-lifecycle.md`）。

### 3.2 模块清单：26 → 12

| 模块 | 名称 | 合并的旧示例 | 新纳入的缝 | 文档锚点 |
|---|---|---|---|---|
| **M01** | 工具管线 | 01, 03, 07, 11, 12 (5) | — | `tool-execution-pipeline.md`、`subsystems/tools.md` |
| **M02** | 上下文装配与经济学 | 02, 10, 14 (3) | `toolResultPruner`、`tokenMeter`、`spillStore` | `subsystems/system-prompt.md`、`compaction.md`、`token-meter.md`、`spill.md` |
| **M03** | 推理服务接入 | 05, 20 (2) | — | `subsystems/llm-streaming.md`、`deepseek-llm-api-wire-extensions.md` |
| **M04** | Agent 循环与干预面 | 06, 09, 19 (3) | `sessionTelemetry`、`invariants` | `agent-lifecycle.md`、`subsystems/session-telemetry.md`、`invariants.md` |
| **M05** | 会话面 | 18 (1) | `sessionPersistence`、`sessionQuery`、`sessionProjections`、`sessionProjectionCache`、`sessionTitle` | `subsystems/session.md`、`persistence.md`、`session-query.md`、`session-projection.md`、`session-title.md`、`session-format-status.md` |
| **M06** | 人在环路 | 04, 13 (2) | `userQuestions`、`planMode`、`todo`、`messageFeedback` | `subsystems/commands.md`、`approval.md`、`user-questions.md`、`plan.md`、`todo.md`、`feedback.md` |
| **M07** | 执行侧后端 | 16, 24, 25 (3) | `terminals`、`sandboxPolicy` | `subsystems/filesystem.md`、`subprocess.md`、`shell.md`、`terminal.md`、`sandbox.md` |
| **M08** | 委派与预设 | 15 (1) | `agentPresets`、`permissionPresets`、`subagentModelSelection` | `subsystems/subagent.md`、`permission-presets.md` |
| **M09** | 长任务与编排 | 21, 22 (2) | `workflowEngine`、`schedule` | `subsystems/goal.md`、`jobs.md`、`workflow.md`、`schedule.md` |
| **M10** | 外部能力接入 | 08 (1) | `mcp`、`webhookRuntime`、`extensions` | `subsystems/skills.md`、`webhook.md`、`extensions.md` |
| **M11** | 配置与数据设施 | 23 (1) | `storage`、`storageDomain`、`attachments`、`fileUploads`、`fileReferences`、`credentials`、`authorization`、`workspaceRegistry` | `subsystems/settings.md`、`storage.md`、`attachment.md`、`credentials.md`、`workspace.md`、`config-catalog.md` |
| **M12** | 框架机制本体 | 17, 26 (2) | fiber 状态机、isolate realm、intercept 配置链 | `cordis-primer.md`、`cordis-tutorial/01-07`、`hello-cordis/03-06` |

服务覆盖：**~25 → ~55**（共 71 个）。目录数 **26 → 12**。

### 3.3 模块内部结构（去碎片但不丢粒度）

```
M01-tool-pipeline/
  README.md            该方向的完整叙事 + 阶段表 + 观察点
  index.ts             模块聚合入口：按序 ctx.plugin(...) 装配下列各阶段
  steps/
    01-register.ts       ctx.tools.register(defineTool(...))
    02-restrict.ts       agent.ctx.tools.restrict({ allow, deny })
    03-guard.ts          ctx.tools.guard(fn)  单调拒绝
    04-pre-execute.ts    ctx.on('tools/pre-execute')  允许/拒绝 + 结构化失败
    05-post-execute.ts   tools/post-execute · tools/result 转换与审计
  run.ts               按阶段顺序跑，每阶段打印 banner + 观察点
  run-real.ts          可选：真实 provider 版（由模型自己决定调用）
```

**关键约束**：`steps/*.ts` 每个文件仍然只讲一种能力、仍然是标准 cordis 插件形状（`name` / `inject` / `Config` / `apply`），可以单独拷进自己的项目。碎片化在**目录层**消除，粒度在**文件层**保留。`run.ts` 的分阶段输出本身就是教学序列 —— 这是整合带来的净增益：学员第一次能在一次运行里看到完整管线。

**不得违反**：仍然只有一个装配枢纽 `runtime/harness.ts`。A4 用 graphify 复核 `createHarness` 是否仍是唯一枢纽（当前度数 32）。

### 3.4 显式不做（写入 README，附理由）

| 不做 | 理由 |
|---|---|
| `client`（51 个包）/ `web` / `desktop` 宿主运行面 | UI 层用录屏演示比代码示例有效 |
| `typert` + `api-gateway` + Host/Remote 三段式 | 它是上面那层 UI 的传输管道，随之一并延后 |
| `e2b` / `code-runtime` | 需外部账号，破坏「离线可跑」 |
| `experimental/agent-team` | 实验期，接口会变 |
| `lsp` | 需真实语言服务器，装配成本压过教学收益 |
| `identity` / `guard` / `feedback`(独立讲) | 内部机制，无独立可观察行为；`feedback` 已并入 M06 |

---

## 4. iota-example 对齐设计（对应修正②）

### 4.1 编号强制同构

iota-example 使用**与 dsh 完全相同的 M01–M12 编号与模块名**。学员可以左右并排看同一个 M0X 目录。差异不体现在编号上，体现在每个模块 README 顶部的**对齐状态徽标**。

### 4.2 三分类判据

| 类 | 判据 | 处置 |
|---|---|---|
| **类 A** 已有能力 | iota-core 已存在等价接缝（形状可不同，语义等价） | 直接写示例，README 标注 `对齐：等价` |
| **类 B** 缺能力且符合 iota 架构方向 | 缺口有**可复现缺陷或重复代码**支撑，且补上后仍属「编排层职责」 | 先在 Segment B′ 补 iota-core，再写示例，标注 `对齐：补齐后等价` |
| **类 C** 缺能力且与 iota 架构冲突 | 补上等于让 iota 接管内核的执行栈 —— 即 iota 自己已否决的「自建 harness」 | **不补**。写「不对齐」示例：跑出 iota 的真实行为，README 讲清缝为什么在另一层，标注 `对齐：结构性差异` |

类 C 的判定必须引用 iota 已有的决策记录（`kernel-replacement.md` / `pluggability-cordis-alignment.md` / `node-hooks.md`），不允许由本工程新造理由。

### 4.3 逐模块对齐矩阵

| 模块 | iota 现状（带证据） | 类 | iota-example 怎么做 |
|---|---|---|---|
| **M01** 工具管线 | 无统一管线。但 `native_kanban.py` 手工叠了三层包装（lifecycle guard / redis mirror / live tool log），`pluggability-cordis-alignment.md` §2.2 记录该机制**真实失效过两次** | **B** | Segment B′ 抽出 `ToolPipeline`（pre/post + 可见性收紧 + 单调守卫），作用域限定为 **iota 自有工具通道**（kanban / memory / skill_actions），内核内部工具明确不接管 |
| **M02** 上下文装配与经济学 | 提示装配由内核负责（iota 只传 `AgentConfig`）；无压缩缝。但 `MemoryContextService` + `MemoryGateway` 是 iota 自己的上下文注入面 | **A + C** | 类 A 部分：记忆注入、作用域隔离、默认不注入 prompt 的策略。类 C 部分：提示装配与压缩为什么在内核里 |
| **M03** 推理服务接入 | **可换单元是整个内核**（`KernelAdapter` 5 个抽象方法），不是 LLM adapter。`llm_request`/`llm_execution` middleware 仅 Hermes Direct 生效，**ACP 编译期拒绝**（`node-hooks.md`） | **C** | 核心对照课：`register_adapter` 换内核 vs `ctx.llm.registerAdapter` 换模型 —— **缝的层级不同**。跑出 ACP 拒绝钩子的真实错误 |
| **M04** Agent 循环与干预面 | 有 `AgentEvent` 流、`telemetry.SpanHook`、`after_node_result`/`on_node_error`（对所有内核生效）。`steer`/`followup`/`inbox`/`inject` **全库 0 处** | **A + B** | 类 A：事件流 + OTel span + 节点结果钩子。类 B：在 Segment B′ 加**受限的运行中注入**（仅 Hermes Direct 支持，ACP 明确 fail-loud 拒绝） |
| **M05** 会话面 | 有 `ConversationStore` / `RunStore` / 四元组 `session_manager`。**无** seq 连续 / 深冻结 / surface 投影这类日志不变量 | **A + B** | 类 B：Segment B′ 给 RunStore 加不变量契约（纯 iota 侧数据契约，不触内核） |
| **M06** 人在环路 | 有 ACP `session/request_permission`（`kernel-replacement.md` §5.1 记录过「未答复会挂死整轮」的真实缺陷）、CLI、goal 命令直通、kanban≈todo。`plan_mode` / `preset` **0 命中** | **A + C** | 类 A：审批请求应答 + 挂死防护 + goal 命令 + kanban。类 C：planMode 是 harness 与人共享工作面的概念，编排层无对应物 |
| **M07** 执行侧后端 | `sandbox` / `def run_shell` / `attachment` **各 0 命中**；无 fs 缝 | **C** | 第二堂对照课：**harness 拥有执行侧，orchestrator 不拥有**。示例跑出「同一个 shell 请求在 dsh 落到 `ctx.shell`、在 iota 落到内核进程内」的路径差异 |
| **M08** 委派与预设 | `graph/` 多节点 + `delegate_task` 就是 iota 的委派机制（19 个文件，含 compiler / scheduler / dependency） | **A** | 形状不同、目的等价：`SubagentProvider` ↔ GraphSpec 节点委派。直接对照 |
| **M09** 长任务与编排 | **iota 更强**：`goals/` + graph `scheduler` / `task_queue` / `checkpoint` / `recovery` + kanban dispatcher | **A（反向）** | 反向对照：iota 有 checkpoint/recovery，dsh 的 jobs 没有。这是 iota 值得讲的地方 |
| **M10** 外部能力接入 | 有 `skills/` + `skill_sync` + `skill_square_loader` + `mcp/server.py` + Hermes plugins 同步。`webhook` **0 命中** | **A + B(可选)** | 类 A：Skill 数据驱动 + MCP server。类 B 可选：`iota_server` 已有 FastAPI，加 webhook 规则运行时成本低 —— 但**无缺陷支撑，建议延后** |
| **M11** 配置与数据设施 | 有 `config.py` + `config_profiles/`（含 dsh 仍 fail-loud 指向 `--config` 的既有决策）+ `storage/backend_loader`（memory/file/redis/sqlite）+ memory gateways。`credential` 仅 2 文件、`attachment` 0 | **A + C** | 类 A：profile 投影 + 存储后端可换 + 网关。类 C：凭证与附件属宿主职责 |
| **M12** 框架机制本体 | **iota 最强对齐**：`EffectStack` 逆序回收+幂等+失效后抛错、`registry.register()` 返 disposer（身份比对）、`capabilities` 类定义期拒绝错名、entry-point 发现、四元组 realm。无事件总线；`node hooks` 的 `call_next` 已是 waterfall 等价物 | **A + C** | 类 A：五项可逆性机制逐项跑出来（这是全工程最有价值的一课）。类 C：不做事件总线 / 不做 HMR / 不做 intercept —— 三处均有 iota 既有决策记录 |

**统计**：类 A 主导 6 个模块（M05 M08 M09 M11 M12 + M02 部分）、类 B 涉及 3 个模块（M01 M04 M05）、类 C 主导 3 个模块（M03 M06 M07）+ 分散若干。

### 4.4 类 C 不是缺陷，是本次教学的第二主线

三堂对照课，每堂都有可跑的证据：

1. **M03 —— 缝开在哪一层**：换模型 vs 换内核。
2. **M07 —— 谁拥有执行栈**：harness 拥有 fs/shell/sandbox 缝；orchestrator 把它留给内核。
3. **M12 —— 借机制不搬架构**：iota 移植了 cordis 的 effect 语义，**拒绝**移植 Proxy Context、HMR、intercept，且每条拒绝都写明理由。

这条主线回答的是选型问题（*我该用 harness 还是 orchestrator*），比 12 个形状雷同的示例更有教学价值。

---

## 5. 任务分解（WBS v2）

```
Segment A ── dsh-example 升级 + 26→12 整合 ──┐
                                              │
Segment B′ ─ iota-core 类 B 补全（需授权）──┐  ├── Segment C ── 讲稿与视频
                                            ├──┘
Segment B ── iota-example M01–M12 ──────────┘
（A2 后 B′ 可启动；B 依赖 B′ 的类 B 交付；C 依赖 A、B 门禁全绿）
```

### Segment A — dsh-example（7–9.5 人日）

| 任务 | 内容 | 出口判据 |
|---|---|---|
| **A0 基线冻结** | 清理脏工作区；`git lfs pull`；打 `baseline/dsh-example-0.1.1-rc.2`；归档 typecheck/test 输出 | G0 |
| **A1 版本线升级** | 30 依赖 → `0.1.5-rc.2`（**精确版本，禁用 `latest`**）；cordis / timer / schemastery peer 范围按 `docs/rescope.md` 改名映射表复核 | G1 |
| **A2 API 漂移修复** | 按漂移表逐包。高危四包优先：subagent / agent-loop / llm / session。已知点：agent-presets 改名 `minimal`、`dsh-file-context` 变事件门插件、session format 版本 bump | 旧 26 示例在新版本下全绿（**先不整合**，隔离变量） |
| **A3 整合重构** | 26 → 12 模块（§3.2/3.3）。每模块：`README.md` + `index.ts` + `steps/*.ts` + `run.ts` | 12 模块各自 run 通过；`steps/*.ts` 保持独立插件形状 |
| **A4 新缝纳入** | 把 §3.2 的新增缝接入对应模块的 `steps/` | 服务覆盖 ≥ 50；typecheck 干净 |
| **A5 文档与图谱** | graphify 重建 `12-example-topology`（数字必须量出来）；更新 README 能力索引 + 四条扩展路径分类；更新 `docs/okf/` 知识包（OKF v0.2，带 source + expiry） | README 每个数字可由 IR JSON 复算；`createHarness` 仍是唯一枢纽 |
| **A6 段落验收** | 全量门禁 + 冷启动复现（删 `node_modules` 重装重跑） | G2 |

> **A2 与 A3 必须分开提交**：一次提交里同时改版本和改结构，出问题无法二分定位。

### Segment B′ — iota-core 类 B 补全（4–6 人日，**需授权**）

作用范围严格限定为三项，每项都有缺陷或重复代码支撑：

| 任务 | 内容 | 缺陷支撑 | 出口判据 |
|---|---|---|---|
| **B′1 ToolPipeline** | 抽出 iota 自有工具通道的 pre/post 钩子 + 可见性收紧 + 单调守卫，替换 `native_kanban.py` 的手工三层包装 | `pluggability-cordis-alignment.md` §2.2：该手工机制**真实失效过两次**（外层遮蔽内层 marker → 重复叠加 mirror；uninstall 按快照顺序恢复复活已移除层） | 三层包装改为 ToolPipeline 注册；`tests/unit/integrations/test_native_kanban.py` 两条既有回归仍绿；新增逆序/幂等/失效后注册测试 |
| **B′2 会话日志不变量** | 给 `RunStore` / `ConversationStore` 加 seq 连续 + 事件深冻结 + surface 投影契约 | 纯 iota 侧数据契约，不触内核；对齐 dsh 的 M05 不变量 | 新增不变量测试；违反契约时 fail-loud |
| **B′3 受限运行中注入** | 加「运行中向会话注入消息」入口，**仅 Hermes Direct 支持，ACP 编译期 fail-loud 拒绝** | 对齐 `node-hooks.md` 已确立的「内核边界 + ACP 拒绝」模式，不新造语义 | ACP 路径拒绝的错误信息指明原因与可用内核 |

**明确不做**（即使能对齐 dsh）：LLM adapter 缝、压缩缝、fs / shell / sandbox 缝、planMode、preset、attachment、事件总线、HMR、intercept。理由见 §0.1 与 §4.3。

**工程约束**：新分支 `feature/iota-example-alignment`（从 `feature/640-phase-ii` 切出）；三项各自独立提交、独立可 revert；**全量 101 个测试文件必须全绿**才允许交付给 Segment B 消费；不合并到主线，由用户决定是否提 MR。

### Segment B — iota-example（8–10 人日）

| 任务 | 内容 | 出口判据 |
|---|---|---|
| **B0 环境** | `uv venv` + `uv sync --extra dev`；私有 Nexus 凭证由**用户**先打通（R-02）；跑 iota-core 单测子集作环境证明 | G3 |
| **B1 装配枢纽** | `runtime/harness.py`：对位 `harness.ts`，一处完成 registry + EffectStack + providers + capabilities 校验 | 单一枢纽 |
| **B2 离线内核** | `runtime/kernel_echo.py`：真实 `KernelAdapter` 子类（非 mock 层），`register_adapter("echo", ...)`，确定性 `AgentEvent` 流 | 无网络、无 Hermes/Claude 即可跑完一轮 |
| **B3 M01–M12** | 按 §4.3 逐模块实现，含类 C 的「不对齐」示例（跑出真实行为 + 拒绝路径） | 12 模块 exit 0，全程无网络 |
| **B4 对照表** | `docs/dsh-vs-iota.md`：12 模块 × 三分类，每条断言带 `文件:行`，类 C 引用 iota 既有决策记录 | 无一条断言无出处 |
| **B5 闸门** | `ruff` + `mypy` + `pytest` 三闸门（对位 dsh 的 typecheck + test） | G4 |

### Segment C — dsh-workshop（4–6 人日 + 渲染机时）

| 任务 | 内容 | 出口判据 |
|---|---|---|
| **C0 主题 brief** | `lusine-meta intake --brief ... --answers ... --yes`，12 必答项 | G5 |
| **C1 讲稿** | `01-scripts/`：**三讲对应三条主线** —— ①dsh 的 12 个能力方向 ②iota 的同构对齐 ③三堂对照课与选型。每句论断标可复现命令 | 讲稿命令实测可跑 |
| **C2 deck** | `02-decks/*/presentation.json`，守 `stats ≤ 4` / `nodes ≤ 5` / `eyebrow` 只写语义标签 / 路径相对 `public/` | G6 |
| **C3 配图** | 复用 A5 的 graphify SVG（先 `git lfs pull`），必要处转 PNG，`alt` 必填 | validate-media 通过 |
| **C4 旁白** | 装 TTS 缺件（D4 决策后）→ `voiceover --force` → `manifest` → `check` | G7 |
| **C5 出片** | `export:pptx` + `render` → `04-out/` | G8 |

---

## 6. 门禁定义

无人工裁量，全部可执行。任一 FAIL 即 HOLD。

| Gate | 位置 | 判据 |
|---|---|---|
| **G0** | A0 后 | `git status --porcelain` 空；`git lfs pull` 完成且抽查 SVG > 130 B；基线 typecheck/test 输出已归档 |
| **G1** | A1 后 | 实测 `@deepseek-ai/dsh-tools` 安装版本 = `0.1.5-rc.2`；30 依赖无一解析为 `0.0.1-rc.1` |
| **G2** | A2–A6 后 | `npm run typecheck` 无输出；`npm test` 全 pass 且用例数 ≥ 基线 7；12 模块 `run.ts` 全部 exit 0；`steps/*.ts` 抽查 3 个可单独 `ctx.plugin()` 装配；graphify 复核 `createHarness` 仍是唯一枢纽；README 每个数字可由 IR JSON 复算 |
| **G2′** | A3 专项 | **反碎片化验收**：12 个模块 README 各自能独立回答「这个方向完整发生了什么」；`run.ts` 输出含分阶段 banner；无模块需要跳读其他模块 |
| **G3** | B0 后 | `import iota_core` 成功；`pytest tests/unit -q` 通过率 ≥ 上游同 commit 基线 |
| **G3′** | B′ 后 | iota-core **全量 101 个测试文件全绿**；`native_kanban` 两条既有回归仍绿；三项各自可独立 revert；工作区无越界改动（`git diff --stat` 只含预期文件） |
| **G4** | B3–B5 后 | `ruff` 干净；`mypy` 干净；`pytest` 全绿；12 模块 exit 0 且**全程无网络**；类 C 模块能跑出真实拒绝路径 |
| **G4′** | B4 专项 | **对齐验收**：12 模块编号与 dsh 一致；每模块 README 有对齐徽标；对照表每条断言带 `文件:行`；类 C 每条引用 iota 既有决策记录 |
| **G5** | C0 后 | brief `schemaVersion:1` / `kind:topic-intent` / `status:confirmed`，12 必答项非空 |
| **G6** | C2 后 | `npm run check -- --presentation ... --manifest ... --public-dir ... --brief ...` 通过；无 slide 违反 `stats≤4`/`nodes≤5`；无绝对路径与 `..` 穿越 |
| **G7** | C4 后 | `voiceover` 全页通过 FFmpeg 电平检查（无静音）；manifest 时间轴与音频实测时长一致 |
| **G8** | C5 后 | `npm run verify` 全绿；MP4 + PPTX 均产出；抽检 3 页画面/旁白/讲稿一致；讲稿每条命令实测可跑；`lusine-a-reves` 工作区仍干净（未改 `example/`） |

---

## 7. 需求追溯矩阵

| 用户需求 | 落到的任务 | 验证门禁 |
|---|---|---|
| 依据最新 deepseek-harness 源码更新 dsh-example | A1、A2 | G1、G2 |
| 依据最新 cordis 源码更新 | A1（peer 范围 + rescope 改名映射）、A3 之 M12 | G2 |
| 全面体现架构思想和功能 / 讲透彻 | A3、A4、A5（覆盖 ~25 → ~55 服务，含 OKF 知识包） | G2 |
| **修正① 极致整合，去碎片化** | A3（26 → 12 模块，目录层去碎片 + 文件层保粒度） | **G2′** |
| 依 iota-core 对标生成 iota-example | B1–B3 | G4 |
| **修正② 高度对齐；缺能力则先补 iota-core** | B′1–B′3（类 B 补全）、B3（同构 M01–M12）、B4（三分类对照表） | **G3′、G4′** |
| 用 lusine 生成讲稿与视频到 dsh-workshop | C0–C5 | G5–G8 |

---

## 8. 风险登记册

S1 = 阻断交付，S2 = 显著返工，S3 = 局部影响。

| ID | 风险 | S | 证据 | 处置 |
|---|---|---|---|---|
| **R-11**（v2 新增） | **修改 iota-core 是改内部 GitLab 产品仓库**（`cabin-brain/iota-core`，分支 `feature/640-phase-ii`），不是沙箱。误改可能影响他人在研功能 | **S1** | `git remote -v` + `git branch --show-current` 实测 | 需用户显式授权（决策点 D6）。从 `feature/640-phase-ii` 切 `feature/iota-example-alignment`；三项独立提交；G3′ 要求全量 101 测试文件全绿；**不自行合并、不自行提 MR** |
| **R-12**（v2 新增） | 「补 iota-core 以对齐」可能滑向把 iota 改造成 harness —— iota 自己已否决 | **S1** | `kernel-replacement.md` §六；`pluggability-cordis-alignment.md` 原则一 | §4.2 三分类判据 + B′ 的「明确不做」清单。类 B 必须有可复现缺陷支撑，无支撑则降为类 C |
| **R-13**（v2 新增） | 整合可能牺牲现有可读性优势（原承诺：读懂任一示例只需读它的 `index.ts` + `harness.ts`） | S2 | 现有 README 的读法承诺 | §3.3 的 `steps/*.ts` 结构 + G2′ 反碎片化验收；A3 不得引入第二个装配枢纽 |
| **R-01** | `PYTHONHOME`/`PYTHONPATH` 被 `Lingxi-py.app` 污染，`/usr/bin/python3` 直接 fatal error | S1 | 实测复现 + lusine `doctor` 自诊断输出 | 所有 Python 调用前 `unset PYTHONHOME PYTHONPATH`；PATH 优先 `/opt/homebrew/bin`；写进两工程 README 与脚本首行 |
| **R-02** | iota 私有依赖需 Nexus 凭证，`keyring-provider = "subprocess"` 触发交互式取凭证；Agent 非交互且禁止读凭证文件 | S1 | `pyproject.toml:151-174` | 用户先本机 `uv sync` 打通，Agent 只消费就绪 `.venv`；失败 → D3 |
| **R-03** | TTS 缺件：`edge-tts` 未安装、windows-sapi 在 macOS 不可用、qwen3 需外部 runtime | S1 | `command -v edge-tts` → MISSING | D4 选路。edge-tts **会把讲稿文本发往微软在线服务**，内部技术内容须先评估合规 |
| **R-04** | 0.1.1→0.1.5 漂移 4870 文件，A2 可能低估（subagent +2509/−1827、agent-loop +973/−183） | S2 | 漂移表 | A2 按包切 4 个可独立回滚提交；先只修 typecheck，行为差异留尾段；超估 2 倍 → D1 降级 |
| **R-05** | `@latest` 会装到 `0.0.1-rc.1`（比现用更老），静默降级 | S2 | dist-tags 实测 | 写精确版本；G1 校验安装后版本 |
| **R-06** | session format 版本已 bump，M05 日志不变量断言可能失效 | S2 | commit `fix: bump session format version` | A2 优先处理；把格式版本号本身变成断言 |
| **R-07** | `hello-olleh` 工作区脏 + SVG 为 LFS 指针 | S2 | `git status` 多处 M/D | A0 前置，G0 拦截 |
| **R-08** | 误改 lusine `example/`（违反其 AGENTS.md） | S3 | AGENTS.md 明文禁止 | C 段命令强制带三个路径参数指向 `dsh-workshop/`；G8 检查 lusine 工作区干净 |
| **R-09** | 渲染耗时不可控 | S3 | 本机已成功产出 6.6M MP4 | 后台落盘轮询；先渲 30 秒切片验证 |
| **R-10** | A3 整合与 A2 漂移修复交织，出问题无法二分定位 | S2 | — | A2 与 A3 强制分离提交；A2 出口判据是「旧 26 示例在新版本下全绿」 |

---

## 9. 排期与关键路径

| 阶段 | 人日 | 关键路径 |
|---|---|---|
| A0 / A1 | 0.5 / 0.5 | ★ |
| A2 API 漂移 | 2–3 | ★ 最大不确定性（R-04） |
| A3 整合重构 | 2.5–3 | ★ 修正①主体 |
| A4 新缝纳入 | 1.5–2 | 可拆并行 |
| A5 文档图谱 | 0.5–1 | 依赖 A4 |
| A6 验收 | 0.5 | ★ |
| **B′ iota-core 补全** | **4–6** | ★ 修正②前置，受 R-11/D6 阻塞 |
| B0 | 0.5 | 受 R-02 阻塞 |
| B1–B2 | 1.5–2 | ★ 离线内核是 B 段地基 |
| B3 十二模块 | 4–5 | 可拆并行 |
| B4–B5 | 2–2.5 | 依赖 B3 |
| C0–C2 | 2–3 | ★ 依赖 A5、B4 |
| C3–C5 | 2–3 | 受 R-03 阻塞 |
| **合计** | **24–32 人日** | A0→A1→A2→A3→A6→B′→B1→B3→B4→C0→C2→C4→C5 |

v1 估 17–24 人日；v2 增加主要来自 Segment B′（+4–6）与 A3 整合重构（整合比新增更费工，但一次性）。

---

## 10. GO/NO-GO 决策点

| ID | 决策 | 选项 | 影响 |
|---|---|---|---|
| **D1** | dsh-example 版本线 | ✅ **已裁决：①升到 `0.1.5-rc.2`** | A1/A2 执行 |
| **D2** | 整合粒度 | ✅ **已裁决：①26 → 12 模块** | A3/B3 按 §3.2 / §4.3 执行 |
| **D3** | iota-example 运行基线 | ✅ **已裁决：①示例真跑**。私有 Nexus 实测**匿名可读**（HTTP 200），`uv sync --extra dev --extra hermes` 已成功 → **R-02 解除** | B0 已具备条件 |
| **D4** | TTS 路线 | ✅ **已裁决：①`edge-tts`**。⚠️ 缓解措施（已自行采用，无需再确认）：讲稿旁白中**不出现内部标识**（内部 GitLab 地址、Nexus 主机名、内部分支名），这些只留在本规划与代码注释里，不进入发往微软的文本 | C4 可执行 |
| **D5** | 视频形态 | ✅ **已裁决：3 讲 / 每讲 12–18 分钟 / 中文 / 含终端录屏** | C1/C2 按此定页数 |
| **D6** | **是否授权修改 iota-core** | ✅ **已裁决：授权，且直接在 `feature/640-phase-ii` 分支上动**（不切新分支） | 已执行，见 §12 |
| **D7** | 类 B 范围 | ✅ **已裁决：只做 ToolPipeline**（选项②）。B′2 会话日志不变量、B′3 受限运行中注入 → 降为类 C，写入对照表 | 已执行，见 §12 |

**D1–D7 全部裁决完毕**，无待决项。



---

## 11. 决策后的第一条指令

D1–D7 裁决后先执行 A0（唯一不依赖任何决策的任务）：

```bash
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
unset PYTHONHOME PYTHONPATH                        # R-01
cd /Users/han/coding/hello-olleh
git status --porcelain --untracked-files=no        # 先看清脏改动归属
git lfs pull                                       # SVG 从指针还原为真图
# 用户确认后再 commit / stash
git tag baseline/dsh-example-0.1.1-rc.2
cd dsh-example && npm run typecheck && npm test    # 归档为回归基准
```

---

## 12. 实施记录：B′1 ToolPipeline（已完成并提交，未 push）

依 D6/D7 裁决执行：授权改 iota-core，直接在 `feature/640-phase-ii` 分支上动，只做 ToolPipeline。

### 12.1 回滚锚点

| 项 | 值 |
|---|---|
| 仓库 | `/Users/han/codingx/petite/sources/iota-core`（内部 GitLab `cabin-brain/iota-core`） |
| 分支 | `feature/640-phase-ii`（与 `origin` 同步，无未推送提交） |
| 动工前 HEAD | `26998fa0e7db1a914f780edc79206688e5c20fe2` |
| 动工前工作区 | 干净（`git status --porcelain` 空） |
| 状态 | **改动已在工作区，未 commit、未 push、未提 MR** |

### 12.2 实际修的缺陷

P0-b 已把三张快照表换成 effect 栈，但**没动「我是否已经装过」这个判断** —— 它仍然靠读 handler 对象上的 marker 属性，外加一条 `_iota_wrapped_inner` 链让检查能往里走。`_handler_chain_has`（17 行）本身就是证据：一个用来修补另一个机制的机制。

留下三个同类缺口，前两个已知、第三个是本次新发现的**潜伏实例**：

| # | 缺口 | 证据 |
|---|---|---|
| 1 | 链只在每层都记得设 `_iota_wrapped_inner` 时成立；漏设或被外部 wrapper 包住即断链，`False` = 重新叠一层 | `native_kanban.py` 原 348-364 行 |
| 2 | marker 名是字符串，拼错读作 `False` = 静默重复安装 | 与 `capabilities.py` 文档注释拒绝布尔 flag 的同一条理由 |
| 3 | **`_patch_delegate_task` 从来没拿到链遍历**，只读最外层 `_iota_kanban_patched`。而 `install_live_tool_logging_handlers` 合法地先于 `install_native_kanban` 运行（`HermesDirectAdapter` 在 `AIAgent` 重建后立刻调它）且包住每个已注册工具，遮住了 marker → 下一次安装叠上第二个 sub-task 补丁 → **每个委派子任务被创建两遍**。此前无测试覆盖 | 原 250 / 335 行 |

第 4 个消费者也被找出来了：`adapters/hermes_direct.py:1570` 也 import 了 `_handler_chain_has` 做属性考古 —— 「我装了没有」这个问题正被两个模块用嗅探外部对象的方式回答。

### 12.3 改法

**不再问 handler，改问安装方。** `ToolPipeline` 自己持有装过的 `(阶段, 工具)` 对，幂等判断退化成一次字典查询：没有 marker、没有链、没有可忘记的属性，第 3 条从结构上不可能再发生。阶段名在构造时声明，未声明的名字抛 `UnknownStageError` 并列出已声明项 —— 补掉字典查询本身管不住的唯一漏洞（拼错的阶段名会被当成新层）。

三角色齐全，符合 iota 自己的「一个角色不构成 seam」判据：

| 角色 | 位置 |
|---|---|
| Definition | `ToolRegistryBackend` / `ToolPipeline`（新增 `src/iota_core/tool_pipeline.py`，295 行） |
| Provider | `HermesToolRegistryBackend`（`native_kanban.py`，`tools.registry` 在方法内 import） |
| Consumer | `native_kanban` 四处安装器 + `adapters/hermes_direct.py` 的重装判断 |

与 `EffectStack` 的分工是刻意的：**pipeline 拥有「有哪些层」，effect 栈拥有「什么时候摘掉」**。pipeline 不重新实现逆序 / 幂等 / 失效后拒绝，只往调用方给的栈上压 disposer。两者一同在 `uninstall_native_kanban` 里释放。

保留的两处既有语义（都有事故记录支撑）：包**当前**装着的 handler 而非先前捕获的 original；回收时做身份比对，避免卸掉 Hermes 重建后别人装的东西。

**明确不做**：工具可见性收紧（cordis 的 `tools.restrict`）。iota 不决定内核向模型暴露哪些工具，那是内核与 profile 的职责；无可复现缺陷支撑的结构改动收益为零而风险为正 —— 与 §P3 放弃 scope 全量合并同一条判据。**这条记入 iota-example M01 的对齐徽标：`补齐后部分等价（restrict 属类 C）`。**

### 12.4 改动面

手写 6 个文件，其余 69 个是知识管线生成物（`AGENTS.md:191-193` 规定的三段顺序：`graphify_scan` → `okf_export` → `archify_render`）。

| 文件 | 改动 |
|---|---|
| `src/iota_core/tool_pipeline.py` | **新增** 295 行 |
| `tests/unit/test_tool_pipeline.py` | **新增** 15 项测试（假后端，不依赖 hermes extra） |
| `src/iota_core/integrations/hermes/native_kanban.py` | 218 行变更；删除 `_handler_chain_has`(17 行)、`_restore_handler`(13 行)、5 处 marker 赋值、4 处 marker 检查 |
| `src/iota_core/adapters/hermes_direct.py` | 11 行；第 4 个消费者改问 pipeline |
| `tests/unit/integrations/test_native_kanban.py` | 5 处**机制**断言迁移到 pipeline 归属；**行为断言一律未改**；新增 2 项回归 |
| `docs/architecture/pluggability-cordis-alignment.md` | 登记 P0-c 并补完整记录段（该仓库有「体量 ≥80 行的模块必须被文档提及」的闸门） |

### 12.5 G3′ 验收证据

| 判据 | 结果 |
|---|---|
| 全量 pytest | **1025 passed, 10 skipped, 0 failed**（动工前基线 1021 passed + 4 failed 的知识闸门，现已全绿） |
| ToolPipeline 单测 | 15/15 passed |
| `test_native_kanban.py` | 31/31 passed，含既有 `test_reinstalling_the_guard_keeps_the_redis_mirror_wrapper`、`test_mirror_install_is_idempotent_and_repoints_the_mirror`、`test_uninstall_restores_hermes_handlers_through_both_layers`、`test_live_logging_preserves_mirror_install_idempotency` |
| 新增回归 | `test_delegate_task_is_not_patched_twice_under_live_logging`（覆盖 §12.2 第 3 条）、`test_uninstall_releases_the_tool_pipeline` |
| ruff | `All checks passed!`（src + tests 全库） |
| mypy | 与 HEAD 基线**逐条一致，0 新增**（仓库既有 185 处报错 / 26 文件；`tool_pipeline.py` 自身 0 处） |
| 知识闸门 | 45 passed / 0 failed；`0 gaps >=80 lines`、`0 broken links` |
| 越界检查 | 手写改动仅上表 6 个文件；无源码残留 marker/链遍历引用（仅文档注释提及） |
| 临时产物 | 用于取 mypy 基线的 `/tmp/iota-baseline` worktree 已 `git worktree remove` |

### 12.6 待用户决定

改动**留在工作区未提交**。按 git 约定，commit 需你明确指示。建议提交粒度：

1. `feat(tool-pipeline): own installed stages instead of sniffing handler markers` —— 新模块 + 单测
2. `refactor(native-kanban): install the four wrapper layers through the pipeline` —— 四处安装器 + hermes_direct + 测试迁移与新回归
3. `docs(knowledge): regenerate after tool_pipeline` —— 文档段 + 69 个生成物

**已提交**（依用户确认）：`d3d0e92 refactor(tool-pipeline): own installed stages instead of sniffing handler markers`

原计划拆 3 个提交，实际改为**单提交** —— 查证该仓库既有惯例是每个提交自带源码 + 测试 + 文档 + 全部知识产物（近三个提交分别 82 / 117 / 89 个文件），每个提交自洽全绿。拆 3 段会让前两个提交停在知识闸门红灯，不如遵循仓库既有做法。

| 项 | 值 |
|---|---|
| 提交 | `d3d0e92`，75 files，+946 / −252 |
| 分支 | `feature/640-phase-ii`，**1 个未推送提交** |
| 状态 | 未 push、未提 MR（按约定等你决定） |
| 工作区 | 干净 |
| 回滚 | `git revert d3d0e92`；或 `git reset --hard 26998fa`（破坏性，需你确认） |
| ⚠️ 署名 | git 自动推断为 `han@M4Pro14C48G.local`。按约定未改你的 git config；若署名不对需你自行 `git config` 后 `--amend` |

---

## 13. 实施记录：Segment A0–A2（已完成，已由用户提交）

### 13.1 A0 基线冻结

| 项 | 值 |
|---|---|
| `hello-olleh` 动工前 HEAD | `ee6b194b1a076227c4e54b16dd7132c355332ebb` |
| 动工前已脏文件 | **14 个**，清单存于 `dsh-workshop/00-baseline/pre-existing-dirty.txt` |
| 基线标签 | `baseline/dsh-example-0.1.1-rc.2` |
| LFS | `git lfs pull` 完成，SVG 实测 32–60 KB（非 130 B 指针） |
| 回归基准 | `dsh-workshop/00-baseline/gate-0.1.1-rc.2.txt`：typecheck 干净 + test 7/7 |

⚠️ **G0 的一处有意偏离**：原判据要求工作区干净。那 14 个脏文件是**你既有的未提交改动**，不是我的。按 git 约定我不替你 commit 或 stash 别人的 WIP，改为**快照清单**——同样达到「我的 diff 可与既有改动区分」的目的。

### 13.2 A1 版本线升级

- 27 个 `@deepseek-ai/dsh-*` 依赖 `0.1.1-rc.2 → 0.1.5-rc.2`（**精确版本**）。
- **依 registry peer 闭包补齐 17 个新必需 peer**（不是猜的：从 `npm view <pkg>@0.1.5-rc.2 peerDependencies` 递归算出，闭包由 27 涨到 44）：
  `dsh-agent-presets` · `dsh-atomic-write` · `dsh-brand` · `dsh-code-runtime` · `dsh-home-paths` · `dsh-http-proxy` · `dsh-sandbox-policy` · `dsh-session-persistence` · `dsh-session-projection` · `dsh-session-projection-cache` · `dsh-session-query` · `dsh-session-title` · `dsh-storage` · `dsh-storage-domain` · `dsh-tool-todo` · `dsh-util-time` · `dsh-util-values`
- 其中 10 个正好是 §3.2 里 M05 / M06 / M08 / M11 需要的包 → A4 的包依赖提前解决。
- framework 三包按 0.1.5 的 peer 约束 `@deepseek-ai/cordis: ^4.0.2` 保持精确钉住，无需动。
- **G1 达成**：安装后实测全部 `dsh-*` = `0.1.5-rc.2`，无一个解析到 `latest`（= 更老的 `0.0.1-rc.1`）。

### 13.3 A2 漂移修复：0.1.1-rc.2 → 0.1.5-rc.2 迁移图谱

初始 **47 个 typecheck 错误 / 14 个文件**，收敛到 0。九处真实 API / 语义变更：

| # | 变更 | 迁移方式 | 影响示例 |
|---|---|---|---|
| 1 | `Session.events` 属性移除 | → `session.snapshotEvents(fromSeq?, toSeqExclusive?)`（返回冻结快照）；按 seq 取单条用 `session.eventAt(seq)` | 01·04·13·14·18·19·22 + runtime |
| 2 | `CallId` 改名 | → `ToolCallId` | runtime/llm-* |
| 3 | `SurfaceOp` 字段改名 | `{start, end}` → `{startSeq, endSeq}` | 14·18 |
| 4 | `SessionSeq` 变 branded number | 用品牌构造函数 `SessionSeq(n)`；`sessions.fork()` 的 boundary 同样品牌化 | 18 |
| 5 | **`assistant/chunk` 事件删除** | token 增量内嵌在 assistant/message 的 provider 流里，不再落日志。观测流式改走 `llm/stream` waterfall（示例 20） | 06 + harness.test |
| 6 | **`system/message` 进入 surface** | `SurfaceEventType` 现为 `system/message \| user/message \| assistant/message \| tool/result`；surface **节点 0 就是系统提示** | harness.test 的不变量断言 |
| 7 | **assistant/message 不能做 surface 替换** | 两条约束合起来导致：surface replace 要求 `sourceEventSeqs` 覆盖每个被遮蔽节点，而 assistant/message 的该字段类型是 `never`。上游 `compaction-basic/src/region.ts` 的做法是追加 **`user/message` 检查点** 占位；示例照此改 | 14·18 |
| 8 | surface 节点 0 受保护 | 运行期：节点 0 只能由 `system/message` 在恰好那一个节点上改写。压缩遮蔽区间必须跳过它 | 18 |
| 9 | `settingsNamespace()` 工厂移除 | 命名空间就是字符串字面量，由 `register()` 的 `SettingsNamespaceInput` 在类型层校验 | 23 |
| 10 | `SubagentCapabilities` 增字段 | 新增必填 `agentOptions` | 15 |
| 11 | **`AgentLoop.static inject` 增依赖** | 多了 `sessionProjections`。不装 `dsh-session-projection` 则 agent-loop 的 fiber 停在 PENDING，**症状是 `ctx.agents.create()` 报 'no agent factory registered'，而不是报缺依赖** —— cordis「依赖未满足则静默不执行」的真实现场，正是 M12 该讲的东西 | runtime/harness.ts |

**G2 前三项达成**：

| 判据 | 结果 |
|---|---|
| `npm run typecheck` | **0 错误** |
| `npm test` | **7 passed / 0 failed** |
| 26 个示例逐个 `npm run NN` | **pass=26 fail=0** |

### 13.4 后续状态

- A0–A2 已由用户提交为 `f83469ff PLAN-A2`；A3 从该干净基线单独开始，满足“升级与结构重构分离”的要求。
- A4（新缝纳入）、A5（graphify 重建图谱 + OKF 更新）、A6（冷启动复现）尚未执行。

---

## 14. 实施记录：Segment A3（已完成并提交）

A3 严格从用户已提交的 A2 基线 `f83469ff PLAN-A2` 开始，只执行 §3.2/§3.3 的 26 → 12 结构整合。**未提前引入 A4 新服务缝，未重建 A5 graphify/OKF，未执行 A6 冷启动重装。**

### 14.1 迁移契约与结果结构

文件级执行契约已固化在 [`00-baseline/A3-MIGRATION-MATRIX.md`](00-baseline/A3-MIGRATION-MATRIX.md)，覆盖 26 个旧示例、3 条真实 provider 路径、共享 helper、SKILL 资产和根级引用面。

| 方向模块 | 合并旧示例 | 阶段数 |
|---|---|---:|
| M01 工具管线 | 01, 03, 07, 11, 12 | 5 |
| M02 上下文装配与经济学 | 02, 10, 14 | 3 |
| M03 推理服务接入 | 05, 20 | 2 |
| M04 Agent 循环与干预面 | 06, 09, 19 | 3 |
| M05 会话面 | 18 | 1 |
| M06 人在环路 | 04, 13 | 2 |
| M07 执行侧后端 | 16, 24, 25 | 3 |
| M08 委派与预设 | 15 | 1 |
| M09 长任务与编排 | 21, 22 | 2 |
| M10 外部能力接入 | 08 | 1 |
| M11 配置与数据设施 | 23 | 1 |
| M12 框架机制本体 | 17, 26 | 2 |

最终结构实测：**12 modules、26 `steps/*.ts`、26 `phases/*.ts`、12 `README.md`、12 `index.ts`、12 `run.ts`**。每个模块 README 独立说明方向、阶段、数据流/责任边界与结论；每个 run 输出模块 banner、阶段 banner 和方向结论。

模块 `index.ts` 使用命名空间聚合，避免原插件普遍导出的 `name/apply/Config` 互相冲突；`steps/*.ts` 保持原能力粒度。M10 的 Skill 是有意保留的结构差异：它是数据能力 helper + `assets/SKILL.md`，不伪装成 `ctx.plugin()`。

### 14.2 真实 provider 与共享资产

真实网络路径完整保留，但与默认离线全跑隔离：

| npm script | 入口 | 含义 |
|---|---|---|
| `M01:real` | `M01-tool-pipeline/run-real.ts` | 真实模型自主决定调用 `word_count` |
| `M03:real` | `M03-inference-service-access/run-real.ts` | 同一 StreamChunk Consumer 接真实 MiniMax |
| `M10:real` | `M10-external-capabilities/run-real.ts` | 注入 `SKILL.md` 前后真实模型 A/B |

共享协议消费器迁至 `M03-inference-service-access/support/consume-stream.ts`；Skill 资产迁至 `M10-external-capabilities/assets/SKILL.md`。三条 real 路径仍从工程根 `.env` 读取 `MINIMAX_API_KEY`，不进入 `npm run all`，A3 验收未发起外部请求。

### 14.3 根入口重构

- `package.json`：数字脚本改为 `M01`–`M12`，加 3 条显式 `:real`。
- `runtime/run-all.sh`：精确列出 12 个离线模块，fail-fast；不使用目录 glob 推测入口。
- `runtime/onboarding.mjs`：新手选择器改用模块 ID 与方向学习路线。
- 根 `README.md`：改为 12 模块总览、统一阅读法、真实路径隔离和架构纪律。
- `cordis.yml`：Skill 路径改指 M10 assets，旧数字示例注释按模块语义更新。
- `tsconfig.json`：旧 glob 只覆盖 `*/index.ts` / `*/run.ts`，迁移后必须改为 `M??-*/**/*.ts` + `runtime/*.ts`，确保 steps/phases/real/support 全部进入 typecheck。

最后一项是实施中发现并修正的计划假设：迁移矩阵初稿曾写“现有 glob 自动包含”，首次 typecheck 随即以 `Context.compaction` 不可见证明该假设错误；修正 glob 后重新 typecheck 归零，并同步更正矩阵。没有通过 ambient 类型补丁掩盖根因。

### 14.4 G2 / G2′ 新鲜验收证据

| 判据 | 结果 |
|---|---|
| `npm run typecheck` | **exit 0，0 错误** |
| `npm test` | **7 passed / 0 failed** |
| 12 模块逐个 npm script | **M01–M12 全部 exit 0**；每个输出独立方向结论 |
| 独立插件抽查 | M01 `word-count`、M02 `prompt-section`、M11 `settings` 均可单独 `loadPlugin` → dispose |
| 反碎片结构 | **12 modules / 26 steps / 26 phases / 12 README / 12 module+phase banners** |
| 真实路径与资产 | **3 real paths / 1 shared consume / 1 SKILL asset** |
| 依赖版本 | 47 dependencies；其中 **44 个 `dsh-*` 唯一版本 `0.1.5-rc.2`** |
| 唯一装配枢纽 | `createHarness` 定义文件数 = **1**，仅 `runtime/harness.ts` |
| 旧引用 | 旧示例路径文件数 = **0**；旧数字 npm 命令文件数 = **0**；旧目录数 = **0** |
| Git 质量 | `git diff --check` **exit 0**；status 102 entries，**out-of-scope = 0** |

G2 中属于后续阶段的 graphify/IR 数字复算和冷启动重装仍分别留给 A5/A6；A3 专项 G2′ 已满足。

### 14.5 当前边界与下一步

- A3 已独立提交为 `f84f1568 refactor(dsh-example): consolidate examples into 12 modules`；未 push，未修改 git config。
- A3 提交仅包含 `dsh-example/` 与 A3 规划记录，未混入 A4/A5/A6。
- A4 从该干净提交开始独立实施。


---

## 15. 实施记录：Segment A4（已完成并独立提交）

A4 从 A3 提交 `f84f1568` 开始，只纳入 §3.2 批准的服务/能力缝及其不可缺少的 Provider 闭包；未重建 A5 graphify/README 图谱数字/OKF，也未执行 A6 冷启动重装。完整 Definition/Provider/Consumer、离线策略和排除项见 [`00-baseline/A4-SERVICE-MATRIX.md`](00-baseline/A4-SERVICE-MATRIX.md)。

### 15.1 真实 API 与依赖闭包

- 核验源码：DSH `fb2c4b9e69`、Cordis `f8ea3cd`；官方 catalog 为 71 Service API / 68 Event API。
- 直接依赖：84 个，其中 79 个 `@deepseek-ai/dsh-*` 全部精确为 `0.1.5-rc.2`。
- 发布包运行时缺口显式补齐：`dsh-anonymous-user-id`、`dsh-cordis-host-runner`、`dsh-launch-environment`、`cordis-plugin-loader@1.0.3`、`cordis-plugin-include@1.0.7`。
- npm 安全策略拦截的 `dsh-subprocess-local` / `koffi` / `node-pty` 安装脚本未被批准；terminal 默认阶段验证真实 `NO_BACKEND`，不伪造 PTY。

### 15.2 模块增量

| 模块 | A4 新增教学面 | 默认策略 |
|---|---|---|
| M02 | token meter、tool-result pruner、local spill | 临时目录、离线 |
| M04 | memory session telemetry、invariant registry | 不发遥测网络 |
| M05 | JSONL persistence、exact-read query、projection cache、title | 临时 JSON/JSONL |
| M06 | user questions、plan mode、todo、message feedback | 进程内 answerer / persistence |
| M07 | terminals、sandbox policy | NO_BACKEND + policy override |
| M08 | agent presets、permission presets、model selection | 空 roster / fail-loud / mock route |
| M09 | worker workflow、schedule | 本地 worker + JSONL |
| M10 | MCP、Webhook boundary、Cordis extensions、agent default model | 本地失败路径 / Host 边界 / mock route |
| M11 | storage/domain、attachments、file references、credentials/auth、workspace | 临时本地 Provider |
| M12 | Fiber 状态机、isolate、intercept | Cordis core 离线 |

结构从 A3 的 26 steps / 26 phases 增至 **58 steps / 58 phases**，仍为 12 个方向模块。复杂服务没有无条件塞入 `runtime/harness.ts`；`createHarness` 仍只定义一次。

### 15.3 覆盖与边界

`runtime/a4-coverage.ts` 固化 PLAN §3.2 的公开扩展面口径：基线 25 + A4 新增 34 = **59**，门槛 ≥50。新增项同时覆盖 Service、函数式 capability seam 和 M12 Cordis 机制，符合 §3.2 表格本身的混合口径。

- `webhookRuntime`：输出完整 static inject 和缺失 Host 依赖，不伪造半套宿主。
- `permissionPresets`：当前 LocalBashExecutor 不具 confinement，真实拒绝并解释原因。
- `mcp`：只启动不存在的本地 stdio 命令验证 startup failure，不发网络。
- `fileUploads`：真实包属于 client Host plane，服从 §3.4 更具体的 client/web/desktop 排除；未安装、未计入 59。
- A5/A6 仍未执行。

### 15.4 新鲜验收证据

| 判据 | 结果 |
|---|---|
| `npm run coverage:a4` | **baseline=25 / added=34 / covered=59 / required=50** |
| `npm run typecheck` | **exit 0，0 错误** |
| `npm test` | **7 passed / 0 failed** |
| `npm run all` | **M01–M12 共 12 个 marker，exit 0** |
| 结构 | **12 modules / 58 steps / 58 phases** |
| 依赖版本 | **84 dependencies / 79 DSH / DSH 唯一版本 0.1.5-rc.2** |
| 唯一装配枢纽 | `createHarness` 定义文件数 **1** |
| 排除项 | `dsh-client-file-upload` direct dependency = **false** |
| Git 质量 | `git diff --check` **exit 0** |

### 15.5 提交边界

A4 已独立提交为 `3e9ca8d7 feat(dsh-example): add A4 service seams`；只包含 `dsh-example/`、本节 PLAN 和 `A4-SERVICE-MATRIX.md`。未 push、未修改 git config。

---

## 16. 实施记录：Segment A5（已完成，随本阶段独立提交）

A5 从 A4 提交 `3e9ca8d7` 开始，严格按仓库规定的三段顺序执行：
`graphify_scan` → `okf_export` → `archify_render`。没有执行 A6 的冷启动删除/重装，也没有把
`graphify-out/` 生成图提交入库。

### 16.1 graphify 结构事实

扫描范围只含 `dsh-example/runtime` 与 `M01`–`M12`；固定使用 `graphifyy==0.9.53`、
`build_from_json(..., directed=True)`。当前工作树重跑后的事实为：

| 指标 | 结果 |
|---|---|
| 扫描文件 | **169** |
| 有向图 | **584 nodes / 744 edges / 45 communities** |
| 可信度 | **739 EXTRACTED / 5 INFERRED**；5 条推断边逐条列出但不作事实 |
| `createHarness` | **唯一匹配**，`runtime/harness.ts` L136，degree **66 = in 62 + out 4** |
| multigraph 诊断 | `DiGraph` 584/744；0 dangling、0 duplicate、0 same-endpoint collapse |

生成图与测量 sidecar 全部位于 gitignored `graphify-out/dsh-example/`。提交的 OKF reference
给出从 `graph.json` 独立复算节点、边、社区、relation、confidence 与 hub 邻接的命令。

### 16.2 OKF v0.2 知识包

更新 `docs/okf/` 的四个 concept、一份 graphify reference、两级 index 与 log：

- 结构数字统一到本次有向图，不再沿用 26 示例时代的 87/488/537/57 与 32/30/2。
- 四个 concept 与 reference 共 5 个知识条目全部带 `sources` 与绝对 UTC
  `stale_after: 2026-12-31T00:00:00Z`；所有本地 source 均存在。
- 来源路径迁到 M01/M02/M03/M07 新结构；`INFERRED` 与 `EXTRACTED` 保持显式分层。
- `docs/okf/log.md` 保留 2026-09-07 历史条目，同时新增 2026-09-12 superseding 记录。
- OKF 范围 46 个本地 Markdown 链接全部可解析。

### 16.3 archify topology 交付

`12-example-topology` 改为 8 个主节点：四条官方扩展路径（按注册/按事件/按服务/按数据）、
唯一 `createHarness` hub、18 个真实服务、离线/真实 Provider 分路、两个刻意留空的 seam。
README 所需数字全部固化在 IR cards。

| 判据 | 结果 |
|---|---|
| archify doctor | **2.14.0，全项 ready** |
| showcase validate | **9/9 checks，0 errors / 0 warnings** |
| 几何 | 0 crossings / 0 ambiguous corridors；最小标签净距 11.7 px |
| specification | SHA-256 `4b1b1ae144f9e23f85f54e12d166e09fdf1929a32aa88e3ef0e20dc6f98a53c4`，5090 bytes |
| HTML | SHA-256 `1a7026fefa4aa2e47beeebef744a529b8f5bc7042266ccfda8db30f566381c3a`，640354 bytes |
| SVG | 82871 bytes；标题、四路径、hub 与 degree 66 均进入产物 |
| visual-check | 1440×900 / 1600×1000 / 1920×1080 / 2048×1320 全部无 X/Y overflow；自动 receipt 的 `visualReview` 如实为 `pending` |

visual-check 的截图/contact sheet/JSON 仅作临时验收证据，验证后已删除；没有把截图噪声纳入提交。

### 16.4 README 与扩展路径

- 能力索引覆盖 A4 新缝，并给 M01–M12 标注“按注册 / 按事件 / 按服务 / 按数据”；分类不是互斥目录。
- 新增四路径选择法：先区分内容与机制，再选 registry/event，只有需可替换后端时才设计完整 service seam。
- 显式记录 PLAN §3.4 排除：client/web/desktop、`fileUploads`、Host-Remote 传输、外部账号 runtime、实验能力与 LSP。
- 8 条工程数量/图谱/覆盖/版本断言逐条指向 topology IR JSON Pointer；门禁实测
  12 modules / 58 steps / 58 phases / 3 real paths / 4 extension paths。
- 同步修正 8 处旧示例号/旧 real 文件名与两处 0.1.1 版本注释；全部是注释/文档，无行为变化。

### 16.5 A5 新鲜验收证据

| 判据 | 结果 |
|---|---|
| `npm run coverage:a4` | **25 + 34 = 59 ≥ 50** |
| `npm run typecheck` | **exit 0，0 错误** |
| `npm test` | **7 passed / 0 failed** |
| `npm run all` | **M01–M12 全部 exit 0** |
| 依赖 | **84 dependencies / 79 DSH / 唯一版本 0.1.5-rc.2**；`dsh-client-file-upload` 排除 |
| graphify | 当前工作树重跑 **169/584/744/45**；唯一 hub **66=62+4** |
| README | **8 个 IR pointer 断言通过**；本地链接全通过 |
| OKF | **5 entries source+expiry**；46 个本地链接全通过 |
| archify | **showcase 9/9，0 errors / 0 warnings** |
| Git 质量 | 登录 shell `git diff --check` **exit 0**；`graphify-out` 确认 gitignored |

仓库级 `scripts/check_doc_links.py` 仍报告 89 条 A3 后既存的旧数字目录链接，全部位于
`docs/hello-cordis/` 与 `docs/hello-dsh/` 的长文，不是 A5 修改引入。A5 对自己改动的 README 与
OKF 范围均已定向验证全绿；这项既存迁移债务如实保留，不以缩小检查口径冒充全库通过。

### 16.6 提交边界与下一步

本阶段只提交 topology IR/HTML/SVG、`docs/okf/`、`dsh-example/README.md`、相关纯注释修正与本节记录；
不提交 `.tools/`、`graphify-out/` 或 visual-check 临时产物。提交后立即启动 A6 冷启动重装验收。

---

## 17. 实施记录：Segment A6（已完成，随本阶段独立提交）

A6 从 A5 提交 `335473e8` 的干净工作区开始，只做冷启动重装与 G2 最终验收；没有修改
`package.json`、`package-lock.json` 或运行时代码。

### 17.1 冷启动复现

| 项 | 冷装证据 |
|---|---|
| 工具链 | Node v26.4.0 / npm 11.17.0 |
| lockfile | v3，256 个 package entries，root 为 `@example/dsh-examples` |
| 删除前 | `node_modules` 119M，112 个顶层目录 |
| 删除范围 | 只删除可再生的 `dsh-example/node_modules`；源码与两个 package 文件保留 |
| 重装命令 | `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund` |
| 重装结果 | **exit 0，597ms，added 211 packages** |
| 删除后 | `node_modules` 119M，112 个顶层目录 |
| 漂移检查 | `package.json` / `package-lock.json` **无 diff**；重装后工作区仍干净 |

`--ignore-scripts` 是有意的安全边界：A4 已记录原生安装脚本未获批准，冷启动不能借“验收”之名
放宽该决定。默认教学路径不依赖这些脚本；terminal 继续以真实 `NO_BACKEND` 说明缺失后端。

### 17.2 冷装后的完整 G2

| 判据 | 冷装后结果 |
|---|---|
| `npm run coverage:a4` | **25 + 34 = 59 ≥ 50** |
| `npm run typecheck` | **exit 0，0 错误** |
| `npm test` | **7 passed / 0 failed** |
| `npm run all` | **exit 0；12 个 module marker + 1 个 final marker** |
| 实际安装版本 | **79 个直接 DSH 包全部存在，唯一版本 0.1.5-rc.2** |
| Host-plane 排除 | `dsh-client-file-upload` **未安装** |

`npm run all` 的完整日志位于 gitignored `graphify-out/a6/npm-all.log`，不提交。

### 17.3 A5 证据的冷装后复核

| 判据 | 结果 |
|---|---|
| archify | showcase **9/9**，0 errors / 0 warnings；IR/HTML/SVG SHA-256 与 A5 提交一致 |
| graphify | **169 files / 584 nodes / 744 edges / 45 communities**；739 EXTRACTED / 5 INFERRED |
| 唯一枢纽 | `createHarness` 唯一，L136，**66 = in 62 + out 4** |
| README | **8 个 IR pointer 断言通过** |
| OKF | **5 entries 全部 source + absolute UTC expiry** |
| Git 质量 | `git diff --check` exit 0；记录前工作区干净 |

### 17.4 Segment A 出口

A0–A6 已分别完成并按阶段提交；A6 证明当前 lockfile 能在禁止安装脚本的安全策略下冷重建并通过
完整 G2。提交后立即进入 Segment B：在 `hello-olleh` 中创建与 DSH M01–M12 高度对齐的
`iota-example`；iota-core 仅消费已完成的 ToolPipeline 提交 `d3d0e92`，不再扩大 core 修改范围。

---

## 18. Segment B 实施记录（iota-example）

### 18.1 B0–B2：环境、唯一装配枢纽与离线内核

- `iota-example` 使用 Python **3.13.13** 与独立 `.venv`；`uv.lock` 锁定本地 editable
  `iota-core==2026.9.8` 及固定版本的 ruff/mypy/pytest。
- `uv sync --frozen --extra dev --offline` 复核为 **Checked 26 packages**，证明当前 lockfile
  可在无网络条件下复用。
- `runtime/harness.py` 是唯一 `create_harness()` 定义，一处装配 `Registry`、`EffectStack`、
  adapter provider、capability 校验、conversation/run stores 与 `IotaRuntime`。
- `runtime/kernel_echo.py` 是完整 `KernelAdapter` 子类；真实实现 start/capabilities/session/
  stream/close，确定性产生 `SystemInitEvent`、`TextDeltaEvent`、工具事件和 `FinalEvent`。
- 每个模块进程安装 socket connect fail-closed guard；任何出网尝试抛 `OfflineViolation`。

### 18.2 B3：M01–M12 同构模块

12 个目录与 `dsh-example` 编号、名称完全一致；每个目录均有 `README.md`、`index.py`、
`run.py`，README 顶部带类 A/B/C 对齐徽标。代表性真实行为：

- M01：ToolPipeline 具名 stage、幂等、missing report、错名拒绝和逆序拆除。
- M03：用真实 Hermes ACP capability 跑出 `llm_execution` middleware 编译期拒绝。
- M06：真实 ACP permission 默认 reject，反向请求总能得到应答。
- M07：shell 意图由 `KernelAdapter` 发出 `kernel.shell` 事件，orchestrator registry 为空。
- M08：GraphSpec research → review 两节点拓扑实际编译执行。
- M09：GraphTaskQueue task-id 幂等、claim/ack 与 checkpoint sequence。
- M10：Skill 文件同步及 MCP `tools/list` / `tools/call` 往返。
- M11：profile 投影、内存存储与 dsh profile fail-loud 指引。
- M12：LIFO、幂等、inactive 拒绝、身份 disposer、capability 错名与 entry-point。

### 18.3 B4：逐条证据对照表

`iota-example/docs/dsh-vs-iota.md` 含 **12 行** DSH-vs-iota 对照。每行分别引用 DSH 事实、
iota-core 实现与本工程运行证明的 `文件:行`；所有含类 C 的行还引用既有架构决策
`kernel-replacement.md`、`node-hooks.md` 或 `pluggability-cordis-alignment.md`。pytest 会解析
全部引用，验证本地文件存在且行号不越界。

### 18.4 B5 / G4 出口

| 判据 | 结果 |
|---|---|
| 离线 lockfile 复用 | `uv sync --frozen --extra dev --offline`：**Checked 26 packages** |
| 12 模块全跑 | **12 个 `IOTA_MODULE_OK` + 1 个 `IOTA_ALL_OK modules=12 network=blocked`** |
| ruff | **All checks passed** |
| mypy | **10 source files，0 issues** |
| pytest | **20 passed / 0 failed** |
| 编号同构 | iota **12** = DSH **12** |
| 唯一枢纽 | `create_harness` 定义 **1** 个 |
| 文档证据 | 12 行；全部 source path/line 存在；9 个含 C 的模块均引用既有决策 |
| Git 质量 | `git diff --check` exit 0；iota-core 工作区未修改 |

Segment B 不修改 iota-core，只消费已完成且内容等价的 ToolPipeline 基线。默认教学运行全程离线；
安装阶段使用锁定依赖，后续复用验证不需要网络。G4 与 G4′ 全绿后进入 Segment C。

---

## 19. Segment C 实施记录（2026-09-12）

### 19.1 C0 / G5：confirmed topic brief

在 `00-brief/` 生成 `answers.json` 与 `topic-brief.json`。brief 为
`schemaVersion: 1`、`kind: topic-intent`、`status: confirmed`，12 个核心必答字段非空；
总主题为“从 DSH 到 iota：能力接缝、结构对齐与工程选型”，确认总页数 40、总时长目标 45 分钟。

### 19.2 C1–C3 / G6：三讲、40 页与本地配图

| 讲次 | 主线 | 页数 | 图片/终端证据 |
|---|---|---:|---|
| 第一讲 | DSH 的 M01–M12 十二个能力方向 | 16 | 复用 A5 topology，并拼入 DSH 12 模块真实终端输出 |
| 第二讲 | iota 的 A/B/C 同构对齐 | 14 | `IOTA_MODULE_OK` 12 条与 `IOTA_ALL_OK ... network=blocked` |
| 第三讲 | M03/M07/M12 三堂结构差异课与选型 | 10 | 三模块终端实录与 harness/orchestrator 选型矩阵 |

三份 Markdown 讲稿逐页包含旁白与可复现命令；Markdown 旁白与 presentation narration 逐条一致。
lusine 原生 `PresentationSchema` 和三份 `validate-deck` 全绿；无 slide 违反 `stats≤4` / `nodes≤5`，
所有资源路径相对 public，image alt 非空，无绝对路径或 `..` 穿越。配图均为 1280×720 PNG。

### 19.3 C4 / G7：edge-tts 与音频时间轴

- 独立 `dsh-workshop/.venv` 安装固定版本 `edge-tts==7.2.3`，不修改 lusine 环境。
- 使用 lusine 原生 edge profile：`zh-CN-XiaoxiaoNeural`、`-5%`、MP3。
- 在线服务只接收通过脱敏扫描的 40 段 narration，不发送命令、路径或源码。
- 生成 40/40 MP3；三份 manifest 为 16/14/10 条。
- FFmpeg 电平检查全部非静音；manifest 与 ffprobe 时长误差小于 0.05 秒。
- 三讲纯旁白总长为 616.27s、544.08s、413.06s。

### 19.4 C5 / G8：PPTX、MP4 与可执行验收

| 讲次 | PPTX 页数 | MP4 时长 | 媒体流 |
|---|---:|---:|---|
| 第一讲 | 16 | 720.00s | H.264 1280×720 + AAC 48kHz 双声道 |
| 第二讲 | 14 | 728.00s | H.264 1280×720 + AAC 48kHz 双声道 |
| 第三讲 | 10 | 720.00s | H.264 1280×720 + AAC 48kHz 双声道 |

三份 PPTX 经 OpenXML 独立解析，逐页标题与 presentation 一致；三份 MP4 由 lusine 原生
`render.mjs` / Remotion 渲染，内置成片音频门禁通过，末尾帧可解码，每讲均在 12–18 分钟。

G8 额外证据：

- lusine `npm run verify` **8/8** 全绿：52 个 Node tests、30 passed/1 skipped Python tests、
  ESLint、两套 tsc、ruff、deck 与 WCAG 对比度均通过。
- 三讲在 635s / 525s / 581s 抽帧；Vision OCR 识别对应标题和真实终端标记；抽检页的
  JSON narration、Markdown 旁白与 manifest 音频映射一致。
- 三份讲稿 **40/40** 条命令实际 exit 0；脱敏日志归档在 `05-evidence/commands/`。
- `validate_workshop.py` 全绿：G5、G6、G7、PPTX/MP4、时间轴、脱敏与终端证据均通过。
- lusine 开始时已有 35 行用户本地状态；结束后字节级不变，status SHA-256 始终为
  `11e81ab7ae535e8f5260b032511e4b6355145b8be433305b421d1f834c4502b3`，未写入 `example/`。
- iota-core 工作区干净；主仓库本段变更全部位于 `dsh-workshop/`；未 push、未修改 git config。

完整机器证据见 `05-evidence/validation-report.md`。

### 19.5 讲稿重写（2026-09-12，同日修订）

首版讲稿有三个真实缺陷，已整体重写内容层：

1. **暴露了工作过程**。第二讲原本以内部对齐分类为骨架讲解，还出现了决策编号。这些是我
   的工作语言，观众既不需要也无法解读。现已全部移除，改为直接说「哪里对得上、哪里对不上、
   为什么不该硬对」，并新增一页用执行栈解释差异的根因。
2. **没有起承转合**。原来四十页是并列罗列。现在第一讲从「给 Agent 加一个删文件的工具」
   这一个需求开场，用它牵出注册、权限、执行、审计，每页结尾自然递给下一页，末页收回到
   开场那个工具；第二讲承接同样编号换一层来做；第三讲只挑三个决策点收束到选型。
3. **节奏空洞**。原来每页旁白约 38 秒却停留 45–72 秒，最长单页静音 34 秒。重写后旁白填满
   页面，有声占比从约 78% 升到 93–96%，换页停顿 1–2 秒。

重写后的验收：

| 判据 | 结果 |
|---|---|
| 页数 | 16 + 14 + 10 = **40**（与 confirmed brief 一致） |
| 成片时长 | **745.9s / 737.9s / 736.0s**，均在 12–18 分钟 |
| 有声占比 | **94.6% / 93.3% / 96.3%**，门禁下限 90% |
| 旁白 | 40 段全部重新生成，非静音检查通过 |
| PPTX | 三份重新导出，逐页标题与画面文字一致 |
| MP4 | 三份重新渲染，成片音频门禁通过 |
| 讲稿命令 | **40/40 exit 0** |
| lusine 门禁 | **8/8 通过**，其工作区状态哈希未变 |
| 可见文本 | 内部工作语言 **0** 处，AI 腔句式 **0** 处 |

`validate_workshop.py` 已把上述三条内容约束固化为常驻门禁，后续再改稿会自动拦住回退。

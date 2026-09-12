# DSH 教学视频工程 — 实施规划（航天工程级）

> 状态：**草案，待 GO/NO-GO 评审**（见 §9）
> 编制日期：2026-09-12
> 编制依据：本机源码与工具链实测，全部断言带证据（§1）。未实测的事项在文中显式标注「未验证」。

---

## 0. 任务定义

| 项 | 内容 |
|---|---|
| 任务目标 | 产出一套可交付的 dsh 教学视频，其内容由两个**能真跑**的示例工程支撑 |
| 交付物 1 | `dsh-example/` 升级到最新 dsh 源码线，覆盖面补全至可完整讲透架构思想 |
| 交付物 2 | `iota-example/` 从零建立，对标 dsh-example，基于 iota-core |
| 交付物 3 | `dsh-workshop/` 教学讲稿 + PPTX + MP4，由 lusine-a-reves 生成 |
| 成功判据 | 三段各自门禁全绿（§4），且交付物 3 的每一句论断都能在交付物 1/2 里跑出来 |

**贯穿性原则（借自 dsh-example 已有的工程风格，不新造）**

1. **无模拟层**：示例依赖 npm/PyPI 上真实发布的包，不写缩样、不打解析钩子。
2. **fail-loud**：解析失败抛错并列出已注册项，禁止静默降级为 no-op。
3. **一个目录只讲一种能力**，装配成本一次性付在 `runtime/` 层。
4. **闸门即证据**：`typecheck` 编译到真实包的 `.d.ts`、`test` 跑真实 turn 核对不变量。
5. **每阶段独立可验收、独立可回滚。**

---

## 1. 现状勘察（全部带证据）

### 1.1 路径与工具链

隧道实际落点是 macOS（`HOME=/Users/han`），需求中的路径均为真实路径，无需映射。

| 工具 | 实测 | 结论 |
|---|---|---|
| node | v26.4.0 `/opt/homebrew/bin/node` | 满足 dsh-example `engines: >=22.18` |
| npm | 11.17.0 | ok |
| pnpm | 已装 | dsh 源码侧需要（`pnpm-workspace.yaml`） |
| uv | 0.12.3 | iota / lusine 的 Python 侧 |
| python3 | 3.14.6（homebrew）/ **`/usr/bin/python3` 崩溃** | 见 R-01 |
| ffmpeg / ffprobe | 8.1.2，均在 `/opt/homebrew/bin` | lusine 音频校验可用 |
| registry.npmjs.org | HTTP 200 | dsh 包可装 |
| nexus.logan.xiaopeng.local:8081 | HTTP 200，ping 44ms（10.192.31.79） | iota 私有依赖可达 |

### 1.2 dsh-example 现状：健康，但版本线严重滞后

**基线闸门实测全绿**（在当前 0.1.1-rc.2 依赖下）：

```
### TYPECHECK  → tsc -p tsconfig.json --noEmit   无输出（干净）
### TEST       → 7 pass / 0 fail  (145ms)
  ✔ 真实 core 服务全部装配
  ✔ 真实 agent-loop 跑完一个 turn 并按序落日志
  ✔ 会话日志不变量：seq 连续 + 深冻结 + surface 只投影消息事件
  ✔ 工具管线：注册 → 执行 → effect 反注册
  ✔ MiniMax 请求映射 / SSE 映射 / reasoningEffort fail loud
```

规模：26 个示例目录，62 个 `.ts`，示例层 `.ts`+`.md` 合计 6796 行。

**版本漂移是本段的主要工作量来源，不是一次 bump：**

- 源码 `package.json` = `0.1.5-rc.2`；示例 `package.json` 全部钉在 `0.1.1-rc.2`。
- `dsh-v0.1.1-rc.2..HEAD` = **3225 个 commit**，`packages/` 下 **4870 个文件变更**。
- npm dist-tags 实测：`next=0.1.5-rc.2`、`alpha=0.1.5-alpha.2`、**`latest=0.0.1-rc.1`**。
  → **`latest` 是个陷阱**，比现用版本还老。升级必须写精确版本号或用 `next`，绝不能用 `npm install <pkg>@latest`。
- 逐依赖漂移（`git diff --stat`，只统计各包 `src/`）：

| 包 | 目录 | src 变更 |
|---|---|---|
| dsh-subagent | packages/subagent/subagent | 22 files, +2509 / −1827 |
| dsh-llm | packages/llm/llm | 9 files, +1038 / −176 |
| dsh-agent-loop | packages/core/agent-loop | 7 files, +973 / −183 |
| dsh-session | packages/core/session | 10 files, +695 / −866 |
| dsh-agent | packages/core/agent | 7 files, +315 / −307 |
| dsh-attachment | packages/attachment/attachment | 6 files, +300 / −37 |
| dsh-goal | packages/goal/goal | 3 files, +255 / −157 |
| 其余 12 包 | settings / tools / commands / system-prompt / compaction / shell / subprocess / user-approval / fs / skill / sandbox / jobs | 各 2–4 文件，数十至百余行 |

已知具体破坏性改动：`feat(agent-presets): rename the two-tool preset to minimal`、
`refactor(fs): make dsh-file-context an event-gate plugin, not a method service`、
`fix: bump session format version`。→ 会话日志格式版本变了，示例 18 的不变量断言需复核。

**覆盖面缺口**：`docs/capability-seams.md` 声明 **71 个 `ctx.*` 服务**；源码 `packages/` 下 **267 个 package.json、49 个分组**。现有 26 个示例约覆盖 25 个服务，**覆盖率 ~35%**。0.1.5 新增分组 `webhook`（0.1.1 时不存在），移除 `packages/examples`。

### 1.3 iota-example 现状：**空目录**

`/Users/han/coding/hello-olleh/iota-example` 存在但无任何文件。属于从零建设。

iota-core（`v2026.9.8`，Python `>=3.11,<3.14`）的可插拔面**已经成熟**，且是刻意对齐 cordis 做的，这使「对标 dsh-example」在概念上一一可映射。证据来自
`docs/architecture/pluggability-cordis-alignment.md` §六实施记录（P0–P3 全部落地，测试从 776 增至 835）：

| cordis 机制 | iota-core 对位实现 | 文件 |
|---|---|---|
| 注册返回可回收句柄 | `_NamedRegistry.register() -> dispose`（身份比对删除） | `registry.py:33` |
| 可逆 effect + `assertActive` | `EffectStack`（逆序回收 / 幂等 / 失效后 push 抛错） | `effects.py` |
| provider 注册表替代 if/elif | `register_adapter` / `register_storage_backend` / `register_config_profile_projector` | `providers.py`、`adapter_providers.py` |
| `inject` / `provide` | `provides` / `requires` frozenset，**类定义期**拒绝未知能力名 | `capabilities.py`、`adapters/base.py` |
| 外部插件发现 | entry-point 组 `iota_core.providers`，三类失败均 fail-loud | `pyproject.toml`、`loader.py` |
| isolate realm | 部分：会话四元组单一派生入口，全量合并**按证据放弃** | `graph/session_manager.py` |
| HMR | **明确不做**（与「启动期装配、运行期冻结」冲突） | — |
| intercept 配置链 | **明确不做** | — |

iota 侧还有 dsh 没有的域：`graph/`（19 文件，图运行时 + checkpoint + recovery + scheduler）、`goals/`、`memory/` + `memory_gateways/`、`skill_actions/`、`kanban*`、`config_profiles/`、`mcp/`、`iota_server/`（FastAPI + WS）。
**这些「非对称」正是教学价值最高的部分**，不应被强行对齐掉。

iota-core 现有测试：101 个 `test_*.py`（tests/{unit,integration,e2e,scenarios,performance}）。

私有依赖：`iota-memory-protocol==0.1.0.dev2026070201`、`iota-observability==0.1.4`，来自
`xp-nexus-pypi`（已实测可达）；`[tool.uv] keyring-provider = "subprocess"` → 见 R-02。

### 1.4 lusine-a-reves 现状：可用，但 TTS 缺件

`npm run doctor` 实测：`uv / node / npm / ffprobe / ffmpeg / venv / node_modules` **全部 ok**。
Remotion `4.0.515`，`@remotion/compositor-darwin-arm64` 已就位，`out/signals-systems-stories.mp4`（6.6M）与 `.pptx`（278K）为本机今日已成功产出 → **渲染链路在 macOS 上已验证可用**。

管线（`package.json` scripts）：
`doctor → intake(uv) → check → voiceover → manifest → check → export:pptx / render`，门禁 `verify` / `lint` / `test` / `lint:py` / `test:py`。

硬性工程约定（`AGENTS.md`）：**新主题不得改 `example/`**，必须用
`--presentation` / `--public-dir` / `--manifest` 指向调用方目录。

内容契约（`core/docs/content-schema.md`）：`schemaVersion: 1`；8 种 slide type；
`stats ≤ 4`、`nodes ≤ 5`（由 13.33 英寸 PPTX 画布决定）；`eyebrow` 只写语义标签、页码由渲染器生成；
音色/情绪/采样参数**禁止写进 slide**，只能由 TTS profile 决定。

主题接入（`core/docs/topic-intake.md`）：`lusine-meta intake` 有 **12 项必答**（缺失即阻塞内容创作）+ 4 项可选；自动化调用必须带 `--yes`；`--brief` 只接受 `status: "confirmed"`。

**TTS 是唯一缺件**：`command -v edge-tts` → MISSING，venv 内也没有。可选路线：
`windows-sapi`（macOS 不可用）、`edge-tts`（需装 CLI，走微软在线服务）、`cosyvoice2`、`qwen3-tts`（需外部已验证 runtime + 模型权重，仓库只产出 `out/tts/plan.json`）。

### 1.5 仓库卫生

`hello-olleh` 工作区**脏**：`README.md`、`.github/workflows/*`、`docs/hello-dsh/diagrams/*` 等多处 M/D 未提交。
所有 `.svg` 由 **Git LFS** 跟踪，未 `git lfs pull` 时拿到的是 130 字节指针文件。

---

## 2. 任务分解（WBS）

三个飞行段串行，段内可并行。段间设**保持点（Hold Point）**，未通过门禁不得进入下一段。

```
Segment A ── dsh-example 升级与补全 ──┐
                                      ├── Segment C ── dsh-workshop 讲稿与视频
Segment B ── iota-example 从零建立 ────┘
（A2 完成后 B 可并行启动；C 必须等 A、B 门禁全绿）
```

### Segment A — dsh-example（预估 5.5–8 人日）

| 任务 | 内容 | 出口判据 |
|---|---|---|
| **A0 基线冻结** | 提交或 stash 现有脏改动；`git lfs pull`；打标签 `baseline/dsh-example-0.1.1-rc.2`；归档当前 typecheck/test 输出为回归基准 | 工作区干净；基线输出落盘 |
| **A1 版本线升级** | 30 个依赖 `0.1.1-rc.2 → 0.1.5-rc.2`（写**精确版本**，禁用 `latest`）；`cordis` / `cordis-plugin-timer` / `schemastery` 按 0.1.5 的 peer 范围复核（参照 `docs/rescope.md` 的 vendor 改名映射表） | `npm install` 成功，`node_modules` 实测版本为 0.1.5-rc.2 |
| **A2 API 漂移修复** | 按 §1.2 漂移表逐包排查。**高危四包优先**：subagent(示例 15)、agent-loop(`runtime/harness.ts`)、llm(05/20)、session(18)。已知点：agent-presets 改名、`dsh-file-context` 变事件门插件、session format 版本 bump | `typecheck` 干净；`test` ≥7/7；26 个 `run.ts` 逐个跑通（`npm run all`） |
| **A3 覆盖面补全** | 新增示例 27–38（§3.1），每目录含 `index.ts` + `run.ts` + `README.md`，接入 `runtime/harness.ts` 与 `onboarding.mjs` | 新示例各自 run 通过；`typecheck` 干净；新增断言全绿 |
| **A4 文档与图谱重生成** | 用 `tools/graphify` 重建 `12-example-topology`（节点/边/社区数**必须是量出来的**）；更新 README 能力索引表与四条扩展路径分类；更新 `docs/okf/` 知识包（OKF v0.2，带来源与过期时间） | README 中每个数字都能由 IR JSON 复算；OKF 条目有 source + expiry |
| **A5 段落验收** | 全量门禁 + 冷启动复现（删 `node_modules` 重装重跑） | 见门禁 G2 |

### Segment B — iota-example（预估 7–10 人日）

| 任务 | 内容 | 出口判据 |
|---|---|---|
| **B0 环境与可安装性** | `uv venv` + `uv sync --extra dev`；确认私有 Nexus 凭证通路（R-02）；跑 iota-core 自带单元测试子集作为环境证明 | `import iota_core` 成功；`iota --help` 可执行 |
| **B1 装配枢纽** | 建 `runtime/harness.py` —— 对位 dsh-example 的 `runtime/harness.ts`：一处完成 registry + EffectStack + providers + capabilities 校验的装配 | 单一枢纽；示例只写自己那一个扩展点 |
| **B2 离线 kernel** | 写 `runtime/kernel_echo.py`：一个真实的 `KernelAdapter` 子类（非 mock 层），`register_adapter("echo", ...)`，产出确定性 `AgentEvent` 流 | 无网络、无 Hermes/Claude 依赖即可跑完一个 turn |
| **B3 示例 01–20** | 按 §3.2 对位表实现 | 每个示例可独立 `uv run python NN-*/run.py` |
| **B4 差异表** | `docs/dsh-vs-iota.md`：逐条对位 + **5 处 iota 无对应缝**的显式记录与理由 | 每条断言带 `文件:行` |
| **B5 闸门** | `ruff` / `mypy` / `pytest` 三闸门（对位 dsh 的 typecheck+test）：装配全部服务、跑一个真实 turn、核对 EffectStack 逆序回收与 fail-loud | 见门禁 G4 |

### Segment C — dsh-workshop（预估 4–6 人日 + 渲染机时）

| 任务 | 内容 | 出口判据 |
|---|---|---|
| **C0 主题 brief** | `uv run lusine-meta intake --brief dsh-workshop/topic-brief.json --answers ... --yes`，12 必答项全填 | `status: "confirmed"` |
| **C1 讲稿** | `dsh-workshop/01-scripts/`：三讲 —— ①dsh 架构与能力缝 ②iota 对位与差异 ③两者取舍与选型。每段旁白对应一页 slide，**每句论断标注可复现命令** | 讲稿中每条命令实测可跑 |
| **C2 presentation.json** | `dsh-workshop/02-decks/*/presentation.json`，遵守 `stats ≤ 4`/`nodes ≤ 5`/`eyebrow` 语义标签/路径相对 `public/` | `npm run check -- --presentation ... --brief ...` 通过 |
| **C3 配图** | 复用 A4 重生成的 graphify SVG（先 `git lfs pull`），必要处转 PNG；`alt` 必填 | `validate-media` 通过 |
| **C4 旁白** | 装 TTS 缺件（R-03 决策后）→ `voiceover --force` → `manifest` → `check` | 无静音页；音频时长与 manifest 一致 |
| **C5 出片** | `export:pptx` + `render`，输出到 `dsh-workshop/04-out/` | MP4 + PPTX 均生成，`verify` 全绿 |

---

## 3. 覆盖面设计（本规划的技术核心）

### 3.1 dsh-example：26 → 38，并显式声明不做什么

选择判据（不是「能覆盖就覆盖」）：**只有出现在教学叙事里的缝才补**；覆盖 71 个服务中架构叙事必需的部分，其余显式记录延后理由。

新增 12 个（27–38）：

| # | 目录 | 讲什么 | 主要接缝 |
|---|---|---|---|
| 27 | `27-mcp-server-tools` | 外部协议接入：MCP 工具进入同一个工具管线 | `packages/mcp` |
| 28 | `28-session-persistence` | 持久化缝 + **会话格式版本**（0.1.5 刚 bump 过） | `ctx.sessionPersistence`、`session-persistence-jsonl` |
| 29 | `29-session-query-trace` | 读侧：查询、trace、投影单元与投影缓存 | `ctx.sessionQuery`、`ctx.sessionProjections` |
| 30 | `30-storage-domain` | 非会话存储枢纽与域数据设施（json / sqlite 双后端） | `ctx.storage`、`ctx.storageDomain` |
| 31 | `31-todo-plan-mode` | 计划协作态与 todo：模型与人的共同工作面 | `ctx.planMode`、`ctx.todo` |
| 32 | `32-workflow-engine` | 脚本化编排与 agent 循环的关系 | `ctx.workflowEngine` |
| 33 | `33-webhook-runtime` | **0.1.5 新增能力**，规则驱动的外部事件入口 | `ctx.webhookRuntime` |
| 34 | `34-terminal-pty` | 持久 PTY 会话与一次性 shell 的区别 | `ctx.terminals`（对照 24） |
| 35 | `35-attachments-references` | 二进制附件、暂存上传、文件引用发现三者的分工 | `ctx.attachments` / `fileUploads` / `fileReferences` |
| 36 | `36-credentials-authorization` | 凭证缝与授权流（**只演示形状，不落任何真实密钥**） | `ctx.credentials`、`ctx.authorization` |
| 37 | `37-telemetry-invariants` | 遥测缝 + 包自持不变量注册表 | `ctx.sessionTelemetry`、`ctx.invariants` |
| 38 | `38-typert-api-gateway` | Host / Remote 三段式：运行期类型注册 + 网关调用 | `ctx.typert`、`ctx.typertGateway` |

**显式不做（写入 README，附理由）**：`client`（51 个包，UI 层——视频用录屏比代码示例有效）、`e2b` / `code-runtime`（需外部账号）、`experimental/agent-team`（实验期，接口会变）、`lsp`（需真实语言服务器，装配成本压过教学收益）、`spill` / `schedule` / `identity` / `guard`（内部机制，无独立可观察行为）。

### 3.2 iota-example：20 个示例 + 5 处显式空缺

| # | iota 示例 | 对位 dsh | iota 侧接缝 |
|---|---|---|---|
| 01 | 注册一个工具 / toolset | 01 | `registry.register` / `create_toolset` |
| 02 | agent spec 与提示装配 | 02 / 10 | `agent_spec.py`、`AgentConfig` |
| 03 | 节点钩子做策略门 | 03 | `graph/hooks.py` `NodeHookScope` |
| 04 | CLI 与 `/goal` 命令直通 | 04 | `cli.py`、`GOAL_COMMANDS` 能力 |
| 05 | **换内核**：注册一个 adapter provider | 05 ★ | `providers.register_adapter` |
| 06 | 事件流与 OTel span hook | 06 | `telemetry.py` `SpanHook` |
| 07 | 工具后端包装与审计 | 07 | `kanban_tool_backend`（仓库唯一三角色齐全的 seam） |
| 08 | 纯数据 skill 与同步 | 08 | `skills/`、`skill_sync`、`skill_square_loader` |
| 09 | **可逆注册**：EffectStack 逆序回收 | ★ cordis effect 对位 | `effects.py` |
| 10 | **声明式依赖**：provides / requires 装配期校验 | 11 / cordis inject | `capabilities.py` |
| 11 | entry-point 外部插件发现 | —（dsh 用 cordis.yml） | `iota_core.providers` 组 |
| 12 | config profile 投影 | 23 | `config_profiles/` |
| 13 | 存储后端可换（memory / file / redis） | 14 / 25 的 provider 形状 | `storage/backend_loader.py` |
| 14 | 记忆网关与作用域隔离 | —（iota 独有） | `memory/gateway.py`、`memory/scope.py` |
| 15 | 图运行时：编译 → 调度 → 执行 | 17（派发语义） | `graph/compiler` + `scheduler` + `engine` |
| 16 | checkpoint 与恢复 | —（iota 独有） | `graph/checkpoint.py`、`recovery.py` |
| 17 | 会话四元组隔离（realm 对位） | 11 / cordis isolate | `graph/session_manager.py` |
| 18 | run / conversation store | 18 | `storage/run_store.py` |
| 19 | 目标生命周期 | 22 ★ | `goals/manager.py`、`backend.py` |
| 20 | MCP server 暴露 | 27 | `mcp/server.py` |

**五处显式空缺（对比教学价值最高，必须讲）**：`ctx.sandbox` 无对位、HMR 明确不做、
`intercept` 配置原型链明确不做、`requires` 不满足时 iota **直接失败**而非停在 PENDING、
ContextVar 全量合并**取证后放弃**。每一处在 iota 文档里都有决策记录与理由，是「借机制，不搬架构」的实证。

---

## 4. 门禁（Gate）定义

无人工裁量，全部为可执行判据。任一 FAIL 即 HOLD，不得推进。

| Gate | 位置 | 判据 |
|---|---|---|
| **G0** | A0 后 | `git status --porcelain` 空；`git lfs pull` 完成且抽查 SVG 大小 > 130 B；基线 typecheck/test 输出已归档 |
| **G1** | A1 后 | `node -e "console.log(require('./node_modules/@deepseek-ai/dsh-tools/package.json').version)"` = `0.1.5-rc.2`；30 个依赖无一解析为 `latest`（即 0.0.1-rc.1） |
| **G2** | A2+A3+A4 后 | `npm run typecheck` 无输出；`npm test` 全 pass 且用例数 ≥ 基线 7；`npm run all` 38 个示例全部 exit 0；README 中每个图谱数字可由 IR JSON 复算 |
| **G3** | B0 后 | `uv run python -c "import iota_core"` 成功；`uv run pytest tests/unit -q` 通过率 ≥ 上游同 commit 基线 |
| **G4** | B3+B5 后 | `ruff check` 干净；`mypy` 干净；`pytest` 全绿；20 个示例 exit 0 且**全程无网络**（离线 kernel 生效） |
| **G5** | C0 后 | brief 满足 `schemaVersion:1` / `kind:topic-intent` / `status:confirmed`，12 项必答非空 |
| **G6** | C2 后 | `npm run check -- --presentation ... --manifest ... --public-dir ... --brief ...` 通过；无 slide 违反 `stats≤4`/`nodes≤5`；无绝对路径与 `..` 穿越 |
| **G7** | C4 后 | `voiceover` 全页通过 FFmpeg 电平检查（无静音）；`manifest` 时间轴与音频实测时长一致 |
| **G8** | C5 后 | `npm run verify` 全绿；MP4 与 PPTX 均产出；抽检 3 页画面/旁白/讲稿三者一致；讲稿内每条命令实测可跑；`lusine-a-reves` 工作区仍干净（未改 `example/`） |

---

## 5. 需求追溯矩阵

| 用户需求 | 落到的任务 | 验证门禁 |
|---|---|---|
| 依据最新 deepseek-harness 源码更新 dsh-example | A1、A2 | G1、G2 |
| 依据最新 cordis 源码更新 | A1（peer 范围 + `docs/rescope.md` 改名映射）、A2 之 17/26 复核 | G2 |
| 「全面体现架构思想和功能」→ 补全完善 | A3（26→38，含选择判据与显式不做清单）、A4 | G2 |
| 「一定要讲透彻」 | A4（OKF 知识包带来源与过期时间）、C1（每条论断标可复现命令） | G2、G8 |
| 依 iota-core 对标生成 iota-example | B1–B4 | G4 |
| 用 lusine-a-reves 生成讲稿与视频到 dsh-workshop | C0–C5 | G5–G8 |

---

## 6. 风险登记册

严重度 S1 = 阻断交付，S2 = 显著返工，S3 = 局部影响。

| ID | 风险 | S | 证据 | 处置 |
|---|---|---|---|---|
| **R-01** | 本机 `PYTHONHOME`/`PYTHONPATH` 被 `Lingxi-py.app` 污染，`/usr/bin/python3` 直接 `Fatal Python error: init_fs_encoding`；lusine `doctor` 已自诊断出该问题 | S1 | 实测复现 + doctor 输出原文 | 所有 Python 调用前 `unset PYTHONHOME PYTHONPATH`，或 `env -u PYTHONHOME -u PYTHONPATH`；PATH 优先 `/opt/homebrew/bin`。写进两个示例工程的 README 与脚本首行 |
| **R-02** | iota 私有依赖需 Nexus 凭证，`keyring-provider = "subprocess"` 会触发交互式取凭证；本 Agent 非交互且**禁止读取凭证文件** | S1 | `pyproject.toml:151-174`；Nexus 可达但鉴权未验证 | 由**用户**先在本机完成一次 `uv sync` 确认凭证可用，Agent 只消费已就绪的 `.venv`。鉴权不通过 → 触发决策点 D3 |
| **R-03** | TTS 缺件：`edge-tts` 未安装，`windows-sapi` 在 macOS 不可用，`qwen3-tts` 需外部模型 runtime | S1 | `command -v edge-tts` → MISSING | 需用户在 D4 选路。edge-tts 最省力但**会把讲稿文本发往微软在线服务**，内部技术内容需先评估合规 |
| **R-04** | 0.1.1→0.1.5 漂移达 4870 文件，A2 工作量可能低估，尤其 subagent(+2509/−1827) 与 agent-loop | S2 | §1.2 漂移表 | A2 按包切为 4 个可独立回滚的提交；先只升级 + 修 typecheck，行为差异留到 A2 尾段统一处理；若单包耗时超估 2 倍 → 触发 D1 降级为「保持 0.1.1-rc.2 + 只做 A3」 |
| **R-05** | `npm install <pkg>@latest` 会装到 `0.0.1-rc.1`（比现用更老），静默降级 | S2 | dist-tags 实测 | A1 一律写精确版本；G1 显式校验安装后版本 |
| **R-06** | session format 版本已 bump，示例 18 的日志不变量断言可能失效 | S2 | commit `fix: bump session format version` | A2 优先处理 18；把格式版本号本身变成断言 |
| **R-07** | `hello-olleh` 工作区脏 + SVG 为 LFS 指针，直接开工会污染 diff、图表渲染失败 | S2 | `git status` 多处 M/D | A0 前置，G0 拦截 |
| **R-08** | 误改 lusine `example/`（违反其 `AGENTS.md`） | S3 | AGENTS.md 明文禁止 | C 段命令强制带 `--presentation/--public-dir/--manifest` 指向 `dsh-workshop/`；G8 检查 lusine 工作区干净 |
| **R-09** | 渲染耗时不可控（Remotion + FFmpeg） | S3 | 本机已成功产出 6.6M MP4，链路可用 | C5 用后台任务落盘轮询；先渲 30 秒切片验证再全量 |
| **R-10** | 示例数量膨胀导致 26 个目录的既有可读性优势丧失 | S3 | 现有 README 的读法承诺：只读单个 `index.ts` + `harness.ts` | A3 严格维持「一个目录一种能力」；不得引入第二个装配枢纽；A4 用 graphify 复核 `createHarness` 仍是唯一枢纽 |

---

## 7. 配置管理与回滚

- **基线标签**：`baseline/dsh-example-0.1.1-rc.2`（A0）、`baseline/iota-example-empty`（B0）。
- **提交粒度**：A2 按包分 4 提交；A3 每个新示例 1 提交；B3 每个示例 1 提交。任一提交可 `git revert` 而不破坏门禁。
- **回滚触发**：任一 Gate 连续两次 FAIL → 回滚到上一绿标签，重新评估该任务方案，而非继续增量修补。
- **禁止事项**：不动 `sources/` 下的上游快照；不改 lusine `example/`；不提交 `node_modules`、`.venv`、`out/`、`build/`；不在任何交付物中写入密钥（示例 36 只演示凭证缝的形状）。
- **执行约定**：预计 > 30s 的命令一律后台落盘轮询，不用前台阻塞、不用 `&`/`nohup`。

---

## 8. 排期与关键路径

| 阶段 | 人日 | 关键路径 |
|---|---|---|
| A0 | 0.5 | ★ |
| A1 | 0.5 | ★ |
| A2 | 2–3 | ★ 最大不确定性（R-04） |
| A3 | 2–3 | 12 个新示例，可拆并行 |
| A4 | 0.5–1 | 依赖 A3 |
| B0 | 0.5 | 可与 A2 并行，但受 R-02 阻塞 |
| B1–B2 | 1.5–2 | ★ 离线 kernel 是 B 段地基 |
| B3 | 3–4 | 20 个示例，可拆并行 |
| B4–B5 | 2–2.5 | 依赖 B3 |
| C0–C2 | 2–3 | ★ 依赖 A4、B4 的图与结论 |
| C3–C5 | 2–3 | 受 R-03 阻塞 |
| **合计** | **17–24 人日** | 关键路径：A0→A1→A2→A3→A4→C0→C2→C4→C5 |

---

## 9. GO/NO-GO 决策点（需用户裁决，Agent 无法代决）

| ID | 决策 | 选项 | 影响 |
|---|---|---|---|
| **D1** | dsh-example 版本线 | ①升到 `0.1.5-rc.2`（对齐「最新源码」要求，含 4870 文件漂移风险）②保持 `0.1.1-rc.2`，只做 A3 覆盖补全（低风险，但不满足「依据最新源码」） | 决定 A1/A2 是否执行；直接决定 2–3 人日与主要返工风险 |
| **D2** | 示例规模上限 | ①26→38（本规划方案）②26→32（只补 27–32）③自定清单 | 决定 A3 与 B3 工作量、视频时长 |
| **D3** | iota-example 运行基线 | ①用户先本机 `uv sync` 打通私有 Nexus，示例真跑（对齐「无模拟层」原则）②不接私有源，示例只做静态可读 + 类型检查 | 选②则 iota-example 无法真跑，与 dsh-example 不对等 |
| **D4** | TTS 路线 | ①`edge-tts`（装 CLI，讲稿文本发往微软在线服务）②`qwen3-tts`（外部 runtime + 模型权重）③只出 `out/tts/plan.json` + PPTX，MP4 出无旁白版 | 决定 C4 可行性与合规面 |
| **D5** | 视频形态 | 讲数（建议 3 讲）、单讲时长、语言（建议中文）、是否含终端录屏 | 决定 C1/C2 页数与 brief 必答项内容 |

**默认建议**：D1① · D2① · D3① · D4①（若讲稿含内部信息改③） · D5 三讲 / 每讲 12–18 分钟 / 中文 / 含录屏。

---

## 10. 决策后的第一条指令

D1–D5 裁决后，立即执行 A0（唯一不依赖任何决策的任务）：

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

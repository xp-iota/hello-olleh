---
title: "代码结构地图"
---
# 代码结构地图

> **本篇回答**：374 个包怎么组织——二级目录结构、六类命名后缀的语义、依赖分层、以及"想改 X 该去哪个包"。
> **路径缩写**：`P/` = `packages/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：2.1–2.3 仓库全貌、命名规律与依赖分层 → 2.4–2.6 `core` 十包、`invariant.ts` 约定的废除与 61 个 `ui-*` → 2.7–2.10 `apps`/`bundle`、`scripts`、顶层配置与"想改 X 去哪"定位表。
>
> 📎 **来源**：本篇对应初版第 02 篇；主题与篇号保持不变。

## 2.1 仓库全貌

![仓库全貌](diagrams/02-codebase-map-diagram.svg)

**仓库全貌** — [交互版](diagrams/02-codebase-map-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-codebase-map-diagram.architecture.json)

- **组成**：顶层实测 11 个目录——`packages/`（53 组 / 374 包）· `apps/`（5 个产品装配）· `vendor/`（9 个 vendored 包）· `native/`（`native/system`）· `python/` · `benchmarks/` · `website/` · `snapshots/` · `patches/` · `docs/` · `scripts/`
- **关系**：能力全部在 `packages/`；`apps/` 只做产品装配；`native/`/`python/`/`website/`/`benchmarks/` 各管一条外围线（分工见 [索引 § 一 Monorepo 化](README.md)）
- **要点**：相比 0.1.5——`examples/` 已删除，新增 `apps/` 桌面端等 3 个 app、`benchmarks/`、`native/system`、`python/`、`website/`、`snapshots/`；执行世界从 `e2b` 组换成 `ssh` 组

`pnpm-workspace.yaml` 的 8 个 workspace glob：

| glob | 说明 |
|---|---|
| `vendor/*` | vendored 框架包（9 个） |
| `packages/*/*` | **二级结构**：组/包 |
| `native/system` + `native/system/packages/*` | Node 原生层（`landlock-run` + `flock`，独立发布序列） |
| `apps/*` | 产品装配层（`apps/cli` 拥有 `dsh` bin） |
| `benchmarks` | 仓库级基准依赖的私有包 |
| `website` | 文档站 |
| `python/sdk-runtime` | 单文件 exe 构建的依赖清单根 |

💡 **glob 的注释本身就是文档**：`native/system` 条目解释了"Landlock launcher 与 harness 消费者一起开发、但原生构建与发布脚本独立"；`python/sdk-runtime` 条目解释了"单文件 exe 的部署根是一份纯依赖清单，其闭包就是 exe 打包与 Python runtime 分发的内容"。0.1.5 时代的 `examples` glob（"只为依赖解析、NOT build targets"）已随 `examples/` 目录一起删除。

## 2.2 二级包结构与命名规律

**这是读 DSH 的第一把钥匙。** 包名后缀严格对应角色：

![包名后缀对应的角色（以 fs 组为例）](diagrams/02-naming-pattern.svg)

**包名后缀对应的角色（以 fs 组为例）** — [交互版](diagrams/02-naming-pattern.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-naming-pattern.architecture.json)

- **这是读 DSH 的第一把钥匙**：后缀严格对应角色，没有例外 · 看到 tool- 就知道它是模型可见的 · 看到 -policy 就知道它只监听事件
- **Provider 可以跨组**：fs-ssh 放在 ssh 组而不是 fs 组 · 因为它依赖 SSH 远端运行时 · 组织按依赖归属，不按接口归属（0.1.5 的例子是 e2b 组，rc.3 已由 ssh 组接棒）
- **一个定义可带多个消费者**：tool-fs 是通用读写 · tool-fs-search 专做搜索 · tool-str-replace-editor 专做精确替换

### 六类后缀

| 命名模式 | 角色 | 实例 |
|---|---|---|
| `<name>`（与组同名） | **Service Definition**：声明接口与事件 | `fs`、`shell`、`sandbox`、`llm`、`session`、`tools`、`agent`、`storage`、`jobs`、`skill`、`goal`、`terminal`、`lsp`、`spill`、`credentials`、`settings`、`workspace`、`compaction`、`subagent`、`workflow`、`attachment`、`subprocess`、`ssh`、`ptc-runtime` |
| `<name>-local` | **Provider**：本机实现 | `fs-local`、`subprocess-local`、`sandbox-local`、`jobs-local`、`storage-*`、`attachment-local`、`credentials-local`、`spill-local`、`bash-local`、`pwsh-local` |
| `<name>-sandbox` / `-ssh` / `-windows-acl` | **Provider**：其它执行世界 | `fs-sandbox`、`bash-sandbox`、`pwsh-sandbox`、`fs-ssh`、`subprocess-ssh`、`sandbox-ssh`、`sandbox-windows-acl` |
| `<name>-policy` | **Policy**：监听 capability 事件加策略 | `fs-observation-policy`、`sandbox-policy`、`spill-policy`、`session-checkpoint-policy`、`timeout-policy` |
| **`tool-<name>`** | **Consumer**：模型可见的工具 | 32 个 `tool-*`（实测）：`tool-fs`、`tool-bash`、`tool-pwsh`、`tool-lsp`、`tool-web`、`tool-skill`、`tool-todo`、`tool-goal`、`tool-jobs`、`tool-subagent`、`tool-office`、`tool-agent-team`、`tool-worktree`…（其中 `tool-executor-native`/`tool-executor-ptc` 是执行器包、`tool-testkit` 是测试支撑，不是模型可见工具；`tool-ralph`/`tool-terminal`/`tool-session-query` 已降级到 experimental 组） |
| `command-<name>` | **人类命令**（不经模型 turn） | `command-compact`、`command-feedback`、`command-goal` |
| `ui-<name>` | **前端**（client 组，61 个） | `ui-conversation`、`ui-settings`、`ui-tool`、`ui-plan`… |

💡 **定位方法**：想改"模型能看到的某个工具"→ 找 `tool-*`；想改"这个工具底层怎么执行"→ 找同组的定义包与 provider；想加"执行前的检查"→ 找 `*-policy` 或直接监听 capability 事件。

💡 **`tool-*` 与 provider 分离是 seam 设计的关键**。`tool-bash` 不知道命令跑在本机还是远端沙箱——它只调 `ctx.shell`。换 provider（`bash-local` → `bash-sandbox`）即改变执行世界，工具代码零改动。详见 [03 篇](03-capability-seams-and-services.md)。

## 2.3 依赖分层

![依赖分层：从 vendor 到能力包](diagrams/02-dependency-layers.svg)

**依赖分层：从 vendor 到能力包** — [交互版](diagrams/02-dependency-layers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-dependency-layers.architecture.json)

- **vendor 是重写过的上游**：包名与 import 被 rescope 到 deepseek-ai 作用域 · 版本固定在 cordis 4.1.0（上游 4.0.0-rc.11 的 fork）· 因此不能直接对照上游 cordis 源码行号
- **core 组现有十个包**：四个提供服务：sessions / tools / agents / agentLoop · system-prompt 提供提示组装 · scope 是纯库，没有 ctx key · tool-executor-native / tool-executor-ptc 是工具执行器 · agent-default-model / agent-tool-presentation 是两个小配置包
- **agent-loop 是可替换的**：它只是 ctx.agentLoop 的默认实现 · 换掉它就换掉整个 turn/step 语义 · 这是没有特权内核的最直接体现

💡 **注意"分层"是逻辑上的，不是强制的**。cordis 的插件系统里没有编译期的层次约束——所有包平等地挂在配置树上，激活顺序由**服务可用性**驱动（`dsh-base` 的 patch 注释明确说"Row order carries no load semantics (activation is service-availability driven)"）。上图是**依赖方向**的归纳，不是加载顺序。

## 2.4 `core` 组十个包

这是全仓最需要精读的 50758 行（`.ts` + `.tsx`，含 spec）。

| 包 | 行数 | `ctx` 键 | 职责 | 对应篇 |
|---|---|---|---|---|
| **`core/agent-loop`** | **17582** | `ctx.agentLoop` | 实现 `AgentFactory` 的默认驱动（turn/step） | [06](06-agent-loop-and-session-log.md) |
| **`core/session`** | **10336** | `ctx.sessions` | append-only `SessionEvent` 日志 + 内存 store + 格式版本（`SESSION_FORMAT_VERSION = 4`） | [06](06-agent-loop-and-session-log.md) |
| **`core/tools`** | **9181** | `ctx.tools` | 作用域化工具注册表 + 三段执行管线 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| **`core/tool-executor-ptc`** | 6925 | — | PTC 模式执行器：模型写代码调工具（原 Code Mode，含 py-types） | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| `core/agent` | 3477 | `ctx.agents` | `Agent` 接口 + 活动注册表 + `agent/*` 事件 | [06](06-agent-loop-and-session-log.md) |
| `core/system-prompt` | 1866 | `ctx.systemPrompt` | 提示分节 + 工具 schema 组装 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| `core/scope` | 997 | 无（库） | 每 agent 的作用域注册原语 | [03](03-capability-seams-and-services.md) |
| `core/agent-default-model` | 181 | — | 入口点创建 Agent 时的默认模型 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| `core/agent-tool-presentation` | 178 | — | 工具呈现方式选择 | [07](07-request-pipeline-llm-tools-and-prompts.md) |
| `core/tool-executor-native` | 35 | — | 模型直接调工具的执行器骨架 | [07](07-request-pipeline-llm-tools-and-prompts.md) |

0.1.5 的"七个包"在 rc.3 变成十个：新增 `tool-executor-native` 与 `tool-executor-ptc`（agent-loop 内的 tool-calls 调度逻辑被拆出成独立执行器包，Code Mode 更名 PTC 模式）。

### 逐文件明细

![core 四大包的逐文件规模](diagrams/02-core-files.svg)

**core 四大包的逐文件规模** — [交互版](diagrams/02-core-files.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-core-files.architecture.json)

- **读哪个文件先**：主循环看 agent-loop/src/agent.ts，751 行 · 工具注册看 tools/index.ts，412 行 · 日志投影看 session/index.ts，1555 行（core src 最大单文件）
- **tools 现为十个文件**：pipeline.ts 794 行做执行管线 · json-schema.ts 656、schema.ts 646 做校验 · contracts.ts 418 承载契约类型；0.1.5 的 py-types.ts / code-mode.ts 已随 Code Mode → PTC 更名迁到 `tool-executor-ptc`（py-types.ts 817 行）
- **session 的辅助文件值得看**：surface.ts 758 行做日志投影 · repair.ts 211 行做日志修复 · known-event-types.ts 收敛事件类型白名单；0.1.5 的 chunk-rows.ts 已随流式记账重写而删除

💡 **`agent.ts` 751 行是整个产品的心脏**——turn/step 循环全在里面（`turn()` `:333`、`preStep()` `:289`、`step()` `:441`）。全 core 最大的单文件（含测试）是 `tools/tests/tools.spec.ts`（3160 行）——契约主要活在测试里。

💡 **`*.generated.ts` 的现行例子**：`P/llm/llm-pi-ai/src/provider-data.generated.ts` 与 `P/util/official-bundles/src/catalog.generated.ts`——DSH 有一批脚本生成的源文件（`scripts/` 实测 `gen-*` 29 个、`verify-*` 82 个，生成与校验成对出现）。改这类文件要改生成器，不是改产物（0.1.5 的 `P/core/scope/src/scoped-events.generated.ts` 已删除）。

## 2.5 `invariant.ts` 约定已被废除

0.1.5 时代"每个包都有 `invariant.ts`"（全仓 219 个）是读 DSH 的一把快钥匙。**rc.3 把这个约定整体移除了**：`find packages -name invariant.ts` 实测为 **0 个**，配套的 `runtime-diagnostics` 组（含提供不变量框架的 `runtime-diagnostics/invariants` 包）也一并删除。

不变量没有消失，而是换了三种载体：

| 载体 | 位置 | 说明 |
|---|---|---|
| 防御模式文档 | `docs/defensive-patterns/`（6 篇英文 md，配 zh） | 逐主题写"绝对不能违反什么"（client-components、conversation-and-session 等），从单文件扩成目录 |
| 版本化会话格式 | `SESSION_FORMAT_VERSION = 4`（`P/core/session/src/types.ts:90`） | 事件代际的不变量由格式版本 + 迁移链保证；`AGENTS.md` 写明"已提交的代际不迁移、不覆盖、不删除"（版本状态见 `docs/session-format-status.md`） |
| spec 契约测试 | 各包 `tests/*.spec.ts` | 运行时断言并入各包 spec（如 `core/tools/tests/tools.spec.ts` 3160 行） |

💡 想快速知道某子系统"绝对不能违反什么"，0.1.5 读 `invariant.ts`，rc.3 读 `docs/defensive-patterns/` 对应主题 + 该包的 spec。[06 篇](06-agent-loop-and-session-log.md) 的"Model-visible means logged"不变量现在由 `core/session` 的格式版本纪律与 spec 共同承载。

## 2.6 `client` 组：71 个子包（61 个 `ui-*`）

396936 行，占 `packages/` + `apps/` 代码（1460227 行）约 27%。

| 基础设施子包（10 个） | 作用 |
|---|---|
| `client-connection` | 与 host 的连接 |
| `client-modules` | 模块注册 |
| `client-web` | Web 壳 |
| `client-hmr` | 前端热重载 |
| `client-locale` | i18n |
| `client-store` | 前端状态 |
| `client-resources` | 静态资源 |
| `client-shortcuts` | 快捷键 |
| `client-file-upload` | 文件上传 |
| `client-product-analytics` | 产品分析 |

（0.1.5 的 `client-runtime`、`client-web-react`、`client-schema-form` 已删除，职责并入 `client-web` 与 `ui-chat` 等域包。）

61 个 `ui-*` 子包按功能域切分：

```
ui-primitives · ui-layout · ui-theme · ui-slots · ui-sidebar（+ -browser / -files / -right / -terminal 等面板）
ui-conversation（对话主体）· ui-chat · ui-tool · ui-trajectory · ui-message-feedback
ui-input-trigger · ui-attachment · ui-commands · ui-context-menu
ui-settings + ui-settings-general / -models / -plugins / -plugin-inventory / -session-log / -shell / -subagent / -web-search 等
ui-model-selection · ui-agent-preset · ui-permission-presets · ui-approval
ui-plan · ui-goal · ui-workflow-run · ui-jobs · ui-schedule
ui-subagent · ui-skill · ui-workspace · ui-deliverables · ui-agent-team
ui-directory-picker-browse / -native · ui-user-questions · ui-secret-mask · ui-dockkit
ui-plugin-manager · ui-plugin-market · ui-session · ui-renderer
（另有 extensions 组的 ui-cordis 与 experimental 组的一批 client-ui-* 试验包）
```

💡 **前端也是插件化的**：加一个 Chat 节点 = 在 `P/client/ui-chat/src/client/conversation-nodes/` 注册节点 + 一个 keyed renderer（0.1.5 的 `docs/cookbook/adding-a-conversation-node.md` 已并入源码结构，该目录现含 assistant / tool / command / compaction / request-prompt 等节点）。详见 [09 篇](09-host-runtime-and-storage.md)。

## 2.7 `apps/` 与 `bundle/` 的分工

![apps 与 bundle 的分工](diagrams/02-apps-vs-bundle.svg)

**apps 与 bundle 的分工** — [交互版](diagrams/02-apps-vs-bundle.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-apps-vs-bundle.architecture.json)

- **base 用 insert，其余用 id 覆盖**：base 是唯一整体插入的 bundle（550 行、99 条 id）· web-app（620 行）与 headless（46 行）都按 id 改写既有行 · 另有 acp-app 23 / sdk-app 87 / sdk-minimal 179 三个新 bundle · 这正是 applyPatches 的两条路径
- **apps 现有五个**：cli 只负责 bin 入口与默认配置 · web 是 React 前端工程 · desktop / desktop-host 是 Electron 桌面端 · plugin-market-generator 生成插件市场目录 · 能力全部来自 bundle 叠出来的插件树
- **hmr 的开关在 base 里**：base 的 hmr 行按 `profileContext` 条件禁用（`disabled: !!js "!ctx.get('profileContext')"`，`base/cordis.patch.yml:28-30`）· web-app 另挂 `client-hmr`（`:222-223`）——0.1.5 "web-app 把 hmr 关掉"的写法已不成立

`bundle/base/package.json` 的全部 dsh 声明只有三行：

```json
{
  "name": "@deepseek-ai/dsh-base",
  "version": "0.2.2-rc.3",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

详见 [05 篇](05-startup-and-cordis-runtime.md)。

## 2.8 `scripts/`：374 个顶层条目的用途分类

![scripts/ 的四类用途](diagrams/02-scripts-taxonomy.svg)

**scripts/ 的四类用途** — [交互版](diagrams/02-scripts-taxonomy.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-scripts-taxonomy.architecture.json)

- **生成与校验成对出现**：gen- 的产物随后被对应的 verify- 脚本校验 · `scripts/` 实测 `gen-*` 29 个、`verify-*` 82 个 · CI 靠 verify 保证生成物未过期 · 改了源码忘记重新生成会被拦住
- **vendor 重写是一次性动作**：rescope-vendor.ts 负责改包名与 import · check-vendor-manifest.sh 校验清单一致 · V1–V14 差异清单记录在 `vendor/README.md`
- **门禁由 run-gates 聚合**：hygiene 不再是根 `package.json` 里的一长串 `&&`，而是 `"hygiene": "tsx scripts/run-gates.ts hygiene"`（`package.json:204`）统一调度（含 verify-cordis-config、verify-runtime-closure、module graph 校验等叶子门禁）；knip 与 0.1.5 的 `verify-package-invariants` 系列已退出

💡 **`doc-typecheck.ts` + `doc-budgets.manifest.json` + `verify-doc-budgets.ts` 值得注意**：DSH 对自己的文档做**类型检查**（代码块必须能编译）与**长度预算**。全仓 468419 行 markdown 能保持一致，靠的是工程手段而非人工。

## 2.9 顶层配置文件

| 文件 | 作用 |
|---|---|
| `tsconfig.json` + `tsconfig.base.json` + `tsconfig.node.base.json` + `tsconfig.base.client.json` + `tsconfig.client.json` + `tsconfig.host.json` | **6 份 tsconfig**：host（Node）与 client（浏览器）分开，rc.3 新增 node 基座 |
| `vitest.config.ts` + 另外 8 份 `vitest.*.ts` | **9 份 vitest 配置**：单元 / e2e / 快照 / expected / bench / web / web 性能 / web 压力（`vitest.shared.ts` 为共享基座），逐份的命令与用途见 [10 § 10.3](10-testing-and-engineering.md) |
| `tsdown.config.ts` | 打包器（tsdown = rolldown 系） |
| `pytest.ini` | Python SDK 的测试 |
| `lefthook.yml` | git hooks |
| `.oxlintrc.json` + `.oxlintrc.staged.json` | **oxlint**（Rust 写的 linter），另有 staged 专用配置 |
| `.jscpd.json` | 重复代码检测 |
| `.rgignore` | ripgrep 忽略规则 |
| `.github/workflows/` | **主 CI：33 个 GitHub Actions workflow**（ci / ci-master / ci-windows / e2e / sandbox / release(-publish) / python-release / node-addon-system(+release) / desktop-publish / build-exe-for-ssh-helper / pi-ai-provider-e2e / weighted-approval …） |
| `.gitlab-ci.yml`（191 行） | **仅用于 Python 包发布**：`workflow.rules` 限定 `$CI_COMMIT_TAG =~ /^python-v.../`，其余情况 `when: never` |
| `AGENTS.md` = `CLAUDE.md`（符号链接，189 行） | 给 agent 的仓库约定 |
| `THIRD_PARTY_NOTICES.md` | 第三方许可披露 |
| `BENCHMARK.md`（3 行）+ `benchmarks/` | 性能基准入口与语料（8 个场景 + support） |
| `SAFETY.md` / `BRAND_GUIDELINES.md` / `Makefile` | rc.3 新增：安全声明、品牌规范、顶层 make 入口 |

💡 **`.oxlintrc.json` 用 oxlint 而非 eslint**——对 146 万行代码，Rust linter 的速度差异是决定性的。

💡 **CI 是双轨的**：主 CI 在 GitHub Actions（`.github/workflows/` 33 个 workflow），而 `.gitlab-ci.yml` 只在打 `python-v*` tag 时触发，专管 Python wheel 的构建与发布（含版本一致性校验：tag 必须等于 `package.json` 的 version）。详见 [10 篇](10-testing-and-engineering.md)。

## 2.10 想改 X 该去哪：定位表

| 想做的事 | 去哪个包 |
|---|---|
| 加一个模型提供方 | 新建包，在 `ctx.llm` 上注册适配器（照 `P/llm/llm-deepseek` 抄；组内另有 llm-pi-ai、llm-deepseek-account、llm-deepseek-api-key 等路线包） |
| 加一个模型可见的工具 | 新建 `tool-<name>` 包，在 `ctx.tools` 注册 |
| 改工具的底层执行方式 | 该组的 provider 包（`*-local` / `*-sandbox` / `*-ssh`） |
| 加执行前后的检查/策略 | `*-policy` 包，或监听 `tools/*` / `fs/*` 事件 |
| 加一个人类命令（不走模型） | `command-<name>` 包，在 `ctx.commands` 注册（`P/interaction/commands`） |
| 改 turn/step 循环 | `P/core/agent-loop/src/agent.ts`（751 行）——但更可能应该用 `agent/*` 事件 |
| 加一种持久的会话状态 | 扩展 `SessionEventMap`（`P/core/session/src/types.ts:287`），并遵守 `SESSION_FORMAT_VERSION` 版本纪律 |
| 改提示词组装 | `P/core/system-prompt`（1866 行）或注册新的 prompt section |
| 加后台任务 | `ctx.jobs`（`P/jobs/jobs`），`job_*` 工具会收集 |
| 加前端 UI | 新建 `client/ui-<name>` 包 |
| 改启动组合 | `P/bundle/*/cordis.patch.yml`，或自己的 profile patch（六个 bundle、五个模板，见 [01 § 1.5](01-overview.md)） |
| 加一种 subagent 驱动 | `P/subagent/subagent-*`（组内已有 fork / spawn / claude-code / codex / acp / dsh-sdk 六种，experimental 另有 oar） |
| 加 SSH 远端执行世界 | `P/ssh/*`（fs-ssh / subprocess-ssh / sandbox-ssh / ssh / ssh-helper-runtime） |
| 加模型写代码运行时 | `P/ptc-runtime/*` + `P/core/tool-executor-ptc`（PTC 模式） |
| 加桌面端 | `apps/desktop` + `apps/desktop-host`（Electron） |
| 改沙箱策略 | `P/sandbox/sandbox-policy`，或换 `sandbox-local` / `sandbox-windows-acl` |
| 加 MCP 服务器接入 | `P/mcp/mcp-client`（组内另有 mcp-manager、mcp-resources） |

💡 **上游 `docs/architecture.md` 有一张更权威的"Where new behavior goes"表**（`:144` 起，22 行映射），本表是它的补充（按包定位而非按机制）。

---

**上一篇** ← [01 项目概览](01-overview.md) ｜ **下一篇** → [03 能力缝 Seam 与服务全景](03-capability-seams-and-services.md)：seam 的三角色模型、两级隔离、以及 seam 全表。

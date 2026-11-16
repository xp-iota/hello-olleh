---
title: "测试与工程实践"
---
# 测试与工程实践

> **本篇回答**：DSH 的质量保障体系——**逐文件 100% 覆盖率门禁（含覆盖率分区模式）**、2531 个 spec / 742352 行测试代码、9 份 vitest 配置、`snapshots/` 录制回放体系、33 个 CI workflow、以及 2724 篇 agent 设计笔记。
> **路径缩写**：`P/` = `packages/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：10.1–10.4 覆盖率门禁、vitest 配置与快照测试 → 10.5–10.7 `test-support`、invariant 约定的废除与多轨 CI → 10.8–10.11 命令清单、版本化迁移立场、`.agents/` 与文档门禁。
>
> 📎 **来源**：本篇对应初版第 24 篇；仅调整篇号与章节号，主题内容保持为测试与工程实践。

## 10.1 一个惊人的数字：测试占 51%

| 指标 | 数值 |
|---|---|
| spec 文件（`*.spec.ts` / `*.spec.tsx`） | **2531** |
| 其中前端 spec（`*.client.spec.*`） | **941** |
| **测试代码总行数** | **742352** |
| 全仓代码（`packages/` + `apps/`，`.ts` + `.tsx`） | 1460227 |
| **测试占比** | **≈ 51%** |

💡 **对比参照**：[cordis](../hello-cordis/README.md) 的测试/实现比是 1.08（4340 / 4015）。**DSH 的 51% 是"整仓级别"的比例**，量级上更惊人——而且是从旧版的 45% 继续涨上来的。

## 10.2 逐文件 100% 覆盖率门禁

`vitest.config.ts:429-437`（旧 `:273-279` 已位移，且**包了一层分区开关**）：

```ts
thresholds: coveragePartitionMode
  ? undefined
  : {
      perFile: true,
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
```

`coveragePartitionMode` 来自环境变量（`vitest.config.ts:159`）。`:425` 的注释直接说明态度：

> 100% or it doesn't merge (docs/testing.md: **excessive tests are welcome**).

![每文件 100% 覆盖率门禁](diagrams/10-coverage-gate.svg)

**每文件 100% 覆盖率门禁** — [交互版](diagrams/10-coverage-gate.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-coverage-gate.architecture.json)

- **门禁很硬**：项目口号是不到 100% 就不合并 · 四项指标语句、分支、函数、行全部要满 · perFile 让平均值失效
- **报告器给精确坐标**：输出形如 路径:行:列 的记录 · 覆盖语句、分支路径与函数三类 · 于是补测试不需要人工找位置
- **代价与收益**：代价是写测试成本高 · 收益是重构时几乎不会漏改 · 对 agent 驱动开发尤其重要

💡 **源码里能看到门禁的痕迹**：多处 `/* v8 ignore next -- ... */` 注释，且**必须写理由**。例如：
- `AL/agent.ts:290`：`/* v8 ignore next -- private callers establish the running phase before proposing a step */`
- `AL/agent.ts:442`：`/* v8 ignore next -- private callers establish the running phase before executing a step */`

**"忽略必须解释"是 100% 门禁能落地的关键**——否则会退化成到处 ignore。

### 10.2a 覆盖率分区：大仓库维持 100% 门禁的新工程手段

rc.3 引入**覆盖率分区模式**（`scripts/coverage-partitions.ts`，头注自述 "Coordinate single-worker Vitest coverage partitions and one merged report. Separate processes preserve worker isolation; only the complete merged inventory can enforce per-file coverage thresholds."）：

| 脚本 | 作用 |
|---|---|
| `scripts/coverage-partitions.ts` | 把全仓测试切成多个单 worker 分区、各自跑覆盖率，再合并成一份完整清单 |
| `scripts/run-coverage-partitions.ts` | 分区跑批入口 |
| `scripts/coverage-fork-diagnostics.ts` | 分区进程的诊断 |
| `scripts/coverage-exempt.ts` | 豁免重套件的清单（`coverageExemptHeavySuites`） |
| `scripts/coverage-canonical-locations.ts` | 规范化未覆盖位置 |

💡 **门禁语义从"一把梭"变成"全量或分区"**：单进程跑不动 2531 个 spec 时，分区各自跑、合并后仍按**完整清单**做逐文件 100% 判定——大仓库不稀释标准，只改执行方式。

## 10.3 九份 vitest 配置

| 配置 | 命令 | 用途 |
|---|---|---|
| `vitest.config.ts` | `pnpm run test` | 单元测试（+ `test:coverage` 门禁，可开分区模式） |
| `vitest.shared.ts` | — | 共享设置（`standardDecoratorPlugin`、`vitestExecArgv`） |
| `vitest.e2e.config.ts` | `pnpm run test:e2e` | **真实 API**；无 `DEEPSEEK_API_KEY` 时**自跳过** |
| `vitest.snapshot.config.ts` | `pnpm run test:snapshot` | **无密钥的回放**对比期望输出（+ `test:snapshot:refresh`，`package.json:75`） |
| **`vitest.expected.config.ts`** | — | **新**：owner 本地的期望输出测试（不依赖录制会话，见 § 10.4） |
| **`vitest.bench.config.ts`** | — | **新**：性能基准（见 § 10.4a） |
| `vitest.web.config.ts` | — | 前端 |
| `vitest.web.perf.config.ts` | — | 前端性能 |
| `vitest.web-stress.config.ts` | — | 前端压力（`apps/web/stress-tests/`） |

💡 **`standardDecoratorPlugin`（`vitest.shared.ts`）** —— DSH 用**标准装饰器**（TC39 stage 3），不是 TS 的 legacy decorators。`@Inject()`（[cordis 05 § 5.3](../hello-cordis/05-service-registration-and-dependency-resolution.md)）与 `@Remote()`（[09 § 9.37](09-host-runtime-and-storage.md)）都是标准形式。

💡 **`tsconfigPaths({ projects: ['./tsconfig.base.json'] })` 的注释很关键**：

> tsconfig.base.json has no include, which vite-tsconfig-paths treats as match-all, so its paths map applies to every test file. **paths must win over package exports so built `lib/` never loads a second module-singleton copy.**

**测试必须走源码而非构建产物**，否则会出现"两份模块单例"——在 384 包的 monorepo 里这是真实风险（cordis 的服务注册依赖单例，[cordis 05 § 5.4](../hello-cordis/05-service-registration-and-dependency-resolution.md)）。

## 10.4 快照测试：`snapshots/` 回放体系

| 命令 | 作用 |
|---|---|
| `pnpm run test:snapshot` | **无密钥**回放，对比期望输出；`-t <name>` 过滤 |
| `pnpm run test:snapshot:record` | **重录**期望输出（需要 key） |
| **`pnpm run test:snapshot:refresh`** | **新**：刷新期望输出（`DSH_SNAPSHOT=refresh`，`package.json:75`） |

rc.3 把录制数据集中到顶层 **`snapshots/`**（`acp/`、`sdk/`、`session/`、`web/` 四类，共 688 个 `.jsonl` 固定数据；`snapshots/AGENTS.md` 记录规则：`session[.vN].jsonl` 按**数值最高代**选择、相邻迁移链一次性组合——与会话格式迁移链共用同一套机制，[11 篇 § 11.1 链 6](11-call-chain-reference.md)）。

配套包（`P/test-support/`）：
- **`session-snapshot`**（**4796 行**，test-support 组最大；旧 `acp-snapshot` 已由它接替）
- `llm-replay`（1211 行）
- `llm-mock-server`（1018 行）

![录制回放式的确定性测试](diagrams/10-snapshot-testing.svg)

**录制回放式的确定性测试** — [交互版](diagrams/10-snapshot-testing.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-snapshot-testing.architecture.json)

- **三步闭环**：录制一次真实交互并入库 · CI 里无密钥回放 · 输出变了就是回归
- **依赖 replayState**：流式装配可以从录制数据重建 · 录制分片现在按 `assistant/attempt` 事件携带（[06 篇 § 6.6](06-agent-loop-and-session-log.md)）
- **四种形态都要覆盖**：ACP 与 SDK 面向自动化客户端 · session 与 web 面向人与前端 · 输出格式不同，因此分别快照

💡 **expected 快照体系**：`vitest.expected.config.ts` 头注自述 "Owner-local assembled expected-output tests that do not use a recorded session as their input"；配套 `.github/workflows/expected-filenames.yml` + `scripts/check-expected-filenames.sh` 校验期望文件命名约定。**"期望输出"不再只来自录制会话。**

### 10.4a `benchmarks/`：性能基准成为门禁

rc.3 新增顶层 **`benchmarks/`**（私有 workspace `@deepseek-ai/dsh-benchmarks`），按**用户路径**组织 8 个场景目录、10 个 `*.bench(.client).ts` 基准文件：

| 场景 | 主题 |
|---|---|
| `active-stream-reconnect` | 流断线重连 |
| `agent-continuation` | agent 续跑 |
| `conversation-fold` | 会话折叠 |
| `long-session-browser` | 长会话浏览器端 |
| `session-corpus` | 会话语料 |
| `session-open` | 会话打开 |
| `terminal-io` | 终端 I/O |
| `user-text` | 用户文本输入 |

配套：`vitest.bench.config.ts`、`scripts/run-bench-suite.ts`、`run-ci-bench.ts`、`run-memory-pressure-bench.ts`（在 4G/8G swapless cgroup 里复跑内存敏感基准，预算不变）、`support/machine-profiles.ts`（参考机预期与 CI 时间尺度分离）。

💡 **旧文档"上游不做性能分析"的印象在 rc.3 已不成立**：`benchmarks/AGENTS.md` 写明 "This tree owns required, repository-level performance gates"——基准是**必过的门禁**，预算常量写在源码里、环境变量不得覆盖，且 `node 24 / benchmarks` CI 作业会发布 `benchmark-report` 产物。

## 10.5 `test-support` 组的 8 个包

| 包 | 行数（src） | 作用 |
|---|---|---|
| **`session-snapshot`** | **4796** | 回放固定数据支持（接替 acp-snapshot） |
| `client-runtime` | 3112 | 前端运行时测试支持 |
| `llm-mock-server` | 1018 | Mock LLM 服务器 |
| `llm-replay` | 1211 | 回放录制的流 |
| `remote-mock` | 929 | **新**：远端（SSH 等）mock |
| `loader-smoke` | 375 | cordis loader 冒烟 |
| `agent-loop-testkit` | 211 | agent 循环测试工具 |
| `tool-testkit` | 92 | **新**：工具测试工具 |

💡 **`agent-loop-testkit` 与 `tool-testkit` 都只有一两百行**却存在 —— 说明测核心循环/工具的样板代码被抽出来了。**核心的测试成本被刻意压低。**

## 10.6 invariant 约定的废除

⚠️ **本章整节改写**：旧版记录的"219 个 `invariant.ts`"与框架本体 `runtime-diagnostics/invariants` 在 rc.3 **全部删除**（`find packages -name invariant.ts` → **0 个**；`packages/runtime-diagnostics` 组不存在；knip.json 也一并移除）。

rc.3 把"运行时不变量"交给了三类新载体：

| 载体 | 例子 |
|---|---|
| **文档化防御模式** | `docs/defensive-patterns/` 从单篇 md 扩成目录（client-components、conversation-and-session 等逐主题） |
| **类型系统即不变量** | `SessionEventMap` 声明合并 + `SESSION_FORMAT_VERSION` 校验（`S/index.ts:106-107` 版本不符直接抛错）；品牌类型（[09 § 9.42](09-host-runtime-and-storage.md)） |
| **fail-closed 代码约定** | goal-round-driver 的预约校验（[09 § 9.23](09-host-runtime-and-storage.md)）、`surfaceManager.validateNext`（[06 § 6.14](06-agent-loop-and-session-log.md)） |

💡 **旧结论的修正**：旧版说"invariant 验证运行时状态永不违反某条约束，与测试互补"。rc.3 的答案是把这类约束**上移进类型与 append-only 日志本身**——格式版本不对就拒绝读，而不是读进来再检查。

## 10.7 多轨 CI：33 个 workflow

![多轨 CI](diagrams/10-dual-ci.svg)

**多轨 CI** — [交互版](diagrams/10-dual-ci.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-dual-ci.architecture.json)

- **主测试轨**：`ci.yml` + 新增 `ci-master.yml`、`ci-windows.yml`（Windows 酒精级诊断单列）、`ci-python.yml` · e2e 与 `pi-ai-provider-e2e` 管端到端
- **平台/原生单列**：`sandbox.yml`、`node-addon-system.yml`（+`-release.yml`，旧 landlock-run 系列更名）、`desktop-publish.yml`/`desktop-rollout.yml`、`macos-*`、`windows-package.yml`、`build-exe-for-ssh-helper.yml`/`publish-ssh-helper.yml`
- **治理轨**：`expected-filenames.yml`、`weighted-approval`（带权审批）双 workflow、`issue-lifecycle`/`issue-policy`、`docs-pages.yml`；发布从 `dsh-v*` tag 手动 dispatch（`release-publish.yml`）

💡 **GitLab 轨仍在**：`.gitlab-ci.yml`（191 行，旧 129 行），双仓库持续集成共存。**E2B 相关 workflow 已随 `packages/e2b` 一起删除**——远端执行世界换成了 SSH（[08 篇](08-execution-services.md)）。

## 10.8 命令清单（`AGENTS.md`）

`AGENTS.md`（189 行）列了完整的开发命令：

| 命令 | 作用 |
|---|---|
| `pnpm run test` | vitest 单元测试 |
| **`pnpm run test:coverage`** | **CI 覆盖率门禁：`packages/*/*/src` 逐文件 100%**（可走分区模式） |
| `pnpm run test:e2e` | 真实 API；无 `DEEPSEEK_API_KEY` **自跳过** |
| `pnpm run test:snapshot` | 无密钥回放（+ `:record` / `:refresh`） |
| `pnpm run typecheck` / `lint` | |
| **`pnpm run duplication`** | **跨文件 TS 克隆检测**（jscpd） |
| `pnpm run build` | `tsc` 出 lib/types + `tsdown` 打包运行时 |
| `pnpm run hygiene` | **`tsx scripts/run-gates.ts hygiene`**（`package.json:204`）：publint + workspace 约束 + NodeNext 消费检查（**knip 已移除**） |
| `pnpm run check:windows-wine` | **仅在诊断已知 Windows 失败时**（需 wine）；CI 拥有这个信号 |
| **`pnpm run doc-sync`** | **全部文档门禁**（`tsx scripts/run-gates.ts doc-sync`，叶子清单在 `scripts/run-gates.ts`） |
| `pnpm run website:build` | 映射到 `docs:build`（`package.json:140`）：VitePress 构建 + `verify-doc-site-fragments`（**兼作死链检查**） |
| `pnpm dsh --profile headless "task"` | 从源码跑一个任务 |
| **`pnpm run demo:cordis`** | **"the agent modifies its own runtime"**（需 key） |
| `pnpm run demo:acp` | ACP 自动化服务器 |

💡 **`demo:cordis` 的描述是"agent 修改自己的运行时"** —— 这是 `tool-cordis`（11304 行 src，[04 § 4.4](04-extensions-and-ecosystem.md)）的演示。**自我修改是被当作正式能力演示的。**

## 10.9 版本化迁移时代（旧"pre-release 立场"的接棒）

旧版的 `AGENTS.md` 有一节标着"**Remove this section at the first tagged release**"，主张"地基优先于爆炸半径"、`SESSION_FORMAT_VERSION` 保持 `0`、读到旧格式直接拒绝。**rc.3 把这一节整体移除**，接棒的是新的一节 `## Pre-stable APIs and released Session data`（`AGENTS.md:5`）：

> Public APIs are pre-stable; update every consumer. Follow [version/status](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/session-format-status.md) and [type acknowledgements](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/cookbook/reviewing-persistence-type-changes.md). [Adjacent migration](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) may add a version-named successor but never move, overwrite, or delete committed generations; predecessors imply neither fallback nor downgrade support. SQLite uses monotonic `SCHEMA_VERSION`.

![版本化迁移时代的立场](diagrams/10-pre-release-stance.svg)

**版本化迁移时代的立场** — [交互版](diagrams/10-pre-release-stance.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-pre-release-stance.architecture.json)

- **承诺翻转了**：从"没有兼容承诺"到"已提交的代次永不移动、覆盖或删除" · 相邻迁移可以新增版本命名的后继格式，但不回退、不降级
- **承诺落在了数字上**：`SESSION_FORMAT_VERSION = 4`（`S/types.ts:90`）· v0→v1…v3→v4 五个相邻迁移包（[11 篇 § 11.1 链 6](11-call-chain-reference.md)）· 读到版本不符直接抛错（`S/index.ts:106-107`）
- **事实源成体系**：`docs/upgrade-guide/` 逐版本迁移指南（v0.1.7-rc.2 起 13 个版本目录）+ `docs/session-format-status.md`（区分"当前写入者、已接受的兼容基线、最新发布格式"）· 外部可感知的破坏性变更必须**立即**记进 upgrade guide（`AGENTS.md` 明文要求）

💡 **"pre-stable"是新的关键词**：不是 stable（公共 API 仍会破坏），但破坏被"版本命名的后继 + upgrade guide + type acknowledgements"管起来了。SQLite 仍用单调 `SCHEMA_VERSION`——数据库结构与会话格式的版本化是两条线。

## 10.10 `.agents/`：agent 驱动开发的产物

![agent 驱动开发的产物](diagrams/10-agent-notes.svg)

**agent 驱动开发的产物** — [交互版](diagrams/10-agent-notes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-agent-notes.architecture.json)

- **总量 2724 篇**：位于 .agents/notes/ 目录 · 按状态分 **implemented / archived / proposed / rejected** 四类（`proposed/` 与 `rejected/` 是 rc.3 新增的状态类，其中 proposed 96 篇、rejected 16 篇）
- **archived 也有价值**：记录了被放弃的方案与原因 · 避免重复走已验证的弯路 · simplification 类特别值得读
- **与官方 docs 的分工**：docs 讲契约是什么、怎么用 · notes 讲为什么这样决定 · 两者互补而不重复（`implemented/architecture/` 现 446 篇，是"为什么这样设计"的最大史料库）

💡 **`AGENTS.md` 里的"Host sandbox failures"一节**很有意思：它指导 agent 在"沙箱阻止了凭据/网络/IPC/文件监听/嵌套 sandbox-exec"时**先用最小的宿主提权重试**，并要求"require sandbox evidence; never bypass genuine test failures or the product sandbox under test"。**这是给 agent 写的操作规程。**

💡 **笔记也有治理脚本**：`scripts/verify-agent-note-classification.ts`、`archived-agent-notes.ts` 等校验笔记分类——设计笔记本身是被工程化管理的对象。

## 10.11 文档也有门禁

| 工具 | 作用 |
|---|---|
| `pnpm run doc-sync` | 全部文档门禁（`tsx scripts/run-gates.ts doc-sync`） |
| `scripts/doc-typecheck.ts` | **文档里的代码块必须能编译** |
| `scripts/doc-budgets.manifest.json` | **文档长度预算** |
| `pnpm run website:build` | VitePress 构建**兼作死链检查**（`verify-doc-site-fragments`） |
| `scripts/gen-*` + `verify-*` | 生成物一致性（[09 § 9.40](09-host-runtime-and-storage.md)） |

💡 **`docs/` 下 709 篇 md（含 352 篇中文对照、共 167089 行）能保持一致**，靠的是这套工程手段而非人工。⚠️ 旧版记录的 `.vale.ini` + `.vale/` 文风检查在 rc.3 已移除（根目录无 `.vale*`）。

💡 **`website/` 是"VitePress projection of selected bilingual docs/ sources"**——文档站是 `docs/` 的**投影**，不是独立副本（`website/package.json` 用 VitePress 1.6.4，`website:build` 走 `tsx website/build.ts`）。

---

**上一篇** ← [09 宿主与运行面：Web、网关、编排、存储、类型](09-host-runtime-and-storage.md) ｜ **下一篇** → [11 关键调用链速查](11-call-chain-reference.md)：六条核心链、事件全表、逐包符号表、症状路由。

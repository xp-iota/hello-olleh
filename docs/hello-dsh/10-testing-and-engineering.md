---
title: "测试与工程实践"
---
# 测试与工程实践

> **本篇回答**：DSH 的质量保障体系——**逐文件 100% 覆盖率门禁**、766 个 spec / 254848 行测试代码、7 份 vitest 配置、219 个 invariant、双轨 CI、以及 1372 篇 agent 设计笔记。
> **路径缩写**：`P/` = `packages/`。行号对应快照 `fb2c4b9e`。
>
> 🧭 **本篇导览**：10.1–10.4 覆盖率门禁、vitest 配置与快照测试 → 10.5–10.7 `test-support`、219 个 `invariant.ts` 与双轨 CI → 10.8–10.11 命令清单、pre-release 立场、`.agents/` 与文档门禁。
>
> 📎 **来源**：本篇对应初版第 24 篇；仅调整篇号与章节号，主题内容保持为测试与工程实践。

## 10.1 一个惊人的数字：测试占 45%

| 指标 | 数值 |
|---|---|
| spec 文件（`*.spec.ts` / `*.spec.tsx`） | **766** |
| 其中前端 spec（`*.client.spec.*`） | **254** |
| **测试代码总行数** | **254848** |
| 全仓代码（`.ts` + `.tsx`） | 564122 |
| **测试占比** | **≈ 45%** |

💡 **对比参照**：[cordis](../hello-cordis/README.md) 的测试/实现比是 1.08（4340 / 4015）。**DSH 的 45% 是"整仓级别"的比例**，量级上更惊人。

## 10.2 逐文件 100% 覆盖率门禁

`vitest.config.ts:273-279`：

```ts
thresholds: {
  perFile: true,
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100,
}
```

`:269` 的注释直接说明态度：

> 100% or it doesn't merge (docs/testing.md: **excessive tests are welcome**).

![每文件 100% 覆盖率门禁](diagrams/10-coverage-gate.svg)

**每文件 100% 覆盖率门禁** — [交互版](diagrams/10-coverage-gate.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-coverage-gate.architecture.json)

- **门禁很硬**：项目口号是不到 100% 就不合并 · 四项指标语句、分支、函数、行全部要满 · perFile 让平均值失效
- **报告器给精确坐标**：输出形如 路径:行:列 的记录 · 覆盖语句、分支路径与函数三类 · 于是补测试不需要人工找位置
- **代价与收益**：代价是写测试成本高 · 收益是重构时几乎不会漏改 · 对 agent 驱动开发尤其重要

💡 **源码里能看到门禁的痕迹**：多处 `/* v8 ignore next -- ... */` 注释，且**必须写理由**。例如：
- `SB/index.ts:159`：`/* v8 ignore next -- abstract service construction is covered through concrete provider packages. */`
- `AL/agent.ts:226`：`/* v8 ignore next -- private callers establish the running phase before proposing a step */`

**"忽略必须解释"是 100% 门禁能落地的关键**——否则会退化成到处 ignore。

## 10.3 七份 vitest 配置

| 配置 | 命令 | 用途 |
|---|---|---|
| `vitest.config.ts` | `pnpm run test` | 单元测试（+ `test:coverage` 门禁） |
| `vitest.shared.ts` | — | 共享设置（`standardDecoratorPlugin`、`vitestExecArgv`） |
| `vitest.e2e.config.ts` | `pnpm run test:e2e` | **真实 API**；无 `DEEPSEEK_API_KEY` 时**自跳过** |
| `vitest.snapshot.config.ts` | `pnpm run test:snapshot` | **无密钥的 ACP/headless 回放**对比期望输出 |
| `vitest.web.config.ts` | — | 前端 |
| `vitest.web.perf.config.ts` | — | 前端性能 |
| `vitest.web-stress.config.ts` | — | 前端压力（`apps/web/stress-tests/`） |

💡 **`standardDecoratorPlugin`（`vitest.config.ts:6`）** —— DSH 用**标准装饰器**（TC39 stage 3），不是 TS 的 legacy decorators。`@Inject()`（[cordis 05 § 5.3](../hello-cordis/05-service-registration-and-dependency-resolution.md)）与 `@Remote()`（[09 § 9.37](09-host-runtime-and-storage.md)）都是标准形式。

💡 **`tsconfigPaths({ projects: ['./tsconfig.base.json'] })`（`vitest.config.ts:19`）的注释很关键**：

> tsconfig.base.json has no include, which vite-tsconfig-paths treats as match-all, so its paths map applies to every test file. **paths must win over package exports so built `lib/` never loads a second module-singleton copy.**

**测试必须走源码而非构建产物**，否则会出现"两份模块单例"——在 219 包的 monorepo 里这是真实风险（cordis 的服务注册依赖单例，[cordis 05 § 5.4](../hello-cordis/05-service-registration-and-dependency-resolution.md)）。

## 10.4 快照测试：`test:snapshot`

| 命令 | 作用 |
|---|---|
| `pnpm run test:snapshot` | **无密钥**回放，对比期望输出；`-t <name>` 过滤 |
| `pnpm run test:snapshot:record` | **重录**期望输出（需要 key） |

配套包：
- `P/test-support/acp-snapshot`（**3162 行**，test-support 组最大）
- `P/test-support/llm-replay`（856 行）
- `P/test-support/llm-mock-server`（1031 行）

![录制回放式的确定性测试](diagrams/10-snapshot-testing.svg)

**录制回放式的确定性测试** — [交互版](diagrams/10-snapshot-testing.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-snapshot-testing.architecture.json)

- **三步闭环**：录制一次真实交互并入库 · CI 里无密钥回放 · 输出变了就是回归
- **依赖 replayState**：assembler 的 replayState 就是为此设计 · 它让流式装配可以从录制数据重建 · 见 [07 篇 § 7.6](07-request-pipeline-llm-tools-and-prompts.md)
- **两种形态都要覆盖**：ACP 面向自动化客户端 · headless 面向一次性 runner · 两者的输出格式不同，因此分别快照

## 10.5 `test-support` 组的 6 个包

| 包 | 行数 | 作用 |
|---|---|---|
| **`acp-snapshot`** | **3162** | ACP 快照 |
| `client-runtime` | 1517 | 前端运行时测试支持 |
| `llm-mock-server` | 1031 | Mock LLM 服务器 |
| `llm-replay` | 856 | 回放录制的流 |
| `loader-smoke` | 342 | cordis loader 冒烟 |
| `agent-loop-testkit` | 76 | agent 循环测试工具 |

💡 **`agent-loop-testkit` 只有 76 行**却存在 —— 说明测 agent 循环的样板代码被抽出来了。**核心循环的测试成本被刻意压低。**

## 10.6 219 个 `invariant.ts`

[02 § 2.5](02-codebase-map.md) 已列。核心几个：

| 包 | 行数 |
|---|---|
| `core/session` | **250** |
| `core/tools` | 128 |
| `core/agent-loop` | 63 |
| `core/system-prompt` | 60 |
| `core/scope` | 41 |
| `core/agent` | 32 |

框架本体：`P/runtime-diagnostics/invariants`（540 行，[04 § 4.8](04-extensions-and-ecosystem.md)）。

💡 **invariant 与测试的关系**：测试验证"给定输入产生正确输出"，invariant 验证"运行时状态永不违反某条约束"。**二者互补**——invariant 能在生产环境捕获测试没覆盖的路径。

💡 **一个具体例子**（`P/fs/fs/src/invariant.ts:23-27`，[08 § 8.3](08-execution-services.md)）：只对三个 `fs/*` 事件名生效，`fs/observed` 有额外形状检查。

## 10.7 双轨 CI

![双轨 CI](diagrams/10-dual-ci.svg)

**双轨 CI** — [交互版](diagrams/10-dual-ci.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-dual-ci.architecture.json)

- **公共轨覆盖的范围**：主测试与类型检查 · 端到端测试含 E2B 与自建 provider · Python 与原生组件的发布流程
- **沙箱相关单独成 workflow**：sandbox.yml 与 landlock-run 系列 · 因为它们需要特定内核能力 · 失败原因也与业务测试不同
- **文档也进 CI**：docs-pages 类 workflow 负责站点构建 · 生成物过期会被 verify 脚本拦住 · 于是文档与代码同步演进

## 10.8 命令清单（`AGENTS.md`）

`AGENTS.md`（149 行）列了完整的开发命令：

| 命令 | 作用 |
|---|---|
| `pnpm run test` | vitest 单元测试 |
| **`pnpm run test:coverage`** | **CI 覆盖率门禁：`packages/*/*/src` 逐文件 100%** |
| `pnpm run test:e2e` | 真实 API；无 `DEEPSEEK_API_KEY` **自跳过** |
| `pnpm run test:snapshot` | 无密钥回放 |
| `pnpm run typecheck` / `lint` | |
| **`pnpm run duplication`** | **跨文件 TS 克隆检测**（jscpd） |
| `pnpm run build` | `tsc` 出 lib/types + `tsdown` 打包运行时 |
| `pnpm run hygiene` | knip + publint + workspace 约束 + NodeNext 消费检查 |
| `pnpm run check:windows-wine` | **仅在诊断已知 Windows 失败时**（需 wine）；CI 拥有这个信号 |
| **`pnpm run doc-sync`** | **全部文档门禁**（叶子清单在 `scripts/run-gates.ts`） |
| `pnpm run website:build` | VitePress 构建（**兼作死链检查**） |
| `pnpm dsh --profile headless "task"` | 从源码跑一个任务 |
| **`pnpm run demo:cordis`** | **"the agent modifies its own runtime"**（需 key） |
| `pnpm run demo:acp` | ACP 自动化服务器 |

💡 **`demo:cordis` 的描述是"agent 修改自己的运行时"** —— 这是 `tool-cordis`（5984 行，[04 § 4.4](04-extensions-and-ecosystem.md)）的演示。**自我修改是被当作正式能力演示的。**

## 10.9 pre-release 立场

`AGENTS.md` 有一节标着"**Remove this section at the first tagged release**"：

> **Pre-release stance: foundation over blast radius**
>
> With no external consumers, prefer the correct foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

![发布前的地基优先立场](diagrams/10-pre-release-stance.svg)

**发布前的地基优先立场** — [交互版](diagrams/10-pre-release-stance.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-pre-release-stance.architecture.json)

- **为什么可以这么做**：发布前没有外部消费者需要照顾 · 保持地基整洁比维护兼容层价值更高 · 一旦发布这个立场就必须改变
- **拒绝而非迁移**：读到旧格式直接抛错，不尝试转换 · 于是不存在半迁移状态 · 错误信息明确指出版本要求
- **两种版本号的差异**：SCHEMA_VERSION 单调递增，用于数据库结构 · SESSION_FORMAT_VERSION 保持为 0 · 后者表示格式尚未冻结

## 10.10 `.agents/`：agent 驱动开发的产物

![agent 驱动开发的产物](diagrams/10-agent-notes.svg)

**agent 驱动开发的产物** — [交互版](diagrams/10-agent-notes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/10-agent-notes.architecture.json)

- **总量 1372 篇**：位于 .agents/notes/ 目录 · 按状态分 implemented 与 archived · 再按类型细分为五到六类
- **archived 也有价值**：记录了被放弃的方案与原因 · 避免重复走已验证的弯路 · simplification 类特别值得读
- **与官方 docs 的分工**：docs 讲契约是什么、怎么用 · notes 讲为什么这样决定 · 两者互补而不重复

💡 **`AGENTS.md` 里的"Host sandbox failures"一节**很有意思：它指导 agent 在"沙箱阻止了凭据/网络/IPC/文件监听/嵌套 sandbox-exec"时**先用最小的宿主提权重试**，并要求"require sandbox evidence; never bypass genuine test failures or the product sandbox under test"。**这是给 agent 写的操作规程。**

## 10.11 文档也有门禁

| 工具 | 作用 |
|---|---|
| `pnpm run doc-sync` | 全部文档门禁（叶子清单在 `scripts/run-gates.ts`） |
| `scripts/doc-typecheck.ts` | **文档里的代码块必须能编译** |
| `scripts/doc-budgets.manifest.json` | **文档长度预算** |
| `pnpm run website:build` | VitePress 构建**兼作死链检查** |
| `.vale.ini` + `.vale/` | 文风与术语检查 |
| `scripts/gen-*` + `verify-*` | 生成物一致性（[09 § 9.40](09-host-runtime-and-storage.md)） |

💡 **169055 行 markdown（含 105 篇中文）能保持一致**，靠的是这套工程手段而非人工。

💡 **`website/` 是"VitePress projection of selected bilingual docs/ sources"**（`AGENTS.md`）——文档站是 `docs/` 的**投影**，不是独立副本。

---

**上一篇** ← [09 宿主与运行面：Web、网关、编排、存储、类型](09-host-runtime-and-storage.md) ｜ **下一篇** → [11 关键调用链速查](11-call-chain-reference.md)：四条核心链、事件全表、逐包符号表、症状路由。

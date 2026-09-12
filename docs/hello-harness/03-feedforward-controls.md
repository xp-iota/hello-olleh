---
layout: content
title: "03 - 前馈控制"
---
# 前馈控制横向对比

前馈控制的核心逻辑是：**不要等 Agent 犯错再纠正，而是在行动之前把正确的约束、知识和流程注入它的上下文**。这里有一个隐含假设：如果你能预测哪类错误会发生，就能提前设计机制来防止它。这个假设不总是成立，但在编程 Agent 的场景里，很多错误是系统性的——跳过测试、变更未指定的文件、使用废弃 API——这些都可以通过前馈机制显著降低发生率。

我们把前馈控制分成计算型和推断型两个轴来分析，原因是它们的可靠性截然不同。计算型前馈（类型系统、Linter、Allowlist）是机械执行的，违反规则就会被拒绝；推断型前馈（AGENTS.md、Skill、Prompt 规范）依赖语言模型去理解并遵守，存在被忽略或误解的概率。一个成熟的 harness 应该先用计算型覆盖高风险操作，再用推断型处理计算型无法表达的复杂约束。

---

## 计算型前馈控制

### 类型系统严格度

类型系统是最便宜的计算型前馈：它在你编写工具代码时实时约束你，而不需要为此运行任何测试。一个严格的类型系统能让工程师在为 harness 添加新功能时，立刻发现接口不兼容或空值传播的问题。我们考察各工程的类型系统状况，是因为类型系统的有效性直接决定了 harness 的维护摩擦——类型系统失效的工程，每次改动都需要更多的手动验证。

#### Claude Code

`sources/claude-code/tsconfig.json` 是 Claude Code 类型系统状态的唯一真相来源，而这里的真相令人警醒：整个项目有约 1341 个 tsc 错误。这是反编译副作用造成的——源码在分发前被混淆和打包，反编译过程无法完美恢复类型信息。

运行时工具是 Bun，Bun 对类型错误比 tsc 更宽容，所以 Claude Code 能正常运行。但这意味着：类型系统作为前馈控制，在这个工程里已经实际失效。工程师向 Claude Code 添加新工具时，编辑器和编译器都无法提供可靠的类型安全保证。这是分析 Claude Code 时必须记住的基础事实，它的影响会渗透到后续所有维度的评估中。

#### Codex

`sources/codex/codex-rs/Cargo.toml` 声明了完整的 Rust 依赖树。Rust 的 borrow checker 是此次对比中最强的类型系统：它在编译期强制内存安全（无空指针、无数据竞争），这些保证不需要任何运行时代价，也不依赖测试覆盖率。

Rust 类型系统作为前馈控制的有效性是毋庸置疑的：如果一段代码能够通过 `cargo build`，它就不会产生整类型的运行时错误。这不是"减少了一些风险"，而是"在类型系统能覆盖的范围内，完全消除了这类风险"。代价是编译时间和学习曲线，但对 harness 的可靠性贡献是实质性的。

#### Gemini CLI

`sources/gemini-cli/packages/core/src/tools/tool-registry.ts` 的工具注册表用 TypeScript 接口定义了工具契约。TypeScript strict mode 在正常项目里是有效的前馈控制，但其有效性取决于两个条件：tsconfig 里严格标志是否全部开启，以及代码里有多少 `as any` 和 `@ts-ignore` 绕过了类型检查。总体评价是中等有效：比无类型更好，但比 Rust 的编译期保证弱得多。

#### OpenCode

OpenCode 使用 Zod 进行运行时验证，见 `sources/opencode/packages/opencode/src/permission/index.ts:19-24`。Zod 的关键区别在于：它是**运行时**验证，不是编译期验证。这意味着类型不合法的数据在被 Zod 检测到之前，仍然可以在代码里流动。Effect-ts 的类型系统提供了一定的编译期保证，但 `z.record(z.string(), z.any())` 这类宽松 schema 在实践中削弱了严格性。

**横向对比**：类型系统严格度排序为 Codex（Rust，编译期保证）> Gemini CLI（TypeScript，中等）≈ OpenCode（Zod，运行时）>> Claude Code（TypeScript 失效，~1341 错误）。这个排序向后渗透：越靠前的工程，harness 代码的维护摩擦越低。

### Linter 配置

Linter 是编辑期/提交期的计算型前馈：它在代码进入版本库之前，通过静态分析捕捉风格违规、潜在 bug 和反模式。对 harness 工程来说，Linter 的意义在于：它让 harness 代码本身保持一致性，降低"harness 代码变成 harness 负担"的风险。

**Claude Code**：无可见的独立 ESLint 或 Biome 配置。`tools.ts:14-135` 的条件导入（通过 feature flag）使静态分析更难有效工作，因为 Linter 无法知道哪些分支实际会执行。Linter 覆盖缺失，这与类型系统失效共同构成了计算型前馈工具链的双重缺失。

**Codex**：Rust 生态的 Clippy（通过 `cargo clippy`）提供超越标准 Lint 的语义分析，能检测常见 Rust 错误模式（如不必要的 clone、错误的迭代器使用）。Clippy 在 CI 里默认运行，覆盖质量在各语言生态里属于顶级。

**Gemini CLI**：无独立 Linter 配置可见。`confirmation-policy.test.ts` 等测试文件部分替代了 Linter 的角色——通过测试来保证行为边界正确，而不是通过静态分析来保证代码形式合规。测试和 Linter 不是等价的，但在实际效果上有部分重叠。

**OpenCode**：Bun 工具链包含基本格式化，但无独立 Linter。`ConfigMarkdown.parse()` 在 `skill/index.ts:72-102` 里对 Skill 文件 frontmatter 进行结构验证，是领域特定的结构 Lint，不覆盖通用代码质量。

### Pre-commit Hooks

四个工程都没有可见的 pre-commit hooks 配置。这个发现本身是有意义的：所有四个工程都没有在代码提交前强制执行最后一道计算型检查。在 harness 工程里，pre-commit hooks 的价值在于防止格式错误的规则文件进入版本库并成为 Agent 的有效输入。这是四个成熟 Agent 工具工程共同的盲区，也是最容易以低成本补充的前馈机制。

### 架构依赖约束

超出 Lint 之外，工程是否对模块间依赖关系有机械执行的架构约束？如果有，工程师在错误的位置调用服务时能立刻发现；如果没有，架构腐烂只能靠代码审查和人工约定来防止。

#### Claude Code

**证据**: `sources/claude-code/src/constants/tools.ts:36-112` — 工具 Allowlist

```typescript
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,
  EXIT_PLAN_MODE_V2_TOOL_NAME,
  // ...
])
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  // ...
])
```

这是工具级边界约束——有效且直接，但粒度较粗。模块间的服务依赖关系（哪个 Service 可以调哪个 Service）没有机械执行的保证，完全依赖约定。

#### Codex

`sources/codex/codex-rs/prompts/templates/permissions/approval_policy/` 的四种 approval policy 文件（`never.md`、`on_failure.md`、`on_request_rule_request_permission.md`、`unless_trusted.md`），加上 `execpolicy` 对 shell 命令的约束，构成两层正交约束：approval policy 管"何时需要人工批准"，exec policy 管"允许执行哪些命令"。两层不冗余，合在一起才覆盖完整的工具执行决策树。这是四个工程里架构依赖约束最系统化的实现。

#### Gemini CLI

`sources/gemini-cli/packages/core/src/core/prompts.ts:20-40` 的系统 prompt 组合是 prompt 级约束，不是代码级机械执行。工具调用的约束依赖 prompt 里的规则描述，而非代码层面的拦截机制。架构依赖约束中等。

#### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:292-307` 的 `Permission.disabled()` 函数静态分析工具列表，是 OpenCode 里最接近机械执行的架构约束，但粒度限于工具级，不覆盖模块服务依赖。

---

## 推断型前馈控制

推断型前馈依赖 Agent 读取自然语言规则并主动遵守它们。这不是弱控制，而是概率性控制——在大多数情况下有效，但不能在单次执行层面保证。它的优势是能表达计算型前馈无法量化的复杂约束（如"在重构前先理解代码意图"）。推断型前馈的质量，很大程度上取决于规则的写法：模糊的规则会产生模糊的遵守，这就是为什么结构化的规则文档比散文式文档更有价值。

### Skills/How-to 机制

Skill 是推断型前馈的核心载体：它告诉 Agent"遇到这类任务要这样做"，把团队的最佳实践注入 Agent 的任务执行流程，而不是依赖 Agent 从零开始推断。Skill 的存在意义在于：经验可以被显式化、版本化、复用，而不是只活在工程师的头脑里。

**Claude Code**：`src/tools/SkillTool/` 实现了 Skill 工具，在 `tools.ts:212` 注册。Skill 通过 CLAUDE.md 的 @include 引用链注入，没有独立的版本化管理机制。Skill 和普通上下文文件耦合在同一套加载体系里，无法单独审计 Skill 覆盖范围。

**Codex**：`sources/codex/.codex/skills/` 目录提供基于 frontmatter 的结构化 Skill 定义（`sources/codex/codex-rs/skills/src/assets/samples/skill-installer/SKILL.md`）。frontmatter 定义了 Skill 的元数据（名称、触发条件、版本），使 Skill 库的管理有结构可循，比自由格式更规范。Skill 文件是独立的版本化资产。

**Gemini CLI**：`activate-skill.ts` 的 `ActivateSkillTool` 把 Skill 建模为"Agent 可主动激活的工具"，而不是"隐式注入的上下文"（`snippets.ts:107-115`）。这要求 Agent 先识别需要哪个 Skill 再调用 `ActivateSkillTool`，增加了一层推断，但也让 Skill 的使用在对话记录里更可见、可审计。

**OpenCode**：`skill/index.ts:1-262` 是四个工程里最完整的 Skill 系统实现：Zod Schema 验证结构合法性，glob 目录扫描支持多种约定路径，URL 远程拉取支持跨仓库 Skill 共享，且有失效回退逻辑（`add()` 函数里的 try-catch）。URL pull 是特别值得注意的能力：它允许团队把 Skill 库独立维护在另一个仓库，实现 Skill 版本化和跨项目复用。

### AGENTS.md 的 ToC vs 百科全书结构

规则文件的结构影响 Agent 对它的遵守质量——这不是抽象的，而是可以量化的：一份有清晰目录、每条规则独立成段的文档，Agent 从中提取和遵守规则的准确率高于散文式长文档。我们分析各工程的规则文件结构，是因为"文件写了什么"和"Agent 从文件里能提取出什么"之间有一个执行摩擦，这个摩擦可以通过结构改善。

**Claude Code**：实现代码 `claudemd.ts` 是 1166 行单文件，体现了一种百科全书式的文化倾向。实际的 CLAUDE.md 文件没有强制结构约定，内容质量完全取决于写作者的意识。对 Agent 来说，从无结构的长文档提取规则比从有目录的分节文档提取的准确率更低。这是 Claude Code 推断型前馈质量的隐性短板。

**Codex**：`default.md` 的 276 行按主题分节（Personality → AGENTS.md spec → Responsiveness → Planning → Task execution → Validating），每个节都有明确的 `##` 标题。Agent 可以通过标题快速定位相关规则，而不必解析整个文档。这是四个工程里规则文档最结构化的实现。

**Gemini CLI**：`snippets.ts` 的 Snippet 函数组合是更激进的 ToC 结构：每个主题是独立的函数，有独立参数类型。不同主题的规则在代码层面完全隔离，可以独立修改和测试。这是"把 prompt 当代码"的极致实现。

**OpenCode**：Skill 文件有强制的 frontmatter 结构（由 Zod Schema 验证），保证了基本格式一致性。但 Skill 文件内容结构没有约定，工程师仍然可以写成散文格式。

### 文档即规约的完备程度

推断型前馈的最终效果，取决于规则文档的规约完备性：是否清楚地说明了期望的行为、不期望的行为、判断的优先级？规约不完备的文档，会让 Agent 在边界情况下产生难以预测的行为。

**Claude Code**：规约完备程度高（四层文件体系有详细加载语义），但组织形式是百科全书式——大量规则混在一起，缺少优先级标记，Agent 在边界情况下需要自行推断哪条规则优先。

**Codex**：`sources/codex/docs/agents_md.md` 是给工程师读的 AGENTS.md 规范，`default.md` 里的 AGENTS.md spec 是给 Agent 读的同一套规范。两个受众的文档分开维护——这是规约完备性最高的实现，也是其他三个工程应该借鉴的模式。

**Gemini CLI**：`snippets.ts:188-191` 的关键权衡注释（`// ⚠️ IMPORTANT: the Context Efficiency changes strike a delicate balance...`）解释了为什么这段代码必须保持现状，以及改动的前置条件。这是部分规约——覆盖了"为什么"，但没有专门的规约文档。

**OpenCode**：`permission/index.ts` 的 Zod Schema 和类型定义把规约写进了代码里，避免了文档和代码不同步的问题。但对不熟悉 Effect-ts 的工程师来说，读代码比读文档更难快速理解规约的全貌。

---

## 横向对比表：三维前馈覆盖评分

| 工程 | Maintainability | Architecture Fitness | Behaviour |
| :------| :-----------------| :---------------------| :-----------|
| Claude Code | **3** — 分层文件体系完整，但类型系统失效，百科全书结构削弱规约清晰度 | **3** — Feature flag + 工具 Allowlist，但 feature() 始终 false | **2** — VerifyPlanExecutionTool 存在但 feature-flagged |
| Codex | **4** — Rust 类型 + Clippy + AGENTS.md 规范完备 | **4** — Approval policy + Exec policy 双层机械执行 | **4** — 两阶段记忆管道 + outcome 标签实现持续行为约束 |
| Gemini CLI | **4** — vitest + 29+ eval 文件全覆盖 | **3** — Snippet 函数边界清晰，但无跨模块机械执行约束 | **3** — Hook System 提供生命周期约束 |
| OpenCode | **3** — Effect-ts + Zod 结构验证 | **3** — Effect Layer 强制依赖注入，Permission Schema 清晰 | **3** — Permission 即代码，但无持续漂移检测 |

**核心发现**：前馈机制的有效性上限由[控制平面](./02-control-plane.md)的显式度决定。Codex 控制平面最透明，四个前馈维度都有实质性实现；Claude Code 控制平面的 feature flag 体系因反编译失效，直接导致 Behaviour 维度的前馈评分最低。接下来的[反馈控制](./04-feedback-controls.md)，关注的是当前馈防线被穿透之后，工程如何发现和纠正。

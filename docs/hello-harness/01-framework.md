---
layout: content
title: "01 - 理论框架总览"
---
<!-- markdownlint-disable MD060, MD024 -->

# Harness Engineering 理论框架在四工程中的映射

Harness Engineering 是一个观察 Agent 系统**可控性**的分析框架。它的核心主张是：一个 AI 编程工具能走多远，不取决于它的模型有多强，而取决于工程师能在多大程度上**看见、影响、纠正**它的行为。框架借用控制论的两个轴来组织这种观察：前馈（Feedforward）与反馈（Feedback）是第一个轴，描述干预发生的时机；计算型（Computational）与推断型（Inferential）是第二个轴，描述传感器的工作方式。

这两个轴之所以被选中，是因为它们覆盖了 Agent 可控性的全部空间，而不重叠冗余。前馈是"在 Agent 行动之前给它正确的约束和知识"，反馈是"在行动之后检测问题并纠正路径"；计算型传感器是"用代码机械执行的规则"，推断型传感器是"用语言或模型判断"。四个象限之间没有对错，只有不同工程选择的组合。本文档的任务，就是把四个真实工程的源码事实映射到这个框架，看清楚每个工程到底站在哪里。

---

## 2. 前馈（Feedforward）与反馈（Feedback）二元

前馈控制的逻辑是：与其等 Agent 犯错再纠正，不如提前把正确的信息、约束、流程注入它的上下文。反馈控制的逻辑恰好相反：接受 Agent 会犯错的现实，在它犯错后尽快检测并提供修正信号。两种策略都必要，因为前馈无法穷举所有情况，而纯反馈的代价又太高。

我们关注这个维度，是因为一个工程在前馈/反馈上的选择，直接决定了它的 Steering Loop 是主动还是被动、是结构化的还是临时性的。下面看四个工程各自的证据。

### Claude Code

Claude Code 的前馈控制中枢是 `sources/claude-code/src/utils/systemPrompt.ts:41-123` 中的 `buildEffectiveSystemPrompt()` 函数。这个函数定义了四个优先级层次，并按照"后加载的内容对模型影响更大"的原则组合。真正值得注意的是 `sources/claude-code/src/utils/claudemd.ts:790-1074` 中的 `getMemoryFiles()` 实现：它把磁盘上的 CLAUDE.md 文件分四层加载（Managed → User → Project → Local），并支持 `@include` 指令做跨文件引用。这是一套完整的前馈知识分发体系。

反馈方面，Claude Code 的主循环在 `sources/claude-code/src/query.ts` 里，工具调用的结果直接回传模型，没有独立的结构化报告层。`sources/claude-code/src/utils/hooks/postSamplingHooks.ts` 提供了采样后 Hook，但触发条件和实际在生产中的状态需要结合 feature flag 系统来判断（详见下文 §10）。

### Codex

Codex 的前馈控制完全依赖 Markdown 模板文件。`sources/codex/codex-rs/protocol/src/prompts/base_instructions/default.md:1-275` 是一份 275 行的结构化行为规范，涵盖人格、AGENTS.md 语义、规划流程、验证要求等。这与 Claude Code 的 TypeScript 硬编码形成对比：Codex 的前馈内容是版本化的、可差量审查的、对人类工程师透明的。

反馈方面，Codex 最重要的机制是两阶段记忆管道。`sources/codex/codex-rs/memories/write/templates/memories/stage_one_system.md` 的 Phase 1 并行提取每次 rollout 的结构化输出，`consolidation.md` 的 Phase 2 整合这些输出并维护一个带 `max_unused_days` 窗口的知识库。这不是普通的"工具返回值注入上下文"，而是主动的、跨 session 的反馈回路。

### Gemini CLI

Gemini CLI 的前馈控制通过 `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts:38-265` 的 `getCoreSystemPrompt()` 以函数组合方式构建。每个片段（preamble、coreMandates、hookContext 等）都是独立的 snippet 函数，这使得 prompt 内容本身成为可以单元测试的代码。这是四个工程里最接近"prompt-as-code"理念的实现。

反馈方面，`sources/gemini-cli/packages/core/src/hooks/hookSystem.ts:259-305` 实现了完整的 BeforeModel/AfterModel 生命周期，且 `hookOutput?.shouldStopExecution()` 提供了显式的执行阻断路径。更重要的是，Gemini CLI 拥有 29+ 个 eval 文件（`sources/gemini-cli/evals/*.eval.ts`），这意味着它的反馈机制不仅在运行时生效，还在开发期以自动化测试的形式存在。

### OpenCode

OpenCode 的前馈控制通过 `sources/opencode/packages/opencode/src/skill/index.ts:1-262` 实现的 Skill 系统传递。Skill 文件通过 SKILL.md + Zod Schema 定义结构，由 `Config.directories()` 决定扫描路径。这是声明式的前馈：规则不写在代码里，写在目录里。

反馈方面，`sources/opencode/packages/opencode/src/permission/index.ts:1-322` 的 Permission 系统通过 `ask()` 方法暂停执行并等待用户判断。这是一种人工参与的反馈，而非自动化反馈。Effect-ts 的 `Deferred.await()` 模型保证了不会有竞争条件，但也意味着每次反馈都需要人类在场。

### 横向对比：前馈/反馈的时序质量

四个工程都有某种形式的前馈，但质量差异显著。Codex 的前馈是最透明的（Markdown 文件，可审查），Claude Code 的前馈是最完备的（四层文件体系），Gemini CLI 的前馈是最"可测试"的（snippet 函数可单元测试），OpenCode 的前馈是最声明式的（目录扫描）。

反馈的差异更大：只有 Codex 实现了**跨 session** 的主动反馈（Phase 1/2 记忆管道），其余三个工程的反馈都是 within-session 的被动响应。这个差距，是后续熵管理评分（§08）的主要来源。

---

## 3. 计算型与推断型两轴

这里的区分关系到一个核心问题：当 Agent 产生了有问题的输出，谁来发现它？如果是编译器或 Linter 发现，那是计算型传感器——快速、确定性、无歧义。如果是另一个模型或提示词规则来判断，那是推断型传感器——灵活、可以处理复杂场景，但有概率出错，且成本更高。我们分析两轴的分布，是因为过度依赖推断型传感器的工程，其控制质量会随着使用规模的增长而退化。

### Claude Code

Claude Code 的计算型传感器理论上应该是 TypeScript 类型系统。但 `sources/claude-code/tsconfig.json` 的实际状态揭示了一个重要事实：反编译过程留下了约 1341 个 tsc 错误，导致类型系统作为前馈控制基本失效。这不是工程设计的问题，而是反编译副作用的现实。工具注册在 `sources/claude-code/src/tools.ts:193-250` 的 `getAllBaseTools()` 里是静态枚举，作为计算型约束是有效的。

推断型传感器方面，`sources/claude-code/src/services/toolUseSummary/toolUseSummaryGenerator.ts` 通过 LLM 生成工具使用摘要，这是典型的推断型传感器。

### Codex

Codex 的计算型传感器是四个工程里最强的：Rust 的 borrow checker 在编译期强制内存安全，`sources/codex/codex-rs/core/src/config/schema.md` 的配置 Schema 在启动时强制配置合规。这些传感器的特点是零成本（不需要在运行时执行任何额外逻辑）且确定性（编译通过 = 不会出现整类错误）。

推断型传感器以 `sources/codex/codex-rs/memories/write/templates/memories/stage_one_system.md` 为代表：Phase 1 的任务是从 rollout 历史里"提取记忆"，这是一个需要模型理解和判断的任务，无法用机械规则替代。

### Gemini CLI

Gemini CLI 的计算型传感器包括工具注册表 `sources/gemini-cli/packages/core/src/tools/tool-registry.ts` 和确认策略测试 `sources/gemini-cli/packages/core/src/tools/confirmation-policy.test.ts`。测试作为计算型传感器是一个值得注意的设计选择：测试能在 CI 阶段机械地检测出行为退化，而不需要人类观察每次 Agent 运行。

推断型传感器以 `sources/gemini-cli/packages/core/src/hooks/hookPlanner.ts` 为代表，以及 29+ eval 文件里的 LLM-as-Judge 模式。

### OpenCode

OpenCode 的计算型传感器主要是 Zod Schema 验证，见 `sources/opencode/packages/opencode/src/permission/index.ts:19-24` 和 `sources/opencode/packages/opencode/src/skill/index.ts:28-34`。Zod 验证是运行时的，不是编译期的，这是与 Rust/TypeScript strict 的本质区别。Effect-ts 的类型系统提供了一定的编译期保证，但 `z.record(z.string(), z.any())` 这类宽松 schema 削弱了其有效性。

### 横向对比：计算型/推断型的成本与可靠性

计算型传感器的优势是可靠性和零成本，推断型的优势是处理复杂场景的能力。Codex 向计算型倾斜最重（Rust borrow checker），OpenCode 向运行时推断型倾斜（Zod + Effect），Claude Code 的计算型传感器因反编译失效而实际偏低，Gemini CLI 用测试套件量化了推断型传感器的覆盖范围。后续的可驾驭性评分（§07）直接来自这里的观察。

---

## 4. 三类 Regulation 维度

Harness Engineering 借鉴软件质量保证的分层概念，把控制行为分为三类：Maintainability（维护性，代码库能被修改而不引入错误）、Architecture Fitness（架构适配性，系统能在演进中保持约束）、Behaviour（行为性，Agent 在运行时按预期行事）。我们记录这三个维度，是为了区分"写代码时的哈内斯"和"运行时的哈内斯"——两者都必要，但很多工程只有其中一个。

### Claude Code

| 维度 | 实现 | 证据 |
| :------| :------| :------|
| Maintainability | 分层 CLAUDE.md + .claude/rules/ 目录 | `claude-md.ts:1-26` |
| Architecture Fitness | feature flag 系统 | `sources/claude-code/src/tools.ts:14-135`（但 feature() 始终 false） |
| Behaviour | VerifyPlanExecutionTool | `process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'`（反编译环境下不触发） |

### Codex

| 维度 | 实现 | 证据 |
| :------| :------| :------|
| Maintainability | Rust 类型系统 + clippy | `codex-rs/Cargo.toml` |
| Architecture Fitness | approval policy 四模式 | `unless_trusted.md`、`on_failure.md` |
| Behaviour | 两阶段记忆管道 + outcome 标签 | `stage_one_system.md:1-569` |

### Gemini CLI

| 维度 | 实现 | 证据 |
| :------| :------| :------|
| Maintainability | vitest 测试 + 29+ eval 文件 | `sources/gemini-cli/evals/*.eval.ts` |
| Architecture Fitness | 模型选择约束 + Snippet 函数边界 | `config.ts`、`models.ts` |
| Behaviour | Hook System BeforeModel/AfterModel | `hookSystem.ts:149-444` |

### OpenCode

| 维度 | 实现 | 证据 |
| :------| :------| :------|
| Maintainability | Bun + TypeScript strict | `sources/opencode/tsconfig.json` |
| Architecture Fitness | Effect-ts Layer 模式 | `permission/index.ts:138` |
| Behaviour | Permission 即代码（allow/deny/ask） | `permission/index.ts:292-307` |

这个对比揭示了一个模式：Codex 和 Gemini CLI 在三个维度上都有可观察的实现，Claude Code 的 Architecture Fitness 和 Behaviour 维度因反编译副作用而失效，OpenCode 的 Maintainability 和 Architecture Fitness 强，但 Behaviour 维度过度依赖人工决策。

---

## 5. 质量左移的时序分布

"左移"（Shift-Left）是说：越早发现问题，修复成本越低。我们把质量检查线分为三个层次：Level 1 是启动时/编译时（成本最低），Level 2 是测试时/CI 时，Level 3 是运行时的持续监控（成本最高，但能捕捉运行时漂移）。一个成熟的 Harness 工程应该在三个层次都有覆盖，而非只依赖运行时观察。

### Claude Code

- **Level 1（启动时）**: `sources/claude-code/src/utils/claudemd.ts:537` — MAX_INCLUDE_DEPTH = 5，防止 @include 循环引用。这是一个有效的启动时检测，但范围非常窄。
- **Level 2（测试时）**: 无原生 CI 配置可见，依赖上游构建系统。
- **Level 3（运行时持续监控）**: 无后台 GC 机制。memoize 缓存一旦建立不会自动失效，文档漂移无法被检测。

### Codex

- **Level 1（启动时）**: `sources/codex/codex-rs/prompts/templates/permissions/approval_policy/unless_trusted.md:1` — 默认拒绝策略在启动时即生效，无需运行 Agent 才能确立安全边界。
- **Level 2（测试时）**: Phase 1/2 记忆管道本身是一种测试：每次 rollout 后，记忆提取结果都会被验证结构化合规。
- **Level 3（运行时持续监控）**: 持续记忆整合是唯一实现 Level 3 的工程。`consolidation.md` 的 `max_unused_days` 窗口使知识库能被主动清理。

### Gemini CLI

- **Level 1（启动时）**: `sources/gemini-cli/packages/core/src/tools/confirmation-policy.test.ts` — 测试即文档，覆盖确认策略的所有边界情况。
- **Level 2（测试时）**: `sources/gemini-cli/evals/` 完整 eval 套件，对 Agent 行为做端到端验证。
- **Level 3（运行时持续监控）**: `hookSystem.ts:230-237` 的 `fireSessionEndEvent` 提供运行时清理钩子，但无主动漂移扫描。

### OpenCode

- **Level 1（启动时）**: `permission/index.ts:292-307` — `Permission.disabled()` 在服务初始化时静态过滤工具列表。
- **Level 2（测试时）**: Effect-ts 的编译时类型验证覆盖了服务依赖图的合法性。
- **Level 3（运行时持续监控）**: 无持续漂移检测。这是 OpenCode 最明显的工程欠债之一。

---

## 6. 可驾驭性（Harnessability）

可驾驭性衡量的是：假设我想在这个工程上添加一个新的控制点（比如一个 Lint 传感器，或一条权限规则），需要修改多少文件、触碰多少核心路径、承担多少风险？可驾驭性越高，团队就越能持续迭代 harness，而不是把它当成一次性的配置。

### Claude Code

Claude Code 的 `src/tools/<ToolName>/` 独立目录结构给工具开发提供了清晰的物理隔离，这是高可驾驭性的信号。但由于 TypeScript 类型系统（隐式传感器）已经失效（~1341 错误），向代码库插入新工具时，编辑器无法给出可靠的类型提示，增加了错误引入的风险。

### Codex

Rust crate 边界（`sources/codex/codex-rs/app-server/src/lib.rs`）是编译期强制的模块隔离，这是最强的可驾驭性保证。任何违反 crate 边界的变更都会在编译期被阻断，而不是在运行时才暴露。代价是：Rust 的学习曲线和编译时间，使驾驭速度慢于 TypeScript 工程。

### Gemini CLI

`sources/gemini-cli/packages/core/src/tools/tool-registry.ts` 的注册表模式依赖约定（你必须知道要向注册表注册），但注册逻辑本身是高度解耦的。TypeScript 类型系统提供了中等程度的隐式传感器，能在 IDE 中给出合理的错误提示。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:138` 的 Effect Layer 模式强制依赖注入，这意味着：任何需要 Permission 服务的代码都必须通过 `ServiceMap` 声明这个依赖，而不能静默地使用全局状态。这是一个强大的架构约束，但对不熟悉 Effect-ts 的工程师来说，门槛相当高。

---

## 7. Ashby 定律与拓扑承诺

Ashby 的必要多样性定律说：控制系统必须具备至少与被控系统同等的复杂度，才能有效控制它。放在 Agent 语境里，这意味着：如果你的 harness 规则只有 5 条，但 Agent 的行为空间有 500 种情况，那 harness 必然覆盖不全。

我们观察各工程在"限制 Agent 操作空间"上投入了多少，是因为**有意识地约束空间，本身就是一种控制策略**。

- **Claude Code**：`sources/claude-code/src/constants/tools.ts:36-112` 的 Allowlist 机制通过精确列出允许/禁止的工具集合来限制空间，这是一种朴素但有效的拓扑承诺。feature flag 系统（即使当前失效）的设计意图是通过条件启用来进一步划定子空间。
- **Codex**：`sources/codex/codex-rs/prompts/templates/permissions/approval_policy/` 的四种 policy 变体，加上 `execpolicy` 对 shell 命令的约束，形成了两层正交的空间限制。
- **Gemini CLI**：`sources/gemini-cli/packages/core/src/core/prompts.ts:20-40` 的组合式 prompt 构建器通过条件渲染（plan mode vs primary workflows）来切换子空间，而 `models.ts` 的模型约束限制了推断引擎的选择空间。
- **OpenCode**：`sources/opencode/packages/opencode/src/config/config.ts` 定义了配置 schema，间接约束了 Agent 可以读取的操作参数空间。但当前缺少对工具调用空间的系统性限制。

---

## 8. Agent 可读性（Agent Legibility）

一个对 Agent 可读（Legible）的工程，意味着：当工程师翻开代码，能清晰看出 Agent 的行为从哪里来、受什么约束、何时会失控。这不是一个美学问题——低可读性的 harness 是技术债务，因为无法被工程师维护的控制系统，迟早不再被维护。

### Claude Code

`sources/claude-code/src/utils/claudemd.ts:1-26` 的文件类型注释清晰地解释了每种 CLAUDE.md 的语义，这使文件体系对工程师可读。但 `sources/claude-code/src/constants/systemPromptSections.ts:20-24` 的记忆化 Snippet 在反编译代码里散落多处，全局状态难以追溯。

### Codex

`sources/codex/codex-rs/protocol/src/prompts/base_instructions/default.md` 的结构（Personality → AGENTS.md spec → Responsiveness → Planning → Task execution → Validating）是线性的、对人类工程师可读的。`sources/codex/codex-rs/memories/write/templates/memories/stage_one_system.md` 的 NO-OP 门控逻辑也有明确的注释说明触发条件，这是高可读性的实现。

### Gemini CLI

`sources/gemini-cli/packages/core/src/prompts/snippets.ts:188-191` 里有一处关键的权衡注释：`// ⚠️ IMPORTANT: the Context Efficiency changes strike a delicate balance...`。这类注释对工程师极其有价值——它告诉维护者为什么这段代码必须保持现在的形态，如果改动需要先跑哪些基准测试。这是可读性工程的最佳实践。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:19-24` 的 Zod Schema 定义和 `sources/opencode/packages/opencode/src/skill/index.ts:28-34` 的 Skill.Info Schema，为 AI 和人类提供了相同的机器可读规范。这是 OpenCode 最突出的可读性优势。

---

## 9. 熵管理（Entropy Management / GC）

熵管理这个维度问的是：当 Agent 持续运行、不断积累上下文和记忆时，这些积累会不会自然走向腐烂？知识积累的必然结局是"过时信息污染新的判断"，除非工程主动设计了清理机制。

- **Claude Code**：`sources/claude-code/src/utils/claudemd.ts:790` 的 `memoize()` 缓存一旦建立就不会主动过期，这意味着 CLAUDE.md 内容的漂移（比如项目规则被废弃但文件未删除）无法被自动检测。这是明确的缺失。
- **Codex**：两阶段管道（Phase 1 并行提取 + Phase 2 整合）是四个工程里唯一真正实现后台 GC 的工程。`consolidation.md` 的 `max_unused_days` 窗口和 usage_count 排序，是在 Agent 运行时自动淘汰过时知识的机制。
- **Gemini CLI**：`hookSystem.ts:226-237` 的 `fireSessionEndEvent` 提供了 session 结束时的清理钩子，但清理行为由 Hook 实现者决定，框架本身没有强制的 GC 策略。
- **OpenCode**：Effect-ts 的 Finalizer 机制（`permission/index.ts:151-160`）保证了资源在 Effect 作用域结束时被清理，但这是 runtime 资源清理，不是知识库漂移检测。无熵管理设计是 OpenCode 的另一个主要工程欠债。

---

## 10. 两种驯化路线

在把前九个维度的观察汇总之后，可以清楚地看到四个工程分别选择了不同的"驯化路线"（Taming Strategy）。理解路线，比理解单个实现细节更重要，因为路线决定了工程的扩展方向和适合的使用场景。

**Claude Code — Runtime-first**：主循环围绕 `sources/claude-code/src/query.ts` 的 query 函数展开；系统提示构建依赖运行时条件（`systemPrompt.ts:41-123`）。这条路线的优势是灵活——可以根据会话状态动态调整行为；风险是隐式约定多，模块级单例状态难以追踪。

**Codex — Control-plane-first**：行为规则写在 Markdown 文件里（`protocol/src/prompts/permissions/approval_policy/`），记忆模板版本化管理。这条路线的优势是行为可预测、变更可审查；代价是团队需要先建立制度（写好 Approval policy），才能享受控制带来的收益。

**Gemini CLI — 混合路线**：Hook System 是推断型控制平面（`hooks/hookSystem.ts`），Snippet 函数是计算型前馈（`prompts/promptProvider.ts`），两者协同工作。这是兼顾灵活性和可测试性的设计，但也意味着调试时需要两个心智模型同时在线。

**OpenCode — Runtime-first（Effect-driven）**：Permission 是运行时 Effect（`permission/index.ts`），Skill 通过 `load()` 异步初始化（`skill/index.ts:126-176`）。Effect-ts 的 Service Layer 理论上提供了很强的可组合性，但当前实现中，各 Service 之间的依赖图尚未被充分利用来建立控制链。

---

## 11. 验证必须独立

验证的独立性是 Harness Engineering 的核心原则之一。如果验证在与执行相同的上下文中进行，验证者会看到和执行者相同的前提假设，确认偏差（Confirmation Bias）就无法被对冲。真正的验证需要在不同的上下文、不同的权限集、甚至不同的代理角色中完成。

- **Claude Code**：`VerifyPlanExecutionTool` 的存在表明有这个设计意图，但 `process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'` 在反编译环境下不触发，实际上是一个死代码路径。主循环在 `query.ts` 里同一上下文内处理工具调用和验证，无对抗确认偏差的机制。
- **Codex**：`consolidation.md` 里的 Phase 2 验证子代理运行在严格限制的环境下（`no approvals, no network, local write access only`，且禁用 collab 防止递归委派）。这是四个工程里唯一真正实现验证隔离的实现。
- **Gemini CLI**：`hookSystem.ts:259-305` 的 BeforeModel/AfterModel 分离使 Hook 链独立于 Agent 执行——Hook 可以在 Agent 运行结果已知之前或之后介入，而不共享 Agent 的决策上下文。29+ eval 文件则在测试层面提供了独立验证覆盖。
- **OpenCode**：Effect-ts 的 ServiceMap 模式在理论上支持角色分离，`Service` 定义（`permission/index.ts:138`）在隔离的 Effect 作用域中运行。但当前架构是单代理，没有多代理验证链。

---

## 12. 团队落地的制度化

一个 Harness Engineering 框架，如果只能由创始工程师维护，那它的价值是脆弱的。我们观察各工程在"团队规模化使用"方面的制度化投入，是因为 Agent 工具的真实挑战往往不在个人使用阶段，而在团队协作与规则继承阶段。

- **Claude Code**：`sources/claude-code/src/utils/claudemd.ts:1-26` 定义了清晰的文件发现顺序和优先级，`.claude/rules/*.md` 的条件规则使团队可以按文件路径分配不同规则集。这是完整的团队治理层级，但缺少 lifecycle 约定文档（何时审查规则、何时清理废弃规则）。
- **Codex**：`sources/codex/docs/agents_md.md` 是专门给团队工程师阅读的 AGENTS.md 规范，`protocol/src/prompts/base_instructions/default.md:17-27` 里的 AGENTS.md 语义给出了嵌套优先规则。这是对团队制度化投入最高的工程。
- **Gemini CLI**：`sources/gemini-cli/packages/core/src/config/memory.ts` 的 `HierarchicalMemory` 接口（global / extension / project 三层）提供了清晰的规则来源层次，每层可由不同角色管理。
- **OpenCode**：`sources/opencode/packages/opencode/src/skill/index.ts:143-157` 的 `Config.directories()` 和 `permission/index.ts:278-290` 的 `Permission.fromConfig()` 提供了配置驱动的制度化路径，但团队协作规范（谁写 Skill、谁审批 Permission 规则）需要团队自行建立。

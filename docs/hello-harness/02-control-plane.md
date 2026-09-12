---
layout: content
title: "02 - 控制平面"
---
<!-- markdownlint-disable MD060, MD024 -->
# 控制平面对比

在分析一个 Agent 工程的 Harness 成熟度时，控制平面是最先必须理解的部分，原因很直接：**所有其他控制机制——Skill、Hook、Permission、工具约束——都必须经过控制平面才能触达 Agent**。如果控制平面自身不清晰，后面的一切精细化投入都可能被吞没在混乱的优先级里。

控制平面的核心问题有三个：指令从哪里来、如何组合、冲突时谁赢。回答清楚这三个问题，就能知道一个工程的控制可预测性有多高，以及团队在它上面建立规则的成本有多低。

---

## 1. System Prompt 分层组织

System Prompt 是 Agent 最持久的控制信号源——它在每次请求时都存在，优先级通常高于对话历史。一个设计良好的 System Prompt 体系，能让工程师通过修改文件来改变 Agent 行为，而不必修改代码或重启服务。我们分析 System Prompt 的分层方式，是为了判断"加一条规则需要改多少地方"以及"规则来源对团队是否可见"。

### Claude Code

Claude Code 的 `buildEffectiveSystemPrompt()`（`sources/claude-code/src/utils/systemPrompt.ts:41-123`）定义了四个互斥的组合路径：最高优先级的 `overrideSystemPrompt` 直接替换所有其他内容，其下是 Coordinator 模式专用 prompt，再下是内置/自定义 Agent prompt，最底层是标准 `defaultSystemPrompt`。

```typescript
// claude-code/src/utils/systemPrompt.ts:56-57
if (overrideSystemPrompt) {
  return asSystemPrompt([overrideSystemPrompt])
}
```

这个结构的设计意图是清晰的：不同的运行模式（REPL、协调器、子 Agent）用不同的 prompt 路径，互不干扰。但这也意味着系统提示的内容分散在 TypeScript 代码里，不是独立的文本文件——改一条行为规则，你需要找对代码位置，而不是只编辑一个 Markdown 文档。

### Codex

Codex 的 System Prompt 完全由 Markdown 模板文件承载，这是一个根本性的设计差异。`sources/codex/codex-rs/protocol/src/prompts/base_instructions/default.md:1-275` 是主规范，275 行全部是可读的结构化文本。协作模式通过独立目录（`collaboration_mode/pair_programming.md`、`plan.md`、`execute.md`）分类管理，压缩 prompt 也有独立文件（`compact/prompt.md`）。

这个架构的含义是：行为规则是可版本化的代码仓库文件，任何 diff 都能被代码审查过程捕捉。工程师不需要懂 TypeScript 就能修改 Agent 行为，也不需要重新编译就能看到变更效果。代价是：没有类型检查来保证 prompt 格式的合法性。

### Gemini CLI

Gemini CLI 的 `getCoreSystemPrompt()`（`sources/gemini-cli/packages/core/src/prompts/promptProvider.ts:38-265`）代表了第三种路线：prompt 作为函数组合。每个维度（preamble、coreMandates、hookContext、planningWorkflow 等）都是独立的 snippet 函数，最终结果是所有 snippet 的拼接：

```typescript
// snippets.ts:123-150
export function getCoreSystemPrompt(options: SystemPromptOptions): string {
  return `
${renderPreamble(options.preamble)}
${renderCoreMandates(options.coreMandates)}
${renderSubAgents(options.subAgents)}
${renderAgentSkills(options.agentSkills)}
${renderHookContext(options.hookContext)}
${options.planningWorkflow ? renderPlanningWorkflow(options.planningWorkflow) : renderPrimaryWorkflows(options.primaryWorkflows)}
${options.taskTracker ? renderTaskTracker(options.taskTracker) : ''}
${renderOperationalGuidelines(options.operationalGuidelines)}
${renderInteractiveYoloMode(options.interactiveYoloMode)}
${renderSandbox(options.sandbox)}
${renderGitRepo(options.gitRepo)}
`.trim();
}
```

这种方式的优势是：每个 snippet 函数可以单独测试，条件渲染逻辑（如 `planningWorkflow` 二选一）有明确的 TypeScript 类型约束。劣势是：最终 prompt 的内容需要运行代码才能看到，不如 Codex 的 Markdown 文件直观。

### OpenCode

OpenCode 的 System Prompt 是 Effect-ts 驱动的动态构建，配置定义在 `sources/opencode/packages/opencode/src/config/config.ts`。与其说它有固定的控制平面，不如说它的控制平面是 Effect 服务网络运行时的涌现结果。这在理论上提供了极高的组合灵活性，但也意味着从代码到最终 prompt 的推导路径不是线性的，需要追踪 Effect 执行图才能理解。

### 横向对比

四种方式代表了控制平面显式性的光谱：Codex（Markdown 文件，最显式）→ Gemini CLI（Snippet 函数，次显式）→ Claude Code（TypeScript 硬编码，需要读代码）→ OpenCode（Effect 运行时，需要追踪执行图）。显式性越高，团队治理成本越低，但灵活性也相应降低。

---

## 2. 指令文件体系

除了 System Prompt 本身，各工程还提供了让用户在磁盘上放置指令文件来影响 Agent 行为的机制。这个机制是 Harness Engineering 里"团队规则版本化"的关键路径：把 Agent 行为写进普通文件，纳入 Git 版本控制，就能在代码审查过程中讨论和治理 Agent 行为。

### Claude Code

Claude Code 的指令文件系统（`sources/claude-code/src/utils/claudemd.ts:1-26`）是四个工程里最完备的：

```
1. Managed memory (/etc/claude-code/CLAUDE.md) — 全局策略（系统管理员管理）
2. User memory (~/.claude/CLAUDE.md) — 用户全局指令
3. Project memory (CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md) — 代码库指令
4. Local memory (CLAUDE.local.md) — 私有项目指令（不应提交 Git）
```

`@include` 指令（`sources/claude-code/src/utils/claudemd.ts:448-535`）支持从一个 CLAUDE.md 引用另一个文件，实现规则复用，且有循环引用检测（MAX_INCLUDE_DEPTH = 5）。`.claude/rules/` 目录还支持条件规则（通过 frontmatter `paths` 字段按文件路径生效），实现"只对后端代码生效的规则"这类精细控制。

这套体系的问题不在设计，而在维护文化：如果团队没有定期审查和清理废弃规则的惯例，四层文件体系就会随时间积累大量过时内容，而 Agent 仍然会读取它们。

### Codex

Codex 把 AGENTS.md 的语义直接写进了 Agent 行为规范（`sources/codex/codex-rs/protocol/src/prompts/base_instructions/default.md:17-27`）：

```markdown
# AGENTS.md spec
- Repos often contain AGENTS.md files
- Instructions in AGENTS.md files:
    - The scope of an AGENTS.md file is the entire directory tree rooted at the folder that contains it
    - For every file you touch in the final patch, you must obey instructions in any AGENTS.md file whose scope includes that file
    - More-deeply-nested AGENTS.md files take precedence in the case of conflicting instructions
```

这里有一个重要的设计决策：不是"Agent 会读取这些文件"，而是"Agent 必须遵守这些文件，针对它触碰的每个文件"。范围绑定（`scope = 包含该目录的树`）和优先级规则（更深嵌套越优先）都被明确量化，减少了歧义。

### Gemini CLI

Gemini CLI 的 GEMINI.md 体系通过 `memory.ts` 的 `HierarchicalMemory` 接口（global / extension / project 三层）组织。上下文文件的发现通过 `getAllGeminiMdFilenames()`（`promptProvider.ts:73`）触发，结果被注入 System Prompt 的 hookContext 部分。Skill 渲染在 `snippets.ts:107-115` 中进行，与记忆加载是解耦的两条路径。

### OpenCode

OpenCode 的 Skill 系统（`sources/opencode/packages/opencode/src/skill/index.ts:21-27`）使用三种 glob 模式：

```typescript
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"
```

这允许 Skill 文件存放在多种约定路径下，并支持从远程 URL 拉取（`skill/index.ts:126-176` 的 `load()` 方法）。这是四个工程里唯一支持远程 Skill 拉取的实现，意味着 Skill 库可以和代码库分离存储和版本化。

---

## 3. 指令优先级与覆盖规则

规则冲突是团队使用 Agent 时不可避免的问题：用户规则和项目规则冲突时谁赢？新指令和旧记忆冲突时呢？如果工程没有明确的冲突解决规则，Agent 的行为就会变得不可预测，团队无法信任它在边界情况下的选择。

### Claude Code

Claude Code 的加载顺序遵循"后加载的优先"原则（`sources/claude-code/src/utils/claudemd.ts:9`）：

```
Local > Project > User > Managed（优先级从高到低）
```

路径条件规则有额外的基准点规则：Managed/User 规则相对于 original CWD 生效，Project 规则相对于包含 `.claude/` 的目录生效。这意味着一个全局工具规则和一个项目特定规则在路径计算上的基准点是不同的，工程师需要记住这个细节才能正确预测行为。

### Codex

Codex 的冲突解决遵循两条明确原则：深嵌套 AGENTS.md 优先，直接系统/开发者/用户指令（作为 prompt 的一部分）优先于 AGENTS.md 指令（`default.md:26`）。这意味着：如果你在会话里直接说"忽略 AGENTS.md 里的 X 规则"，Agent 应该服从。这是一个有意识的设计选择，把直接指令的优先级置于文件规则之上，避免静态文件阻断动态需求。

### Gemini CLI

Gemini CLI 的覆盖通过 Snippet 函数的条件渲染实现：`planningWorkflow` 和 `primaryWorkflows` 是两选一，`interactiveYoloMode` 在 YOLO 模式下会覆盖标准交互指南。这是隐式优先级——你必须读源码才能知道哪个 snippet 在哪种模式下会被哪个覆盖。

### OpenCode

OpenCode 的 Permission 规则通过 `merge()` 函数叠加（`permission/index.ts:292-294`）：

```typescript
export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}
```

规则集的平铺意味着后来的规则不覆盖早先的，而是并列存在，由 `disabled()` 函数的逻辑决定最终效果。这比"后加载优先"的 Claude Code 更复杂，但也更灵活——你可以组合多个规则集而不担心它们相互覆盖。

---

## 4. Prompt 作为控制平面而非人格装饰

这是一个分析角度，不是一个代码实现层面的维度。我们通过它来判断：各工程的 Prompt 工程师是否意识到 System Prompt 是**工程控制信号**，而不只是"让 AI 说话更礼貌的地方"。只有当 Prompt 被当作控制平面设计时，它才能有效承担 Harness 职能。

**Claude Code** 的 `overrideSystemPrompt` 直接替换所有其他内容（`systemPrompt.ts:56-57`），这表明系统设计者清楚地知道某些情况下需要完全重置控制信号，而不是叠加修补。Coordinator 模式使用专用 prompt（`systemPrompt.ts:67-75`），而非在默认 prompt 上打补丁，也表现出相同的工程意识。

**Codex** 的行为规范（`default.md:131-144`）里的 Validating 章节：

```markdown
## Validating your work
If the codebase has tests or the ability to build or run, consider using them to verify that your work is complete.
```

这不是在描述 Claude 的"个性"，而是在规定 Agent 在任务完成后必须执行的检查流程。这是控制平面视角的典型写法。

**Gemini CLI** 的 `snippets.ts:188-191` 里有一处不寻常的工程注释：

```typescript
// ⚠️ IMPORTANT: the Context Efficiency changes strike a delicate balance...
// You must run the major benchmarks, such as SWEBench, prior to committing any changes...
```

这条注释的存在说明：这段 Prompt 代码的设计者不认为它是文案，而是认为它是影响基准测试分数的工程代码，修改之前需要先跑测试。这是把 Prompt 当控制平面的最直接体现。

**OpenCode** 的 `Permission.Action`（`permission/index.ts:22-25`）把权限决策建模为一个强类型枚举（allow/deny/ask），而非一段自然语言描述。这意味着权限控制的粒度是机械执行的，不依赖 Agent 对自然语言规则的理解。这是控制平面设计而非人格装饰的最纯粹形式。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| Prompt 来源 | TypeScript 硬编码 + 模板片段 | Markdown 模板文件 | Snippet 函数组合 | Effect-ts 配置 |
| 文件发现 | 向上遍历 CWD，四层优先级 | AGENTS.md 语义（范围绑定） | GEMINI.md 三层层级 | Skill 目录扫描 + URL pull |
| 优先级规则 | Local > Project > User > Managed | 嵌套优先 + Direct 最高 | Snippet 条件组合 | Permission merge 叠加 |
| 覆盖机制 | overrideSystemPrompt 完全替换 | Direct 指令优先于文件指令 | interactiveYoloMode 覆盖 | Effect 层叠（非覆盖） |
| 控制平面显式度 | 高（4 层明确，有文档） | 高（AGENTS.md 规范完备） | 中（需读源码理解条件组合） | 中（Schema 清晰，执行图复杂） |

**一句话判断**：Codex 的控制平面对团队工程师最透明（Markdown 文件 + 规范文档），Claude Code 的控制平面最完备（四层文件体系），Gemini CLI 的控制平面最可测试（snippet 函数），OpenCode 的控制平面在 Effect-ts 架构下最灵活但可读性最低。

理解控制平面之后，我们才能有意义地讨论前馈控制（[03-feedforward-controls](./03-feedforward-controls.md)）——因为所有前馈信号都要经过控制平面才能进入 Agent。

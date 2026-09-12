---
layout: content
title: "04 - 反馈控制"
---
# 反馈控制横向对比

如果说前馈控制是在行动之前建立约束，那反馈控制就是在行动之后检测偏差并提供修正信号。两者共同构成控制论意义上的闭环。在 Agent 系统里，反馈控制格外重要，因为 Agent 的行动空间极大，前馈无法穷举所有情况——Agent 总会在某些前馈没有覆盖到的地方做出意想不到的事情。

反馈控制的质量可以从三个维度衡量：**速度**（多快能检测到偏差）、**精度**（检测的误报率是多少）、**可操作性**（检测到问题后有没有清晰的纠正路径）。我们分析四个工程的反馈控制，就是为了看清楚这三个维度上的差距，以及谁建立了真正的闭环，谁只有单向的信号发送。

---

## 计算型反馈控制

计算型反馈控制的优势和前馈类似：机械执行、确定性、低误报。在反馈语境里，计算型意味着"通过代码检测偏差"，而不是通过人的观察或模型的判断。

### 测试结果回注入 Agent Context

测试是软件工程里最经典的反馈机制：写代码、运行测试、看结果、修正。在 Agent 编程里，同样的循环需要被设计进 Agent 的工作流，而不是等人类在外部观察测试结果后再手动告诉 Agent。我们看各工程是否把测试结果作为结构化信号回传给 Agent，而不只是让 Agent 看到原始的命令行输出。

**Claude Code**：`sources/claude-code/src/query.ts` 的主查询循环处理工具调用的返回值，把 tool result 直接注入对话历史。这意味着如果 Agent 运行了测试，测试输出会被注入上下文，Agent 可以看到它。但这是非结构化的——测试输出是原始文本，没有被解析成结构化的"失败/通过/未覆盖"信号。Agent 需要自己从原始文本里推断测试结果，这是推断型反馈而非计算型。

**Codex**：`sources/codex/codex-rs/memories/write/templates/memories/stage_one_system.md:42-51` 定义了 Phase 1 的结构化输出格式（`raw_memory`、`rollout_summary`、`rollout_slug`）。这不是"测试输出",而是把整个任务执行过程——包括测试结果——提炼成结构化的记忆记录。通过 outcome 标签（success/partial/uncertain/fail）量化任务质量，这是计算型反馈信号的典型实现。

**Gemini CLI**：更准确的反馈主链路不在 eval，而在 `sources/gemini-cli/packages/core/src/core/client.ts`、`sources/gemini-cli/packages/core/src/scheduler/tool-executor.ts` 和 `sources/gemini-cli/packages/core/src/core/geminiChat.ts`。工具执行结果会以结构化的 tool result 回注到对话历史，模型能基于这些结果继续决策。`hookSystem.ts` 提供的是额外的事件拦截点，适合在 Before/After 阶段追加反馈，但 eval 文件属于仓库验证资产，不是运行时反馈回路本身。

**OpenCode**：`sources/opencode/packages/opencode/src/permission/index.ts:260-264` 的 `Permission.list()` 返回待处理的权限请求列表。这是有限的结构化反馈：它告诉调用者"有哪些权限决策在等待"，但不提供任务执行质量的反馈。

### Lint 报告 Remediation 指令

一个优秀的反馈控制不只是"发现问题"，还要"告诉 Agent 如何修正"。Lint 报告如果能附带 remediation 指令，Agent 就不需要从零推断如何修复，而是可以直接按照建议执行——这大幅降低了修复的推断成本。

**Claude Code**：无原生 Linter 配置，因此也没有结构化的 Lint Remediation 指令流程。测试/Lint 失败后，Agent 只能从原始输出里推断修复方向。

**Codex**：`sources/codex/codex-rs/apply-patch/apply_patch_tool_instructions.md` 包含验证要求和使用说明，这是部分 remediation 指令——它告诉 Agent 如何正确使用 patch 工具，减少因工具误用导致的失败。但它不是动态的"基于当前 Lint 结果的修复建议"。

**Gemini CLI**：没有内建的 Lint remediation 子系统。更贴近现实的说法是：它能把测试、lint 或 shell 输出通过工具结果重新交给模型，再由模型自己推断修复策略；必要时 Hook 可以在执行前后补充额外约束，但仓库里没有一个专门负责“读 lint 结果并生成修复建议”的独立模块。

**OpenCode**：`sources/opencode/packages/opencode/src/permission/index.ts:83-103` 定义了三种错误类型（`RejectedError`、`CorrectedError`、`DeniedError`）。`CorrectedError` 特别有意义：它携带了"应该是什么"的信息，而不只是"不对"的信号——这是 remediation 指令的一种形式。

### Hooks 的阻断与回调机制

Hook 是反馈控制里最直接的干预机制：它允许在 Agent 执行流程的特定点上注入检查逻辑，如果检查失败，可以阻断执行或修改参数。Hook 机制存在与否，决定了反馈控制是"观察型"还是"干预型"——前者只能事后发现，后者可以在问题造成损害前阻断。

**Claude Code**：`sources/claude-code/src/utils/hooks/postSamplingHooks.ts` 提供了采样后 Hook，`sources/claude-code/src/utils/hooks.js` 是 Hook 执行入口。Hook 机制存在，但实际在生产中的触发状态需要结合 feature flag 系统判断——由于 feature() 始终返回 false，依赖 feature flag 的 Hook 分支可能不实际运行。

**Codex**：`sources/codex/codex-rs/memories/write/templates/memories/stage_one_system.md:15-26` 定义了 Phase 1 的 NO-OP 门控：如果没有足够的信号，Phase 1 返回空，不入库。这是一种"阻断"的反馈逻辑——不是所有执行都会产生记忆，只有通过信号门控的才会。这比"把所有输出都写进记忆库"更克制，也更正确。

**Gemini CLI**：`hookSystem.ts` 的 Before/After 事件确实提供了显式阻断路径；同时 `LoopDetectionService` 和 `GeminiClient` 还负责检测重复工具调用、内容循环，并在必要时向模型注入恢复反馈。这意味着 Gemini CLI 的反馈控制不只是一套 Hook 回调，而是“Hook 拦截 + 运行时循环自愈”两层共同作用。

**OpenCode**：`sources/opencode/packages/opencode/src/permission/index.ts:166-201` 的 `ask()` 方法通过 `Deferred.await()` 挂起执行，等待用户决策。这本质上是一个"挂起 + 回调"的 Hook 模式，由 Effect-ts 管理竞争条件。区别在于：这是人工审批型 Hook，不是自动化检查型 Hook。

---

## 推断型反馈控制

推断型反馈控制的核心是：用语言模型来判断 Agent 的输出质量，并产生修正信号。这类控制比计算型更灵活——它能评估代码可读性、设计合理性、注释清晰度等无法机械量化的质量维度。代价是：推断型判断本身也可能出错，且成本更高。

### 代码审查 Agent 作为独立角色

让 Agent 自我审查是一种天然的直觉：Agent 写完代码后，再让同一个或另一个 Agent 来审查。问题在于：如果审查者和执行者共享上下文（包括相同的前提假设、记忆、偏见），审查的独立性就大打折扣。独立的审查 Agent 需要在不同的上下文里工作。

**Claude Code**：无独立审查 Agent。主循环在 `query.ts` 里同一上下文内处理工具调用和任务验证，确认偏差无法被对冲。

**Codex**：`sources/codex/codex-rs/core/templates/review/history_message_completed.md` 和 `history_message_interrupted.md` 把审查设计成独立的阶段，有专属的模板。审查阶段有自己的提示词，引导审查者从执行记录里推断任务结果，而不是继承执行者的主观判断。

**Gemini CLI**：仓库里确实有 `generalist-agent.ts` 和完整的子代理基础设施，但没有一个像“review-only verifier”那样的专用审查代理。当前更常见的路径是：把工具结果、Hook 输出和用户反馈回注给主循环，或者显式委派给子代理做额外分析。也就是说，它有委派能力，但审查角色并没有在 core 里被硬编码成独立职能。

**OpenCode**：无审查 Agent。单代理架构，所有决策在同一上下文内完成。

### 自纠正循环的轮数限制

Agent 自纠正循环（Agent 遇到失败 → 分析失败 → 尝试修复 → 再次检查）是反馈控制里最常见的模式。但无限的自纠正循环会变成死循环——Agent 在同一个错误上反复尝试，消耗大量 token 和时间而不产生进展。显式的轮数限制是一种终止条件，防止反馈循环变成资源消耗。

**Claude Code**：`sources/claude-code/src/query.ts` 主循环无明确的自纠正轮数限制可见。Agent 可以在工具调用失败后无限次重试，直到 token 耗尽或用户中断。这是一个显著的设计缺失。

**Codex**：`stage_one_system.md:559-565` 的 Phase 1 工作流定义了固定的步骤序列（Apply minimum-signal gate → Triage outcome → Read rollout → Return structured output），这个序列是有限的，不存在无限重试路径。每次 rollout 都会产生一个结果（即使是空结果），不会死循环。

**Gemini CLI**：它不是只靠 `shouldStopExecution()` 一条终止路径。当前源码里还有 `LoopDetectionService` 的重复模式检测，以及 `GeminiClient` 里的 `MAX_TURNS` 上限。也就是说，自纠正循环既可以被 Hook 主动拦停，也会被运行时的循环检测和回合上限截断。

**OpenCode**：`permission/index.ts:166-201` 的 `ask()` 等待用户响应，把终止决策交给人类。这是有终止条件的（用户总会最终回应），但终止的时机和原因完全由人类控制，不是自动化的。

### LLM-as-Judge 质量打分

LLM-as-Judge 是一种推断型反馈：用另一个模型调用来评估当前模型的输出质量，产生结构化的质量分数或标签。这类评估能覆盖无法机械量化的质量维度，但需要额外的推断成本，且评估结果本身也是概率性的。

**Claude Code**：无可见的 LLM-as-Judge 实现。质量判断完全依赖工具执行结果（成功/失败）和用户的主观反馈。

**Codex**：`stage_one_system.md:150-201` 的 Task Outcome Triage 是最接近 LLM-as-Judge 的实现：Phase 1 的 Agent 读取 rollout 历史，为每次任务打上 outcome 标签（success/partial/uncertain/fail），并提取 preference evidence（Agent 的行为偏好证据）。这不是一个独立的 Judge 模型，而是让同一个模型在不同的上下文（Phase 1 的 system prompt）里充当评估者。

**Gemini CLI**：运行时最接近 LLM-as-Judge 的实现，其实是 `LoopDetectionService` 里的 LLM 二次判定。系统会在 turn 数达到阈值后，请模型分析最近历史是否陷入无进展循环。eval 框架当然也能做离线质量评估，但那属于仓库测试手段，不是主执行链里的在线质量打分器。

**OpenCode**：无 LLM-as-Judge 机制可见。质量判断完全依赖人工审批（Permission.ask()）。

---

## Shift-Left 分布分析

Shift-Left 是质量管理的核心原则：越早发现问题，修复成本越低。在反馈控制里，我们把检测时机分为三个层次，并观察各工程在每个层次上的覆盖情况。这个分析之所以重要，是因为一个只有 L3（运行时持续监控）的工程，每次问题发现时损失已经发生；而一个 L1（提交前检查）覆盖全面的工程，大多数问题在造成损害前就被阻断了。

| Level | Claude Code | Codex | Gemini CLI | OpenCode |
| :-------| :-------------| :-------| :------------| :----------|
| **L1（自纠正/提交前）** | **2** — MAX_INCLUDE_DEPTH = 5 是仅有的提交前检查 | **4** — Approval policy 在执行前生效，无需到 CI 才触发 | **3** — 测试套件覆盖提交前行为 | **3** — `Permission.disabled()` 静态过滤在初始化时生效 |
| **L2（CI Pipeline）** | **1** — 无原生 CI 配置 | **4** — Phase 1/2 记忆管道提供持续集成质量记录 | **4** — 29+ eval 文件提供 CI 级别的行为验证 | **2** — Effect-ts 编译期检查有限 |
| **L3（持续漂移检测）** | **1** — 无后台 GC 机制，无持续监控 | **4** — Phase 2 Consolidation 持续整合，遗忘机制主动清理 | **2** — SessionEnd 事件驱动，无主动扫描 | **1** — 无熵管理机制 |

**关键观察**：Claude Code 在所有三个层次的反馈控制上都是最弱的，这直接来自两个根因：一是 feature flag 体系的失效（本应存在的 Hook 和验证工具不实际运行），二是无熵管理设计（没有 L3 的存在基础）。Codex 是唯一在三个层次都有实质性实现的工程，这使它的反馈控制真正形成了闭环，而不只是单向的信号发送。

反馈控制的分析揭示了前馈控制的局限——无论前馈多完善，反馈都是必要的补偿。接下来我们转向[工具治理](./05-tool-governance.md)，它是 Agent 与外部世界交互的唯一通道，也是反馈控制最直接的作用对象。

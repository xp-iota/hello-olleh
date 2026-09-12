---
layout: content
title: "08 - 熵管理"
---
# 熵管理对比

熵（Entropy）在这里不是物理意义上的，而是信息工程意义上的：随着 Agent 持续运行、不断积累上下文和记忆，这些积累会不会自然走向腐烂？知识积累的必然结局是"过时信息污染新的判断"，除非工程主动设计了清理机制。

这个维度是 Harness Engineering 里最容易被忽视的，因为熵管理的缺失不会立刻产生可见的故障——Agent 今天仍然运行良好，只是明天的判断会比今天略差，下个月的判断会比这个月略差。这种"慢性退化"在没有监控的情况下很难被察觉，直到某次错误让工程师回顾历史才会发现问题早在数周前就埋下了。

---

## 1. 后台 GC 机制

GC（Garbage Collection）机制在记忆工程里，指的是：工程是否有主动的、不需要人工触发的机制来识别和清理过时信息？主动 GC 和被动清理（如用户手动执行 /clear）的区别在于：主动 GC 能在问题严重化之前介入，而被动清理依赖人类发现问题并采取行动。

### Claude Code

`sources/claude-code/src/utils/claudemd.ts:790` 的 `getMemoryFiles()` 使用 `memoize()` 缓存——缓存一旦建立，在 conversation 期间不会主动过期。这意味着：如果 CLAUDE.md 里有一条规则在三个月前已经过时（比如"使用旧 API X"），Agent 仍然会在每次 session 里读取并遵守它，直到工程师手动删除那条规则。

没有后台任务定期扫描知识库、识别陈旧内容、提示工程师审查。这是明确的 GC 缺失。结合反编译副作用导致的类型系统失效，Claude Code 在长期运行下的可靠性退化风险是四个工程里最高的。

### Codex

Codex 是四个工程里唯一实现了真正意义上的后台 GC 的工程。`stage_one_system.md` 的 Phase 1 定义了每次 rollout 后自动触发的记忆提取流程：

```markdown
What it does:
- claims a bounded set of rollout jobs from the state DB
- filters rollout content down to memory-relevant response items
- sends each rollout to a model (in parallel)
- expects structured output containing:
  - a detailed raw_memory
  - a compact rollout_summary
  - an optional rollout_slug
```

Phase 1 的 NO-OP 门控（如果没有足够信号，返回空，不入库）防止了记忆库被噪音污染。Phase 2（`consolidation.md`）在 Phase 1 产物基础上做全局整合，关键是其遗忘机制：`prunes stale rollout summaries that are no longer retained`。这个机制通过 `max_unused_days` 窗口自动淘汰长期未被引用的知识，是四个工程里唯一实现"知识自动遗忘"的。

### Gemini CLI

`hookSystem.ts:226-237` 的 `fireSessionEndEvent` 提供了 session 结束时的清理钩子：

```typescript
async fireSessionEndEvent(
  reason: SessionEndReason,
): Promise<AggregatedHookResult | undefined> {
  return this.hookEventHandler.fireSessionEndEvent(reason)
}
```

这是事件驱动的清理机制——当 session 结束时，注册了 `SessionEnd` Hook 的处理器会被调用。但"事件驱动"和"主动GC"之间有一个关键差别：事件驱动依赖 session 正常结束来触发，如果 session 因异常中断就可能丢失清理机会；且清理的具体内容由 Hook 实现者决定，框架本身没有强制的 GC 策略。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:151-160` 的 Finalizer 机制：

```typescript
yield* Effect.addFinalizer(() =>
  Effect.gen(function* () {
    for (const item of state.pending.values()) {
      yield* Deferred.fail(item.deferred, new RejectedError())
    }
    state.pending.clear()
  }),
)
```

Finalizer 是 Effect 作用域结束时的资源清理，这是运行时资源回收，不是知识库的 GC。OpenCode 没有任何主动扫描知识库、识别陈旧内容的机制。无熵管理是 OpenCode 最显著的工程欠债之一，特别是考虑到其 Skill 系统可以加载大量 Skill 文件这一事实。

---

## 2. 文档腐烂检测方式

文档腐烂（Documentation Rot）是指：规则文件的内容随着时间推移变得过时、错误或互相矛盾，但没有任何机制来检测或提示这个情况。在 Agent 工程里，腐烂的规则比没有规则更危险：没有规则时 Agent 会自己推断（往往合理），而错误的规则会积极地引导 Agent 做错误的事情。

**Claude Code**：`claudemd.ts:80-82` 仅有路径清理（防止路径注入），没有对文档内容的腐烂检测。如果一条规则引用了一个已经废弃的 API，Claude Code 不会警告工程师——它会把这条规则注入 Agent 上下文，Agent 会尝试使用废弃的 API，然后失败。检测不到 = 腐烂不可见。

**Codex**：`consolidation.md` 的 Phase 2 包含一个隐式的腐烂检测机制：通过 `usage_count` 和 `max_unused_days` 窗口，长期未被引用的知识会被标记为"候选淘汰"。这不是直接的"文档内容是否仍然正确"的检测，但通过使用频率代理了相关性——一条从未被模型使用过的规则，很可能已经过时或不再适用。

**Gemini CLI**：无文档腐烂检测机制。GEMINI.md 文件的内容会被原样注入上下文，没有时效性检查。29+ eval 文件提供了行为层面的回归测试，如果规则腐烂导致 Agent 行为退化，eval 测试可能会捕捉到——但这是行为层面的间接检测，不是文档层面的直接检测。

**OpenCode**：无文档腐烂检测。Skill 文件的 Zod Schema 验证保证了格式合法性，但不验证内容的时效性。

---

## 3. 质量评分与漂移追踪

量化 Agent 输出质量，并追踪这个质量随时间的变化趋势，是熵管理的主动形式。如果质量分数持续下降，工程师能看到趋势并介入；如果没有质量追踪，质量退化只能在某次严重错误发生后才被发现。

**Claude Code**：无质量评分或漂移追踪机制。Agent 输出质量的评估完全依赖用户的主观判断，没有结构化的历史记录。

**Codex**：`stage_one_system.md:150-201` 的 Task Outcome Triage 为每次任务输出打结构化标签：

- `outcome = success` — 任务完成
- `outcome = partial` — 部分完成
- `outcome = uncertain` — 结果不确定
- `outcome = fail` — 任务失败

加上 preference evidence（行为偏好证据，带引号原文）和 failure mode（失败模式分类）。这些标签在 Phase 2 整合时被聚合，理论上可以追踪一段时间内的任务成功率趋势。这是四个工程里唯一有结构化质量历史记录的实现。

**Gemini CLI**：`sources/gemini-cli/evals/` 的 eval 测试套件提供了静态的质量基准。`evalTest("USUALLY_PASSES", ...)` 这类标注表明，某些测试是概率性通过的，而不是确定性通过的——这是对模型不确定性的诚实承认，也是质量评分的一种形式。但 eval 是静态测试，不是实时漂移追踪。

**OpenCode**：无质量评分或漂移追踪。

---

## 4. Golden Principles 显式程度

Golden Principles（黄金原则）是指：工程是否有一套核心的、高优先级的行为规范，这些规范在任何情况下都优先于其他规则？显式的 Golden Principles 能在发生规则冲突时给 Agent 提供清晰的仲裁依据，防止 Agent 因规则优先级模糊而做出错误的权衡。

**Claude Code**：`sources/claude-code/CLAUDE.md` 提供了项目指南，但这是非结构化的文档，没有明确标注哪些是"黄金原则"（必须遵守）vs. 哪些是"建议"（可以忽略）。Agent 需要自行判断规则的相对重要性，这是引入不确定性的地方。

**Codex**：`default.md` 包含显式的 Core Mandates 章节：

```markdown
## Core Mandates
- Credential Protection: Never log, print, or commit secrets
- Source Control: Do not stage or commit changes unless requested
```

这些 Mandate 用命令式语言（Never、Do not）表达，明确区别于建议性语言（should、consider）。层级上的显式程度是四个工程里最高的。

**Gemini CLI**：`snippets.ts:195-197` 的 Security & System Integrity 节使用了和 Codex 类似的命令式语言：

```typescript
// Credential Protection: Never log, print, or commit secrets...
// Source Control: Do not stage or commit changes unless specifically requested...
```

不同的是，这些规则在 Gemini CLI 里表达为 TypeScript 注释字符串，而不是 Markdown 文档——这使规则的修改需要修改代码，而不只是编辑文本文件。

**OpenCode**：`permission/index.ts` 的 Permission Action（allow/deny/ask）是最机械化的 Golden Principles 实现形式：权限规则不是自然语言，而是枚举值，没有被 Agent 误解的空间。但这个机械化的代价是：权限规则无法表达复杂的上下文相关逻辑，只能表达静态的 allow/deny/ask 决策。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 后台 GC | **1** — 无，memoize 无过期策略 | **5** — Phase 1/2 两阶段，usage 遗忘机制 | **2** — SessionEnd 事件触发，被动 | **1** — 无，仅 Effect Finalizer（资源清理） |
| 文档腐烂检测 | **1** — 路径清理，无内容检测 | **4** — usage_count 代理相关性，间接检测 | **2** — eval 行为回归（间接） | **1** — Zod 格式验证，无时效性检测 |
| 质量评分 | **1** — 无 | **4** — outcome 标签 + preference evidence | **3** — eval 静态基准（非实时） | **1** — 无 |
| Golden Principles | **2** — 存在但非结构化 | **4** — Core Mandates 节，命令式语言 | **3** — 命令式规则（代码注释形式） | **3** — 机械化 Permission Action（最无歧义） |
| **综合评分 (1-5)** | **1.25** | **4.25** | **2.5** | **1.5** |

**核心发现**：熵管理是所有维度里四个工程差距最大的。Codex 的两阶段管道实现了真正意义上的"Agent 工程的知识 GC"，而 Claude Code 和 OpenCode 在这个维度上几乎空白。Gemini CLI 的 eval 套件提供了静态的质量基准，但无法追踪运行时的动态漂移。

没有熵管理的 Agent 工程会面临一个不可见的技术债的积累——每次新的规则被添加而旧规则没有被清理，每次知识库被更新而过时内容没有被淘汰，Agent 的可靠性就在悄悄退化。这个退化不会触发任何警报，直到某次明显的错误让工程师回头检查历史才会发现。认识到这个维度，是在选择 Agent 工程时需要直面的一个现实。

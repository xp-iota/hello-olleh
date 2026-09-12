---
layout: content
title: "09 - 多 Agent 验证"
---
# 多代理与验证隔离对比

单代理系统的根本性局限是确认偏差（Confirmation Bias）：当同一个 Agent 既执行任务又验证任务结果时，它的验证会受到它自己对任务的理解和期望的影响。一个 Agent 在写完一段代码后去"审查"这段代码，往往会看到它期望看到的，而不是代码实际有的问题。

这不是 Agent 智能不够的问题，而是认知结构的问题——即使是人类专家，自我审查的可靠性也远低于同行审查。解决方案是引入独立的验证角色：另一个 Agent（或人类）在不共享执行者上下文的情况下对结果进行检验。

这个维度我们关注的是：各工程是否意识到了确认偏差的问题，并设计了缓解机制。

---

## 1. Agent 委派模型

多代理系统的第一个前提是：有能力把任务委派给子 Agent，并让子 Agent 在相对独立的上下文里工作。没有委派能力的工程只能是单代理，验证独立性自然无从谈起。

### Claude Code

`sources/claude-code/src/tools/AgentTool/` 实现了子 Agent 委派，在 `tools.ts:195` 注册为 `AgentTool`。但 `sources/claude-code/src/constants/tools.ts:40-41` 指出 AgentTool 对非 Anthropic 内部（non-ant）用户禁用。这意味着：多代理委派能力在源码层面存在，但对外部用户不可用，状态隔离机制也没有显式设计。委派存在，但是私有、无隔离的。

### Codex

`sources/codex/codex-rs/core/templates/agents/orchestrator.md` 的 Orchestrator 模板定义了协调者角色：Orchestrator 负责把任务分配给 workers，状态通过 DB 共享（Phase 1 提取结果 → Phase 2 整合）。这是一个完整的多代理架构：有角色分工、有共享状态机制、有任务分配协议。

### Gemini CLI

当前 Gemini CLI 已经不是“无多代理能力”的状态。`sources/gemini-cli/packages/core/src/agents/registry.ts` 负责加载和注册 agent 定义，`subagent-tool.ts` 把 agent 暴露成可调用工具，`local-executor.ts` 负责本地子代理执行，`remote-invocation.ts` 负责远程 A2A 代理调用。也就是说，多代理能力已经进入主运行时，不再只是概念性测试夹具。

### OpenCode

无多代理架构可见。OpenCode 是单代理系统，所有任务在同一个 Agent 实例里完成。这是当前最主要的架构限制——不是功能上的欠缺，而是设计范式的选择，且这个选择使验证独立性无法在代码层面实现。

---

## 2. 验证阶段的独立性

知道"有多代理"和"多代理之间有有效的验证隔离"是两件不同的事。隔离需要在三个层面同时成立：上下文隔离（验证者不继承执行者的决策历史）、权限隔离（验证者不能修改它正在验证的内容）、递归隔离（验证者不能再委派给执行者，形成循环）。

### Claude Code

`sources/claude-code/src/tools/VerifyPlanExecutionTool/` 的存在表明有验证的设计意图：

```typescript
// claude-code/src/tools.ts:91-95
const VerifyPlanExecutionTool =
  process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
    ? require('./tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js')
        .VerifyPlanExecutionTool
    : null
```

但 `feature()` 始终返回 false 的反编译副作用意味着 `CLAUDE_CODE_VERIFY_PLAN` 永不为 true。验证工具存在于代码里，但在实际运行时是一个死代码路径。主循环在 `query.ts` 里同一上下文内处理工具调用和验证，无实际的确认偏差对冲机制。

### Codex

`consolidation.md` 的 Phase 2 子代理运行条件是四个工程里最严格的验证隔离实现：

- **独立子代理**：Phase 2 生成一个与 Phase 1 独立的子代理
- **no approvals**：验证阶段不能发起新的审批请求
- **no network**：验证阶段无网络访问
- **local write access only**：只有本地写访问
- **collab disabled**：禁止再次委派，防止递归

这五个约束共同构成了一个真正的验证隔离环境。验证子代理不继承 Phase 1 的上下文（它只看到 Phase 2 prompt 和整合后的 diff），不能修改它之外的资源，也不能把任务再次外包。

### Gemini CLI

Gemini CLI 有一定程度的验证隔离，但还不到 Codex Phase 2 那样“强约束验证沙箱”的程度。`subagent-tool.ts` + `local-executor.ts` 允许把子任务放进独立 agent context；与此同时，`hookSystem.ts` 的 BeforeModel/AfterModel 也是与主生成路径并行的检查链：

```typescript
async fireBeforeModelEvent(llmRequest): Promise<BeforeModelHookResult> {
  const result = await this.hookEventHandler.fireBeforeModelEvent(llmRequest)
  const hookOutput = result.finalOutput

  if (hookOutput?.shouldStopExecution()) {
    return { blocked: true, stopped: true }
  }
  // ...
}
```

Hook 在 Agent 决策前介入，是独立代码路径；本地子代理又会创建自己的工具注册表和子消息总线，并显式阻止 agent 递归再调 agent。问题在于：这些能力主要服务“任务卸载”，不是专门为“验证者隔离”设计的，因此它属于中等强度隔离，而不是专用 verifier 隔离。

### OpenCode

`permission/index.ts` 的 Permission Service 在独立的 Effect Layer 里运行，这是代码级的隔离。但 OpenCode 是单代理，Permission Service 的隔离是对"人在回路"决策的隔离，而不是"Agent 验证 Agent 行为"的隔离。

---

## 3. 自我审查循环的可信度

当工程要求或允许 Agent 审查自己的输出时，这个自我审查有多少可信度？在什么情况下自我审查是有价值的，在什么情况下会产生虚假的安全感？

自我审查的可信度取决于两个条件：审查者能看到的信息是否与执行者不同（不同的视角），以及审查者是否有从不同角度真正质疑执行者的动机（对抗性角色）。满足其中一个能提高可信度，两个都满足才能实现真正有价值的自我审查。

**Claude Code**：主循环在 `query.ts` 里同一上下文处理一切。Agent 审查自己的输出时，使用与执行时相同的上下文、相同的假设、相同的偏见——可信度低。

**Codex**：`stage_one_system.md:561-565` 的 Phase 1 工作流引入了结构化的自我审查协议：

```markdown
Workflow:
0. Apply the minimum-signal gate（先过信号门控，无信号不处理）
1. Triage outcome using the common rules（按既定规则分类，避免主观判断）
2. Read the rollout carefully（仔细阅读执行记录，不跳过细节）
3. Return rollout_summary, rollout_slug, and raw_memory（输出结构化结果）
```

NO-OP 门控防止了"全部通过"的偏见（无信号时返回空，而不是强制生成记忆）。Outcome 标签的三值系统（success/partial/uncertain/fail）强制审查者在不确定时承认不确定（而不是默认成功）。Preference evidence 要求引号原文而非摘要，防止事后合理化。这些设计共同提高了自我审查的可信度，但仍然不如独立的外部审查。

**Gemini CLI**：它没有内建的专用 review agent，但也不只是“完全没有自我审查”。当前可用的路径包括 Hook 检查、循环检测，以及显式委派给子代理追加分析。可信度高低取决于是否真的把任务切给了新的 agent context；如果只是主循环自我反思，确认偏差仍然存在。

**OpenCode**：没有自我审查循环。质量判断完全依赖人工审批。

---

## 4. Ralph Wiggum Loop 实现

Ralph Wiggum Loop 是一个概念性描述，指的是全自动化的 PR-审查-合并循环：Agent 创建 PR → Agent（或另一个 Agent）审查 PR → Agent 响应审查意见 → Agent 合并。这是 Agent 自主工作流的理想形态，也是验证独立性要求最高的场景。

分析各工程对这个循环的支持，是为了判断它们在何种程度上支持"Agent 在最小人工干预情况下完成完整工作流"的使用场景。

**Claude Code**：无可见的 PR 流程自动化支持。AgentTool 理论上可以被用来构建类似的循环，但需要外部编排，且 AgentTool 对外部用户禁用。

**Codex**：记忆管道（Phase 1 提取 → Phase 2 整合）从逻辑上覆盖了 Wiggum Loop 的部分阶段：Phase 1 相当于"提交工作成果"，Phase 2 相当于"独立审查"，结果入 DB 相当于"合并"。但这是记忆管道的类比，不是代码 PR 流程的实现。真正的 PR 流程（git PR、GitHub API）没有内置支持。

**Gemini CLI**：无 PR 流程内置支持。MCP 接入理论上可以调用 GitHub API 来实现，但需要外部配置和编排。

**OpenCode**：无 PR 流程实现。单代理架构使这个循环需要完全依赖外部编排。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 委派模型 | **2** — AgentTool 存在但外部用户禁用，无状态隔离 | **4** — Orchestrator + DB 共享状态，角色分工明确 | **3** — GeneralistAgent + 子 Agent API，有测试覆盖 | **1** — 单代理，无委派 |
| 验证独立性 | **1** — VerifyPlanExecutionTool feature-flagged，实际死代码 | **5** — Phase 2 五重隔离（无审批、无网络、仅本地写、无递归） | **3** — Hook 独立代码路径，非进程级隔离 | **2** — Effect Layer 隔离，但单代理、验证即人工 |
| 自我审查可信度 | **1** — 同一上下文，无对抗机制 | **4** — NO-OP 门控 + outcome 标签 + 引号证据要求 | **2** — Hook 部分对冲，无专门协议 | **1** — 无自我审查循环 |
| Wiggum Loop | **1** — 无支持 | **3** — 记忆管道类比（非代码 PR） | **2** — MCP 理论上可接，需外部编排 | **1** — 单代理，无支持 |
| **综合评分 (1-5)** | **1.25** | **4** | **2.5** | **1.25** |

**核心发现**：多代理验证隔离是 Agent 工程成熟度的高水位线。目前仅有 Codex 实现了足够严格的验证隔离（Phase 2 的五重约束），其他三个工程要么是单代理（OpenCode），要么是验证工具存在但不可用（Claude Code），要么是隔离不完整（Gemini CLI 的 Hook 共享进程）。

接下来的[人类引导机制](./10-human-steering.md)，关注的是当自动化验证不足时，人类如何介入并且代价有多高。

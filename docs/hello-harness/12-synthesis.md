---
layout: content
title: "12 - 综合裁定"
---
# 综合裁定

经过前十一个维度的分析，我们已经积累了足够多的源码层面的证据。这里不做重复罗列，而是把这些证据汇合成三个层次的结论：四象限定位图（Where are they?）、评分卡（How do they compare?）、选型建议（Who should use what?）。

每一个判断都基于可观察的代码实现，不基于宣传文档或功能描述。评分的标准是"当前实现的实际效果"，而不是"设计意图的质量"。

---

## 1. 四象限定位图

横轴：**运行时连续性成熟度**（Agent 能否跨 session 积累知识、维持一致性）
纵轴：**控制平面显式化程度**（规则是否对团队透明、可审查、可版本化）

```mermaid
%%{init: {'theme': 'neutral'}}%%
quadrantChart
    title Harness Engineering 四工程定位
    x-axis 运行时连续性成熟度 (Runtime Continuity) --> 高
    y-axis 控制平面显式化程度 (Control Plane Explicitness) --> 高
    quadrant Runtime-first 高控制
    quadrant Runtime-first 低控制
    quadrant Control-plane-first 高控制
    quadrant Control-plane-first 低控制
    point "Claude Code": [0.3, 0.4]
    point "Codex": [0.7, 0.85]
    point "Gemini CLI": [0.6, 0.65]
    point "OpenCode": [0.35, 0.35]
```

### 定位说明

**Codex (0.7, 0.85)** — 右上象限：控制平面优先 + 高运行时连续性

Codex 到达右上象限的路径是清晰的：两阶段记忆管道（Phase 1/2）实现了四个工程里唯一的跨 session 知识积累，推动它在横轴上处于最右；Markdown 模板文件 + AGENTS.md 规范 + approval policy 体系使控制规则对团队全透明，推动它在纵轴上处于最高。Rust borrow checker 的编译期保证是这个定位的底层基础——它使 harness 代码的可靠性比其他工程高出一个量级。

**Gemini CLI (0.6, 0.65)** — 中右象限：运行时与控制平面的平衡

Gemini CLI 的 Hook System（BeforeModel/AfterModel 完整生命周期）和 29+ eval 文件提供了较高的运行时连续性（横轴 0.6），而 Snippet 函数组合的控制平面虽然不如 Codex 的 Markdown 文件直观，但比 Claude Code 的 TypeScript 硬编码更透明（纵轴 0.65）。Gemini CLI 是四个工程里唯一真正平衡了两个轴的工程。

**Claude Code (0.3, 0.4)** — 左中象限：运行时优先 + 低控制

Claude Code 的低运行时连续性（横轴 0.3）来自两个根因：无 GC 机制（知识不会被主动整理和更新），以及 feature flag 体系因反编译失效（本应存在的连续性特性不实际运行）。控制平面的显式度（纵轴 0.4）被 TypeScript 硬编码的规则和 1341 个 tsc 错误拖低——规则存在，但团队看到和修改的成本高。

**OpenCode (0.35, 0.35)** — 左下象限：运行时优先 + 低控制

OpenCode 的定位反映了它当前的开发阶段：单代理架构（无多代理验证）、无熵管理机制、Permission Schema 清晰但孤岛化。Effect-ts 的理论可治理性（Layer 模式、ServiceMap 依赖注入）是潜力，而不是当前实现的现实。

---

## 2. Harness Engineering 评分卡

以下评分基于源码可观察实现，每个维度满分 5 分。括号内的来源是关键证据的引用。

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------|:-----------:|:-----:|:----------:|:--------:|
| **前馈控制** | 2 | 4 | 3 | 3 |
| — 证据 | `claudemd.ts` 分层加载，但百科全书结构 + 类型系统失效 | `base_instructions/default.md` 276 行结构化 AGENTS.md 规范 | `snippets.ts:123-151` Snippet 函数组合 | `permission/index.ts:19-24` Zod Schema |
| **反馈控制** | 2 | 4 | 3 | 2 |
| — 证据 | `query.ts` 无结构化反馈，Hook feature-flagged | `stage_one_system.md:150-201` outcome 标签 + NO-OP 门控 | `hookSystem.ts:259-305` BeforeModel/AfterModel + 29+ eval | `permission/index.ts:260-264` pending list，无自动闭环 |
| **工具治理** | 2 | 4 | 3 | 3 |
| — 证据 | `tools.ts:36-112` 工具级 Allowlist，硬编码，无沙箱 | `approval_policy/` Policy + 命令分段 + 三层沙箱 | `confirmation-policy.test.ts` 三种 ApprovalMode + 完整 MCP Client | `permission/index.ts:292-307` 细粒度 Action + Pattern |
| **上下文工程** | 3 | 4 | 3 | 2 |
| — 证据 | `claudemd.ts:790-1074` 四层分层加载 | Phase 1/2 跨 session + `consolidation.md` usage-based 遗忘 | `HierarchicalMemory` 三层 + Agent 可主动写记忆 | `skill/index.ts` 目录扫描，无 Compact 策略 |
| **可驾驭性** | 2 | 5 | 3 | 2 |
| — 证据 | `tsconfig.json` ~1341 错误，类型系统归零 | Rust borrow checker 编译期保证 + crate 边界强制 | TypeScript 中等严格度 + 注册表模式 | Zod 运行时验证 + Effect Layer（非编译期） |
| **熵管理** | 1 | 5 | 2 | 1 |
| — 证据 | 无 GC，memoize 无过期 | Phase 1/2 两阶段 + usage-count 遗忘 + outcome 质量标签 | `hookSystem.ts:226-237` SessionEnd 事件（被动） | 无熵管理，仅 Effect Finalizer |
| **验证独立性** | 1 | 4 | 2 | 2 |
| — 证据 | `VerifyPlanExecutionTool` feature-flagged，死代码 | Phase 2 五重隔离（无审批/网络，只允许本地写，禁止递归） | BeforeModel/AfterModel 分离（非进程级） | Effect Layer 隔离，但单代理 |
| **团队落地** | 3 | 4 | 3 | 3 |
| — 证据 | 四层文件体系 + 条件规则 | `docs/agents_md.md` 规范 + default.md 语义 + 嵌套优先规则 | `HierarchicalMemory` 接口 + eval 验证 | `Config.directories()` + `Permission.fromConfig()` |
| **总分 (40)** | **16** | **34** | **22** | **18** |
| **均分 (5)** | **2.0** | **4.25** | **2.75** | **2.25** |

---

## 3. 三类团队的选型建议

评分卡提供的是客观对比，选型建议需要把团队的实际情况纳入考量。以下三个场景覆盖了 Agent 工具使用中最常见的痛点类型。

### a) 长会话经常失控型

症状：Agent 工作一段时间后"忘记"了最初的指令，开始做一些没有被要求的事情；或者对话太长后 Agent 开始自相矛盾。

**优先选择：Gemini CLI**

Hook System 提供 BeforeModel/AfterModel 生命周期管理（反馈控制评分 3），使每次 Agent 决策前后都能注入检查逻辑。`fireSessionEndEvent`（`hookSystem.ts:226-237`）在会话结束时触发清理，维持会话边界。Snippet 模板化使会话规则可以版本化管理，不会因为规则散落在百科全书式文档里而失控。

**为什么不是 Codex**：Codex 的控制平面优先路线要求团队先建立制度（先写好 Approval policy，先定义模板体系），才能享受控制带来的收益。对于"先跑起来，边跑边治理"的团队，这个前期投入可能太高。Gemini CLI 的 Hook System 更接近"即插即用"的控制模式。

**为什么不是 Claude Code**：feature() 始终返回 false 导致条件分支走死代码路径，即使 Claude Code 有 Hook 机制，在反编译环境下也无法依赖它实际运行。

### b) 规则来源过散、权限边界不清型

症状：团队无法说清楚哪条规则从哪里来，不同成员设置的规则互相冲突，也不知道 Agent 在某个情况下会遵守哪条规则。

**优先选择：Codex**

Approval policy 四种模式强制团队明确"什么操作需要人工审批"（工具治理评分 4）。AGENTS.md 的嵌套优先规则提供了可预测的冲突解决机制——更深嵌套的规则总是优先，直接指令总是优先于文件规则（`default.md:25-26`）。`sources/codex/docs/agents_md.md` 的规范文档让每个团队成员都能读懂规则体系，而不需要阅读源码（团队落地评分 4）。

**为什么不是 Claude Code**：Claude Code 的权限模型（`ALL_AGENT_DISALLOWED_TOOLS`）是硬编码集合，用户无法查看完整规则，无法在不修改源码的情况下调整权限边界。规则的不透明正是这类团队痛点的根源之一。

**为什么不是 OpenCode**：OpenCode 的 Permission Schema 虽然清晰，但缺少 Codex 那样的配套规范文档和冲突解决机制。团队在 OpenCode 上建立规则体系，需要自己设计协作规范，而 Codex 的规范是开箱即用的。

### c) 从零开始型

症状：团队还没有建立 Agent 工作流，想学习如何建立可控的 Agent 系统。

**两条路线并行推荐**

**Gemini CLI 路线**（学习推断型控制平面）：

- Snippet 函数组合直观：Prompt 即代码，可以单独修改和测试每个 Snippet
- 29+ eval 文件提供即时反馈循环：改一个规则，eval 立刻告诉你效果
- Hook System 是推断型前馈 + 反馈的完整示例：从这里理解 Agent 控制的实时性

**Codex 路线**（学习工程化控制）：

- 两阶段记忆管道是迄今最完整的熵管理实现：从这里理解"Agent 如何跨 session 保持一致性"
- Phase 1/2 的分离展示了如何实现验证隔离，对抗确认偏差
- Rust borrow checker 示范了编译期强制的最高水位线，理解它有助于评估其他工程的类型安全现实

**为什么不推荐从 Claude Code 开始**：反编译副作用导致大量条件分支是死代码，学习者无法从代码行为推断设计意图，容易形成错误的心智模型。Claude Code 更适合作为"分析反模式"的研究对象，而不是学习对象。

---

## 4. 一句话定性

| 工程 | 最终判断 |
| :------| :----------|
| **Claude Code** | 反编译 CLI，类型系统失灵且无熵管理，运行时优先路线因 feature flag 全部失效而沦为无控制保证的裸跑；四层文件体系是其唯一实质性的 harness 投入。 |
| **Codex** | 控制平面优先的当前标杆：Approval/Exec 双层 policy + Rust 编译期保证 + 两阶段记忆管道，是 Harness Engineering 各维度综合得分最高的实现，代价是 Rust 的入门门槛和"先建制度再跑 Agent"的时序要求。 |
| **Gemini CLI** | Hook System + Snippet 模板的平衡路线，eval 套件提供行为层面的持续验证，是"即插即用控制"的最佳实践；主要缺口是无主动熵管理和验证独立性不足，团队需自建 GC 机制。 |
| **OpenCode** | Effect-ts 架构提供理论上强大的可组合性，Permission Schema 的机械化审批是最无歧义的 harness 形式；当前阶段的主要限制是单代理、无熵管理、Skill 库孤岛化，工程成熟度仍在建设中。 |

---

*本文档由源码驱动分析生成，所有评分和结论基于 `sources/claude-code/src/`、`sources/codex/codex-rs/`、`sources/gemini-cli/packages/core/src/`、`sources/opencode/packages/opencode/src/` 的可观察实现。分析时间：2026 年，各工程版本分别为 Claude Code 2.1.87、Codex rust-v0.141.0、Gemini CLI v0.47.0、OpenCode v1.4.14。*

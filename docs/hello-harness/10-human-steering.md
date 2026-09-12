---
layout: content
title: "10 - 人类引导"
---
# 人类引导机制对比

无论自动化控制机制多么完善，人类始终是 Harness Engineering 里的终极仲裁者。Harness 的目标不是消除人类参与，而是让人类参与发生在正确的时刻、以正确的代价、产生正确的效果。

人类引导机制的质量取决于两个因素的平衡：一方面，如果审批门槛太高、操作太繁琐，人类会选择不参与（批准所有请求而不真正审查，或者完全绕过），导致实质性的控制丧失；另一方面，如果没有审批机制，人类只能在事后发现问题，修复成本更高。理想的引导机制是"在真正重要的决策上要求人类参与，在低风险操作上不打扰"。

---

## 1. 审批门槛的粒度与透明度

审批门槛定义了"什么样的 Agent 操作需要人类明确同意"。门槛太低（几乎所有操作都需要批准）会让人类疲于应对，最终产生习惯性批准；门槛太高（几乎什么都不需要批准）使人类无法有效干预危险操作。透明度则决定了人类能否看懂自己在批准什么——不透明的审批请求往往会被默认批准，而不是真正被审查。

### Claude Code

`sources/claude-code/src/constants/tools.ts:36-112` 的工具 Allowlist 把权限管理硬编码在 TypeScript 文件里。人类用户看到的是工具的允许/禁止结果，但不能看到也不能修改审批的规则本身（除非修改源码）.

**粒度**：工具级——要么整个工具被允许，要么整个工具被禁止。没有"允许这个工具但不允许这个参数组合"的表达能力。
**透明度**：低。用户知道某个工具会被允许或拒绝，但不知道原因是什么规则导致的，也无法查看完整的权限规则列表。

### Codex

`sources/codex/codex-rs/prompts/templates/permissions/approval_policy/` 的四种 policy 文件是人类可读的 Markdown 文档。团队可以直接读取这些文件，理解当前的审批策略是什么，以及为什么这样设计。

- `never.md` — 从不请求人工审批（完全信任 Agent）
- `on_failure.md` — 仅在操作失败时请求审批
- `on_request_rule_request_permission.md` — 按照显式规则决定是否请求审批
- `unless_trusted.md` — 除非 Agent 已被明确信任，否则请求审批

**粒度**：Policy + 命令分段（每个 shell 控制操作符生成的段独立评估）。
**透明度**：高。规则是 Markdown 文件，可读、可审查、可版本化。

### Gemini CLI

`confirmation-policy.test.ts` 覆盖了三种 ApprovalMode（DEFAULT / PLAN / YOLO）。三个模式之间的区别是明确的：DEFAULT 是标准交互，PLAN 是计划审查后执行，YOLO 是跳过所有确认。这个模式选择系统对用户透明——你选择了什么模式，你就知道会发生什么。

**粒度**：模式级——在同一模式内，所有工具的审批行为一致。
**透明度**：中。模式的含义是清晰的，但具体哪个操作触发确认、哪个不触发，需要了解各工具的确认策略实现。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:19-24` 的 `Action` 枚举（allow/deny/ask）加上路径模式匹配，提供了最细粒度的权限表达：每条权限规则明确对应一个路径模式和一个操作类型。`ask` 状态把决策权推给用户，但用户在决策时有具体的上下文（"你要求读取 `/etc/passwd`，是否允许？"），而不是模糊的"工具 X 请求权限"。

**粒度**：细，Pattern + Action 的组合。
**透明度**：中。Schema 定义清晰，但运行时的审批请求是否携带足够上下文取决于实现。

---

## 2. 中断与恢复的设计

当人类需要中断一个正在进行的 Agent 任务时，中断后能否恢复到有意义的状态？这个问题决定了人类干预的代价：如果中断意味着所有进度丢失、必须从头开始，人类会在"该中断时不愿中断"，导致失控任务被允许继续运行。

**Claude Code**：`/clear` 命令触发 `clearSystemPromptSections()`（`systemPromptSections.ts:60-68`），清理缓存状态。这是简单中断，无结构化恢复路径——中断后 session 重置，之前的进度不能被直接续接。中断代价高，对用户形成"不到万不得已不要中断"的心理压力。

**Codex**：`sources/codex/codex-rs/core/templates/review/history_message_interrupted.md` 专门为中断情况提供了模板。当任务被中断时，审查模板引导模型从执行记录里推断任务在中断前的进度，并生成合理的恢复建议。状态 DB 支持跨 session 恢复——Codex 的有状态架构使中断后能从接近中断点的位置继续，而不必从头开始。

**Gemini CLI**：`hookSystem.ts:220-225` 的 `fireSessionStartEvent` 在每次 session 开始时触发，这为恢复逻辑提供了注入点——Hook 实现者可以在 SessionStart 里检查是否有未完成的任务，并相应地恢复上下文。这是事件化的中断恢复：框架提供了钩子，具体恢复能力取决于 Hook 实现。

**OpenCode**：`permission/index.ts:151-160` 的 Finalizer 在 Effect 作用域结束时清理 pending 权限请求，防止未处理的权限请求永久阻塞。但没有显式的任务状态恢复机制——中断意味着 pending 请求被标记为 RejectedError，任务从这里无法续接。

---

## 3. 团队级治理文件体系

单用户使用 Agent 和团队协作使用 Agent 面临完全不同的治理挑战。在团队场景里，规则冲突（不同成员设置了互相矛盾的规则）、规则覆盖责任（谁能修改哪些规则）、规则可见性（团队成员能否看到彼此的规则设置）都成为需要解决的问题。

**Claude Code**：`claudemd.ts:1-26` 的四层文件体系（Managed → User → Project → Local）天然映射了团队责任分工：系统管理员管理 Managed 层，个人用户管理 User 和 Local 层，团队共同维护 Project 层（通过 Git）。`.claude/rules/*.md` 的条件规则使团队可以按文件路径分配不同规则集，实现"这条规则只对这个目录下的文件生效"的精细控制。

**Codex**：`sources/codex/docs/agents_md.md` 是专门给团队工程师阅读的 AGENTS.md 规范文档，解释了规则的语义、优先级和冲突解决方式。`default.md:17-27` 里的嵌套优先规则（更深嵌套的 AGENTS.md 优先级更高）提供了可预测的冲突解决机制。这是四个工程里团队治理规范最完整的实现——既有给工程师的文档，又有给 Agent 的规范。

**Gemini CLI**：`HierarchicalMemory` 的三层接口（global / extension / project）提供了清晰的责任分工框架：global 由组织配置，extension 由扩展维护，project 由项目团队协作维护。每层的来源和权威性是明确的。

**OpenCode**：`skill/index.ts:143-157` 的 `Config.directories()` 扫描和 `permission/index.ts:278-290` 的 `Permission.fromConfig()` 提供了配置驱动的治理路径。但团队协作规范（谁写 Skill、谁审批 Permission 规则、如何解决规则冲突）需要团队自行建立，没有内置的引导。

---

## 4. Steering Loop 操作成本

Steering Loop 是人类发现问题、调整 Agent 行为、验证调整效果的完整循环。这个循环的操作成本（时间、认知负担）决定了团队实际使用引导机制的频率——成本越低，引导越频繁，Agent 行为越贴近团队预期。

**Claude Code**：Steering Loop 路径是：发现问题 → 找到相关 CLAUDE.md 文件 → 编辑规则 → 测试验证 → 确认效果。问题在于：如果相关规则散落在 1166 行的单文件或多个 CLAUDE.md 里（四层体系），"找到相关规则"本身就是高成本操作。高认知负担。

**Codex**：Steering Loop 路径是：发现问题 → 确定是哪个 template 文件负责 → 编辑对应文件 → 验证。模板按功能域组织在 `templates/` 目录里，"找到相关 template"的成本远低于 Claude Code——你知道问题出在 collaboration 模式，就去 `collaboration_mode/` 目录找。中等成本。

**Gemini CLI**：Steering Loop 路径是：发现问题 → 确定是哪个 Snippet 或 Hook 负责 → 编辑 → 运行 eval 验证。Snippet 函数化意味着"找到相关代码"可以通过 grep 函数名快速完成，eval 套件提供了即时的反馈验证。中等成本，且验证成本低于其他工程（eval 直接运行，不需要 session 级的手动测试）。

**OpenCode**：Steering Loop 路径是：发现问题 → 修改 Permission Schema 或添加 Skill → Effect 层重新加载。Effect-ts 的 Layer 模式理论上支持热加载（不需要重启服务），这能显著降低验证成本。但 Permission Schema 的修改需要了解 Effect-ts，学习曲线是额外成本。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 审批门槛粒度 | **粗**（工具级 Allowlist） | **细**（Policy + 命令分段） | **中**（模式级，三种 ApprovalMode） | **细**（Pattern + Action + Deferred） |
| 审批透明度 | **低**（硬编码，用户不可见） | **高**（Markdown 文件，可读可审查） | **中**（模式语义清晰，细节需读代码） | **中**（Schema 清晰，运行时上下文依赖实现） |
| 中断恢复 | **无**（/clear 全清，不可续接） | **有**（中断模板 + DB 状态支持） | **事件化**（SessionStart Hook 注入点，恢复靠实现） | **有限**（Finalizer 清理 pending，无续接路径） |
| 团队治理完整度 | **高**（四层体系 + 条件规则，但缺少规范文档） | **最高**（工程师文档 + Agent 规范 + 嵌套优先规则） | **中**（三层接口清晰，责任分工明确） | **中**（配置驱动，但无协作规范） |
| Steering Loop 成本 | **高**（百科全书结构，找规则难） | **中**（模板按功能域组织，定位容易） | **中低**（函数化 + eval 验证，定位和验证都快） | **低**（理论热加载，但 Effect-ts 学习曲线） |
| **综合评分 (1-5)** | **2.5** | **4** | **3** | **3** |

**核心洞察**：人类引导机制质量的终极指标，不是"有多少控制点"，而是"团队实际上会不会使用这些控制点"。Claude Code 的引导机制存在（四层文件体系、工具 Allowlist），但高成本低透明度使实际使用频率可能不高；Codex 的引导机制设计得最正式（文档化、规范化），长期来看维护成本最低。

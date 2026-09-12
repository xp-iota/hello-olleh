---
layout: content
title: "07 - 可驾驭性"
---
# 可驾驭性对比

可驾驭性（Harnessability）是一个元级别的维度：它不问"这个工程目前有哪些控制机制"，而问"这个工程有多容易被继续改善"。换句话说，如果我们把 Harness Engineering 视为一个持续过程（而不是一次性配置），可驾驭性决定了这个过程的摩擦有多高。

这个维度之所以值得单独分析，是因为一个 harness 工程的当前状态和其未来演进能力往往不相关。一个当前有精细控制机制的工程，如果语言选择或架构设计使得继续添加控制点代价极高，它的可驾驭性就很低；反过来，一个当前控制较少的工程，如果代码库结构使得添加新控制点代价很低，其可驾驭性就很高。

---

## 1. 语言/框架的 Ambient Affordances

Ambient Affordance（环境承载能力）是一个借自认知科学的概念，在这里指：某种语言或框架天然提供的、不需要额外工作就能获得的控制属性。Rust 的 borrow checker 是一种 Ambient Affordance——你不需要为了得到内存安全而专门写测试，写 Rust 代码本身就创造了内存安全。这类"免费自带"的控制属性，是可驾驭性的重要来源。

### Claude Code

TypeScript 的 Ambient Affordance 包括类型系统（发现接口不兼容）和 IDE 集成（实时错误提示）。但 `sources/claude-code/tsconfig.json` 的 ~1341 tsc 错误让这些 Affordance 全部失效：当整个项目都有大量类型错误时，IDE 的错误提示失去了信号噪声比，工程师无法区分"这个新的类型错误是我引入的问题"还是"这是反编译留下的旧问题"。

**结论**：TypeScript 本应提供的 Ambient Affordance 在反编译副作用下归零。Claude Code 的可驾驭性因此严重受损——每次修改都需要承担无类型安全保证的风险。

### Codex

Rust 的 Ambient Affordance 是此次对比中最强的：

- **Borrow checker**：编译期空指针检测，无需运行程序就能发现整类错误
- **数据竞争检测**：编译期强制线程安全，并发 Bug 在运行前被消除
- **所有权系统**：资源生命周期在编译期明确，无内存泄漏可能性

这些 Affordance 使 Codex 的 harness 代码维护者能够以更高的信心添加新的控制点。当你为 Codex 添加一个新工具时，Rust 编译器会帮你验证这个工具不会引入内存问题或线程问题，而不需要运行时测试来发现这类错误。

### Gemini CLI

`sources/gemini-cli/packages/core/src/tools/tool-registry.ts` 的 TypeScript 中等严格度提供了有效的 Ambient Affordance：接口定义、返回类型标注、null 检查，这些在 IDE 里都是实时反馈。中等程度意味着：比没有类型好，但比 Rust 的编译期保证弱得多。特别是，TypeScript 的类型系统是可以被 `as any` 和 `@ts-ignore` 逃脱的，而 Rust 不允许这种逃逸。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:14` 的 `import z from "zod"` 表明 OpenCode 选择了运行时验证而非编译期验证。Zod 的 Ambient Affordance 是运行时的——它在数据实际传入时才检测不合规，而不是在代码编写时。Effect-ts 的类型系统提供了一定的编译期保证，但总体上，OpenCode 的 Ambient Affordance 强度处于运行时验证的水平。

---

## 2. 模块边界的机械执行程度

一个工程的模块边界是否被机械执行（而不只是约定遵守），决定了它的可驾驭性是否会随着代码库增长而退化。如果模块边界只靠约定，随着贡献者增加、时间流逝，边界会自然腐烂——人们为了便利会越过边界，架构约束逐渐失效。如果模块边界被编译器或运行时强制，违反边界的代码会在进入版本库前就被拒绝。

### Claude Code

`sources/claude-code/src/tools.ts:193-250` 的 `getAllBaseTools()` 显示工具按 `src/tools/<ToolName>/` 目录组织，这是好的物理隔离设计。但这只是约定，没有机械执行——任何代码都可以直接 import 另一个工具的内部实现，TypeScript 不会阻止这类跨边界引用（特别是在类型系统失效的情况下）。

**结论**：模块边界依赖约定，无机械执行。可驾驭性低。

### Codex

`sources/codex/codex-rs/app-server/src/lib.rs` 的 crate 边界是编译期强制的：

```rust
pub mod app_server_tracing;
pub mod bespoke_event_handling;
pub mod codex_message_processor;
```

在 Rust 里，`pub` 决定了哪些 API 可以跨 crate 边界访问，而这是编译器强制的——你不能从外部 crate 访问另一个 crate 的私有实现，编译器会拒绝。这使 Codex 的模块边界是真正的边界，而不只是建议性的目录组织。任何违反 crate 边界的代码都无法通过 `cargo build`，这是最强的机械执行。

### Gemini CLI

`sources/gemini-cli/packages/core/src/tools/tool-registry.ts` 的注册表模式依赖约定（你需要知道要向注册表注册工具，而不是直接使用工具实现）。TypeScript 的 `export/import` 系统提供了一定的边界控制（只有 export 的符号才能被外部访问），但 `export *` 和动态 import 等逃逸路径使这个控制不是完全机械的。

**结论**：注册表模式 + TypeScript export 边界，中等机械执行。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:138` 的 Effect Layer 定义：

```typescript
export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Permission") {}
```

Effect-ts 的 ServiceMap 模式强制依赖注入：任何需要 Permission Service 的代码都必须通过 `ServiceMap` 声明这个依赖，而不能静默使用全局变量。这是一种运行时的模块边界执行：违反依赖注入规则的代码不会在编译期报错，但会在 Effect 运行时产生明确的错误。

**结论**：Effect Layer 强制依赖注入，运行时执行，强度介于约定和编译期之间。

---

## 3. Harness Templates 潜力

Harness Templates 是指：工程里是否有可以被复用和扩展的模板机制，使得建立新的控制点不需要从零开始？一个好的 Template 系统让 harness 工程师可以"填空"而不是"从白纸写起"，大幅降低扩展成本。

### Claude Code

`systemPromptSections.ts:20-24` 的 `systemPromptSection()` 函数是一个轻量级的模板机制：

```typescript
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}
```

这允许新的 Prompt 片段以统一的方式注册，而不需要修改核心 Prompt 构建逻辑。但 feature flag 系统（`feature()` 始终返回 false）限制了条件性 Template 的有效性——你可以定义新的 feature-gated Template，但无法在反编译环境下激活它。

### Codex

`sources/codex/codex-rs/core/templates/` 目录是四个工程里最丰富的 Template 系统：

```
templates/
  agents/orchestrator.md
  collaboration_mode/
    default.md
    execute.md
    pair_programming.md
    plan.md
  compact/
    prompt.md
    summary_prefix.md
  memories/
    consolidation.md
    stage_one_input.md
    stage_one_system.md
```

每个目录对应一个功能域（协作模式、压缩、记忆），每个文件是该功能域的一个变体。添加新的协作模式，只需在 `collaboration_mode/` 添加新的 Markdown 文件——不需要修改任何代码。这是 Template 系统最大化可驾驭性的核心设计。

### Gemini CLI

`sources/gemini-cli/packages/core/src/prompts/snippets.ts` 的 Snippet 函数组合是 Template 系统的代码化实现。每个 Snippet 函数（如 `renderPreamble`、`renderCoreMandates`）都是独立的 Template，可以独立测试和修改。Snippet 函数的组合模式使得添加新的 Prompt Section 只需写一个新函数和一个测试，然后在 `getCoreSystemPrompt()` 里调用它。

### OpenCode

无独立的 Template 目录或 Template 机制可见。Skill 系统提供了部分 Template 功能（可重用的任务定义），但和 Codex 的系统级 Template 相比，缺少框架性的组织。添加新的控制点需要理解 Effect-ts 的 Service 系统，对不熟悉这个框架的工程师来说学习曲线相当高。

---

## 4. Ashby 定律视角

Ashby 的必要多样性定律（Law of Requisite Variety）说：一个控制系统必须具备至少与被控系统同等复杂度的内部多样性，才能有效控制它。在 Agent 语境里，这意味着：如果你的 harness 规则只有 5 条，但 Agent 的行为空间有 500 种情况，harness 必然覆盖不全。

Ashby 定律在工程实践里有一个推论：**有意识地约束操作空间本身就是一种有效的控制策略**——让 Agent 能做的事情更少，比建立覆盖所有情况的规则更可靠。我们观察各工程在约束 Agent 操作空间上投入了多少。

**Claude Code**：`sources/claude-code/src/constants/tools.ts:36-112` 的 Allowlist 通过精确列出允许/禁止的工具集合来约束操作空间。这是直接的拓扑承诺：通过减少 Agent 的工具选择，减少了 harness 需要覆盖的行为空间。

**Codex**：`protocol/src/prompts/permissions/approval_policy/` 的四种 policy 变体，加上 `execpolicy` 的 shell 命令约束，形成了两层正交的空间限制。Policy 模式的多样性恰好是 Ashby 定律意义上的"必要多样性"：不同的团队使用场景（从不审批 vs. 除非信任才不审批）需要不同的控制策略，四种 policy 覆盖了这个变体空间。

**Gemini CLI**：`getCoreSystemPrompt()` 的条件渲染（`planningWorkflow` 二选一）通过模式切换来约束 Agent 在特定阶段的行为空间，而 `models.ts` 的模型约束限制了推断引擎的选择空间。

**OpenCode**：`config/config.ts` 的配置 Schema 间接约束了 Agent 可以读取的操作参数空间。但当前缺少对工具调用空间的系统性限制，Agent 的行为空间仍然相对开放。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 隐式传感器强度 | **1** — 类型系统因反编译失效，归零 | **5** — Rust borrow checker，编译期内存安全 | **3** — TypeScript 中等严格度，有效但可逃逸 | **2** — Zod 运行时验证，非编译期 |
| 模块边界执行 | **1** — 仅目录约定，无机械执行 | **5** — Rust crate 边界，编译期强制 | **2** — TypeScript export + 注册表，可逃逸 | **4** — Effect Layer 强制依赖注入，运行时执行 |
| Template 潜力 | **3** — Snippet 机制存在，但 feature flag 体系失效 | **5** — 丰富模板目录，添加功能只需加文件 | **4** — Snippet 函数组合，可独立测试 | **1** — 无模板系统，每个控制点需从零建立 |
| 拓扑承诺程度 | **3** — 工具 Allowlist 有效约束行为空间 | **4** — Policy 四变体 + execpolicy 双层约束 | **3** — 模式切换 + 模型约束 | **2** — 配置 Schema 间接约束，无系统性工具约束 |
| **综合评分 (1-5)** | **2** | **4.75** | **3** | **2.25** |

**核心发现**：可驾驭性的差距比任何其他单一维度都更根本，因为它影响的不是当前状态，而是未来演进能力。Codex 在 Rust 语言选择上的可驾驭性优势是结构性的——它不能通过添加文档或配置来"补偿"，而是嵌入在语言选择里。Claude Code 的可驾驭性损失同样是结构性的：反编译副作用使类型系统失效，这不是一个可以通过"修复几行代码"来解决的问题。

可驾驭性分析到这里给了我们一个预测：Codex 的 harness 最容易持续改善，Claude Code 的改善成本最高。接下来的[熵管理](./08-entropy-management.md)会看到这个预测在持续运行场景里如何体现。

---
layout: content
title: "05 - 工具治理"
---
# 工具治理对比

工具是 Agent 与外部世界交互的唯一通道。一个 Agent 能读文件、写代码、运行命令、调用 API，全部通过工具实现——没有工具，Agent 只能输出文字，不能做任何事情。这个事实使工具治理成为 Harness Engineering 里最直接的安全杠杆：如果你能控制工具，你就能控制 Agent 能做什么。

工具治理的四个核心问题是：工具怎么注册（谁能加工具、工具的 Schema 是否类型安全）、权限粒度有多细（是工具级还是操作级）、高危操作有没有额外隔离（沙箱）、并发场景下是否安全。这四个问题的答案，共同决定了一个 Agent 工程在开放部署时的安全边界宽度。

---

## 1. 工具注册与 Schema 化方式

工具注册的方式决定了两件事：谁可以向 Agent 添加工具（扩展性），以及工具的输入输出契约是否在开发期被类型系统强制（可靠性）。一个运行时动态注册的工具系统灵活但脆弱；一个静态类型强制的系统可靠但扩展成本高。

### Claude Code

`sources/claude-code/src/tools.ts:193-250` 的 `getAllBaseTools()` 以静态枚举的方式列出所有工具：

```typescript
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool,
    FileEditTool,
    // ... 30+ 工具
  ]
}
```

`sources/claude-code/src/Tool.ts` 定义了 Tool 接口，每个工具声明 `name`、`description`、`inputSchema`（JSON Schema）。工具 Schema 是运行时对象，不是编译期类型——这意味着如果一个工具的 `inputSchema` 和它实际接受的 TypeScript 类型不一致，TypeScript 编译器不会报错，Bug 只在运行时暴露。

### Codex

`sources/codex/codex-rs/app-server/src/message_processor.rs` 的消息处理器以 Rust 类型系统作为工具 Schema 的基础。Rust 的 trait 系统强制工具实现特定的接口，而接口合规性在编译期验证。这使 Codex 的工具 Schema 是静态的、编译期保证的，这是四个工程里最强的工具注册可靠性。

### Gemini CLI

`sources/gemini-cli/packages/core/src/tools/tool-registry.ts:1-50` 的 `ToolRegistry` 是一个运行时注册表：

```typescript
export class ToolRegistry {
  getAllTools(): Tool[]
  getToolByName(name: string): Tool | undefined
  getAllToolNames(): string[]
}
```

`sources/gemini-cli/packages/core/src/tools/tool-names.ts` 定义了工具名称常量，防止字符串硬编码引入的拼写错误。这是一个务实的设计：注册表本身是运行时的，但工具名称常量提供了编译期的名称安全性。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:296-307` 通过 Permission 系统过滤工具列表，而不是直接管理工具注册：

```typescript
const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    // ...
  }
  return result
}
```

OpenCode 的架构把工具注册和权限过滤分离——工具注册在其他模块，Permission 系统只决定哪些工具在当前上下文里被允许。这是关注点分离的良好实践，但也意味着工具 Schema 的定义散落在多处。

---

## 2. 权限模型的粒度

权限模型的粒度决定了"你能以多精细的方式表达访问策略"。粗粒度的权限（如"允许/禁止这个工具"）简单但不灵活；细粒度的权限（如"允许读文件但不允许写系统目录"）表达力更强但管理复杂度更高。选择哪种粒度，取决于团队对安全边界精细程度的需求，以及他们愿意投入的管理成本。

### Claude Code

`sources/claude-code/src/constants/tools.ts:36-112` 使用工具级 Allowlist：`ALL_AGENT_DISALLOWED_TOOLS`（禁用工具集合）和 `ASYNC_AGENT_ALLOWED_TOOLS`（异步 Agent 允许工具集合）。这是粗粒度的权限模型——要么允许整个工具，要么禁止整个工具，无法表达"允许读文件但不允许写特定目录"这类中间状态。

权限规则硬编码在 TypeScript 文件里，对用户不透明——团队无法在不修改源码的情况下调整权限边界。

### Codex

`sources/codex/codex-rs/prompts/templates/permissions/approval_policy/` 的四种 Approval Policy 代表了四种不同的人工审批策略：

- `never.md` — 从不请求人工审批，完全自主
- `on_failure.md` — 仅在操作失败时请求审批
- `on_request_rule_request_permission.md` — 按需请求审批
- `unless_trusted.md` — 除非已被信任，否则请求审批

这四种 policy 不只是"允许/禁止"，而是定义了不同的信任升级路径。更重要的是，`on_request_rule_request_permission.md:29-34` 里的命令分段评估（每个 shell 控制操作符将命令分段，每段独立评估）使 Codex 能以命令段而非工具为单位执行权限检查。这是四个工程里权限粒度最细的实现。

### Gemini CLI

`sources/gemini-cli/packages/core/src/tools/confirmation-policy.test.ts` 的确认策略测试覆盖了三种 ApprovalMode（DEFAULT / PLAN / YOLO）。Tool + Confirmation 的粒度：每个工具可以独立配置是否需要确认，而不是全局统一。YOLO 模式下所有确认都被跳过，这对熟悉 Agent 行为的高级用户是有意义的——但也意味着安全边界可以被完全绕过。

### OpenCode

`sources/opencode/packages/opencode/src/permission/index.ts:19-24` 的 `Action` 枚举（allow/deny/ask）加上路径模式匹配，提供了细粒度的权限表达：

```typescript
export const Action = z.enum(["allow", "deny", "ask"]).meta({
  ref: "PermissionAction",
})
```

`ask` 的存在是 OpenCode 权限模型的独特之处：它不是简单的二元判断，而是允许"悬停"状态——权限决策被延迟到运行时，由实际执行上下文决定。这通过 `Deferred.await()` 实现（`permission/index.ts:166-201`），保证了 ask 状态下不会有竞争条件。

---

## 3. 沙箱隔离强度

权限模型控制"何时允许执行"，沙箱隔离控制"执行在什么环境里发生"。两者正交——一个没有沙箱的工程，即使有精细的权限模型，Agent 的操作也在完整的系统权限下执行；一个有沙箱的工程，即使权限模型相对粗糙，沙箱也能提供额外的失控保护层。

**Claude Code**：`sources/claude-code/src/tools/BashTool/` 无沙箱实现可见。BashTool 运行在完整的系统权限下，只有操作系统层面的权限限制。这意味着如果 Agent 在某个上下文里被允许运行 BashTool，它能执行任何当前用户有权限执行的命令——包括删除文件、修改系统配置等高危操作。

**Codex**：`unless_trusted.md:1` 中提到："Approvals are your mechanism to get user consent to run shell commands without the sandbox." 这句话的含义是：Codex 默认在沙箱内运行 shell 命令，只有获得明确批准才能在沙箱外执行。沙箱有三种模式（macos-seatbelt / generic / outside），分别对应不同的隔离强度。这是四个工程里唯一实现了系统级沙箱隔离的工程。

**Gemini CLI**：`sources/gemini-cli/packages/core/src/prompts/snippets.ts:88-93` 定义了 `SandboxMode`：

```typescript
export type SandboxMode = 'macos-seatbelt' | 'generic' | 'outside';

export interface SandboxOptions {
  mode: SandboxMode;
  toolSandboxingEnabled: boolean;
}
```

沙箱模式的类型定义存在，说明 Gemini CLI 有明确的沙箱意识，且沙箱状态是提示词的一部分（会被注入 Agent 上下文，让 Agent 知道自己在什么隔离环境里运行）。

**OpenCode**：无沙箱实现可见。工具在无隔离的环境里执行，安全边界完全依赖 Permission 系统的决策。

---

## 4. 工具调度纪律（并发安全）

当 Agent 并发调用多个工具时，工具系统的并发安全性决定了是否会出现竞争条件。在实际的 Agent 工作流里，并发工具调用是常见的（如同时读取多个文件），工具系统需要保证并发调用不会相互干扰。

**Claude Code**：`tools.ts:325-326` 的工具列表过滤基于 `isEnabled()` 检查，是同步的简单过滤。没有显式的并发控制机制，并发安全依赖底层 Bun 运行时。

**Codex**：Rust 的 Arc<Mutex<>> 等并发原语在编译期强制线程安全。Rust 的 Send 和 Sync trait 使得任何违反线程安全约束的代码都无法通过编译。这是最强的并发安全保证，完全依赖于语言层面的机械执行。

**Gemini CLI**：无独立的并发控制机制可见，依赖底层 Node.js 事件循环（单线程模型）的安全性。在 Node.js 里，同步代码不会产生数据竞争，但异步操作的顺序性依然需要注意。

**OpenCode**：`permission/index.ts:123-131` 的 State 接口使用 `Map<PermissionID, PendingEntry>` 加 `Deferred`，通过 Effect-ts 管理并发权限请求：

```typescript
interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
}
```

Effect-ts 的设计保证了 Fiber 之间的并发安全：同一个 Permission 请求不会被重复处理，多个并发请求会被独立追踪。这是通过函数式并发模型实现的并发安全，不依赖锁。

---

## 5. 高危工具约束密度

不是所有工具都是等危险的。`git commit`、`rm -rf`、写入系统目录——这些操作一旦执行就难以恢复，需要额外的约束。高危工具约束密度衡量的是：工程是否对这类操作有超出标准权限模型之外的专门约束。

**Claude Code**：`sources/claude-code/src/tools.ts:197` 的 BashTool 是核心工具，但没有针对高危命令（如 git commit/push/amend）的专门约束。所有 bash 命令在同一个权限层面执行，仅靠 Agent 的 prompt 规则来避免危险操作。约束密度低。

**Codex**：`on_request_rule_request_permission.md:29-34` 的命令分段评估对高危操作提供了细粒度约束：

```markdown
## Command segmentation reminder
The command string is split into independent command segments at shell control operators...
Each segment is evaluated independently for sandbox restrictions and approval requirements.
```

每个命令段独立评估意味着：即使一个复合命令（`cp file.txt backup/ && rm file.txt`）的整体意图是合理的，其中的高危部分（`rm file.txt`）也会被独立检查。这是四个工程里高危工具约束密度最高的实现。

**Gemini CLI**：无针对高危命令的专门约束可见，依赖 prompt 规则和 ApprovalMode 设置。中等约束密度。

**OpenCode**：`permission/index.ts:270-276` 的路径扩展（`~/` 展开为 home 目录）是一种间接的安全措施，防止路径注入。对高危命令本身没有专门约束。中等约束密度。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| 工具注册方式 | 运行时对象，JSON Schema | 静态类型，编译期验证 | 运行时注册表 + 名称常量 | Permission 过滤，关注点分离 |
| 权限粒度 | 粗（工具级 Allowlist，硬编码） | 细（Policy + 命令分段） | 中（Tool + Confirmation 模式） | 细（Action + Pattern + Deferred） |
| 沙箱强度 | 无沙箱 | 三层沙箱（macos-seatbelt/generic/outside） | 有沙箱类型定义，toolSandboxingEnabled 配置 | 无沙箱 |
| 并发安全 | 简单同步过滤 | Rust 编译期线程安全保证 | 依赖 Node.js 单线程模型 | Effect-ts Fiber 并发管理 |
| 高危约束密度 | **低** — 无分级，依赖 prompt 规则 | **高** — 命令级分段评估，独立约束 | **中** — 确认模式分级 | **中** — 路径规范化 + Deferred 审批 |
| 综合评分 (1-5) | **2** | **4** | **3** | **3** |

工具治理的核心发现与前馈、反馈评估一致：Codex 的系统性最强（沙箱 + 命令分段 + policy 层次），Claude Code 的约束密度最低（无沙箱、硬编码 Allowlist）。工具治理的分析为我们理解下一个维度——[上下文与记忆工程](./06-context-and-memory.md)——奠定了基础：工具帮助 Agent 行动，上下文决定 Agent 能看到什么来做出决定。

---
layout: content
title: "11 - 扩展机制"
---
# 扩展性与 Harness 生态对比

没有任何分析框架能覆盖所有控制维度，没有任何初始配置能预见团队未来的所有需求。扩展性衡量的是：当团队需要添加新的控制点（一个新工具、一个新权限规则、一个新的验证机制）时，代价有多高？这个代价是一次性的学习成本，还是每次扩展都要承担的结构性成本？

扩展性差的工程面临一个残酷的现实：随着团队对 Agent 行为的理解加深，他们会发现越来越多需要控制的边界情况，而如果每次添加控制点都需要大量工程工作，这些控制点最终会被放弃——不是因为不重要，而是因为成本太高。

---

## 1. MCP Server 接入方式

MCP（Model Context Protocol）是 AI 工具生态里的一个重要标准，它定义了 Agent 如何接入外部服务（数据库、代码仓库、通信工具等）。MCP 接入能力决定了工程师能否通过扩展工具集合来控制 Agent 的行为范围，而不必修改核心代码。

**Claude Code**：`sources/claude-code/src/tools/McpTool/` 实现了 MCP 工具，在 `tools.ts:245-246` 注册 `ListMcpResourcesTool` 和 `ReadMcpResourceTool`。MCP 接入是运行时的——Agent 可以在运行时发现和调用 MCP Server 提供的工具，不需要修改代码来接入新的 MCP Server。

**Codex**：`codex-rs/app-server/src/codex_message_processor/plugin_mcp_oauth.rs` 的 MCP OAuth 实现表明 Codex 通过插件架构接入 MCP Server。OAuth 支持意味着 Codex 能接入需要认证的企业级 MCP Server（如 GitHub Enterprise、Jira、Confluence），这对团队级别的工具集成有实际价值。

**Gemini CLI**：`sources/gemini-cli/packages/core/src/tools/mcp-client.ts` 的 `McpClient` 和 `mcp-client-manager.ts` 的 `McpClientManager` 构成了完整的 MCP 客户端。Client Manager 负责管理多个 MCP Server 连接的生命周期，这是四个工程里 MCP 接入最完整的实现—— MCP 不只是"能用"，而是有完整的连接管理和生命周期控制。

**OpenCode**：`sources/opencode/packages/opencode/src/mcp/index.ts` 的 `MCP` 命名空间提供了 MCP 支持。实现存在，但没有 Gemini CLI 的 Manager 层，多个 MCP Server 的连接管理需要调用方自行处理。

---

## 2. Skills/Plugin 的加载与版本化

Skills 和 Plugin 是推断型前馈的主要扩展机制：通过添加新的 Skill 文件，团队可以在不修改代码的情况下扩展 Agent 的行为指导。版本化能力决定了 Skill 库能否被当作一个独立的资产来维护和演进。

**Claude Code**：SkillTool 在工具列表里（`tools.ts:212`），通过 CLAUDE.md 的 @include 引用链加载 Skill。无版本锁定机制——Skill 内容随 CLAUDE.md 文件一起更新，没有独立的版本管理。

**Codex**：`sources/codex/.codex/skills/` 目录的 Skill 文件用 frontmatter 定义元数据，`skill-installer/SKILL.md` 的格式示例展示了结构化 Skill 的写法。frontmatter 包含版本信息，这意味着 Skill 库可以有版本化的演进路径，不同项目可以锁定到不同版本的 Skill。

**Gemini CLI**：`activate-skill.ts` 的 `ActivateSkillTool` 把 Skill 激活建模为工具调用，`snippets.ts:107-115` 负责 Skills 渲染到 System Prompt。Skill 的版本化依赖文件系统，无独立版本锁定。

**OpenCode**：`skill/index.ts:104-117` 的 `scan()` 函数支持 glob 目录扫描和 URL 远程拉取：

```typescript
const scan = async (state: State, root: string, pattern: string, opts?) => {
  return Glob.scan(pattern, {
    cwd: root,
    absolute: true,
    include: "file",
    symlink: true,
    dot: opts?.dot,
  }).then((matches) => Promise.all(matches.map((match) => add(state, match))))
}
```

URL pull 是 OpenCode Skill 系统的独特能力：团队可以把 Skill 库放在独立仓库（甚至 CDN），通过 URL 引用，实现 Skill 库的独立版本化和跨项目共享。这是四个工程里 Skill 扩展能力最强的实现。

---

## 3. 新增自定义 Lint 传感器的最小修改点

这是一个具体的扩展场景测试：如果我想为 Agent 添加一个自定义的代码质量检查工具（Lint 传感器），我需要修改哪些文件，是否需要改动核心代码？这个测试揭示了工程的扩展成本结构。

**Claude Code**：最小修改点为 3 处：

1. `src/tools/<NewLintTool>/` — 创建新工具目录和实现
2. `src/tools.ts` — 在 `getAllBaseTools()` 注册新工具
3. （如需条件启用）相关的 feature flag — 但 feature() 始终 false，等于无效

核心路径不需要修改，工具系统是解耦的。但类型系统失效使开发过程缺乏安全保证。整体中等成本。

**Codex**：最小修改点深入 Rust 代码：

1. `codex-rs/app-server/src/` — 新工具的 Rust 实现
2. `codex-rs/protocol/src/prompts/` — 如需修改 Prompt 以说明新工具的使用

Rust 的学习曲线和编译时间是实质性的成本。任何 Rust 代码修改都需要完整的编译流程（可能需要数分钟），这使迭代周期相对较长。高成本，但稳定性最高。

**Gemini CLI**：最小修改点仅 2 处：

1. `packages/core/src/tools/<NewLintTool>.ts` — 新工具实现
2. `packages/core/src/tools/tool-registry.ts` — 注册（如需要，部分工具通过自动发现注册）

不改核心，完全模块化。TypeScript 的修改-编译-测试循环比 Rust 快得多，且 eval 套件提供了即时的回归测试。低成本。

**OpenCode**：最小修改点也是 2 处：

1. `packages/opencode/src/permission/index.ts` — 新 Permission 规则（如果新工具需要特殊权限）
2. `packages/opencode/src/skill/index.ts` — 新 Skill 定义（如果新工具需要说明指令）

在 Effect-ts Layer 模式下，新工具通常不需要修改核心代码，只需在正确的 Layer 添加实现。但 Effect-ts 的概念（Fiber、Layer、ServiceMap、Effect）是额外的学习成本，对不熟悉的工程师来说入门门槛高。低成本（熟悉 Effect-ts 后）或高成本（学习期）。

---

## 4. Harness 资产的跨工程迁移可行性

当团队从一个 Agent 工程迁移到另一个时，他们积累的 Harness 资产（规则文件、Skill、Policy）能否被复用？迁移可行性高的工程使团队不必"从零开始"，能保留他们在旧工程里的控制机制投入。

**Claude Code**：CLAUDE.md 文件和 `.claude/rules/*.md` 可以直接迁移（它们是普通 Markdown 文件）。但 feature flag 系统（Anthropic 内部）不可迁移，依赖 feature flag 的控制机制在迁移后失效。百科全书式的 CLAUDE.md 在迁移到结构化要求更严格的工程时需要重组。中等迁移性。

**Codex**：`templates/` 目录下的所有 Markdown 文件、AGENTS.md 文件、approval policy .md 文件，几乎可以完整迁移到任何支持 AGENTS.md 规范的工程。Codex 的格式（Markdown + YAML frontmatter for Skill）是通用格式，与工程自身的技术栈无耦合。最高迁移性。

**Gemini CLI**：GEMINI.md 文件可以迁移，但 Snippet 函数（TypeScript 代码）需要目标工程也使用 TypeScript 环境。如果迁移目标是非 TypeScript 工程，Snippet 的形式价值消失（需要重写为目标环境的格式）。中等迁移性（取决于目标技术栈）。

**OpenCode**：Skill 文件（Markdown + frontmatter）可以迁移。Permission Schema（TypeScript + Zod）和 Effect-ts Layer 深度绑定 OpenCode 的架构，无法直接迁移。中等迁移性（Skill 可迁，架构绑定不可迁）。

---

## 总结对比表

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :-------------| :-------| :------------| :----------|
| MCP 接入 | **3** — 运行时接入，简单实用 | **3** — Plugin + OAuth，企业级认证支持 | **4** — 完整 MCP Client Manager，连接生命周期管理 | **3** — MCP 命名空间，无 Manager 层 |
| Skill 版本化 | **1** — 无独立版本管理 | **3** — frontmatter 版本化，可锁定版本 | **1** — 依赖文件系统，无版本锁定 | **2** — URL pull 支持独立仓库，但无锁定机制 |
| 扩展最小成本 | **3** — 中等（TypeScript + 注册，类型不安全） | **2** — 高（Rust 编译 + 学习曲线） | **4** — 低（模块化 TypeScript，eval 快速验证） | **3** — 低（熟悉 Effect-ts 后）或高（学习期） |
| 迁移可行性 | **3** — Markdown 资产易迁，feature flag 不可迁 | **5** — Markdown 格式通用，几乎完整迁移 | **3** — Markdown 易迁，Snippet TS 绑定 | **3** — Skill 易迁，架构层不可迁 |
| 热加载 | **1** — 无热加载，所有变更需重启 session | **1** — 无热加载 | **1** — 无热加载 | **2** — Effect Layer 理论支持，实践取决于实现 |
| **综合评分 (1-5)** | **2.2** | **2.8** | **2.6** | **2.6** |

**观察**：扩展性这个维度里，四个工程的差距没有其他维度那么大。这是因为所有工程都基于类似的"注册工具 + 编辑规则文件"的扩展模式，差别主要在执行成本（Rust vs TypeScript）和资产可移植性（Markdown 格式的通用性）。Codex 在迁移可行性上的优势（纯 Markdown 格式）是实质性的——它使 harness 资产成为工程无关的可复用资产，而不是绑定在特定技术栈里的专有配置。

扩展性分析完毕后，我们具备了评估所有维度的完整证据。[综合裁定](./12-synthesis.md)将这些证据汇合成最终的定位图、评分卡和选型建议。

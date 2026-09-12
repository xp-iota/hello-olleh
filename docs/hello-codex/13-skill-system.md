---
layout: content
title: "Skill 系统：Codex 的能力扩展与自定义指令机制"
---
# Skill 系统：Codex 的能力扩展与自定义指令机制

本文分析 Codex 的 Skill 系统，以及它和 `AGENTS.md`、MCP、Prompt 注入、TUI 管理面的关系。

**目录**

- [1. Codex 没有独立的 Skill 子系统](#1-codex-没有独立的-skill-子系统)
- [2. AGENTS.md 作为 Skill 的载体](#2-agentsmd-作为-skill-的载体)
- [Skill: 代码审查](#skill-代码审查)
- [Skill: 测试生成](#skill-测试生成)
- [3. config.toml 的 user_instructions](#3-configtoml-的-user_instructions)
- [4. MCP 工具作为 Skill 扩展点](#4-mcp-工具作为-skill-扩展点)
- [5. 与其他系统 Skill 的功能对照](#5-与其他系统-skill-的功能对照)
- [6. 评估与展望](#6-评估与展望)

---

## 1. Codex 的 Skill 子系统定位

Codex 现在有独立的 Skill 发现、解析、列举与 prompt 注入链路。它不是早期那种只靠 `AGENTS.md` 的自由文本约定，而是由 `core-skills` crate 扫描 `SKILL.md`，由 core session 把可用 skill 渲染成 `<skills_instructions>` developer block，再由 TUI 暴露 enable/disable 管理面。

其能力扩展路径为：

```
SKILL.md（专项说明与元数据）
    + .agents/skills / config skills root / bundled system skills（发现范围）
    + <skills_instructions> developer block（模型可见入口）
    + MCP/dynamic tools（依赖能力）
    + TUI skills picker（启停与可见性）
```

源码入口集中在 `sources/codex/codex-rs/core-skills/src/loader.rs:106`、`sources/codex/codex-rs/core/src/context/available_skills_instructions.rs:20`、`sources/codex/codex-rs/core/src/session/mod.rs:2581` 和 `sources/codex/codex-rs/tui/src/chatwidget/skills.rs:61`。

## 2. AGENTS.md 与 Skill 的边界

`AGENTS.md` 仍然是项目级自定义指令，但不等于 Skill 本体。`AGENTS.md` 的发现与合并由 `AgentsMdManager` 负责：它读取配置指令、向上查找 `AGENTS.md` / `AGENTS.override.md`，并拼接到 user instructions 中（`sources/codex/codex-rs/core/src/agents_md.rs:125`, `sources/codex/codex-rs/core/src/agents_md.rs:191`, `sources/codex/codex-rs/core/src/agents_md.rs:255`）。

Skill 则走另一条链路：`core-skills` 扫描 `SKILL.md`，`AvailableSkillsInstructions` 生成 developer block，二者在 prompt 中分层出现。测试还明确覆盖“skills 不追加到 AGENTS.md”的边界（`sources/codex/codex-rs/core/src/agents_md_tests.rs:491`）。

`AGENTS.md` 可以继续表达项目约束，例如：

```markdown
# AGENTS.md（项目级）

## Skill: 代码审查
当用户要求代码审查时，按以下步骤执行：
1. 读取所有被修改的文件
2. 检查以下规则：
   - 函数长度 < 50 行
   - 变量命名采用 snake_case
   - 每个公开函数都有文档注释
3. 输出结构化审查报告

## Skill: 测试生成
为每个新函数自动生成单元测试，测试框架为 pytest。
```

## 3. Skill 发现与加载

| 阶段 | 源码锚点 | 说明 |
| --- | --- | --- |
| 根目录约定 | `sources/codex/codex-rs/core-skills/src/loader.rs:106` | 使用 `.agents/skills`、`skills`、system cache 等根 |
| repo/user/system/admin scope | `sources/codex/codex-rs/core-skills/src/loader.rs:151` | `SkillRoot` 记录路径、scope 和文件系统 |
| 配置层扫描 | `sources/codex/codex-rs/core-skills/src/loader.rs:233` | 按 config layer 推导 project/user/system/admin roots |
| repo 层扫描 | `sources/codex/codex-rs/core-skills/src/loader.rs:319` | 从项目根到 cwd 搜索 `.agents/skills` |
| 去重和排序 | `sources/codex/codex-rs/core-skills/src/loader.rs:159` | repo scope 优先，然后按名称和路径稳定排序 |
| 元数据结构 | `sources/codex/codex-rs/core-skills/src/model.rs:12` | `SkillMetadata` 统一名称、描述、依赖、policy 和路径 |

TUI 启动后会触发 skills refresh（`sources/codex/codex-rs/tui/src/app.rs:956`），core 通过 `Op::ListSkills` 返回 `ListSkillsResponse`（`sources/codex/codex-rs/protocol/src/protocol.rs:736`, `sources/codex/codex-rs/core/src/session/handlers.rs:647`）。用户在管理弹窗里启停 skill 后，`ChatWidget` 会把启用的 skill metadata 写入 bottom pane / mention 上下文（`sources/codex/codex-rs/tui/src/chatwidget/skills.rs:96`, `sources/codex/codex-rs/tui/src/chatwidget/skills.rs:138`）。

## 4. Prompt 注入与 MCP 依赖

Codex 把可用 skill 渲染为 developer role 的 `<skills_instructions>` 块，而不是普通 user message。渲染模板直接定义“Discovery / Trigger rules / How to use skills / Context hygiene / Safety and fallback”等规则（`sources/codex/codex-rs/core/src/context/available_skills_instructions.rs:20`）。Session 构造 prompt 时调用 `build_available_skills`，并把渲染结果追加进 developer sections（`sources/codex/codex-rs/core/src/session/mod.rs:2581`, `sources/codex/codex-rs/core/src/session/mod.rs:2600`）。

MCP 仍然是 Skill 的能力依赖面。Skill metadata 可以携带 tool dependency（`sources/codex/codex-rs/core-skills/src/model.rs:67`, `sources/codex/codex-rs/core-skills/src/model.rs:72`），core 再通过 `mcp_skill_dependencies` 解析被提及 skill 的 MCP 依赖（`sources/codex/codex-rs/core/src/mcp_skill_dependencies.rs:36`）。

```toml
# config.toml
[[mcp_servers]]
name = "security-scanner"
command = "npx"
args = ["@security/codex-mcp"]
```

这不是“把 MCP 当 Skill”，而是 Skill 可以声明或暗示 MCP 依赖；MCP server 是否可用仍由 config、session refresh 和工具治理决定。

## 5. 与其他系统 Skill 的功能对照

| 功能 | Codex 实现 | 对应 Claude Code | 对应 Gemini CLI | 对应 OpenCode |
| :------| :-----------| :-----------------| :----------------| :--------------|
| **自定义行为** | `AGENTS.md` + `SKILL.md` | `CLAUDE.md` + Skills | `GEMINI.md` + extensions | Skill / command |
| **专项工具** | MCP / dynamic tools / local shell | MCP + 内置工具 | MCP + tools | Tool registry + MCP |
| **全局配置** | `config.toml` / profiles | settings.json | settings.json | config |
| **发现机制** | `.agents/skills`、config roots、system cache | 文件系统 | extensions/commands | registry/file |
| **版本管理** | repo/user/system scope | 文件系统 | 文件系统 | 配置/文件 |

## 6. 评估与展望

**优势**：

- 无需学习专门的 Skill API，`AGENTS.md` 是普通 Markdown
- 项目级 `AGENTS.md` 可随代码库版本化管理（git 追踪）
- MCP 生态提供丰富的专项工具

**局限**：

- 无统一 Skill 发现/安装机制（需手动配置 `AGENTS.md`）
- 不同 Skill 之间没有依赖管理
- 缺乏 Skill 的测试与验证框架

Codex 的设计已经从“配置即代码”前进到“Skill 是可发现的本地资产”。`AGENTS.md` 仍适合放团队规则，`SKILL.md` 适合放可触发、可列举、可禁用的专项工作流。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `load_skills_from_roots()` | `sources/codex/codex-rs/core-skills/src/loader.rs:153` | 从多个 root 扫描 `SKILL.md`，去重并排序 |
| `skill_roots()` | `sources/codex/codex-rs/core-skills/src/loader.rs:205` | 汇总配置层、插件和 repo `.agents/skills` 根 |
| `AvailableSkillsInstructions::body()` | `sources/codex/codex-rs/core/src/context/available_skills_instructions.rs:25` | 生成模型可见的 skills developer block |
| `build_available_skills()` | `sources/codex/codex-rs/core/src/skills.rs:27` | 暴露 skill metadata 渲染入口 |
| `handle list_skills` | `sources/codex/codex-rs/core/src/session/handlers.rs:647` | 把 skill list 作为事件返回给 UI/客户端 |
| `open_manage_skills_popup()` | `sources/codex/codex-rs/tui/src/chatwidget/skills.rs:61` | TUI 中启停 skill |
| `find_skill_mentions_with_tool_mentions()` | `sources/codex/codex-rs/tui/src/chatwidget/skills.rs:242` | 从 mention 中识别显式 skill 使用 |

---

## 代码质量评估

**优点**

- **Scope 分层清楚**：repo/user/system/admin root 分开，且 repo scope 排序优先，便于团队项目覆盖用户通用 skill。
- **Prompt 注入边界明确**：`AGENTS.md` 和 `<skills_instructions>` 分层，降低项目规则与可用 skill 列表互相污染的风险。
- **UI 管理面完整**：TUI 可以列举、启停、刷新 skill，模型侧可通过 mention 触发。

**风险与改进点**

- **执行语义仍靠 prompt discipline**：Skill 是否被正确使用，最终仍依赖模型遵守 `<skills_instructions>` 的 progressive disclosure 规则。
- **依赖链路跨层**：MCP dependency 分散在 metadata、session、config 和 tool registry，排障时需要跨多个章节阅读。
- **repo skill 的信任边界敏感**：本地仓库可提供 skill 说明，恶意仓库仍可能通过 prompt injection 改写行为，应和 approval/sandbox 一起治理。

## 横向对齐补强：Codex Skill 更接近“运行时依赖声明”

Codex 的 skill 不应按 `AGENTS.md` 文本注入理解。它同时影响 prompt、MCP dependency、tool availability 和 turn 前置准备。

| 关注点 | Codex 源码入口 | 横向对齐 |
| --- | --- | --- |
| 指令来源 | `sources/codex/codex-rs/core/src/agents_md.rs:125` | 对齐 Claude/Gemini 的项目指令文件 |
| Skill discovery | `sources/codex/codex-rs/core-skills/src/loader.rs:153` | 从 repo/user/system/admin roots 发现 `SKILL.md` |
| Skill prompt | `sources/codex/codex-rs/core/src/context/available_skills_instructions.rs:20` | 生成 developer block |
| MCP 依赖提示 | `sources/codex/codex-rs/core/src/mcp_skill_dependencies.rs:36` | Codex 特有：skill 可触发 MCP 依赖安装/提示 |
| 状态记忆 | `sources/codex/codex-rs/core/src/state/session.rs` | 记录已提示过的 MCP dependency，避免重复打扰 |

横向看，Claude/Gemini/OpenCode 的 skill 更像模型可见能力说明；Codex 的 skill 更接近运行时 dependency graph 的一部分，因此必须同时讲清“skill 如何改变工具集合和依赖提示”，而不只讲 Markdown 注入。

## Skill 对工具集合与依赖提示的影响

| 影响面 | Codex 行为 | 横向意义 |
| --- | --- | --- |
| 指令注入 | `AGENTS.md`/skill 文本进入 prompt 指令层 | 与 Claude/Gemini 项目指令相似 |
| MCP dependency | skill 可声明或触发 MCP dependency 提示 | Codex 特有，skill 参与运行时依赖图 |
| Tool availability | dependency 满足后，相关 MCP/dynamic tools 才能成为候选 | skill 不只是“建议模型使用工具” |
| Session memory | 已提示过的 dependency 被记录，避免重复打扰 | 与 OpenCode durable state、Gemini session store 对齐 |
| Turn 前准备 | turn 构造 prompt/tool specs 时需要考虑 skill dependency 状态 | 连接 `11-prompt-system.md` 与 `24-mcp-system.md` |

这也是 Codex skill 章节和 MCP 章节必须交叉阅读的原因：skill 改变的是“模型可见规则 + 运行时可用依赖”的组合，而不是单纯 Markdown 片段。

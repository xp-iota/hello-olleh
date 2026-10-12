---
title: "Prompt 系统：分节 system prompt 与懒广告 skills"
---
# Prompt 系统：分节 system prompt 与懒广告 skills

> 基于 `sources/pi/` 快照（pi v1.1.0），对照 `src/core/system-prompt.ts`、`resource-loader.ts`、`skills.ts` 与 `prompt-templates.ts` 校对。

**目录**

- [1. 分节 system prompt](#1-分节-system-prompt)
- [2. 分节 diff 与缓存](#2-分节-diff-与缓存)
- [3. AGENTS.md 式项目上下文](#3-agentsmd-式项目上下文)
- [4. skills 的懒广告](#4-skills-的懒广告)
- [5. prompt templates](#5-prompt-templates)

---

## 1. 分节 system prompt

`buildSystemPromptSections()`（`src/core/system-prompt.ts:128`）把 system prompt 组装成**有名分节的有序映射**，`preamble` 是无标签正文，其余每节用 XML 标签包裹：

| 节 | 内容 |
| --- | --- |
| `preamble` | 默认 "expert coding assistant… pi, a coding agent harness"，可整体替换 |
| `tools` | 每个工具的一行 snippet + 提示"可能还有项目自定义工具" |
| `rules` | 工具使用守则；未启用 grep/find/ls 时追加"用 bash 跑 ls/rg/find"的条件规则 |
| `docs` | 指向随包发布的 `README.md`、`docs/`、`examples/` 路径，模型被要求按主题读对应文档 |
| `addendum` | 用户配置的 `appendSystemPrompt` |
| `project_context` | `<project_instructions path=…>` 包裹的项目上下文文件 |
| `skills` | 可用 skills 广告（见第 4 节） |
| `cwd` | 当前工作目录 |

扩展通过 `sections` 传入自定义节，节名须匹配 `^[a-z][a-z0-9_-]*$` 且不得占用 `preamble`——**扩展向 system prompt 注入的是带命名空间的结构，而不是拼接字符串**。声明式隐藏工具（`prepareLoadout` 的 hidden 声明）会同时从 `tools` 节和 `rules` 节消失，但经间接工具可达时 skills 提示保留。

## 2. 分节 diff 与缓存

节结构存在的理由是 `diffSystemPromptSections()`（`:217`）：对比模型当前持有的节（从 transcript 重放得到，永不为 null）与期望的节，返回 `SystemMessage.sections` 补丁——只有变化的节被重发，全未变则返回 undefined 不发任何系统消息。切换 thinking 档位改的是 settings，`cwd` 变化只重发 `cwd` 节，系统提示的其余部分原样留在 transcript 里。这直接服务 provider prompt cache（Anthropic 等按前缀计费），与工具集增量的 `declareToolChanges` 机制同构（见 [08-performance.md](./08-performance.md) § 3）。

## 3. AGENTS.md 式项目上下文

`resource-loader.ts` 的 `loadProjectContextFiles()`（`:232`）负责把项目说明注入 `project_context` 节：

- 每个目录按优先级取**一个**上下文文件：`AGENTS.override.md` > `AGENTS.md` > `AGENTS.MD` > `CLAUDE.md` > `CLAUDE.MD`（`loadContextFileFromDir`）；
- 自 agent dir（全局）与 cwd 起**沿祖先目录向上**逐级收集，按路径去重后从浅到深拼接，即 AGENTS.md 的层级继承语义；
- `findShadowedContextFile()`（`:214`）处理一个 git 细节：嵌套的 linked worktree 与主仓库占同一逻辑范围，两个上下文文件会被应用两次，于是检测到嵌套 worktree 时把主仓库那份标记为 shadowed 跳过（普通仓库与兄弟 worktree 不受影响）；
- 文件读取统一 `stripBom()`；上下文文件**不受 project trust 门控**（`docs/security.md` 明示），但加载可用设置整体关闭。

## 4. skills 的懒广告

skill 是带 `SKILL.md`（YAML frontmatter：`name` ≤ 64 字符、`description` ≤ 1024 字符、可选 `disable-model-invocation`）的目录，发现自 `.pi/skills/`（trust-gated）、`~/.pi/agent/skills/` 与跨工具的 `~/.agents/skills/` 及祖先 `.agents/skills/`。关键设计在 `formatSkillsForPrompt()`（`src/core/skills.ts:358`）：**prompt 里只放 name 与 description**，并附一句"当任务匹配描述时，用 read 工具加载该 skill 的文件"——完整 SKILL.md 内容永远不进初始 prompt，模型按需懒读。`read` 不可用退而广告 bash，两者皆无则只说"加载"不点名工具；标记 `disable-model-invocation` 的 skill 对模型隐身（仍可被 `/skill` 手动调用）。

对照各家把整个 skill 目录塞进 context 的做法：pi 把 skills 当成"目录化的提示词缓存"，把 token 成本转移给了模型自己的 read 判断。

## 5. prompt templates

`src/core/prompt-templates.ts`：`~/.pi/agent/prompts/` 与 `.pi/prompts/`（非递归）下的 `.md` 文件各自变成一个 `/<文件名>` 斜杠命令。frontmatter 支持 `description` 与 `argument-hint`；正文用 **bash 风格参数替换**（`substituteArgs()`，`:71`）：`$1`…`$N`、`$@`、`$ARGUMENTS`、`${N:-default}` 默认值、`${@:N}` 与 `${@:N:L}` 切片。一个 markdown 文件因此既是文档又是可复用的命令模板，与 skills/扩展命令并列出现在 `getCommands()` 的统一命令面里（见 [06-extension-mcp.md](./06-extension-mcp.md)）。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/system-prompt.ts`](../../sources/pi/packages/coding-agent/src/core/system-prompt.ts)：分节组装与 diff
- [`sources/pi/packages/coding-agent/src/core/resource-loader.ts`](../../sources/pi/packages/coding-agent/src/core/resource-loader.ts)：上下文文件发现与 worktree shadowing
- [`sources/pi/packages/coding-agent/src/core/skills.ts`](../../sources/pi/packages/coding-agent/src/core/skills.ts)：skill 加载与 `formatSkillsForPrompt`
- [`sources/pi/packages/coding-agent/src/core/prompt-templates.ts`](../../sources/pi/packages/coding-agent/src/core/prompt-templates.ts)：模板扫描与参数替换
- [`sources/pi/packages/coding-agent/docs/skills.md`](../../sources/pi/packages/coding-agent/docs/skills.md)：skill 语义官方文档
- [`sources/pi/packages/coding-agent/docs/prompt-templates.md`](../../sources/pi/packages/coding-agent/docs/prompt-templates.md)：模板命令官方文档

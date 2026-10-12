---
title: "Skill 系统：SKILL.md、跨工具发现与懒加载"
---
# Skill 系统：SKILL.md、跨工具发现与懒加载

> 基于 `sources/pi/` 快照（pi v1.1.0）：`src/core/skills.ts`、`src/core/package-manager.ts` 与 `docs/skills.md` 校对。

**目录**

- [1. Skill 的形态与 frontmatter](#1-skill-的形态与-frontmatter)
- [2. 发现位置](#2-发现位置)
- [3. 目录遍历与 ignore 规则](#3-目录遍历与-ignore-规则)
- [4. formatSkillsForPrompt：懒加载广告](#4-formatskillsforprompt懒加载广告)
- [5. 与 Agent Skills 规范及 Claude Code 的兼容性](#5-与-agent-skills-规范及-claude-code-的兼容性)

---

## 1. Skill 的形态与 frontmatter

skill 是一个含 `SKILL.md` 的目录：YAML frontmatter 声明元数据，正文是给模型读的流程说明。pi 实现的是 [Agent Skills 规范](https://agentskills.io/specification)（`docs/skills.md:7`），frontmatter 只认三个字段：

| 字段 | 语义 | 长度上限 |
| --- | --- | --- |
| `name` | 调用标识 | 64 字符（`src/core/skills.ts` 中 `MAX_NAME_LENGTH`） |
| `description` | 何时该用此 skill 的自然语言描述 | 1024 字符（`MAX_DESCRIPTION_LENGTH`） |
| `disable-model-invocation` | 设为 `true` 时对模型隐藏，仅供用户显式调用 | — |

与 nanobot 的 `metadata.nanobot.requires` 需求检查不同（见 `docs/hello-nanobot/13-skill-system.md`），pi 没有"需求校验/可用性过滤"这一层——skill 是**纯 prompt 级扩展**，能力全靠既有工具兑现。

## 2. 发现位置

发现由两份代码配合：`skills.ts` 的 `loadSkills` 与 `package-manager.ts` 的资源收集。位置一览：

| 位置 | 作用域 | 门控 |
| --- | --- | --- |
| `~/.pi/agent/skills/` | 用户级 | 无 |
| `.pi/skills/`（cwd 下） | 项目级 | project trust 门控（见 [17-settings-config.md](./17-settings-config.md)） |
| `~/.agents/skills/` | 跨工具用户级 | 无 |
| `.agents/skills/`（cwd 及祖先目录，到 git 根为止） | 跨工具项目级 | 同样需要 project trust |

代码锚点：`package-manager.ts:369` 定义 `type SkillDiscoveryMode = "pi" | "agents"`，两种模式的遍历语义不同（见下节）；`:2458` 起 `collectAutoSkillEntries` 分别以 `"pi"` 模式扫 `.pi/skills` 与 `~/.pi/agent/skills`，以 `"agents"` 模式扫 `~/.agents/skills` 与祖先目录里的 `.agents/skills`（`collectAncestorAgentsSkillDirs` 向上找 `.agents` 目录）。`skills.ts:458-459` 的 `loadSkills` 在 `includeDefaults` 时加载用户与项目两个默认目录，`skillPaths` 可显式追加文件或目录；同名 skill 以先到者为准并产出 `collision` 诊断，symlink 去重靠 `canonicalizePath`。

## 3. 目录遍历与 ignore 规则

遍历尊重三个 ignore 文件：`.gitignore` / `.ignore` / `.fdignore`（`skills.ts` 的 `IGNORE_FILE_NAMES`），模式按相对 root 目录加前缀后交给 `ignore` 库；命中 `SKILL.md` 的目录即视为一个 skill，**不再向其子目录下钻**（`docs/skills.md` 的说明与实现一致）。`package-manager.ts` 的 `collectSkillEntries` 还会跳过 `node_modules` 与隐藏目录。`SkillDiscoveryMode` 决定散装 Markdown 文件的收录规则：`"pi"` 模式只在根目录收录散装 `*.md`，`"agents"` 模式则收录**子目录**里的散装 `*.md`（`package-manager.ts:432`）——前者对齐 pi 自己的"目录即 skill"约定，后者对齐 Agent Skills 规范允许的扁平文件布局。

## 4. formatSkillsForPrompt：懒加载广告

`skills.ts:358` 的 `formatSkillsForPrompt(skills, fileReadTool)` 是唯一的注入点，语义是**广告而非全文**：它先过滤掉 `disableModelInvocation` 的 skill，然后在 system prompt 的 `skills` 分区（见 `src/core/system-prompt.ts` 的 sections 结构）列出每个 skill 的 name 与 description，并明确指示模型"任务匹配时用 read 工具加载该 skill 的文件"。`fileReadTool` 参数决定指路文案：`"read"`（默认）、`"bash"`（没有 read 工具的会话）或 `"indirect"`（只能经由其他工具间接读文件）。skill 正文从不预载——只有模型主动 `read SKILL.md` 时才进入上下文，相对路径也被告知要按 skill 目录解析为绝对路径。这与 nanobot 的"摘要进 prompt、全文按需 load"两层注入是同一思路。

## 5. 与 Agent Skills 规范及 Claude Code 的兼容性

pi 的 skill 目录约定与 Claude Code 同源：两者都实现 agentskills.io 的 Agent Skills 规范，都以 `SKILL.md` + `name`/`description` frontmatter 为核心，因此一份 skill 目录在两个工具间基本可以直接复用。差异在发现位置：Claude Code 走 `.claude/skills` 系约定，pi 走 `.pi/skills` 加上**规范推荐的跨工具目录 `~/.agents/skills` 与祖先 `.agents/skills`**（`docs/skills.md:61`）——把 skill 放进 `.agents/skills` 是两个工具共享一份 skill 库的官方落点。pi 对无效字段只产出 warning 而不阻断启动（`docs/skills.md` 的措辞），兼容姿态宽松。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/skills.ts`](../../sources/pi/packages/coding-agent/src/core/skills.ts)：frontmatter 解析、ignore 规则、`formatSkillsForPrompt`
- [`sources/pi/packages/coding-agent/src/core/package-manager.ts`](../../sources/pi/packages/coding-agent/src/core/package-manager.ts)：`SkillDiscoveryMode` 与全部发现位置
- [`sources/pi/packages/coding-agent/docs/skills.md`](../../sources/pi/packages/coding-agent/docs/skills.md)：上游 skill 文档（含 agentskills.io 声明）
- [`sources/pi/packages/coding-agent/src/core/system-prompt.ts`](../../sources/pi/packages/coding-agent/src/core/system-prompt.ts)：`skills` 分区的 system prompt 组装

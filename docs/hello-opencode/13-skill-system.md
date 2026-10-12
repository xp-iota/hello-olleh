---
title: "Skill 系统：发现、路径安全与指令注入"
---
# Skill 系统：发现、路径安全与指令注入

> 基于 `sources/opencode/packages/core/src/skill/` 与 `plugin/skill` 中的 OpenCode `v2.0.27` 源码校对。

**目录**

- [1. skill 的定位](#1-skill-的定位)
- [2. 发现与路径安全](#2-发现与路径安全)
- [3. 指令注入路径](#3-指令注入路径)
- [4. 插件贡献的 skill](#4-插件贡献的-skill)

---

## 1. skill 的定位

在 v2 的扩展谱系里，skill 是**指令级扩展**：它不注册可执行工具，而是把领域指引注入 instruction 装配（见 [11-prompt-system.md](./11-prompt-system.md)）。这与 MCP（动态工具+指引）、plugin（代码级扩展）正交。

## 2. 发现与路径安全

`skill/discovery.ts` 的发现实现有两个硬约束：

- **并发限界**：skill 级并发 4、文件级并发 8，避免目录大爆炸时打满 IO。
- **路径段校验**：`isSafeSegment` / `isSafeRelativePath` 拒绝空段、`.`、`..`、正反斜杠、NUL、`?`/`#`、可解析为 URL 的值以及任何绝对路径；每个段还要经 `decodeURIComponent` 后复检。skill 内容来自磁盘与网络（实现里引入 `HttpClient`），路径安全是防注入的第一道闸。

## 3. 指令注入路径

- `skill/instructions.ts` 把当前可见的 skill 集合渲染成 `<available_skills>` 目录 instruction 来源；组合发生在 `session/context.ts`——skill 目录与 MCP 指引、项目发现、内建指引等来源按"跨会话共享度从高到低"的顺序合并成 instruction 基线，保持 prompt-cache 前缀可复用。
- skill 正文**按需加载**：模型经 skill 工具（`tool/plugin/skill.ts`）在任务匹配时才读取具体指引，返回 `<skill_content>` 块；用户直接调用 skill 时同样以该形状进入对话。
- skill 目录的变更与其它来源同律：内容哈希变化才产生 `session.instructions.updated`，正文只存一份于 `instruction_blob`；目录增删渲染为小 delta，其余变化整体重述。

## 4. 插件贡献的 skill

`plugin/skill`（目录）与 `plugin/skill.ts` 让插件作者把 skill 打包进插件分发：插件激活时其 skill 随插件 Scope 生效，关闭即随 Scope 卸载——与工具注册的 Scope 覆盖语义一致（见 [05-tool-system.md](./05-tool-system.md) §3）。

## 源码锚点

- [`sources/opencode/packages/core/src/skill/discovery.ts`](../../sources/opencode/packages/core/src/skill/discovery.ts)：发现与路径校验
- [`sources/opencode/packages/core/src/skill/instructions.ts`](../../sources/opencode/packages/core/src/skill/instructions.ts)：skill -> instruction
- [`sources/opencode/packages/core/src/session/context.ts`](../../sources/opencode/packages/core/src/session/context.ts)：instruction 来源组合
- [`sources/opencode/packages/core/src/tool/plugin/skill.ts`](../../sources/opencode/packages/core/src/tool/plugin/skill.ts)：按需加载 skill 正文的工具
- [`sources/opencode/packages/core/src/plugin/skill.ts`](../../sources/opencode/packages/core/src/plugin/skill.ts)：插件贡献 skill
- [`sources/opencode/packages/core/src/session/skill.ts`](../../sources/opencode/packages/core/src/session/skill.ts)：会话侧 skill 解析

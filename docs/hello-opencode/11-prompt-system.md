---
title: "Prompt 系统：system prompt 模板与 instruction 来源谱系"
---
# Prompt 系统：system prompt 模板与 instruction 来源谱系

> 基于 `sources/opencode/packages/core/src/session/system-prompt.ts`、`session/instructions.ts` 与 `specs/v2/session.md` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 装配模型总览](#1-装配模型总览)
- [2. system prompt 模板与工具指引注入](#2-system-prompt-模板与工具指引注入)
- [3. instruction 来源谱系](#3-instruction-来源谱系)
- [4. epoch 基线与变更渲染](#4-epoch-基线与变更渲染)
- [5. 与模型选择、compaction 的关系](#5-与模型选择compaction-的关系)

---

## 1. 装配模型总览

v2 的 prompt 装配分两层：**静态模板**（`runner/prompt/system.txt` + 按工具集注入的行为指引）与**动态 instruction 增量**（内容寻址、可重放、按 epoch 渲染基线）。模型选择影响请求装配，但本身不是 instruction 来源。

## 2. system prompt 模板与工具指引注入

`session/system-prompt.ts` 的实现非常克制：加载 `runner/prompt/system.txt`，按本次请求实际可用的工具列表条件化地拼接行为指引，替换 `${OPENCODE_TOOL_GUIDANCE}` 占位符：

- 含 `shell` 时：优先用专用工具而非 shell；不要用 `echo "====";` 之类分隔符串联 shell 命令（输出噪音会污染用户侧对话）。
- 含 `write` 时：用 write 创建或整体替换文件；定点修改优先用 edit。
- 含 `edit` 时：edit 用 `oldString` -> `newString` 精确替换，两者必须不同；默认 `oldString` 必须恰好出现一次，多处出现时扩大上下文或设 `replaceAll`。

也就是说，**system prompt 随工具集变化**，而不是一份静态文本发给所有请求——工具指引只在该工具真实可用时才出现。

## 3. instruction 来源谱系

runner 显式组合的 instruction 来源（`specs/v2/session.md` § Instructions Are Value Deltas）：

| 来源 | 说明 |
| --- | --- |
| 内建（built-ins） | 运行时自带的基础指令 |
| 环境发现（ambient discovery） | `instruction-discovery.ts` 从工作区/环境发现的指令（如 AGENTS.md 类文件） |
| 所选 agent 的 skill 指引 | 见 [13-skill-system.md](./13-skill-system.md) |
| reference | `reference.ts` 管理的引用内容 |
| MCP 指引 | MCP server 提供的 instructions（见 [24-mcp-system.md](./24-mcp-system.md)） |
| API 托管条目 | 经 API 写入的 instruction entry（`instruction-entry.ts`） |

没有可变的"指令注册表"：每个来源的值以内容寻址方式存储，变更即 delta。

## 4. epoch 基线与变更渲染

- 每次到达模型执行的 Physical Attempt 前，runner 对每个来源**并发读取恰好一次**、哈希编码值，把 delta 与新 blob 原子准入（在输入投递之前）。初始 delta 必须完整且不带更新文本；某来源不可用只阻塞初始 delta，之后静默保留已存值。
- 请求装配从存储值渲染 **epoch 基线**；后续变更在准入时渲染一次，把可选 `text` 冻结进 durable 事件，并投影为按时间序的 System 消息。
- 客户端展示的是**变更的 key**，而不是特权散文——UI 不假装知道指令正文以外的语义。

## 5. 与模型选择、compaction 的关系

- instruction epoch 跨越已完成的 compaction：`session.compaction.ended` 把 epoch 起点移到其精确序号、使当前值成为初始值，不读来源、不补写指令事件（见 [04-state-session-memory.md](./04-state-session-memory.md) §5）。
- move 保留 instruction 状态（目的地变化成为时间序更新）；committed revert 清除状态（下一边界重建基线）；fork 认领父会话最新值作基线。
- 插件侧还有 `plugin/system-prompt` 子域，允许插件参与系统提示塑造。

## 源码锚点

- [`sources/opencode/packages/core/src/session/system-prompt.ts`](../../sources/opencode/packages/core/src/session/system-prompt.ts)：模板渲染与工具指引注入
- [`sources/opencode/packages/core/src/session/runner/prompt/`](../../sources/opencode/packages/core/src/session/runner/prompt)：system.txt 模板
- [`sources/opencode/packages/core/src/session/instructions.ts`](../../sources/opencode/packages/core/src/session/instructions.ts)、[`instruction-discovery.ts`](../../sources/opencode/packages/core/src/instruction-discovery.ts)：增量与环境发现
- [`sources/opencode/packages/core/src/reference.ts`](../../sources/opencode/packages/core/src/reference.ts)：reference 来源

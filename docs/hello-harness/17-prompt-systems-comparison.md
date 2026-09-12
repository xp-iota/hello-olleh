---
layout: content
title: "17 - Prompt 系统横向对比"
---
<!-- markdownlint-disable MD060, MD024 -->

# Prompt 系统横向对比

对应项目章节：

- `docs/hello-claude-code/11-prompt-system.md`
- `docs/hello-codex/11-prompt-system.md`
- `docs/hello-gemini-cli/11-prompt-system.md`
- `docs/hello-opencode/11-prompt-system.md`

## 1. 一句话结论

| 项目 | Prompt 设计取向 |
| --- | --- |
| Claude Code | Prompt 是产品人格、工具协议、缓存稳定性和 agent 能力的核心资产 |
| Codex | Prompt 是 runtime 输入编译结果，重点在 AGENTS.md、工具声明和 turn context |
| Gemini CLI | PromptProvider 负责片段组合，现代/旧模型、技能、计划模式按运行时状态切换 |
| OpenCode | Prompt 阶段先生成 durable user message，文件、agent、resource 会被编译成 part |

## 2. 注入面矩阵

| 注入面 | Claude | Codex | Gemini | OpenCode |
| --- | --- | --- | --- | --- |
| System prompt | 静态+动态边界，强 cache 意识 | build prompt 时合成 | PromptProvider 片段组合 | LLM.stream 前组装 |
| 项目指令 | CLAUDE.md/user context | AGENTS.md | GEMINI.md/settings | `.opencode`/command/prompt |
| 工具 prompt | 工具本身携带微 prompt | tool spec 描述 | tool declaration | tool schema + system |
| Skill | Markdown/command 注入 | skills dependency | discover then activate | skill/config command |
| 文件上下文 | 工具读取或 user context | thread/context manager | config/tool 读取 | prompt 阶段编译为 part |

## 3. 关键差异

Claude Code 的文档最需要保留细节，因为它把 prompt 当成产品行为的主要控制面。Codex 的文档已经补上 prompt 与 sandbox/tool specs/thread context 的字段级关系，维护时要继续把这些字段连回采样请求。Gemini CLI 的文档要突出 `PromptProvider` 是构造器而不是最终注入点。OpenCode 要持续强调：用户输入不是直接进模型，而是先编译并持久化。

## 4. 代表源码证据

| 项目 | Prompt 构造 / 注入点 | 项目指令 | 工具 / Skill 注入 |
| --- | --- | --- | --- |
| Claude Code | `sources/claude-code/src/constants/prompts.ts`, `sources/claude-code/src/query.ts:365` | `sources/claude-code/src/context.ts` | `sources/claude-code/src/tools/AgentTool/built-in/exploreAgent.ts`, `sources/claude-code/src/skills/loadSkillsDir.ts` |
| Codex | `sources/codex/codex-rs/core/src/session/turn.rs`, `sources/codex/codex-rs/core/src/client.rs` | `sources/codex/codex-rs/core/src/agents_md.rs` | `sources/codex/codex-rs/tools/src/tool_spec.rs:17`, `sources/codex/codex-rs/core/src/compact.rs` |
| Gemini CLI | `sources/gemini-cli/packages/core/src/core/prompts.ts`, `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts` | `sources/gemini-cli/packages/core/src/prompts/snippets.ts` | `sources/gemini-cli/packages/core/src/tools/activate-skill.ts`, `sources/gemini-cli/packages/core/src/tools/tool-registry.ts:635` |
| OpenCode | `sources/opencode/packages/opencode/src/session/prompt.ts:162`, `sources/opencode/packages/opencode/src/session/processor.ts:548` | `sources/opencode/packages/opencode/src/session/prompt.ts:986` | `sources/opencode/packages/opencode/src/session/prompt.ts:1304`, `sources/opencode/packages/opencode/src/command/index.ts:117` |

## 5. 建议统一章节结构

每个 `11-prompt-system.md` 建议按以下顺序整理：

1. Prompt 的最终注入点。
2. System prompt 的静态/动态组成。
3. 项目指令和用户记忆如何进入。
4. 工具、MCP、skill、agent 的 prompt 化方式。
5. 缓存、token budget 和版本漂移风险。
6. 关键源码锚点和质量评估。

## 5.1 一次请求流验收口径

Prompt 章节要达到“深”，不能只列 prompt 文件或配置项，还要能沿一次用户请求说明每类提示词在哪个节点发挥作用：

| 请求节点 | 必须回答的问题 | 证据类型 |
| --- | --- | --- |
| 用户输入进入 turn/loop | 输入是否先经过 hooks、slash command、附件/文件引用、mention 解析 | turn/loop 入口函数、输入预处理函数 |
| 会话/项目上下文注入 | 项目指令、用户记忆、权限说明、collaboration/personality 等是否以 system、developer、user 或 part 形式进入 | context builder、prompt provider、message compiler |
| 工具能力暴露 | 工具 schema、MCP/app/plugin/skill capability 是作为 tool declaration、文本 prompt 还是 lazy discovery | tool registry、tool spec serializer、MCP exposure |
| 历史与 compact | 历史如何进入本轮请求，超限时是裁剪、摘要、替换历史还是远端 compaction | history manager、compaction prompt、resume logic |
| 最终 provider request | 最终请求对象包含哪些字段，字段来自哪里，下游如何影响采样 | request payload、client stream/send function |
| 工具结果回注 | tool call output 是否回写 history 并触发下一次 sampling request | tool handler、scheduler/follow-up loop |

以 Codex 为例，合格分析应追到 `Prompt { input, tools, base_instructions, parallel_tool_calls }`，并说明 `AGENTS.md`、skill 内容、权限说明、MCP tools、compact prompt 分别进入 `input`、`tools` 或独立 compact turn，而不是笼统说“被拼进 system prompt”。

以 Claude Code 为例，合格分析应追到 `queryLoop()` 调用模型前的 `messages + systemPrompt + tools`，并区分四条通道：`getSystemPrompt()` 生成产品级 system sections，`getUserContext()`/`prependUserContext()` 把 `CLAUDE.md` 作为 meta user context 注入，`toolToAPISchema()` 把工具 prompt/schema 暴露为 API tools，`compactConversation()` 把旧历史降级为 summary message。Claude 的难点不是缺少 prompt，而是每一层都和 prompt cache、ToolSearch/deferred tools、MCP、agent fork 交织。

## 6. 横向结论

Prompt 系统不是“字符串模板”问题，而是每个工具的前馈控制系统。谁能更稳定地把规则、上下文、工具能力和风险边界注入模型，谁的 agent 行为就更可预测。

## 7. 最终注入点对比

判断 Prompt 系统是否写深，关键不是统计有多少 prompt 文件，而是找到“最终进入模型请求”的对象。

| 项目 | 最终注入点 | 需要追的上游输入 | 需要追的下游影响 |
| --- | --- | --- | --- |
| Claude Code | `queryLoop()` / `queryModel()` 中组装后的 `messages + system + tools` | `CLAUDE.md`、memory、skill、tool prompt、permission mode、API prefix | prompt cache、ToolSearch/deferred tools、tool availability、stop hook、compact |
| Codex | `Prompt { input, tools, base_instructions, parallel_tool_calls }` | `AGENTS.md`、turn input、history、skills、MCP tools | Responses/WebSocket request、tool parallelism、approval prompt |
| Gemini CLI | `PromptProvider` 片段 + `GeminiClient` 请求上下文 | `GEMINI.md`、settings、skills list、planning mode、tools | `sendMessageStream()`、Scheduler、loop detection |
| OpenCode | durable user message + `LLM.stream()` 编译后的 system/tools/messages | command prompt、attachments、agent prompt、instruction stack、history projection | `streamText()`、tool execution、part 写回、compaction |

如果章节只讲“项目指令文件怎么读”，但没有追到最终模型请求，就仍然只是配置分析，不是 Prompt 系统分析。

## 8. 统一字段清单

每个 `11-prompt-system.md` 建议固定列出这些字段，并说明来源与优先级：

| 字段 | 为什么重要 |
| --- | --- |
| System / base instructions | 决定最高权威规则；需要说明内置、用户、项目、组织策略的合并顺序 |
| User input | 需要说明自然语言、slash command、附件、文件引用是否被预编译 |
| History / context | 决定模型看见哪些旧消息；需要和 compaction/resume 联读 |
| Tools | 需要说明 schema、描述、权限提示是否进 prompt，工具过多时如何控长 |
| Skills / extensions | 需要说明是全量注入、列表曝光、按需激活还是工具化召回 |
| Token budget / cache | 需要说明哪些内容稳定、哪些内容动态、哪些内容可能破坏缓存 |

## 9. 证据等级要求

Prompt 章节最容易把产品行为解释写成源码事实，因此建议按四类标注：

| 等级 | 使用场景 |
| --- | --- |
| 源码确认 | 有明确函数、字段、请求对象或 prompt 模板路径 |
| 链路推断 | 由多个调用点合成，例如“skill 激活后影响下一轮 prompt” |
| 版本风险 | 行号或实现易漂移，尤其是大文件里的 prompt builder |
| 设计解读 | 对行为取舍的解释，不应写成确定源码事实 |

---
layout: content
title: "Gemini CLI Prompt 系统：PromptProvider、片段组合与技能注入"
---
# Gemini CLI Prompt 系统：PromptProvider、片段组合与技能注入

当前 Gemini CLI 的 Prompt 系统，核心不是一组静态模板文件，而是 `PromptProvider` 按运行时配置拼出最终 system prompt，再把记忆与模式相关内容附到末尾。

**目录**

- [1. 入口只有一个：`PromptProvider`](#1-入口只有一个promptprovider)
- [2. Prompt 是按运行时状态动态拼出来的](#2-prompt-是按运行时状态动态拼出来的)
- [3. `snippets.ts` 才是主模板来源](#3-snippetsts-才是主模板来源)
- [4. 记忆、技能、子代理如何进入 Prompt](#4-记忆技能子代理如何进入-prompt)
- [5. Plan mode 会切换一整套提示词片段](#5-plan-mode-会切换一整套提示词片段)
- [6. 支持用环境变量覆盖系统 Prompt](#6-支持用环境变量覆盖系统-prompt)
- [7. 不要把它和 `PromptRegistry` 混淆](#7-不要把它和-promptregistry-混淆)
- [8. 关键源码锚点](#8-关键源码锚点)

---

## 1. 入口只有一个：`PromptProvider`

`sources/gemini-cli/packages/core/src/core/prompts.ts` 本身非常薄，真正的工作都在 `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts`：

- `getCoreSystemPrompt()` 生成主 system prompt
- `getCompressionPrompt()` 生成上下文压缩专用 prompt

也就是说，聊天 prompt 和压缩 prompt 是两套不同的输出，并不是同一份模板改参数。

## 2. Prompt 是按运行时状态动态拼出来的

`PromptProvider.getCoreSystemPrompt()` 会先解析当前运行态，再决定要拼哪些片段。主要输入包括：

- 当前模型，以及该模型是否支持 modern features
- 交互模式 / 非交互模式
- approval mode，尤其是 plan mode / yolo mode
- 已发现的 skills
- 已注册的 subagents
- task tracker、sandbox、git repo 等运行能力
- 当前允许使用的记忆文件名
- 已批准计划文件路径

因此，这里的 Prompt 不是“固定角色设定 + 几段说明”，而是显式依赖 `Config`、`ToolRegistry`、`AgentRegistry`、`SkillManager` 的动态产物。

## 3. `snippets.ts` 才是主模板来源

### 3.1 现代模型与旧模型用不同模板集

`PromptProvider` 会根据 `supportsModernFeatures(resolveModel(...))` 选择：

- `sources/gemini-cli/packages/core/src/prompts/snippets.ts`
- `sources/gemini-cli/packages/core/src/prompts/snippets.legacy.ts`

这意味着 Prompt 结构会随模型能力切换，而不是所有模型共用一份模板。

### 3.2 片段级拼装，而不是“大段字符串替换”

在 `snippets.ts` 里，system prompt 由多个 renderer 拼起来，例如：

- `renderPreamble`
- `renderCoreMandates`
- `renderSubAgents`
- `renderAgentSkills`
- `renderPrimaryWorkflows`
- `renderPlanningWorkflow`
- `renderOperationalGuidelines`
- `renderSandbox`
- `renderGitRepo`

最后再由 `renderFinalShell()` 追加 memory 内容。

## 4. 记忆、技能、子代理如何进入 Prompt

### 4.1 记忆不是硬编码文本

`renderFinalShell()` 会把 `userMemory` 追加到主 prompt 末尾。这里的 `userMemory` 既可能是字符串，也可能是 `HierarchicalMemory` 结构。

### 4.2 Skill 的进入方式有两步

先是**列出可用 skill**：

- `PromptProvider` 从 `SkillManager.getSkills()` 取到可用 skill
- `renderAgentSkills()` 把 skill 名称、描述、位置写进 system prompt

再是**按需激活具体 skill**：

- 激活工具：`sources/gemini-cli/packages/core/src/tools/activate-skill.ts`
- 激活结果：返回 `<activated_skill>` 包裹的 instructions 与资源目录结构

也就是说，当前实现不是“根据关键词自动触发 skill prompt”，而是先让模型知道有哪些 skill，再通过 `activate_skill` 精确启用。

### 4.3 Subagent 也会写入 prompt

`PromptProvider` 会从 `AgentRegistry` 取出所有可用 agent 定义，并通过 `renderSubAgents()` 写入 system prompt，让主代理知道有哪些可委派的子代理。

## 5. Plan mode 会切换一整套提示词片段

如果 approval mode 是 `PLAN`，`PromptProvider` 不再渲染普通工作流，而是改走 `planningWorkflow` 分支：

- 展示 plan mode 可用工具列表
- 告知 plans 目录位置
- 注入已批准计划路径

这也是为什么 Gemini CLI 的 prompt 不能只看一份静态快照，必须结合运行模式一起读。

## 6. 支持用环境变量覆盖系统 Prompt

`PromptProvider` 支持读取 `GEMINI_SYSTEM_MD`：

- 可以显式指定一个自定义 `system.md`
- 也可以通过开关关闭默认行为的一部分

如果指定了自定义文件，`PromptProvider` 会先读取文件，再做 substitutions，而不是完全跳过技能、配置等运行时信息。

## 7. 不要把它和 `PromptRegistry` 混淆

仓库里还存在 prompt registry 的概念，但那主要服务于 MCP prompt 注册。Gemini CLI 的核心 system prompt 生成链路，仍然是：

`core/prompts.ts` -> `PromptProvider` -> `snippets.ts` / `snippets.legacy.ts`

## 8. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| Prompt 总入口 | `sources/gemini-cli/packages/core/src/core/prompts.ts` | 对外暴露 system/compression prompt 接口 |
| 核心拼装器 | `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts` | 根据运行态构造 prompt |
| 现代模板片段 | `sources/gemini-cli/packages/core/src/prompts/snippets.ts` | system prompt 主模板 |
| 旧模型模板片段 | `sources/gemini-cli/packages/core/src/prompts/snippets.legacy.ts` | 兼容旧能力模型 |
| Skill 激活 | `sources/gemini-cli/packages/core/src/tools/activate-skill.ts` | 把 skill 指令显式注入上下文 |
| 记忆结构 | `sources/gemini-cli/packages/core/src/config/memory.ts` | `HierarchicalMemory` 与 flatten 逻辑 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `PromptProvider.getCoreSystemPrompt()` | `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts` | 按运行态（模式/skill/subagent/memory）动态拼装 system prompt |
| `PromptProvider.getCompressionPrompt()` | `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts` | 生成上下文压缩专用 prompt（独立于主 system prompt）|
| `renderFinalShell()` | `sources/gemini-cli/packages/core/src/prompts/snippets.ts` | 将 userMemory 追加到 system prompt 末尾 |
| `renderSubAgents()` | `sources/gemini-cli/packages/core/src/prompts/snippets.ts` | 将可用子代理定义写入 system prompt |
| `renderAgentSkills()` | `sources/gemini-cli/packages/core/src/prompts/snippets.ts` | 将 skill 名称、描述、激活位置写入 system prompt |
| `ActivateSkillTool` | `sources/gemini-cli/packages/core/src/tools/activate-skill.ts` | 将具体 skill 的指令以 `<activated_skill>` 形式注入对话上下文 |
| `supportsModernFeatures()` | `sources/gemini-cli/packages/core/src/prompts/` | 判断当前模型是否使用现代模板集（snippets vs snippets.legacy）|

---

## 代码质量评估

**优点**

- **片段级动态拼装**：`snippets.ts` 将 system prompt 分解为多个 renderer（preamble、mandates、subagents、skills、workflows 等），各片段可独立修改和测试，无单块静态字符串难维护的问题。
- **新旧模型模板分离**：根据 `supportsModernFeatures()` 选择 `snippets.ts` 或 `snippets.legacy.ts`，不同模型能力不影响彼此逻辑。
- **Skill 两步激活**：先在 system prompt 中列出可用 skill，再通过 `activate_skill` 工具精确激活，避免全量 skill 指令一次性注入导致 token 浪费。

**风险与改进点**

## 横向对齐补强：PromptProvider 是构造器，GeminiClient 是注入点

Gemini CLI 的 Prompt 系统容易被误读成 `snippets.ts` 模板集合。更准确的生命周期是：`PromptProvider` 选择和拼接片段，`GeminiClient.startChat()` / `sendMessageStream()` 才把 system instruction 和消息输入带入模型调用。

| 层级 | 源码入口 | 职责 |
| --- | --- | --- |
| 片段来源 | `sources/gemini-cli/packages/core/src/core/prompts/snippets.ts` | 维护模型/模式相关 prompt 片段 |
| PromptProvider | `sources/gemini-cli/packages/core/src/core/prompts/prompt-provider.ts` | 根据配置、模式、skill 状态生成 system prompt |
| 客户端注入 | `sources/gemini-cli/packages/core/src/core/client.ts` | start chat、更新 system instruction、发送 stream |
| CLI 回路 | `sources/gemini-cli/packages/cli/src/ui/hooks/useGeminiStream.ts` | 用户输入、工具结果 continuation 和 UI 状态联动 |

横向看，Gemini 的优势是 prompt 片段结构清楚；短板是 prompt 与工具/skill 激活之间的链路需要跨 core、cli hooks 阅读。

- **`PromptProvider` 依赖 `Config`/`ToolRegistry`/`AgentRegistry`/`SkillManager` 四个外部依赖**：测试时需要 mock 大量外部状态，单元测试复杂度较高。
- **`renderFinalShell()` 中 memory 直接字符串拼接**：HierarchicalMemory 展平后直接拼进 system prompt，没有 token 预算保护，记忆文件过大时可能推低可用 context 窗口。
- **Plan mode prompt 切换缺乏中间态**：plan mode 和普通模式是两条完全不同的 snippet 分支，若用户在会话中途手动切换 approval mode，prompt 与历史对话可能出现语义不连贯。

## 源码锚点补强：PromptProvider 构造，GeminiClient 注入

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/gemini-cli/packages/core/src/core/prompts.ts` | 对外 prompt 入口 | 对应 Codex prompt module |
| `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts` | system/compression prompt 构造器 | Gemini prompt 主体 |
| `sources/gemini-cli/packages/core/src/prompts/snippets.ts` | 现代模板片段 | 对应 Claude/Gemini 模型特化 prompt |
| `sources/gemini-cli/packages/core/src/tools/activate-skill.ts` | skill 激活工具把指令注入上下文 | 与 skill 章节联读 |
| `sources/gemini-cli/packages/core/src/core/client.ts:354` | `updateSystemInstruction()` 注入 system instruction | Prompt 进入模型会话的位置 |
| `sources/gemini-cli/packages/core/src/core/client.ts:883` | `sendMessageStream()` 使用已构造 prompt 和 history | 连接 agent loop |

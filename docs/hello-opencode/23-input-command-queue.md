---
layout: content
title: "OpenCode 深度专题 B14：用户输入编译、命令队列与执行流程"
---

# OpenCode 深度专题 B14：用户输入编译、命令队列与执行流程

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

---

**目录**

- [1. 概述：用户输入如何变成 Durable Message](#1-概述用户输入如何变成-durable-message)
- [2. PromptInput 编译流程](#2-promptinput-编译流程)
- [3. Part 类型与编译逻辑](#3-part-类型与编译逻辑)
- [4. 命令系统](#4-命令系统)
- [5. Shell 命令执行](#5-shell-命令执行)
- [6. Session Loop 与消息流](#6-session-loop-与消息流)
- [7. 关键数据结构汇总](#7-关键数据结构汇总)
- [8. 代码级结论](#8-代码级结论)

---

## 1. 概述：用户输入如何变成 Durable Message

OpenCode 的消息系统核心是 `MessageV2`（`sources/opencode/packages/opencode/src/session/message-v2.ts`），它将所有用户输入编译成 `MessageV2.Info` + `MessageV2.Part[]` 的结构，持久化到 SQLite。

### 1.1 核心数据类型

```ts
// opencode/packages/opencode/src/session/message-v2.ts:351-375
export const User = Base.extend({
  role: z.literal("user"),
  time: z.object({ created: z.number() }),
  format: Format.optional(),           // text | json_schema
  summary: Summary.optional(),
  agent: z.string(),                   // agent 名称
  model: z.object({ providerID, modelID }),
  system: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(), // deprecated
  variant: z.string().optional(),
})

// opencode/packages/opencode/src/session/message-v2.ts:104-119
export const TextPart = PartBase.extend({
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),   // 系统合成内容
  ignored: z.boolean().optional(),
  time: z.object({ start, end }).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

// opencode/packages/opencode/src/session/message-v2.ts:175-184
export const FilePart = PartBase.extend({
  type: z.literal("file"),
  mime: z.string(),
  filename: z.string().optional(),
  url: z.string(),                      // data: | file: | mcp resource
  source: FilePartSource.optional(),     // file | symbol | resource
})
```

---

## 2. PromptInput 编译流程

### 2.1 `SessionPrompt.PromptInput` 结构

`sources/opencode/packages/opencode/src/session/prompt.ts:95-160` 定义了输入格式：

```ts
export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z.object({ providerID, modelID }).optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(),
  format: MessageV2.Format.optional(),   // text | json_schema
  system: z.string().optional(),
  variant: z.string().optional(),
  parts: z.array(z.discriminatedUnion("type", [
    MessageV2.TextPart.omit({...}).partial(),
    MessageV2.FilePart.omit({...}).partial(),
    MessageV2.AgentPart.omit({...}).partial(),
    MessageV2.SubtaskPart.omit({...}).partial(),
  ]))
})
```

### 2.2 `createUserMessage()` 编译步骤

`sources/opencode/packages/opencode/src/session/prompt.ts:986-1387` 是核心编译函数：

```ts
async function createUserMessage(input: PromptInput) {
  // Step 1: 确定 agent
  const agentName = input.agent || (await Agent.defaultAgent())
  const agent = await Agent.get(agentName)
  
  // Step 2: 确定 model
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  
  // Step 3: 构建 MessageV2.Info
  const info: MessageV2.Info = {
    id: input.messageID ?? MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    time: { created: Date.now() },
    agent: agent.name,
    model,
    format: input.format,
    ...
  }
  
  // Step 4: 编译 parts（按类型处理）
  const parts = await Promise.all(
    input.parts.map(async (part) => {
      if (part.type === "file") return compileFilePart(part)
      if (part.type === "agent") return compileAgentPart(part)
      return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
    })
  )
  
  // Step 5: 持久化
  await Session.updateMessage(info)
  for (const part of parts) {
    await Session.updatePart(part)
  }
}
```

---

## 3. Part 类型与编译逻辑

### 3.1 FilePart 编译

`sources/opencode/packages/opencode/src/session/prompt.ts:1031-1299` 对不同协议处理不同：

| 协议 | 处理方式 |
| :------| :----------|
| `data:` | 直接提取文本或 base64 内容 |
| `file:` | 调用 `ReadTool` 读取文件内容，生成合成文本 |
| `mcp:resource` | 调用 `MCP.readResource()` 获取 MCP resource 内容 |

```ts
// MCP resource 处理
if (part.source?.type === "resource") {
  const { clientName, uri } = part.source
  const resourceContent = await MCP.readResource(clientName, uri)
  // 提取 text 或 blob 生成合成文本
}

// file:// 处理
if (url.protocol === "file:") {
  const result = await ReadTool.init().then(t => t.execute(args, readCtx))
  pieces.push({ type: "text", text: result.output, synthetic: true })
}
```

### 3.2 AgentPart 编译

`sources/opencode/packages/opencode/src/session/prompt.ts:1303-1326` 将 `@agent` 引用转成 task 调用：

```ts
if (part.type === "agent") {
  return [
    { ...part, messageID: info.id, sessionID: input.sessionID },
    {
      messageID: info.id,
      sessionID: input.sessionID,
      type: "text",
      synthetic: true,
      text: "Use the above message and context to generate a prompt and call the task tool with subagent: " + part.name
    }
  ]
}
```

---

## 4. 命令系统

### 4.1 Command 定义

`sources/opencode/packages/opencode/src/command/index.ts:33-51`：

```ts
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  source: z.enum(["command", "mcp", "skill"]),  // 命令来源
  template: z.promise(z.string()).or(z.string()), // 模板内容
  subtask: z.boolean().optional(),                 // 是否作为子任务执行
  hints: z.array(z.string()),                     // $1, $2, $ARGUMENTS 等
})
```

### 4.2 命令来源

`sources/opencode/packages/opencode/src/command/index.ts:75-158` 整合三类命令：

| 来源 | 获取方式 |
| :------| :----------|
| 内置命令 | `init`, `review` - 硬编码模板 |
| 用户自定义命令 | `config.command` - 用户配置文件 |
| MCP Prompts | `MCP.prompts()` - 来自 MCP server |
| Skills | `Skill.all()` - 来自 skill 系统 |

### 4.3 命令执行流程

`sources/opencode/packages/opencode/src/session/prompt.ts:1823-1844`：

```ts
export async function command(input: CommandInput) {
  // Step 1: 获取命令定义
  const command = await Command.get(input.command)
  
  // Step 2: 解析参数（支持 $1, $2, $ARGUMENTS）
  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map(arg => arg.replace(quoteTrimRegex, ""))
  
  // Step 3: 填充模板占位符
  let template = withArgs.replaceAll(placeholderRegex, ...)
  template = template.replaceAll("$ARGUMENTS", input.arguments)
  
  // Step 4: 执行 shell 插值
  const shellMatches = ConfigMarkdown.shell(template)
  for (const [, cmd] of shellMatches) {
    const out = await Process.text([cmd], { shell: sh, nothrow: true })
    template = template.replace(bashRegex, () => results[index++])
  }
  
  // Step 5: 决定执行方式
  const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
  
  if (isSubtask) {
    // 生成 SubtaskPart，由 loop 中的 task handler 执行
    parts = [{
      type: "subtask",
      agent: agent.name,
      prompt: templateParts.find(y => y.type === "text")?.text ?? "",
      ...
    }]
  }
  
  // Step 6: 调用 prompt
  return prompt({ sessionID, messageID, model, agent, parts, variant })
}
```

---

## 5. Shell 命令执行

### 5.1 `shell()` 函数

`sources/opencode/packages/opencode/src/session/prompt.ts:1541-1788` 处理用户 shell 命令：

```ts
export async function shell(input: ShellInput) {
  // Step 1: 创建 user message 和 assistant message
  const userMsg: MessageV2.User = { id: MessageID.ascending(), role: "user", ... }
  const msg: MessageV2.Assistant = { id: MessageID.ascending(), role: "assistant", ... }
  
  // Step 2: 创建 tool part 表示正在运行的命令
  const part: MessageV2.Part = {
    type: "tool",
    tool: "bash",
    callID: ulid(),
    state: { status: "running", time: { start: Date.now() }, input: { command } }
  }
  
  // Step 3: spawn shell 进程
  const proc = spawn(shell, args, { cwd, env: { ...process.env, TERM: "dumb" } })
  
  // Step 4: 捕获 stdout/stderr 实时更新 part
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
    part.state.metadata = { output, description: "" }
    Session.updatePart(part)  // 实时流式更新
  })
  
  // Step 5: 等待进程结束，更新 part 状态
  await new Promise(resolve => proc.on("close", resolve))
  part.state = { status: "completed", output, time: { start, end } }
}
```

### 5.2 支持的 Shell

`sources/opencode/packages/opencode/src/session/prompt.ts:1648-1693` 支持多种 shell：

```ts
const invocations = {
  nu: { args: ["-c", input.command] },
  fish: { args: ["-c", input.command] },
  zsh: { args: ["-c", "-l", `source ~/.zshenv && source ~/.zshrc && eval ${cmd}`] },
  bash: { args: ["-c", "-l", `source ~/.bashrc && eval ${cmd}`] },
  cmd: { args: ["/c", input.command] },
  powershell: { args: ["-NoProfile", "-Command", input.command] },
  pwsh: { args: ["-NoProfile", "-Command", input.command] },
}
```

---

## 6. Session Loop 与消息流

### 6.1 Loop 架构

`sources/opencode/packages/opencode/src/session/prompt.ts:278-756` 是核心处理循环：

```ts
export const loop = fn(LoopInput, async (input) => {
  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  
  let step = 0
  while (true) {
    await SessionStatus.set(sessionID, { type: "busy" })
    
    // 获取消息历史
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
    
    // 找到最后一个 user message 和 assistant message
    let lastUser, lastAssistant, lastFinished
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (!lastUser && msg.info.role === "user") lastUser = msg
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg
      if (!lastFinished && msg.info.finish) lastFinished = msg
    }
    
    // 检查是否需要退出
    if (lastFinished && !["tool-calls", "unknown"].includes(lastFinished.finish)) {
      break
    }
    
    // 处理 pending subtask
    if (task?.type === "subtask") {
      const result = await TaskTool.execute(taskArgs, taskCtx)
      continue
    }
    
    // 处理 pending compaction
    if (task?.type === "compaction") {
      await SessionCompaction.process({ messages: msgs, ... })
      continue
    }
    
    // 正常 LLM 调用
    const tools = await resolveTools({ agent, model, ... })
    const result = await processor.process({ user: lastUser, agent, tools, ... })
    
    if (result === "stop") break
    if (result === "compact") { /* 触发 compaction */ }
  }
})
```

### 6.2 消息流图

```
HTTP Request (prompt/command/shell)
         │
         ▼
   SessionPrompt.prompt/command/shell
         │
         ▼
   createUserMessage() ──► MessageV2.Info + Parts
         │
         ▼
   Session.updateMessage() ──► SQLite
   Session.updatePart()
         │
         ▼
   SessionPrompt.loop()
         │
    ┌────┴────┐
    ▼         ▼
 Subtask?   正常 LLM
    │         │
    ▼         ▼
 TaskTool  processor.process()
 execute   ──► LLM API
    │         │
    ▼         ▼
 结果写入   tool calls
 Session   ──► 结果写入
    │         │
    └────┬────┘
         ▼
    循环/停止
```

---

## 7. 关键数据结构汇总

| 结构 | 位置 | 用途 |
| :------| :------| :------|
| `PromptInput` | `sources/opencode/packages/opencode/src/session/prompt.ts:95-160` | HTTP API 输入格式 |
| `MessageV2.Info` | `sources/opencode/packages/opencode/src/session/message-v2.ts:351-375` | User/Assistant 消息元信息 |
| `MessageV2.Part` | `sources/opencode/packages/opencode/src/session/message-v2.ts:377-395` | 消息内容片段（text/file/tool等） |
| `TextPart` | `sources/opencode/packages/opencode/src/session/message-v2.ts:104-119` | 纯文本片段 |
| `FilePart` | `sources/opencode/packages/opencode/src/session/message-v2.ts:175-184` | 文件/资源片段 |
| `ToolPart` | `sources/opencode/packages/opencode/src/session/message-v2.ts:335-344` | 工具调用记录 |
| `Command.Info` | `sources/opencode/packages/opencode/src/command/index.ts:33-51` | 命令定义 |
| `CommandInput` | `sources/opencode/packages/opencode/src/session/prompt.ts:1790-1811` | 命令执行输入 |

---

## 8. 代码级结论

> OpenCode 的输入系统将 HTTP API 输入通过 `PromptInput` 规范化为 `MessageV2.Info + Parts[]`，经过 `createUserMessage()` 编译成可持久化结构。命令系统通过 `Command` 服务整合内置/自定义/MCP/Skill 四类来源，`command()` 函数负责模板填充和执行路由。Shell 命令通过 `shell()` 直接 spawn 进程并流式更新 `ToolPart`。所有输入最终进入 `SessionPrompt.loop()` 处理循环，由 `processor.process()` 与 LLM 交互，工具调用结果写回 Session。

---

## 代码质量评估

**优点**

- **`PromptInput` 统一用户输入的中间表示**：不同来源（键盘/stdin/args/drag-drop）统一编译为 `PromptInput`，下游 `prompt()` 无需区分来源。
- **Command 系统统一内建+MCP+Skill**：slash command 汇总内建/MCP prompts/Skill，单一查询点，用户使用体验一致。
- **Durable 写盘前的 plugin hook**：`chat.message` hook 允许在 user message 落库前改写内容，保证 durable 中存的是最终结果而非原始输入。

## 跨工具横向对比

本章（OpenCode）与同主题其他工具的差异：

| 维度 | Claude Code | Codex | Gemini CLI | OpenCode |
| :------| :------------| :-------| :------------| :----------|
| 核心主题 | Slash 命令 + QueryGuard 并发控制 | Mailbox + Command Canonicalization + Exec | CommandService + Shell 状态 | PromptInput 编译 + Durable Message |
| 独有机制 | `QueryGuard` 防并发 query | `Mailbox` 跨 Agent 通信 | `Shell 状态管理` | `Part` 编译类型系统 |
| 命令返回 | 可改变工具/模型/effort | 命令规范化元数据 | CommandService 统一分发 | 模板化 command 编译 |
| 架构驱动 | 单 Agent，query 并发控制 | 多 Agent，Mailbox 通信 | 单 Agent，Shell 状态隔离 | Durable State，输入即消息 |

**要点**：Codex 因有多 Agent 架构（含 child-agents），其队列系统加入了 Mailbox 机制和命令规范化，远比其他三个工具复杂；其他三者均面向单 Agent，核心问题是"slash 命令解析 + 输入队列调度"。

**风险与改进点**

- **`prompt()` 编译顺序硬编码**：Part 编译、plugin 调用、校验、写盘的顺序写死在函数体中，不可配置，新增步骤需要修改 `prompt()` 主函数。
- **Command 无限速机制**：用户高频触发 slash command（如批量自动化场景）无速率保护，可能触发大量 LLM 调用或 MCP 请求。
- **Shell 命令执行无超时默认值**：bash 工具执行 shell 命令时，若无显式超时配置，长时间运行的命令会卡住整个 session loop。

## 横向对齐补强：OpenCode 输入先进入 server contract

OpenCode 的输入队列要从 Hono route 和 server contract 开始读：prompt、command、shell、permission reply 都是 HTTP/API/TUI 表面进入 session runtime 的不同入口。

| 输入类型 | OpenCode 侧入口 | 横向对比 |
| --- | --- | --- |
| prompt | `sources/opencode/packages/opencode/src/server/routes/instance/session.ts` -> `SessionPrompt.prompt()` | durable user message 编译 |
| command | `SessionPrompt.command()` | 对应 Gemini slash command |
| shell | `SessionPrompt.shell()` | 直接生成 shell 类输入 |
| permission reply | `Permission.reply()` route | 和 durable permission request 配合 |
| TUI event | `sources/opencode/packages/opencode/src/server/routes/instance/tui.ts` / Bus | 多表面输入统一投影 |

横向看，OpenCode 的输入队列优势是 server-first；风险是每类输入都可能触发 durable 写和 session busy 检查，文档应明确并发闸门位置。

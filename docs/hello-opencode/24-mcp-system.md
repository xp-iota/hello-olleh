---
layout: content
title: "OpenCode 深度专题 B15：MCP 工具/Prompt/Resource 发现与工具调用流程"
---

# OpenCode 深度专题 B15：MCP 工具/Prompt/Resource 发现与工具调用流程

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

> B13（33-mcp-details.md）讲了 MCP 的状态机和认证流程，本文聚焦工具/Prompt/Resource 的发现机制和完整调用链。

---

**目录**

- [1. MCP 在 OpenCode 中的角色矩阵](#1-mcp-在-opencode-中的角色矩阵)
- [2. 工具发现：`MCP.tools()`](#2-工具发现mcptools)
- [3. Prompt 发现：`MCP.prompts()`](#3-prompt-发现mcpprompts)
- [4. Resource 发现与读取](#4-resource-发现与读取)
- [5. MCP Tool 调用完整链路](#5-mcp-tool-调用完整链路)
- [6. MCP Resource 在 Message 编译时的读取](#6-mcp-resource-在-message-编译时的读取)
- [7. 工具名称 sanitize 规则](#7-工具名称-sanitize-规则)
- [8. ToolsChanged 通知与动态感知](#8-toolschanged-通知与动态感知)
- [9. 关键数据结构汇总](#9-关键数据结构汇总)
- [10. 代码级结论](#10-代码级结论)

---

## 1. MCP 在 OpenCode 中的角色矩阵

| MCP 角色 | 发现函数 | OpenCode 投影 |
| :----------| :----------| :---------------|
| Tool 来源 | `tools()` | AI SDK `Tool`，通过 `ToolRegistry.tools()` 合并 |
| Prompt 来源 | `prompts()` | `Command`，通过 `Command.list()` 暴露 |
| Resource 来源 | `resources()` / `readResource()` | FilePart，在 `createUserMessage()` 时按需读取 |

---

## 2. 工具发现：`MCP.tools()`

### 2.1 发现流程

`scc/mcp/index.ts:606-646`：

```ts
export async function tools() {
  const result: Record<string, Tool> = {}
  const s = await state()
  const clientsSnapshot = await clients()
  
  // 过滤出 connected 的 client
  const connectedClients = Object.entries(clientsSnapshot).filter(
    ([clientName]) => s.status[clientName]?.status === "connected"
  )
  
  // 并发获取所有 client 的 tools
  const toolsResults = await Promise.all(
    connectedClients.map(async ([clientName, client]) => {
      const toolsResult = await client.listTools()
      return { clientName, client, toolsResult }
    })
  )
  
  // 转换每个 tool
  for (const { clientName, client, toolsResult } of toolsResults) {
    const mcpConfig = config[clientName]
    const timeout = entry?.timeout ?? defaultTimeout
    
    for (const mcpTool of toolsResult.tools) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      
      // 格式：clientName_toolName
      result[sanitizedClientName + "_" + sanitizedToolName] = 
        await convertMcpTool(mcpTool, client, timeout)
    }
  }
  return result
}
```

### 2.2 Tool 转换：`convertMcpTool()`

`scc/mcp/index.ts:121-149`：

```ts
async function convertMcpTool(
  mcpTool: MCPToolDef, 
  client: MCPClient, 
  timeout?: number
): Promise<Tool> {
  // 把 MCP 的 JSON Schema 转成 AI SDK 的 jsonSchema
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: inputSchema.properties ?? {},
    additionalProperties: false,
  }
  
  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      // 直接调用 MCP client 的 callTool
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        }
      )
    },
  })
}
```

---

## 3. Prompt 发现：`MCP.prompts()`

### 3.1 发现流程

`scc/mcp/index.ts:648-667`：

```ts
export async function prompts() {
  const s = await state()
  const clientsSnapshot = await clients()
  
  const prompts = Object.fromEntries<PromptInfo & { client: string }>(
    (
      await Promise.all(
        Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
          if (s.status[clientName]?.status !== "connected") return []
          return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
        })
      )
    ).flat()
  )
  return prompts
}
```

### 3.2 单 Client Prompt 获取

`scc/mcp/index.ts:247-267`：

```ts
async function fetchPromptsForClient(clientName: string, client: Client) {
  const prompts = await client.listPrompts()
  const commands: Record<string, PromptInfo & { client: string }> = {}
  
  for (const prompt of prompts.prompts) {
    const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
    const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
    const key = sanitizedClientName + ":" + sanitizedPromptName
    
    commands[key] = { ...prompt, client: clientName }
  }
  return commands
}
```

### 3.3 Prompt 投影为 Command

`command/index.ts:117-140` 将 MCP prompts 变成可执行命令：

```ts
for (const [name, prompt] of Object.entries(yield* Effect.promise(() => MCP.prompts()))) {
  commands[name] = {
    name,
    source: "mcp",
    description: prompt.description,
    get template() {
      // 懒加载：实际调用时才获取 prompt 内容
      return new Promise<string>(async (resolve, reject) => {
        const template = await MCP.getPrompt(
          prompt.client,
          prompt.name,
          prompt.arguments
            ? Object.fromEntries(prompt.arguments.map((arg, i) => [arg.name, `$${i + 1}`]))
            : {}
        ).catch(reject)
        
        resolve(
          template?.messages
            .map(msg => msg.content.type === "text" ? msg.content.text : "")
            .join("\n") || ""
        )
      })
    },
    hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
  }
}
```

---

## 4. Resource 发现与读取

### 4.1 Resource 发现

`scc/mcp/index.ts:669-688`：

```ts
export async function resources() {
  const s = await state()
  const clientsSnapshot = await clients()
  
  const result = Object.fromEntries<ResourceInfo & { client: string }>(
    (
      await Promise.all(
        Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
          if (s.status[clientName]?.status !== "connected") return []
          return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
        })
      )
    ).flat()
  )
  return result
}
```

### 4.2 Resource 读取

`scc/mcp/index.ts:718-743`：

```ts
export async function readResource(clientName: string, resourceUri: string) {
  const clientsSnapshot = await clients()
  const client = clientsSnapshot[clientName]
  
  if (!client) {
    log.warn("client not found for prompt", { clientName })
    return undefined
  }
  
  return client.readResource({ uri: resourceUri }).catch(e => {
    log.error("failed to get prompt from MCP server", { clientName, resourceUri, error: e.message })
    return undefined
  })
}
```

---

## 5. MCP Tool 调用完整链路

### 5.1 Tool 整合进 ToolRegistry

`sesson/prompt.ts:860-951` 在 `resolveTools()` 中将 MCP tools 合并：

```ts
async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  ...
}) {
  const tools: Record<string, AITool> = {}
  
  // Step 1: 获取内置 tools（通过 ToolRegistry）
  for (const item of await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )) {
    tools[item.id] = tool({ id: item.id, ... })
  }
  
  // Step 2: 追加 MCP tools
  for (const [key, item] of Object.entries(await MCP.tools())) {
    // 转换 schema
    const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
    item.inputSchema = jsonSchema(transformed)
    
    // 包装 execute 添加 plugin hooks
    item.execute = async (args, opts) => {
      const ctx = context(args, opts)
      
      // 触发 before hook
      await Plugin.trigger("tool.execute.before", { tool: key, ... }, { args })
      
      // 权限检查
      await ctx.ask({
        permission: key,
        metadata: {},
        patterns: ["*"],
        always: ["*"],
      })
      
      // 执行
      const result = await execute(args, opts)
      
      // 触发 after hook
      await Plugin.trigger("tool.execute.after", { tool: key, ... }, result)
      
      // 格式化输出
      const textParts: string[] = []
      const attachments: Omit<MessageV2.FilePart, ...>[] = []
      
      for (const contentItem of result.content) {
        if (contentItem.type === "text") {
          textParts.push(contentItem.text)
        } else if (contentItem.type === "image") {
          attachments.push({
            type: "file",
            mime: contentItem.mimeType,
            url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
          })
        } else if (contentItem.type === "resource") {
          if (resource.text) textParts.push(resource.text)
          if (resource.blob) {
            attachments.push({
              type: "file",
              mime: resource.mimeType ?? "application/octet-stream",
              url: `data:...;base64,${resource.blob}`,
            })
          }
        }
      }
      
      const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
      return {
        title: "",
        metadata: { truncated, outputPath: truncated.outputPath },
        output: truncated.content,
        attachments: attachments.map(a => ({ ...a, id: PartID.ascending(), sessionID: ctx.sessionID, messageID: input.processor.message.id })),
        content: result.content,
      }
    }
    tools[key] = item
  }
  return tools
}
```

### 5.2 调用时序图

```
Agent Loop
    │
    ▼
processor.process({ tools })
    │
    ▼
LLM 返回 tool call
    │
    ▼
AI SDK 路由到 tool.execute()
    │
    ├─► 内置 Tool (ToolRegistry)
    │       │
    │       ▼
    │       item.execute(args, ctx)
    │
    └─► MCP Tool (key = "clientName_toolName")
            │
            ▼
        item.execute(args, opts)  // prompt.ts:867-949
            │
            ├─► Plugin.trigger("tool.execute.before")
            │
            ├─► Permission.ask()  // 权限检查
            │
            ├─► client.callTool()  // MCP SDK
            │       │
            │       ▼
            │       StreamableHTTPClientTransport / StdioClientTransport
            │       │
            │       ▼
            │       MCP Server 处理
            │
            ├─► Truncate.output()  // 截断
            │
            ├─► 格式化 result (text/image/resource → FilePart[])
            │
            └─► Plugin.trigger("tool.execute.after")
                    │
                    ▼
                返回 { output, title, metadata, attachments }
```

---

## 6. MCP Resource 在 Message 编译时的读取

### 6.1 FilePart 的 ResourceSource

`sesson/prompt.ts:1031-1098` 在 `createUserMessage()` 中处理 MCP resource：

```ts
if (part.type === "file") {
  // 检查是否是 MCP resource
  if (part.source?.type === "resource") {
    const { clientName, uri } = part.source
    
    const resourceContent = await MCP.readResource(clientName, uri)
    
    for (const content of contents) {
      if ("text" in content && content.text) {
        pieces.push({
          type: "text",
          text: content.text as string,
          synthetic: true,
        })
      } else if ("blob" in content && content.blob) {
        pieces.push({
          type: "text",
          text: `[Binary content: ${mimeType}]`,
          synthetic: true,
        })
      }
    }
    
    pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
    return pieces
  }
}
```

### 6.2 Resource URI 格式

Resource 的 `source` 字段结构（`message-v2.ts:163-169`）：

```ts
export const ResourceSource = FilePartSourceBase.extend({
  type: z.literal("resource"),
  clientName: z.string(),
  uri: z.string(),
}).meta({ ref: "ResourceSource" })
```

---

## 7. 工具名称 sanitize 规则

所有 MCP 实体在投影到 OpenCode 时都会做安全处理：

```ts
// 替换所有非法字符为 _
const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")

// 最终格式
// Tool: clientName_toolName
// Prompt: clientName:promptName
// Resource: clientName:resourceName
```

---

## 8. ToolsChanged 通知与动态感知

### 8.1 通知处理器注册

`scc/mcp/index.ts:113-118`：

```ts
function registerNotificationHandlers(client: MCPClient, serverName: string) {
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    log.info("tools list changed notification received", { server: serverName })
    Bus.publish(ToolsChanged, { server: serverName })
  })
}
```

### 8.2 通知触发点

在 `create()` 连接成功时注册（`388`, `473` 行）：

```ts
await withTimeout(client.connect(transport), connectTimeout)
registerNotificationHandlers(client, key)
```

这使得 MCP server 可以动态更新 tool list，OpenCode 会收到 `ToolsChanged` 事件并触发 tool registry 刷新。

---

## 9. 关键数据结构汇总

| 结构 | 位置 | 用途 |
| :------| :------| :------|
| `MCPClient` | `scc/mcp/index.ts:65` | MCP SDK `Client` 实例别名 |
| `MCP.Status` | `scc/mcp/index.ts:67-110` | 连接状态 discriminated union |
| `MCP.ToolsChanged` | `scc/mcp/index.ts:43-48` | tool list 变更事件 |
| `convertMcpTool()` | `scc/mcp/index.ts:121-149` | MCP Tool → AI SDK Tool |
| `fetchPromptsForClient()` | `scc/mcp/index.ts:247-267` | 单 client 的 prompt 发现 |
| `fetchResourcesForClient()` | `scc/mcp/index.ts:269-289` | 单 client 的 resource 发现 |
| `readResource()` | `scc/mcp/index.ts:718-743` | 按需读取 resource 内容 |
| `resolveTools()` | `sesson/prompt.ts:766-954` | 合并 ToolRegistry + MCP tools |
| `ResourceSource` | `message-v2.ts:163-169` | MCP resource 在 FilePart 中的标记 |

---

## 10. 代码级结论

> MCP 在 OpenCode 中通过 `tools()` / `prompts()` / `resources()` 三函数实现发现，通过 `convertMcpTool()` 将 MCP tool 投影为 AI SDK `Tool`，通过 `Command` 服务将 prompts 投影为可执行命令，通过 `readResource()` 按需读取 resources。调用链路为：LLM 决定调用 tool → AI SDK 路由到 `execute()` → `prompt.ts:867-949` 包装层处理权限、truncation、格式化 → `MCPClient.callTool()` → MCP transport → MCP server。ToolsChanged 通知通过 Bus 传播实现动态感知。

---

## 代码质量评估

**优点**

- **5 状态机覆盖所有 MCP server 生命周期**：connected/disabled/failed/needs_auth/needs_client_registration 状态转移完整，auth flow 与连接 flow 解耦。
- **Prompt + Resource + Tool 三类能力统一接入**：MCP server 的三类导出（工具/提示词/资源）都被 OpenCode 消费，不是只支持 tool 的简化接入。
- **`ToolsChanged` 通知驱动动态感知**：热刷新工具列表无需重启，MCP server 更新工具集合时 OpenCode 立即感知。

**风险与改进点**

- **MCP 连接无全局超时**：等待 stdio server 握手时无超时上限，MCP server 启动慢会阻塞 `InstanceBootstrap()` 整个初始化过程。
- **子进程清理问题**：MCP stdio server 以子进程运行，父进程崩溃时子进程可能成为孤儿进程，无 `SIGTERM` 传播保证。
- **OAuth 令牌无持久化存储**：认证令牌在内存中管理，进程重启后需要重新 OAuth 授权，频繁重启场景体验差。

## 横向对齐补强：OpenCode MCP 同时接入 Tool、Command 和 OAuth

OpenCode 的 MCP 不只是 tool discovery。MCP prompt 可进入 command 系统，remote MCP 可走 OAuth，工具最终进入 ToolRegistry 并受 Permission/Plugin 影响。

| MCP 面 | OpenCode 侧落点 | 横向对比 |
| --- | --- | --- |
| tools | ToolRegistry | 对应四项目工具池 |
| prompts | Command 系统 | OpenCode 特色 |
| resources | prompt/file part | 与 `11-prompt-system.md` 交叉 |
| OAuth | `cli/cmd/mcp.ts`, config schema | 比 Gemini/Codex 更强调 CLI 管理 |
| plugin influence | tool.definition hook | OpenCode 特色 |

## 连接状态、auth、schema 与 permission 关系表

| 层级 | 源码锚点 | 作用 | 与下一层关系 |
| --- | --- | --- | --- |
| 连接状态 | `sources/opencode/packages/opencode/src/mcp/index.ts:68` | MCP status union 定义 connected/disabled/failed/needs_auth 等状态 | 只有 connected server 才能贡献可调用工具 |
| auth 状态 | `sources/opencode/packages/opencode/src/mcp/index.ts:93` | `needs_auth` 是连接状态的一种 | auth 完成后重新连接并刷新 status |
| OAuth pending | `sources/opencode/packages/opencode/src/mcp/index.ts:153` | `pendingOAuthTransports` 保存待完成的远端 transport | callback/authenticate 后恢复连接 |
| 工具变化事件 | `sources/opencode/packages/opencode/src/mcp/index.ts:116` | `ToolsChanged` 通知工具池刷新 | ToolRegistry 重新收集 MCP tools |
| 工具 schema | `sources/opencode/packages/opencode/src/session/prompt.ts:818` | `tool()` 包装最终暴露给 AI SDK | schema 可见不代表权限已通过 |
| 权限请求 | `sources/opencode/packages/opencode/src/session/prompt.ts:804` | 工具 context 内调用 `Permission.ask()` | 拒绝会写成工具错误/阻塞结果 |

这四层必须分开：MCP server 认证成功只说明能 discovery；工具 schema 进入模型只说明可被选择；真正执行仍受 session/agent permission 和交互审批控制。

## 源码锚点补强

| MCP 面 | 源码锚点 | 说明 |
| --- | --- | --- |
| MCP namespace | `sources/opencode/packages/opencode/src/mcp/index.ts:28` | MCP 系统入口 |
| Config schema | `sources/opencode/packages/opencode/src/config/config.ts:565`, `sources/opencode/packages/opencode/src/config/config.ts:601` | local/remote MCP 配置 |
| MCP CLI | `sources/opencode/packages/opencode/src/cli/cmd/mcp.ts:55`, `sources/opencode/packages/opencode/src/cli/cmd/mcp.ts:140` | MCP 管理和 OAuth 命令 |
| Command prompts | `sources/opencode/packages/opencode/src/command/index.ts:117`, `sources/opencode/packages/opencode/src/command/index.ts:124` | MCP prompts 进入 command |
| Tool registry | `sources/opencode/packages/opencode/src/tool/registry.ts:155` | MCP tool 最终并入工具集合 |

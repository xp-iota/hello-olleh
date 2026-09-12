---
layout: content
title: "Plugin 系统：JS/TS 插件的加载、命令贡献与 Hooks 注册"
---
# Plugin 系统：JS/TS 插件的加载、命令贡献与 Hooks 注册

本文深度分析 Claude Code 的 Plugin 系统，包括插件加载机制、插件可以贡献的能力（命令、工具、Hooks），以及与 Skill 和 MCP 的边界区分。

> 另见：[06-extension-mcp](./06-extension-mcp.md) — Plugin 在整个扩展体系中的位置


**目录**

- [1. Plugin 是什么](#1-plugin-是什么)
- [2. Plugin 文件格式](#2-plugin-文件格式)
- [3. Plugin 加载机制](#3-plugin-加载机制)
- [4. 插件贡献的能力](#4-插件贡献的能力)
- [5. 与 Skill、MCP 的边界](#5-与-skillmcp-的边界)

---

## 1. Plugin 是什么

Claude Code 的 Plugin 是**以 JavaScript/TypeScript 编写的扩展模块**，可以贡献：
- 新的 Slash 命令
- 新的工具
- Lifecycle Hooks
- 子 Agent 定义

Plugin 比 Skill 更强大（可编程），比 MCP 更轻量（同进程运行）。

## 2. Plugin 文件格式

```typescript
// .claude/plugins/my-plugin/index.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // 贡献命令
  commands: [
    {
      name: 'deploy',
      description: '部署应用到生产环境',
      handler: async ({ args, tools }) => {
        const result = await tools.bash(`./deploy.sh ${args}`);
        return result;
      },
    },
  ],
  
  // 贡献工具
  tools: [
    {
      name: 'get_jira_ticket',
      description: '获取 Jira 工单信息',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async ({ id }) => {
        return await jiraClient.getIssue(id);
      },
    },
  ],
  
  // 注册 Hooks
  hooks: {
    preToolCall: async ({ tool, input }) => {
      console.log(`About to call tool: ${tool}`);
    },
    postToolCall: async ({ tool, result }) => {
      await auditLog.record(tool, result);
    },
  },
};
```

## 3. Plugin 加载机制

### 3.1 扫描路径

```typescript
// src/utils/plugins/loadPluginCommands.ts
const PLUGIN_PATHS = [
  '~/.claude/plugins/',      // 用户全局插件
  '.claude/plugins/',        // 项目级插件
];

export async function loadPlugins(cwd: string): Promise<Plugin[]> {
  const dirs = await findPluginDirs(cwd);
  return Promise.all(dirs.map(dir => loadPlugin(dir)));
}
```

### 3.2 插件隔离

Plugin 在**主进程**中运行（非独立进程），通过沙箱化的 `tools` API 与 Claude Code 交互，而非直接调用内部 API：

```typescript
// 插件只能访问受限的 tools API
interface PluginTools {
  bash(cmd: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  // 不能访问内部 state、session 等
}
```

## 4. 插件贡献的能力

### 4.1 命令贡献

Plugin 命令与内置命令、Skill 命令共享同一命令总线，用户通过相同方式调用：

```bash
/deploy production  # 由插件提供的命令
/commit             # 内置命令
/review file.ts     # 由 Skill 提供
```

### 4.2 工具贡献

Plugin 贡献的工具与内置工具同等优先级，模型可以直接调用：

```json
{
  "type": "tool_call",
  "name": "get_jira_ticket",  // 插件工具
  "input": { "id": "PROJ-123" }
}
```

### 4.3 Hooks 注册

Plugin 可以在工具调用生命周期中注入逻辑：

| Hook | 触发时机 | 典型用途 |
|------|---------|---------|
| `preToolCall` | 工具调用前 | 审计日志、权限检查 |
| `postToolCall` | 工具调用后 | 结果后处理、通知 |
| `onSessionStart` | 会话开始 | 环境初始化 |
| `onSessionEnd` | 会话结束 | 清理、统计 |

## 5. 与 Skill、MCP 的边界

| 特性 | Plugin | Skill | MCP |
|------|--------|-------|-----|
| **实现语言** | JS/TS | Markdown | 任意 |
| **运行位置** | 主进程 | 主进程（Prompt 注入）| 独立进程 |
| **贡献命令** | ✅ | ✅ | ❌ |
| **贡献工具** | ✅ | ❌ | ✅ |
| **注册 Hooks** | ✅ | ❌ | ❌ |
| **访问内部 API** | 受限 | 无 | 无 |
| **进程隔离** | 无（同进程）| 无 | 有 |
| **崩溃影响** | 影响主进程 | 无 | 不影响主进程 |

**何时选择 Plugin**：
- 需要编程逻辑（条件判断、API 调用）
- 需要贡献工具到模型工具表
- 需要 Hooks 监听生命周期事件
- 不需要进程隔离（信任代码）

**何时选择 MCP**：
- 需要进程隔离（不信任代码/第三方服务）
- 需要跨 AI 工具共享工具实现
- 需要支持多语言实现

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
|----------|------|------|
| `McpHub` | `src/services/mcp/mcpHub.ts` | MCP 客户端管理中心：维护所有 MCP server 连接的生命周期 |
| `McpHub.connectToServer()` | `src/services/mcp/mcpHub.ts` | 建立单个 MCP server 连接：初始化传输、执行 handshake |
| `McpHub.callTool()` | `src/services/mcp/mcpHub.ts` | 发起 MCP 工具调用，包含超时和重试 |
| `ToolRegistry.registerMcp()` | `src/tools/registry.ts` | 将 MCP server 工具注册到统一工具表 |
| `McpServerConfig` | `src/config/types.ts` | config.json 中 MCP server 配置类型：command/args/env/url |
| `StdioClientTransport` | `@modelcontextprotocol/sdk` | MCP SDK 提供的 stdio 传输层 |

---

## 代码质量评估

**优点**

- **MCP SDK 官方实现**：使用 Anthropic 官方 `@modelcontextprotocol/sdk`，协议兼容性最佳，升级随 SDK 同步。
- **McpHub 统一管理连接**：所有 MCP server 连接集中在 McpHub，连接状态监控和错误处理有统一入口。
- **工具注册中心化**：built-in 和 MCP 工具通过同一 ToolRegistry 统一注册，LLM 看到的工具列表来源透明。

**风险与改进点**

- **McpHub 为单例**：单例模式下 MCP server 状态跨 session 共享，一个 session 的重置不会断开 server 连接，可能影响其他 session。
- **子进程 MCP server 无泄漏保护**：进程异常退出时 stdio 模式的子进程 MCP server 可能成为孤儿进程，无 cleanup hook。
- **MCP 工具 schema 无差异检测**：MCP server 更新工具 schema 后 Claude Code 无法感知变更，已缓存的旧 schema 可能导致调用失败。

## 横向对齐补强：Claude Plugin 同时影响设置、Hook 和 MCP

Claude Code 的 plugin 不是单纯命令扩展。它可以影响 settings、hooks、commands、skills、MCP server，最终改变 prompt 和工具池。

| 插件影响面 | 对齐章节 |
| --- | --- |
| settings cascade | `17-settings-config.md` |
| hook matcher | `19-hooks-lifecycle.md` |
| command/skill | `13-skill-system.md`, `23-input-command-queue.md` |
| MCP server | `24-mcp-system.md` |
| tool availability | `05-tool-system.md` |

横向看，Claude 的 plugin 深度强于 Gemini，接近 OpenCode plugin hook，但需要更明确的信任和冲突策略。

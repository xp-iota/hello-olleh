---
layout: content
title: "Gemini CLI 扩展系统：`gemini-extension.json`、MCP Server 与装载治理"
---
# Gemini CLI 扩展系统：`gemini-extension.json`、MCP Server 与装载治理

Gemini CLI 这里更准确的名称是 **extension system**。MCP 只是 extension 能贡献的一部分能力，不等同于全部“插件系统”。


**目录**

- [1. 一个 extension 能提供什么](#1-一个-extension-能提供什么)
- [2. 扩展管理的核心是 `ExtensionManager`](#2-扩展管理的核心是-extensionmanager)
- [3. MCP 是 extension 能力里最重要的一类](#3-mcp-是-extension-能力里最重要的一类)
- [4. 安全治理不是外挂](#4-安全治理不是外挂)
- [5. 一个最小 MCP extension 长什么样](#5-一个最小-mcp-extension-长什么样)
- [6. 关键源码锚点](#6-关键源码锚点)

---

## 1. 一个 extension 能提供什么

磁盘上的扩展配置定义在 `sources/gemini-cli/packages/cli/src/config/extension.ts`，核心文件是 `gemini-extension.json`。

当前 `ExtensionConfig` 明确支持的贡献项包括：

- `mcpServers`
- `contextFileName`
- `excludeTools`
- `settings`
- `themes`
- `plan.directory`

也就是说，extension 不只是“挂几个 MCP 工具”，还可以改上下文文件名、添加设置项、注入主题，甚至影响计划目录。

## 2. 扩展管理的核心是 `ExtensionManager`

`sources/gemini-cli/packages/cli/src/config/extension-manager.ts` 负责：

- 从本地、link、git、GitHub release 安装或更新 extension
- 处理 workspace trust
- 请求用户 consent
- 校验管理员 allowlist / blocklist
- 解析并水合环境变量
- 加载 extension 自带的 skills、agents、policies、themes、MCP servers

这说明 Gemini CLI 的扩展系统已经是一个完整的装载管理器，而不是“读个目录然后执行脚本”。

## 3. MCP 是 extension 能力里最重要的一类

### 3.1 生命周期由 `McpClientManager` 统一管理

`sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts` 负责：

- 记录所有 MCP server 配置
- 连接或断开具体 server
- 管理 blocked / disabled 状态
- 发现 tools、prompts、resources
- 把发现结果注册到主 registry
- 维护诊断信息，并在需要时提示用户运行 `/mcp list`

这里的实现已经明显超过“有个 Map 存 client”这种简单包装。

### 3.2 `McpClient` 支持多种传输

`sources/gemini-cli/packages/core/src/tools/mcp-client.ts` 直接引入了三类 MCP transport：

- `StdioClientTransport`
- `SSEClientTransport`
- `StreamableHTTPClientTransport`

因此，Gemini CLI 当前的 MCP 支持并不只限于 stdio。它能接入本地进程型 server，也能接入基于网络的 MCP 服务。

### 3.3 发现的不只有工具

`McpClient.discoverInto()` 会同时发现并注册：

- tools
- prompts
- resources

旧版文档里“Gemini CLI 不支持 prompt / resource”这类一刀切说法，已经不适用于当前代码。

## 4. 安全治理不是外挂

扩展和 MCP 都被纳入了多层治理：

### 4.1 Extension 级治理

- workspace 必须可信，或显式提升 trust
- 可被 `allowedExtensions` / `blockGitExtensions` 等设置限制
- 安装、更新、启用、禁用都有专门事件和日志
- 完整性数据由 `ExtensionIntegrityManager` 参与校验

### 4.2 MCP 级治理

- `McpClientManager` 会区分 blocked 与 disabled
- 配置层可以限制允许的 MCP server 名称
- 连接失败、认证失败、工具发现失败都会进入诊断系统
- 发现到的工具还会继续进入 policy / confirmation 体系

所以，这里不是“先连上再说”，而是明确有一整套启用前与运行时限制。

## 5. 一个最小 MCP extension 长什么样

仓库里的示例位于：

- `sources/gemini-cli/packages/cli/src/commands/extensions/examples/mcp-server/gemini-extension.json`

示例格式很直接：

```json
{
  "name": "mcp-server-example",
  "version": "1.0.0",
  "mcpServers": {
    "nodeServer": {
      "command": "node",
      "args": ["${extensionPath}${/}example.js"],
      "cwd": "${extensionPath}"
    }
  }
}
```

这也印证了一个事实：Gemini CLI 的“插件”入口实际是 extension manifest，而 MCP server 只是 manifest 里的一个字段。

## 6. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| Extension 配置结构 | `sources/gemini-cli/packages/cli/src/config/extension.ts` | `gemini-extension.json` 的字段定义 |
| Extension 装载管理 | `sources/gemini-cli/packages/cli/src/config/extension-manager.ts` | 安装、更新、trust、consent、贡献项加载 |
| MCP 生命周期管理 | `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts` | 连接、发现、诊断、刷新 |
| MCP 连接实现 | `sources/gemini-cli/packages/core/src/tools/mcp-client.ts` | stdio / SSE / Streamable HTTP transport |
| 示例 manifest | `sources/gemini-cli/packages/cli/src/commands/extensions/examples/mcp-server/gemini-extension.json` | 最小 MCP extension 例子 |

---

## 代码质量评估

**优点**

- **`ExtensionManager` 统一入口**：所有 extension（MCP、skills、commands、其他工具）通过同一个管理器加载，外部工具接入不需要修改主流程代码。
- **MCP 作为扩展协议标准**：外部工具通过 MCP 协议接入，与内建工具在 JSON Schema、审批链、并发控制方面完全等价，替换成本低。
- **安全治理不是外挂**：Extension 的 sandbox 权限在 `ExtensionManager` 装配时就被绑定，无法被 extension 自行提升，防止特权蔓延。

**风险与改进点**

- **Extension MCP server 启动慢影响整体**：Extension 中的 MCP server 在 `Config.initialize()` 阶段同步初始化，若某个 MCP server 响应慢，会阻塞整个 CLI 启动流程。
- **Extension 热重载不支持**：Extension 配置变更需要重启 CLI 才能生效，开发调试 extension 时 DX 较差。
- **Extension 命名空间冲突**：多个 extension 可能注册同名工具，当前缺少冲突检测和明确的覆盖策略，行为不确定。

## 横向对齐补强：Gemini Plugin 应写成 Extension 装配模型

Gemini CLI 没有像 OpenCode 那样的运行时 plugin hook 系统，也不像 Claude Code 有复杂 plugin marketplace。它更适合按 Extension 装配模型来写：配置发现、MCP server、skill、command、tool registry 和 policy 串在一起。

| 扩展对象 | 文档归属 | 说明 |
| --- | --- | --- |
| MCP server | `24-mcp-system.md` | 贡献外部工具和资源 |
| Skill | `13-skill-system.md` | 贡献可激活提示词能力 |
| Tool | `05-tool-system.md` | 最终进入 ToolRegistry/Scheduler |
| Policy | `07-error-security.md` | 决定扩展工具是否可执行 |
| Config | `17-settings-config.md` | 决定 extension 是否启用 |

横向比较时，Gemini 的插件系统应强调“组合式扩展装配”，而不是单独寻找一个 plugin runtime。

## Extension 生命周期补强

Gemini CLI 的插件面应按 `ExtensionLoader` 来读，而不是寻找一个通用 `Plugin` class。

| 阶段 | 源码锚点 | 说明 |
| --- | --- | --- |
| 初始化 | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:33` | `start()` 在 Config 初始化后启动所有 active extensions |
| 启动 extension | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:65` | `startExtension()` 要求 loader 已经初始化 |
| MCP 注入 | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:75` | extension 的 MCP server 交给 `McpClientManager.startExtension()` |
| Policy 注入 | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:80` | extension rules/checkers 注册进 PolicyEngine |
| Hook 刷新 | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:129` | extension 变更后重新初始化 HookSystem |
| 停止 extension | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:172` | stop 时卸载 MCP server，并移除 policy/checker |
| 重启 extension | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:241` | restart 是 stop + start 的组合 |

这条链路说明：Gemini 的 extension 能贡献 MCP、policy、checker、skill/command 等对象，但最终仍要落到已有运行时组件里。它不是 OpenCode 式“插件 hook 可以订阅 Bus 并注入 tool/context”的同构 plugin runtime。

### 命名空间与失效边界

extension stop 会调用 `McpClientManager.stopExtension()` 并注销 policy/checker，但已经进入会话历史的 tool result、prompt 内容不会自动从历史里删除。文档里应把“运行时能力失效”和“历史事实保留”分开，否则会误以为禁用 extension 能回滚既有上下文。

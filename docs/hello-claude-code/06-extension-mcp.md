---
layout: content
title: "扩展体系：技能、插件与 MCP"
---
# 扩展体系：技能、插件与 MCP

本篇梳理技能、插件与 MCP 如何直接并入命令总线和工具总线。

这里重点放在“扩展如何并入主系统”。若要继续看 MCP client、传输、资源与提示接口的协议层细节，请继续看 [26-mcp-system.md](./24-mcp-system.md)。


**目录**

- [1. 这套工程为什么扩展能力这么强](#1-这套工程为什么扩展能力这么强)
- [2. 命令装配总入口：`commands.ts`](#2-命令装配总入口commandsts)
- [2.1 `COMMANDS()` 是内建命令表](#21-commands-是内建命令表)
- [2.2 `getCommands(cwd)` 不是简单返回内建列表](#22-getcommandscwd-不是简单返回内建列表)
- [3. 技能系统：`loadSkillsDir.ts`](#3-技能系统loadskillsdirts)
- [3.1 技能本质上会被编译成 `Command`](#31-技能本质上会被编译成-command)
- [3.2 技能 prompt 生成时做了哪些事](#32-技能-prompt-生成时做了哪些事)
- [3.3 为什么 MCP 技能被特别防护](#33-为什么-mcp-技能被特别防护)
- [4. 动态技能发现不是启动时一次性完成](#4-动态技能发现不是启动时一次性完成)
- [5. 条件技能：按文件路径激活](#5-条件技能按文件路径激活)
- [6. 插件系统：`loadPluginCommands.ts`](#6-插件系统loadplugincommandsts)
- [6.1 插件命令与插件技能都归一成 Markdown -> Command](#61-插件命令与插件技能都归一成-markdown-command)
- [6.2 命名空间设计](#62-命名空间设计)
- [6.3 插件 prompt 在生成时会做变量替换](#63-插件-prompt-在生成时会做变量替换)
- [6.4 插件命令也支持 shell 注入](#64-插件命令也支持-shell-注入)
- [7. MCP 客户端：把外部能力接入工具系统](#7-mcp-客户端把外部能力接入工具系统)
- [8. MCP 工具调用如何处理复杂异常](#8-mcp-工具调用如何处理复杂异常)
- [8.2 普通 MCP tool call 还带 timeout、progress、auth/session 恢复](#82-普通-mcp-tool-call-还带-timeoutprogressauthsession-恢复)
- [9. SDK 模式下还支持 in-process MCP](#9-sdk-模式下还支持-in-process-mcp)
- [10. 扩展体系总图](#10-扩展体系总图)
- [11. 这套扩展体系的设计优点](#11-这套扩展体系的设计优点)
- [11.1 协议统一](#111-协议统一)
- [11.2 来源隔离](#112-来源隔离)
- [11.3 运行期可增量变化](#113-运行期可增量变化)
- [12. 关键源码锚点](#12-关键源码锚点)
- [13. 总结](#13-总结)

---

## 1. 这套工程为什么扩展能力这么强

因为它没有把“扩展”做成边缘插件，而是把扩展直接接进了两条核心总线：

1. 命令总线
2. 工具总线

于是：

- 技能会变成 slash command
- 插件会贡献命令、技能、hooks、agent
- MCP server 会贡献工具、资源，甚至在 SDK 模式下同进程运行

因此 `src/commands.ts`、`src/skills/loadSkillsDir.ts`、`src/utils/plugins/loadPluginCommands.ts`、`src/services/mcp/client.ts` 需要放在同一篇里分析。

## 2. 命令装配总入口：`commands.ts`

关键代码：

- `src/commands.ts:225-254` `INTERNAL_ONLY_COMMANDS`
- `src/commands.ts:258-346` `COMMANDS()`
- `src/commands.ts:449-469` `loadAllCommands(...)`
- `src/commands.ts:476-517` `getCommands(cwd)`

## 2.1 `COMMANDS()` 是内建命令表

它包含大量 built-in `/xxx` 命令，例如：

- `/clear`
- `/compact`
- `/config`
- `/memory`
- `/model`
- `/review`
- `/permissions`
- `/tasks`
- `/mcp`

并且会受 feature flags 与用户类型影响。

## 2.2 `getCommands(cwd)` 不是简单返回内建列表

它会合并：

- bundled skills
- builtin plugin skills
- skill directory commands
- workflow commands
- plugin commands
- plugin skills
- built-in commands
- dynamic skills

用户最终能输入的 `/xxx` 命令集合，是运行时动态拼出来的。

## 3. 技能系统：`loadSkillsDir.ts`

关键代码：

- `src/skills/loadSkillsDir.ts:270-400` `createSkillCommand(...)`
- `src/skills/loadSkillsDir.ts:923-975` `addSkillDirectories(...)`
- `src/skills/loadSkillsDir.ts:981-983` `getDynamicSkills()`
- `src/skills/loadSkillsDir.ts:997-1035` `activateConditionalSkillsForPaths(...)`

## 3.1 技能本质上会被编译成 `Command`

`createSkillCommand(...)` 会把技能 frontmatter + Markdown 内容转成统一的 `Command` 对象，并挂上：

- `name`
- `description`
- `allowedTools`
- `argumentHint`
- `argNames`
- `whenToUse`
- `version`
- `model`
- `disableModelInvocation`
- `userInvocable`
- `context`
- `agent`
- `effort`

结论如下：

- 技能不是另一套 DSL。
- 技能就是一种特殊来源的 prompt command。

## 3.2 技能 prompt 生成时做了哪些事

`getPromptForCommand(args, toolUseContext)` 里会做：

- 拼上 `Base directory for this skill`
- 参数替换
- 替换 `${CLAUDE_SKILL_DIR}`
- 替换 `${CLAUDE_SESSION_ID}`
- 如非 MCP 来源技能，还会执行技能 Markdown 内的 shell 注入

这使技能具备很强的上下文感知能力。

## 3.3 为什么 MCP 技能被特别防护

源码明确写了：

- MCP skills 是 remote and untrusted
- 不允许执行其 Markdown 里的 inline shell commands

技能扩展虽强，但系统明确区分本地可信技能与远程不可信技能。

## 4. 动态技能发现不是启动时一次性完成

关键代码：`src/skills/loadSkillsDir.ts:923-975`

`addSkillDirectories(dirs)` 允许系统在运行过程中动态加载新的 skill 目录。

典型场景：

- 文件操作触发了新的 skill dir discovery
- 目录更深的 skill 覆盖浅层 skill

这解释了为什么命令表并非静态，也解释了 REPL 里为什么要有 `useMergedCommands(...)`。

## 5. 条件技能：按文件路径激活

关键代码：`src/skills/loadSkillsDir.ts:997-1035`

条件技能的逻辑是：

- skill frontmatter 声明 `paths`
- 当用户对某些文件进行操作时，系统把文件路径喂给 `activateConditionalSkillsForPaths(...)`
- 命中的 skill 会被移入 dynamic skills

技能系统不仅是“手动 `/skill` 调用”，还是一种：

> 基于当前工作集的条件化提示词注入系统

## 6. 插件系统：`loadPluginCommands.ts`

关键代码：

- `src/utils/plugins/loadPluginCommands.ts:102-130` 收集 markdown
- `src/utils/plugins/loadPluginCommands.ts:135-167` skill 目录转换
- `src/utils/plugins/loadPluginCommands.ts:169-213` 目录转命令
- `src/utils/plugins/loadPluginCommands.ts:218-402` `createPluginCommand(...)`
- `src/utils/plugins/loadPluginCommands.ts:414-420` `getPluginCommands()`

## 6.1 插件命令与插件技能都归一成 Markdown -> Command

插件目录里的 Markdown 文件会被扫描，然后：

- 普通 `.md` 作为 plugin command
- `SKILL.md` 目录结构作为 plugin skill

这和本地技能系统高度统一。

## 6.2 命名空间设计

插件命令的名字会根据：

- plugin 名
- 相对路径命名空间
- 文件名或 skill 目录名

拼成类似：

- `pluginName:foo`
- `pluginName:namespace:skill`

这样既避免重名，又保留了来源信息。

## 6.3 插件 prompt 在生成时会做变量替换

包括：

- `${CLAUDE_PLUGIN_ROOT}`
- `${CLAUDE_PLUGIN_DATA}`
- `${CLAUDE_SKILL_DIR}`
- `${CLAUDE_SESSION_ID}`
- `${user_config.X}`

并且：

- 对敏感 user config 不会把秘密直接放进 prompt

这说明插件系统既追求能力，又兼顾安全边界。

## 6.4 插件命令也支持 shell 注入

和技能类似，插件命令/技能最终也能通过 `executeShellCommandsInPrompt(...)` 把局部 shell 输出并入 prompt。

所以从执行效果看，插件是一等扩展，不是薄外壳。

## 7. MCP 客户端：把外部能力接入工具系统

关键文件：`src/services/mcp/client.ts`

代码中显式支持多种 transport：

- `stdio`
- `sse`
- `http`
- `claudeai-proxy`
- `ws`
- SDK in-process transport

这意味着 MCP 在这套系统里并不是“一个简单 HTTP adapter”，而是完整的多传输协议能力层。

## 8. MCP 工具调用如何处理复杂异常

关键代码：`src/services/mcp/client.ts:2813-3026`

`callMCPToolWithUrlElicitationRetry(...)` 体现了 MCP 接入的工程深度。

### 8.1 它会处理 `UrlElicitationRequiredError`

流程是：

1. 调用 MCP tool。
2. 如果收到 `-32042 UrlElicitationRequired`：
   - 提取 elicitation 列表
   - 先跑 elicitation hooks
   - SDK/print 模式走 `handleElicitation`
   - REPL 模式则排入 `AppState.elicitation.queue`
3. 用户或 hook 接受后重试 tool call

MCP 工具调用并不是“一次函数调用”，而可能插入新的用户交互。

## 8.2 普通 MCP tool call 还带 timeout、progress、auth/session 恢复

关键代码：`src/services/mcp/client.ts:3029-3245`

`callMCPTool(...)` 会做：

- 自定义超时 race
- 30 秒一轮的长任务进度日志
- SDK progress 转换成 `mcp_progress`
- 处理 401 -> `McpAuthError`
- 处理 session expired -> 清缓存并抛 `McpSessionExpiredError`

MCP 客户端层不仅接协议，还负责连接生命周期治理。

## 9. SDK 模式下还支持 in-process MCP

关键代码：`src/services/mcp/client.ts:3262-3335`

`setupSdkMcpClients(...)` 会：

- 用 `SdkControlClientTransport`
- 建立同进程 client
- 拉取 capabilities
- 拉取 tools
- 生成 connected/failed 的 MCPServerConnection

这一层统一了：

- REPL 模式的外部 MCP
- SDK 模式的同进程 MCP

都能统一注入同一套工具系统。

## 10. 扩展体系总图

```mermaid
---
config:
  theme: neutral
---
flowchart TB
    A[commands.ts] --> B[built-in commands]
    A --> C[skill dir commands]
    A --> D[plugin commands]
    A --> E[plugin skills]
    A --> F[dynamic skills]

    C --> G[skills/loadSkillsDir.ts]
    D --> H[loadPluginCommands.ts]
    E --> H
    F --> G

    I[tools.ts] --> J[base tools]
    I --> K[MCP tools]
    K --> L[services/mcp/client.ts]

    G --> A
    H --> A
    L --> I
```

## 11. 这套扩展体系的设计优点

## 11.1 协议统一

技能、插件、MCP 没有各搞一套调用协议，而是最终落到：

- `Command`
- `Tool`
- `Message`

这让主循环可以保持稳定。

## 11.2 来源隔离

源码里会保留：

- source
- loadedFrom
- pluginInfo
- marketplace/repository 元数据

这有利于：

- 权限策略
- telemetry
- UI 来源展示

## 11.3 运行期可增量变化

命令和工具池都能在运行时变化：

- 新 MCP server 连上
- 动态技能被激活
- 插件热更新

因此扩展系统不是“启动时注册完就不变”的传统插件系统，而是动态能力系统。

## 12. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| 命令合并 | `src/commands.ts:449-517` | 各类命令源如何汇总 |
| 技能命令化 | `src/skills/loadSkillsDir.ts:270-400` | skill frontmatter 与 prompt 生成 |
| 动态技能 | `src/skills/loadSkillsDir.ts:923-1035` | 目录发现与条件激活 |
| 插件命令生成 | `src/utils/plugins/loadPluginCommands.ts:218-402` | plugin markdown -> Command |
| MCP URL elicitation | `src/services/mcp/client.ts:2813-3026` | 需要用户打开 URL 时的处理 |
| MCP tool call | `src/services/mcp/client.ts:3029-3245` | timeout/progress/auth/session |
| SDK MCP | `src/services/mcp/client.ts:3262-3335` | 同进程 MCP 接入 |

## 13. 总结

这套扩展体系的核心价值在于：

- 不是把插件附着在系统边缘。
- 而是把技能、插件、MCP 直接并入命令表、工具池和主循环。

因此扩展能力并不是“锦上添花”，而是这套 Agent Runtime 的组成部分。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
|----------|------|------|
| `COMMANDS()` | `src/commands.ts` | 内建 slash command 注册表（静态部分）|
| `getCommands(cwd)` | `src/commands.ts` | 动态命令列表：内建 + Skills + MCP |
| `loadSkillsDir()` | `src/utils/loadSkillsDir.ts` | 扫描目录，加载 `.md` 技能文件 |
| `getMcpTools()` | — | 从已连接 MCP server 获取工具声明列表 |
| `connectMcpServer()` | — | 连接单个 MCP server（stdio/SSE）|
| `processSkillPrompt()` | — | 将 skill `.md` 内容注入 system prompt |
| `registerPlugin()` | — | 注册第三方 plugin（工具/命令/hook） |

---

## 代码质量评估

**优点**

- **命令统一入口 `getCommands()`**：内建命令、Skills、Plugin、MCP 工具全部汇聚成同一 `Command[]`，调用层无须区分来源，扩展接入不改核心分发逻辑。
- **技能文件即 Markdown**：`.md` 文件即技能，降低贡献门槛，版本管理友好，CI 可以 lint Markdown 而非检查代码。
- **MCP 协议标准化**：外部能力通过 MCP stdio/SSE 接入，与内建工具在权限模型和参数 Schema 上完全对等，工具替换无需改查询层。

**风险与改进点**

- **`loadSkillsDir()` 无并发保护**：扫描目录时若被多个 session 并发调用，在文件系统侧无锁机制，可能读取到部分写入的 skill 文件。
- **MCP server 连接无全局超时限制**：`connectMcpServer()` 等待外部进程 stdio 握手，若 server 启动慢，启动时会无限等待，影响整体启动延迟。
- **`processSkillPrompt()` 无 token 预算**：skill 注入到 system prompt 不检查 total token，大量 skill 激活时可能超出 context 限制，导致静默截断。

## 横向对齐补强：Claude 扩展面最宽，必须分层阅读

Claude Code 的扩展面同时包含 Skill、Plugin、MCP、Hooks、slash command 和配置策略。横向比较时，`06` 应只做总览，细节分流到 `13`、`14`、`24`。

| 扩展层 | Claude 侧对象 | 对齐章节 |
| --- | --- | --- |
| 指令层 | Skill / CLAUDE.md | `13-skill-system.md` |
| 运行时插件 | Plugin / hooks | `14-plugin-system.md`, `19-hooks-lifecycle.md` |
| 外部工具 | MCP server/tool/resource | `24-mcp-system.md` |
| 企业策略 | managed settings / allowlist | `17-settings-config.md`, `07-error-security.md` |

横向看，Claude 的优势是扩展能力丰富；风险是扩展路径多，文档必须避免把 MCP、Plugin、Skill 混成同一层。

## 源码锚点补强

| 主题 | 源码锚点 | 说明 |
| --- | --- | --- |
| headless plugin/MCP 刷新 | `sources/claude-code/src/cli/print.ts:1707`, `sources/claude-code/src/cli/print.ts:1795` | headless 模式安装 plugin 并同步 MCP diff |
| plugin 热刷新 | `sources/claude-code/src/cli/print.ts:1763`, `sources/claude-code/src/cli/print.ts:1917` | refresh 与 hook hot reload |
| MCP OAuth | `sources/claude-code/src/services/mcp/auth.ts:847` | `performMCPOAuthFlow()` |
| MCP XAA | `sources/claude-code/src/services/mcp/auth.ts:664` | cross-app access 认证 |
| settings 中 MCP/Plugin schema | `sources/claude-code/src/utils/settings/types.ts:112`, `sources/claude-code/src/utils/settings/types.ts:559` | MCP policy 与 enabled plugin 配置 |

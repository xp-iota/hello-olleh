---
layout: content
title: "OpenCode 深度专题 B09：扩展面，Plugin、MCP、Command、Skill 与 Custom Tool 怎样挂进固定骨架"
---
# OpenCode 深度专题 B09：扩展面，Plugin、MCP、Command、Skill 与 Custom Tool 怎样挂进固定骨架

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

如果只看 A 线，很容易觉得 OpenCode 的能力主要来自“内建工具 + 模型”。但在当前实现里，扩展面非常大：插件、MCP、自定义工具、命令、技能都可以插进系统。不过它们并没有绕开主链路，而是被统一压回相同的 runtime 接口。B09 关注的就是这件事。

其中 Skill 在这里只讨论“它作为扩展入口怎样挂进骨架”；Skill 自己的发现、授权、加载与注入链路，放到 [14-skill-system.md](./13-skill-system.md) 单独展开。若想单看 plugin hook、认证覆写和失败语义的更细展开，可以继续读补充稿 [15-plugin-system.md](./14-plugin-system.md)。

---

**目录**

- [1. 当前扩展面至少有五个入口](#1-当前扩展面至少有五个入口)
- [2. Plugin 不是工具列表，而是一组 hook](#2-plugin-不是工具列表而是一组-hook)
- [3. MCP 不是“远端工具接口”，而是一整套二级扩展系统](#3-mcp-不是远端工具接口而是一整套二级扩展系统)
- [4. ToolRegistry 才是“所有工具真正汇总”的地方](#4-toolregistry-才是所有工具真正汇总的地方)
- [5. Command 系统把命令模板也做成了可扩展汇总面](#5-command-系统把命令模板也做成了可扩展汇总面)
- [6. Skill 系统本身也是多来源装载](#6-skill-系统本身也是多来源装载)
- [7. 扩展能力很多，但没有第二条执行骨架](#7-扩展能力很多但没有第二条执行骨架)
- [8. 把 B09 压成一句代码级结论](#8-把-b09-压成一句代码级结论)

---

## 1. 当前扩展面至少有五个入口

| 扩展入口 | 代码坐标 | 最终落在哪里 |
| --- | --- | --- |
| Plugin hooks | `packages/opencode/src/plugin/index.ts:47-165` | 挂到 bus event、tool definition 和其他 hook 点上。 |
| MCP servers | `packages/opencode/src/mcp/index.ts:43-140`、`325-465`、`606-718` | 产出 tool、prompt、resource 和连接状态。 |
| Custom tools | `packages/opencode/src/tool/registry.ts:85-105` | 变成 runtime 可调用 Tool。 |
| Commands | `packages/opencode/src/command/index.ts:63-157` | 变成 slash command / prompt template。 |
| Skills | `packages/opencode/src/skill/index.ts:126-226`、`skill/discovery.ts:55-100` | 变成 skill 列表，也可继续折叠进 command 和 prompt。 |

所以 OpenCode 当前不是“只有一个插件系统”，而是多种扩展入口并存。

---

## 2. Plugin 不是工具列表，而是一组 hook

`packages/opencode/src/plugin/index.ts:47-165` 当前把插件组织成 `Hooks[]`。

### 2.1 内建插件先于外部插件

`47-51` 明确有一组直接内建的 plugin：

1. `CodexAuthPlugin`
2. `CopilotAuthPlugin`
3. `GitlabAuthPlugin`
4. `PoeAuthPlugin`

所以 OpenCode 的插件系统不是“全都来自用户安装”，它自己也靠同一套 hook 机制挂内建能力。

### 2.2 外部插件可以来自本地文件或 npm 包

`91-135` 的流程是：

1. 从 `cfg.plugin` 读取插件声明
2. 若是 npm specifier，则 `BunProc.install(pkg, version)`
3. 若是 `file://`，则直接 import
4. 对模块导出的每个插件函数做初始化

这意味着 plugin 既可以是：

1. 配置目录里发现的本地文件
2. 也可以是运行时安装的 npm 包

### 2.3 插件拿到的是“内嵌 SDK + 当前 instance 上下文”

`60-81` 初始化 `PluginInput` 时，会给插件：

1. 一个 `createOpencodeClient(...)` 出来的 client
2. `project`
3. `worktree`
4. `directory`
5. `serverUrl`
6. `Bun.$`

而且这个 client 的 `fetch` 直接指向 `Server.Default().fetch(...)`。

所以 plugin 并不是在 runtime 外部瞎连 HTTP，而是运行在当前 instance 作用域内部。

### 2.4 插件会收到 config hook 和 bus event hook

`138-145` 会给每个 hook 调一次 `config?.(cfg)`；`148-158` 又把 `Bus.subscribeAll(...)` 里的事件继续分发给 `hook["event"]`。

说明 plugin 的本体不是某个“单次扩展函数”，而是：

1. 启动时拿 config
2. 运行时持续拿事件
3. 视情况再介入工具定义或执行

---

## 3. MCP 不是“远端工具接口”，而是一整套二级扩展系统

`packages/opencode/src/mcp/index.ts` 比单纯的 tool proxy 要厚得多。

### 3.1 MCP 自己有状态机

`67-109` 定义了 `connected / disabled / failed / needs_auth / needs_client_registration` 五种状态。

也就是说，MCP 在 OpenCode 里不是“要么能连要么不能连”，而是显式把认证和注册状态都纳入 runtime。

### 3.2 remote 和 local 是两套 transport

`325-446` 处理 remote MCP：

1. 优先尝试 `StreamableHTTP`
2. 再退到 `SSE`
3. 默认支持 OAuth，必要时进入 `needs_auth`

`448-465` 处理 local MCP：

1. 直接走 `StdioClientTransport`
2. `cwd = Instance.directory`
3. 从当前实例目录启动本地命令

这说明 MCP server 并不只代表“远端 SaaS 工具”，也可以是本地子进程。

### 3.3 MCP 对外暴露的不只有 tools

当前至少有四类导出：

1. `tools()`，见 `606-646`
2. `prompts()`，见 `648-667`
3. `resources()`，见 `669-688`
4. `getPrompt()` / `readResource()`，见 `690-734`

因此 MCP 在 OpenCode 当前实现里更像一个“二级扩展生态”：

1. MCP tool 会变成 agent tool
2. MCP prompt 会变成 command 模板
3. MCP resource 会变成可读取上下文

也就是说，它不是单一能力入口。

### 3.4 MCP 自己还能发“扩展已变化”事件

`43-56` 和 `112-117` 定义了 `mcp.tools.changed`、`mcp.browser.open.failed` 等事件。

所以 MCP 甚至不是静态挂载的；server 端如果发 `ToolListChangedNotification`，OpenCode 会把这个变化继续抛回自己的 Bus。

---

## 4. ToolRegistry 才是“所有工具真正汇总”的地方

`packages/opencode/src/tool/registry.ts:85-190` 是扩展面里最关键的汇合点之一。

### 4.1 Custom tool 会从配置目录自动扫描

`85-98` 会遍历 `Config.directories()`，扫描：

```ts
{tool,tools}/*.{js,ts}
```

然后把这些定义包成 `Tool.Info`。

这意味着自定义工具并不是一定要走 plugin；`.opencode/tools/*.ts` 这一路本身就是一级扩展入口。

### 4.2 Plugin 也可以贡献 tool

`100-105` 会读取 `Plugin.list()`，再把每个 `plugin.tool` 项继续并入 `custom`。

所以当前工具生态至少有三层来源：

1. 内建工具
2. 配置目录里的 custom tool
3. plugin 暴露的 tool

### 4.3 真正下发给模型前还会做一轮运行时裁剪

`112-136` 先拼出工具全集；`155-190` 再按模型和 flag 过滤：

1. `codesearch` / `websearch` 不是对所有模型开放
2. `apply_patch` 与 `edit` / `write` 会按模型类型互斥切换
3. `LspTool`、`BatchTool`、`PlanExitTool` 都受实验 flag 影响

说明 ToolRegistry 输出的不是“注册表静态快照”，而是**当前模型条件下的可用工具集**。

### 4.4 插件还能在工具定义阶段再改一刀

`181-185` 会对每个工具调用：

```ts
Plugin.trigger("tool.definition", { toolID: tool.id }, output)
```

这意味着 plugin 不仅能新增工具，还能在最终暴露给模型前改工具 description / parameters。

---

## 5. Command 系统把命令模板也做成了可扩展汇总面

`packages/opencode/src/command/index.ts:63-157` 的做法非常有代表性。

当前 command 列表由四部分拼成：

1. 内建 `init` / `review`，见 `82-100`
2. `cfg.command` 里的显式命令，见 `102-115`
3. `MCP.prompts()` 导出的 prompt，见 `117-140`
4. `Skill.all()` 导出的技能，见 `142-153`

也就是说，slash command 在 OpenCode 当前实现里不是一个孤立功能，而是多个扩展源的统一投影。

这也是为什么 command 不是“死写在仓库里的一组内建脚本”，而更像 prompt template registry。

---

## 6. Skill 系统本身也是多来源装载

`packages/opencode/src/skill/index.ts:126-166` 当前会从四个地方收集技能：

1. 全局 `~/.claude`、`~/.agents` 下的 `skills/**/SKILL.md`
2. 当前工程向上发现的 `.claude` / `.agents`
3. `Config.directories()` 下的 `{skill,skills}/**/SKILL.md`
4. `cfg.skills.paths` 和 `cfg.skills.urls`

其中远端 skill pack 由 `skill/discovery.ts:55-100` 负责：

1. 拉 `index.json`
2. 下载 skill 文件到 `Global.Path.cache/skills`
3. 以本地目录形式继续装载

所以 Skill 也不是“仓库里几个 markdown 文件”那么简单，而是一套：

1. 本地发现
2. 配置追加
3. 远端拉取
4. 缓存复用

的混合系统。

### 6.1 Skill 仍然受 agent permission 约束

`packages/opencode/src/skill/index.ts:212-216` 的 `available(agent)` 会用：

```ts
Permission.evaluate("skill", skill.name, agent.permission)
```

过滤掉被 deny 的技能。

这说明技能列表不是“用户装了就所有 agent 都能用”，它仍然回到同一套权限系统里。

---

## 7. 扩展能力很多，但没有第二条执行骨架

把 B09 前面的几类入口放在一起看，会发现一个很稳定的实现风格：

1. Plugin 通过 hook 介入，不自己维护独立会话骨架。
2. MCP 最终被折叠成 tool / prompt / resource。
3. Custom tool 最终还是 `Tool.Info`。
4. Command 最终还是 prompt template。
5. Skill 最终还是被投影成 skill 列表或 command 来源。

也就是说，OpenCode 当前的扩展面虽然很大，但都被压回几种固定接口：

1. tool
2. command
3. prompt
4. resource
5. event hook

这就是它能持续扩展，但又不把 runtime 主链路撕裂掉的原因。

---

## 8. 把 B09 压成一句代码级结论

OpenCode 当前的扩展系统可以压成四句话：

1. **扩展入口很多，但真正汇总点只有少数几个：Plugin、MCP、ToolRegistry、Command、Skill。**
2. **MCP 不只是 tool provider，它还能贡献 prompt 和 resource，因此本质上是一个二级扩展子系统。**
3. **自定义工具、plugin 工具、技能和命令最终都会被投影到固定的 runtime 接口，而不是自己跑一条旁路执行链。**
4. **权限、模型裁剪和 plugin hook 会在最终暴露前再收口一次，因此扩展能力始终被纳入同一套 runtime 约束。**

所以如果要一句话概括 B09：

> 在 OpenCode 里，扩展并不是“外挂旁路”，而是把外部能力持续编译回同一套 tool / command / resource / hook 骨架。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Plugin.init()` | `plugin/index.ts:47-165` | Plugin 桥接入口：11 种 hook 覆盖 runtime 内部改写面 |
| `McpClientManager` | `mcp/index.ts` | MCP 桥接：将远程/本地 MCP server 能力接入 ToolRegistry |
| `ToolRegistry.state()` | `tool/registry.ts:85-105` | 汇总所有工具来源（内建/plugin/MCP）的统一出口 |
| `Command.list()` | `command/index.ts:63-157` | 命令桥接：内建 + 配置 + MCP prompts + Skill commands |
| `Skill.all()` | `skill/index.ts:168-226` | Skill 桥接：多来源 skill 的统一获取接口 |
| `ACP` handler | `server/routes/acp.ts` | 第三层协议桥接：任何 ACP 客户端均可接入 session 的外部入口 |

---

## 代码质量评估

**优点**

- **扩展面统一为 tool/command/resource/hook 四种原语**：无论是 plugin、MCP、skill 还是内建功能，最终都汇入同一套原语集，外部调用不需要区分来源。
- **ACP 支持任意语言客户端**：ACP 基于 HTTP/SSE，任何语言的客户端都可以接入，不依赖 TypeScript SDK。
- **没有第二条执行骨架**：所有扩展能力最终回到同一条 `loop()` 执行路径，不存在"扩展走另一条 fast path"的特例。

**风险与改进点**

- **Plugin 无沙箱隔离**：Plugin 运行在信任代码假设下，第三方 plugin 可以直接访问进程文件系统和环境变量，无向外隔离。
- **MCP tool name sanitize 后碰撞无检测**：不同 MCP server 产生同名工具时（`clientName_toolName` 碰撞），后注册者静默覆盖前者，无冲突报警。
- **ACP 协议无认证**：ACP 端点无 token 或证书验证，局域网内任何客户端都可以调用 ACP API 控制 session。

## 横向对齐补强：OpenCode Bridge 是多表面统一接入

OpenCode 的 bridge/集成能力本质是 server contract：Plugin、MCP、Command、Skill、ACP、TUI/Web 都围绕同一 session runtime。

| 接入面 | 说明 |
| --- | --- |
| Plugin | 进程内 hook |
| MCP | 外部 tool/resource/prompt |
| ACP | 远程/编辑器协议 |
| TUI/Web/Desktop | UI 表面 |
| Command/Skill | prompt 编译表面 |

横向看，OpenCode bridge 最统一，但也最需要认证、协议版本和权限隔离。

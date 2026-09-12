---
layout: content
title: "桥接与集成：CLI、SDK、IDE Companion 与 A2A 接口"
---
# 桥接与集成：CLI、SDK、IDE Companion 与 A2A 接口

把 Gemini CLI 说成“没有 Bridge”只说对了一半。它确实没有 Claude Code 那种单一、专有的 IDE Bridge 子系统，但仓库里已经形成了多条明确的桥接面：CLI 宿主、SDK、VS Code Companion、MCP 扩展和实验性的 A2A 服务。

**目录**

- [1. 当前仓库里的主要桥接面](#1-当前仓库里的主要桥接面)
- [2. CLI 本身就是第一层桥接协议](#2-cli-本身就是第一层桥接协议)
- [3. 程序化桥接：SDK](#3-程序化桥接sdk)
- [4. IDE 桥接：VS Code Companion](#4-ide-桥接vs-code-companion)
- [5. 外部系统桥接：MCP 与 Extension](#5-外部系统桥接mcp-与-extension)
- [6. 远程桥接：实验性的 A2A Server](#6-远程桥接实验性的-a2a-server)
- [7. 与 Claude Code Bridge 的差异](#7-与-claude-code-bridge-的差异)
- [8. 一句话总结](#8-一句话总结)

---

## 1. 当前仓库里的主要桥接面

| 桥接面 | 代码锚点 | 作用 |
| --- | --- | --- |
| CLI 宿主 | `sources/gemini-cli/packages/cli/src/gemini.tsx:227`、`sources/gemini-cli/packages/cli/src/nonInteractiveCli.ts:59` | 交互式终端与 headless 管道接入 |
| SDK | `sources/gemini-cli/packages/sdk/src/agent.ts:19`、`sources/gemini-cli/packages/sdk/src/session.ts:171` | 以程序方式嵌入 Gemini CLI 能力 |
| IDE Companion | `sources/gemini-cli/packages/vscode-ide-companion/src/ide-server.ts:107` | 向 CLI 提供编辑器上下文与 diff 能力 |
| MCP / Extensions | `sources/gemini-cli/packages/cli/src/config/extension-manager.ts:103`、`sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts:34` | 把外部工具、资源、prompt 接到主运行时 |
| A2A/Remote Agent | `sources/gemini-cli/packages/core/src/agents/a2a-client-manager.ts:52`、`sources/gemini-cli/packages/core/src/agents/remote-invocation.ts:78` | 以远程 agent task 形式桥接外部 agent |

## 2. CLI 本身就是第一层桥接协议

Gemini CLI 最基础的桥接能力来自它自己就是一个稳定的宿主入口：

- `main()` 负责参数解析、信任校验、沙箱重启和模式分发
- 交互式模式走 `interactiveCli`
- 非交互模式走 `runNonInteractive()`

这意味着最简单的集成并不需要“专门 Bridge”，而是直接把 CLI 当成协议边界：

- CI 调用 `gemini -p ...`
- 脚本通过 stdin/stdout 与它通信
- 编辑器任务系统把当前文件、选区或 diff 喂给 headless 模式

所以 Gemini CLI 的桥接哲学更接近“以宿主入口为原语”，而不是“所有集成都走一条专有通道”。

## 3. 程序化桥接：SDK

真正的 headless 集成接口不在 `@google/gemini-cli-core`，也不是旧文档里写的 `GeminiAgent`，而是 SDK 包里的：

- `GeminiCliAgent`
- `GeminiCliSession`

对应源码：

- `packages/sdk/src/agent.ts`
- `packages/sdk/src/session.ts`

更贴近源码事实的调用方式是：

```typescript
import { GeminiCliAgent } from '@google/gemini-cli-sdk';

const agent = new GeminiCliAgent({
  instructions: 'You are a helpful assistant.',
});

const session = agent.session();

for await (const event of session.sendStream('分析当前仓库结构')) {
  // 消费流式事件
}
```

SDK 的特点不是重新发明一套执行引擎，而是直接复用核心运行时：

- 仍然用 `Config`
- 仍然用 `GeminiClient`
- 仍然走工具调度
- 仍然支持 skills、tool scheduling、session resume

## 4. IDE 桥接：VS Code Companion

Gemini CLI 现在并非“完全没有 IDE 侧实现”。仓库里有单独的 `packages/vscode-ide-companion`。

从 `ide-server.ts` 可以看到，它会：

- 在本地启动一个基于 Streamable HTTP 的 MCP server
- 给 CLI 注入端口、工作区路径和鉴权 token
- 持续发送 `ide/contextUpdate` 通知
- 处理 diff 打开/关闭等 IDE 请求

这套设计的重点有两个：

- IDE 不直接重写 Gemini CLI 的执行循环，而是把“编辑器能力”包装成可消费的协议面
- 认证、Host 校验、CORS 和本地端口写入都在扩展侧显式实现，说明它不是一个随意拼出来的 demo

## 5. 外部系统桥接：MCP 与 Extension

对于 Jira、浏览器、内部平台、企业工具等外部系统，Gemini CLI 当前的主桥接面不是 IDE Companion，而是 MCP 与扩展系统。

这层由两部分协作：

- `ExtensionManager` 负责发现、启用和装配扩展
- `McpClientManager` 负责建立 MCP transport，并把 tools / prompts / resources 注册进运行时

因此 Gemini CLI 的“桥接面”很分明：

- IDE 语义上下文走 IDE Companion
- 外部服务能力走 MCP / extension
- 宿主执行走 CLI / SDK

## 6. 远程桥接：实验性的 A2A Server

`packages/a2a-server` 说明 Gemini CLI 还在探索另一种桥接形式：把 Agent 作为远程任务服务暴露出去。

当前 README 很克制，只说明它是实验性的实现；但从 `packages/a2a-server/src/http/app.ts`、`packages/a2a-server/src/agent/task.ts` 可以确认它已经具备这些能力：

- HTTP 服务入口
- 任务式流式返回
- 工具审批事件桥接
- checkpoint / restore / memory 等命令封装

这条路线更适合：

- 把 Gemini CLI 作为远程 worker 接入平台
- 做 agent-to-agent 协作
- 让非终端宿主复用现成的 Agent 能力

## 7. 与 Claude Code Bridge 的差异

更准确的对比不是“Gemini CLI 没有 Bridge”，而是：

| 维度 | Gemini CLI | Claude Code |
| --- | --- | --- |
| 核心思路 | 多桥接面并存 | 单一 Bridge/LSP 体系更强 |
| IDE 集成 | VS Code Companion + IDE context protocol | 原生 Bridge 更集中 |
| 外部工具集成 | MCP / extensions 是主力 | Plugin / MCP / Bridge 共同参与 |
| 程序化接入 | SDK + A2A + CLI | SDK / transport / bridge 组合 |

Gemini CLI 的优势是边界比较清楚、协议更分散也更可替换；代价是没有一个像 Claude Code Bridge 那样“一提就知道从哪进”的中心化集成层。

## 8. 一句话总结

当前源码里，Gemini CLI 的桥接不是缺失，而是被拆成了多条真实可用的接入面：CLI、SDK、IDE Companion、MCP/Extensions 和实验性的 A2A Server。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `startInteractiveUI()` | `sources/gemini-cli/packages/cli/src/gemini.tsx:227` | 交互模式 CLI 桥接入口 |
| `runNonInteractive()` | `sources/gemini-cli/packages/cli/src/nonInteractiveCli.ts:59` | Headless / pipe 模式桥接入口 |
| `GeminiCliAgent` | `sources/gemini-cli/packages/sdk/src/agent.ts:19` | SDK 对外 agent facade |
| `GeminiCliSession.sendStream()` | `sources/gemini-cli/packages/sdk/src/session.ts:171` | SDK 流式会话接口 |
| `A2AClientManager` | `sources/gemini-cli/packages/core/src/agents/a2a-client-manager.ts:52` | 远程 A2A agent 通讯管理 |
| `McpClientManager` | `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts:34` | 外部系统桥接：将 MCP server 能力引入运行时 |
| `ExtensionManager` | `sources/gemini-cli/packages/cli/src/config/extension-manager.ts:103` | 扩展发现、加载、启停和配置管理 |

---

## 代码质量评估

**优点**

- **SDK 模式复用同一核心层**：程序化调用和 CLI 交互使用相同的 `GeminiClient`，无双重实现负担。
- **MCP 作为外部系统标准接口**：任何实现了 MCP 的系统都可以与 Gemini CLI 互联，不需要专用适配器。
- **A2A 远程 agent 遵循业界协议**：基于 A2A 标准协议，而不是私有 RPC，有利于跨团队/跨厂商 agent 协作。

## 横向对齐补强：Bridge 包含 IDE、A2A 和 Headless 三类宿主

Gemini CLI 的 bridge 不等同于 Claude Code 的远程 REPL bridge，也不等同于 OpenCode 的 Hono server contract。它更像多宿主适配层：IDE/headless/A2A server 复用 core client、tool registry 和 scheduler。

| Bridge 面 | 典型源码 | 说明 |
| --- | --- | --- |
| Headless/non-interactive | `sources/gemini-cli/packages/cli/src/nonInteractiveCli.ts:59` | 无 TUI 的单次或脚本化执行 |
| SDK session | `sources/gemini-cli/packages/sdk/src/session.ts:171` | 外部程序以库方式消费 stream |
| A2A/remote agent | `sources/gemini-cli/packages/core/src/agents/a2a-client-manager.ts:52` | 将 Gemini CLI 能力转成远程 agent task |
| IDE context | `sources/gemini-cli/packages/vscode-ide-companion/src/ide-server.ts:107` | 与编辑器、诊断、上下文同步集成 |
| MCP/extension | `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts:34` | 外部系统工具与资源接入 |

## 状态边界补强

Bridge 章节和 `15-sdk-transport.md` 的分工如下：

| 主题 | `15-sdk-transport.md` | `21-bridge-system.md` |
| --- | --- | --- |
| stream 协议 | 讲 `GeminiClient.sendMessageStream()` 如何产出事件 | 只说明哪些宿主消费这些事件 |
| 工具执行 | 讲 Scheduler、ToolExecutor、MessageBus | 说明 headless/IDE/A2A 如何呈现审批和结果 |
| 会话状态 | 讲 core session/recording | 说明外部宿主能恢复或附着到什么边界 |
| 远程能力 | 讲协议格式 | 讲 A2A/IDE/ACP 等宿主场景和限制 |

关键点是：Gemini 的 bridge 面都应复用 core client、tool registry 和 scheduler；只要某个宿主绕过这些组件，就不再是同一套运行时能力。

**风险与改进点**

- **A2A 仍处于实验状态**：`a2a-server.ts` 无稳定 API 保证，依赖其做生产集成风险较高。
- **SDK 桥接无 Rate Limit 感知**：程序化调用时若外层频繁调用 `sendMessageStream()`，没有内建速率控制，会直接向 Gemini API 发送过多请求。
- **IDE 桥接依赖 VS Code Companion extension**：非 VS Code 的 IDE 集成（如 JetBrains、Neovim）无官方支持，需要社区自行开发 MCP 适配器。

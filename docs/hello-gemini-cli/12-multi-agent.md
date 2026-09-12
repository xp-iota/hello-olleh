---
layout: content
title: "Gemini CLI 多代理与远程模式：本地子代理、A2A 远程代理与调度器"
---
# Gemini CLI 多代理与远程模式：本地子代理、A2A 远程代理与调度器

旧版文档把 Gemini CLI 概括成“单 Agent CLI”，这已经明显过时。当前仓库里不仅有本地子代理，也有远程代理与对应的调度、认证、进度回传链路。

**目录**

- [1. Agent 不是一个，而是一套注册表](#1-agent-不是一个而是一套注册表)
- [2. 子代理会被暴露成普通工具](#2-子代理会被暴露成普通工具)
- [3. 本地子代理有独立执行环境](#3-本地子代理有独立执行环境)
- [4. 远程代理通过 A2A 调用](#4-远程代理通过-a2a-调用)
- [5. 并行能力也不只停留在设想里](#5-并行能力也不只停留在设想里)
- [6. 当前边界在哪里](#6-当前边界在哪里)
- [7. 关键源码锚点](#7-关键源码锚点)

---

## 1. Agent 不是一个，而是一套注册表

多代理能力的入口是 `sources/gemini-cli/packages/core/src/agents/registry.ts` 中的 `AgentRegistry`。

它会加载四类 agent：

- 内建 agent
- 用户级 agent
- 项目级 agent
- extension 提供的 agent

当前内建项至少包括：

- `CodebaseInvestigatorAgent`
- `CliHelpAgent`
- `GeneralistAgent`
- `BrowserAgentDefinition`
- `MemoryManagerAgent`（按配置启用）

所以，Gemini CLI 现在的真实情况是“主代理 + 可注册子代理”，而不是“完全没有多代理”。

## 2. 子代理会被暴露成普通工具

`sources/gemini-cli/packages/core/src/agents/subagent-tool.ts` 里的 `SubagentTool` 会把 agent definition 包装成一个普通 declarative tool：

- 名称沿用 agent 名称
- 输入参数来自 agent 的 JSON Schema
- 调用前会做 schema 校验
- 执行时通过 `SubagentToolWrapper` 继续分派到本地或远程实现

这也是为什么在主循环里，子代理看起来像是“一个工具调用”，但内部其实已经切换到另一套执行上下文。

## 3. 本地子代理有独立执行环境

本地 agent 的真正执行者是 `sources/gemini-cli/packages/core/src/agents/local-executor.ts`。

它不是简单复用主代理状态，而是显式创建隔离环境：

- 独立的 `ToolRegistry`
- 独立的 `PromptRegistry`
- 独立的 `ResourceRegistry`
- 派生后的 `MessageBus`
- 单独的 chat recording，`kind` 标记为 `subagent`

同时它还会做几件关键事情：

- 从父级 registry 里挑选允许使用的工具
- 阻止 agent 再调用其他 agent，避免递归套娃
- 支持 agent 自己挂载 MCP server
- 通过 `scheduleAgentTools()` 接入调度器
- 在长会话里继续复用压缩、恢复、超时与恢复逻辑

换句话说，本地子代理并不是“主代理切换一个 prompt 继续跑”，而是真正隔离出一套执行回路。

## 4. 远程代理通过 A2A 调用

Gemini CLI 也并非完全没有远程代理。远程分支在 `sources/gemini-cli/packages/core/src/agents/remote-invocation.ts`：

- 使用 `A2AClientManager` 连接远端 agent
- 支持认证 provider
- 维护 `contextId` / `taskId`
- 流式接收远端执行进度
- 把远端活动重新组装成可显示的 `SubagentProgress`

当前实现里，远程 agent 调用默认仍要求确认，这一点在 `getConfirmationDetails()` 中写得很明确。

因此更准确的表述是：

- **没有 Codex / OpenCode 那种通用 app-server 宿主**
- **但已经有 A2A 形式的远程 agent 调用能力**

## 5. 并行能力也不只停留在设想里

Gemini CLI 的并行不只是“未来可以做”，当前就已经有相当明确的调度实现：

- 主线调度器：`sources/gemini-cli/packages/core/src/scheduler/scheduler.ts`
- 子代理调度入口：`sources/gemini-cli/packages/core/src/agents/agent-scheduler.ts`
- 并行测试：`sources/gemini-cli/packages/core/src/scheduler/scheduler_parallel.test.ts`

这说明当前仓库已经具备工具级并行的真实实现基础，而不是纯串行执行模型。

## 6. 当前边界在哪里

虽然多代理能力已经存在，但它的边界也很清楚：

- 主产品形态仍然是 CLI / TUI，而不是独立 server
- 子代理主要以“工具化调用”的方式接入，而不是长期常驻会话
- 本地子代理默认不允许互相递归调用
- 远程代理集中走 A2A，不是统一的浏览器/桌面桥接协议

## 7. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| Agent 注册 | `sources/gemini-cli/packages/core/src/agents/registry.ts` | 发现并注册本地/远程 agent |
| 子代理工具封装 | `sources/gemini-cli/packages/core/src/agents/subagent-tool.ts` | 把 agent 暴露成普通工具 |
| 本地子代理执行 | `sources/gemini-cli/packages/core/src/agents/local-executor.ts` | 隔离 registry、message bus 与执行循环 |
| 远程代理调用 | `sources/gemini-cli/packages/core/src/agents/remote-invocation.ts` | A2A 远程 agent 流式调用 |
| 子代理调度 | `sources/gemini-cli/packages/core/src/agents/agent-scheduler.ts` | 把 agent 工具调用接入调度器 |
| 主调度器 | `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts` | 主/子代理共用的调度基础设施 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `AgentRegistry` | `sources/gemini-cli/packages/core/src/agents/registry.ts` | 加载内建/用户级/项目级/extension agent 定义，提供统一注册表 |
| `SubagentTool` | `sources/gemini-cli/packages/core/src/agents/subagent-tool.ts` | 将 agent 定义包装成标准 declarative tool，调用前做 schema 校验 |
| `LocalAgentExecutor` | `sources/gemini-cli/packages/core/src/agents/local-executor.ts` | 创建隔离执行环境（独立 ToolRegistry/PromptRegistry/MessageBus），阻止递归 |
| `A2AClientManager` | `sources/gemini-cli/packages/core/src/agents/remote-invocation.ts` | 连接远端 agent，维护 contextId/taskId，流式接收执行进度 |
| `Scheduler.scheduleAgentTools()` | `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts` | 将子代理工具调用接入主调度器的并发与审批链路 |
| `SubagentToolWrapper.getConfirmationDetails()` | `sources/gemini-cli/packages/core/src/agents/subagent-tool.ts` | 决定远程 agent 调用是否需要用户确认 |

---

## 代码质量评估

**优点**

- **子代理看起来像工具**：`SubagentTool` 将 agent 包装为 declarative tool，主循环无需区分"工具调用"和"子代理调用"，扩展成本低。
- **LocalAgentExecutor 真正隔离执行**：独立的 ToolRegistry/PromptRegistry/MessageBus 防止父子代理状态污染，`kind=subagent` 的 chat recording 也独立归档。
- **A2A 协议支撑远程 agent 调用**：不依赖 app-server 宿主，通过标准 A2A 协议接入，远端 agent 可以是任何实现了协议的服务。

**风险与改进点**

- **LocalAgentExecutor 禁止 agent 嵌套**：通过权限控制阻止子代理再调用其他代理，虽然避免了递归套娃，但也限制了合法的多层任务分解场景。
- **远程 agent 调用默认需要确认**：`getConfirmationDetails()` 要求用户确认，在批量自动化 headless 场景下会阻塞流程，无法配置跳过。
- **`AgentRegistry` 无热更新**：agent 定义在启动时加载，会话中新增 agent（如动态安装 extension）需要重启生效，无法动态注册。

## 横向对齐补强：Gemini 多代理分成本地 agent 与 A2A

Gemini CLI 的多代理能力比 Codex/Claude 更明显分成两层：本地 LocalAgentExecutor 和远程 A2A server/client。

| 层级 | Gemini 侧对象 | 横向对比 |
| --- | --- | --- |
| 本地 agent | LocalAgentExecutor / AgentRegistry | 对应 Claude AgentTool |
| 远程 agent | A2A server/client | Gemini 特色 |
| 权限 | confirmation / policy | 仍需和 Scheduler/PolicyEngine 联读 |
| 输入输出 | sendMessageStream / task event | 与 core client 复用 |

## Agent 类型能力与隔离矩阵

| Agent 类型 | 入口对象 | 隔离方式 | 权限/确认 | 适用场景 |
| --- | --- | --- | --- | --- |
| 本地 agent | `LocalAgentExecutor` / `AgentRegistry` | 独立 ToolRegistry、PromptRegistry、MessageBus，禁止递归 agent 调用 | 仍经 Scheduler / confirmation | 本地子任务拆分、专门化 prompt |
| Browser agent | 作为工具/agent 能力接入调度 | 与浏览器执行环境隔离，状态不应直接污染 core chat | 需要显式确认或策略允许 | UI 自动化、网页上下文任务 |
| A2A agent | `A2AClientManager` / remote invocation | 远端 contextId/taskId，流式 task event 回传 | 默认确认，远端能力受协议约束 | 跨进程/跨服务 agent 调用 |

这三类能力的共同点是“作为工具被 Scheduler 看见”，差异在隔离边界：本地 agent 隔离的是 Gemini 内部 registry/message bus；browser agent 隔离的是外部执行环境；A2A agent 隔离的是远端协议上下文。源码锚点可从 `sources/gemini-cli/packages/core/src/agents/local-executor.ts`、`sources/gemini-cli/packages/core/src/agents/remote-invocation.ts`、`sources/gemini-cli/packages/core/src/agents/subagent-tool.ts` 与 `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts:191` 对照阅读。

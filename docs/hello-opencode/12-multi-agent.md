---
title: "多代理：Agent 目录、子代理任务与代理选择"
---
# 多代理：Agent 目录、子代理任务与代理选择

> 基于 `sources/opencode/packages/core/src/agent.ts` 与 `session/subagent-*.ts` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. Agent 是一等目录对象](#1-agent-是一等目录对象)
- [2. 代理选择与步数配额](#2-代理选择与步数配额)
- [3. 子代理任务](#3-子代理任务)
- [4. 与插件体系的关系](#4-与插件体系的关系)

---

## 1. Agent 是一等目录对象

`packages/core/src/agent.ts` 把 Agent 定义为 Location 作用域的目录对象：

- 标识与形状来自 `packages/schema/src/agent.ts`：`Agent.ID`、`Agent.Name`、`Agent.Info`、`Agent.Color`，以及 `Event`（agent 事件，`agent.updated` 会被事件日志器桥接进进程日志）。
- 内建默认 agent 的 ID 是 `build`（`defaultID = ID.make("build")`）。
- Agent 目录参与数据清理约定：`SHELL_OUTPUT_GLOB` 与 `TOOL_OUTPUT_GLOB` 定义了 shell 输出与工具输出的受管存储 glob——工具的受管输出按 agent 数据目录组织。

## 2. 代理选择与步数配额

- 运行时的代理选择是 `Selection = { id, info? }`；每个 Step 前 runner 重新解析所选 agent 与模型（见 [03-agent-loop.md](./03-agent-loop.md) §4）。
- 步数配额（step allowance）按所选 agent 计：**提升新的用户输入会重置所选 agent 的步数配额；一批 steer 只重置一次**。这防止 steer 轰炸无限延长执行。
- 代理与模型选择走 Session 操作（重命名、agent/model 选择等都在 ID 绑定 Session 值上），选择结果持久化。

## 3. 子代理任务

子代理由任务化机制承载，而不是简单的"再开一个会话"：

- `session/subagent-job.ts`：把子代理执行包装成可调度任务（`Runner` 由 `Session.Service + Job.Service + Scope` 构造），继承 job 的调度与生命周期语义。
- `session/subagent-completion.ts`：子代理完成后的结果回收与父会话回流。
- 子代理与普通 Session 共享 durable 事件与 projection 基础设施，父会话能观测子代理的进展与终态。

## 4. 与插件体系的关系

- `plugin/agent.ts` 与 `plugin/plan.ts` 让插件参与 agent 目录与 plan 形态的塑造；catalog 变换管线决定最终生效的 agent 集合（见 [17-settings-config.md](./17-settings-config.md)）。
- 权限、工具快照、instruction 组合都按"当前 agent"维度生效：所选 agent 的 skill 指引是 instruction 来源之一，工具可用集随 agent 变化（system prompt 的工具指引也随之条件化，见 [11-prompt-system.md](./11-prompt-system.md)）。

## 源码锚点

- [`sources/opencode/packages/core/src/agent.ts`](../../sources/opencode/packages/core/src/agent.ts)：Agent 目录对象与默认 `build`
- [`sources/opencode/packages/schema/src/agent.ts`](../../sources/opencode/packages/schema/src/agent.ts)：公共形状
- [`sources/opencode/packages/core/src/session/subagent-job.ts`](../../sources/opencode/packages/core/src/session/subagent-job.ts)、[`subagent-completion.ts`](../../sources/opencode/packages/core/src/session/subagent-completion.ts)：子代理任务化
- [`sources/opencode/packages/core/src/plugin/agent.ts`](../../sources/opencode/packages/core/src/plugin/agent.ts)：插件对 agent 目录的参与

---
title: "多代理：pi 不内建 sub-agent，用扩展补"
---
# 多代理：pi 不内建 sub-agent，用扩展补

> 基于 `sources/pi/` 快照（pi v1.1.0）：README/CONTRIBUTING 的官方姿态、`examples/extensions/subagent/`、`src/experimental/durable/`、`src/experimental/vacation/` 校对。

**目录**

- [1. 官方姿态：核心刻意不做](#1-官方姿态核心刻意不做)
- [2. 官方示例：subagent 扩展](#2-官方示例subagent-扩展)
- [3. durable 子会话：subagent.ts](#3-durable-子会话subagentts)
- [4. vacation：后台 subagent 自跑 harness](#4-vacation后台-subagent-自跑-harness)
- [5. 与其他 CLI 的对照](#5-与其他-cli-的对照)
- [6. 哲学根源](#6-哲学根源)

---

## 1. 官方姿态：核心刻意不做

pi 的 README（`README.md:19`）说得非常直白："Pi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package that does it your way."——sub-agent 和 plan mode 都**不属于核心**，官方给出的两条路是：让模型现场搭一个，或者装一个别人写好的 package。这与 CONTRIBUTING.md 的 Philosophy 一脉相承：核心必须保持极小且可扩展，"PRs that bloat the core will likely be rejected"。

因此在 pi 里找不到 Claude Code 的 `Task` 工具那种内建委派入口；多代理是**资源层**（扩展、package）的组合结果，而不是 `AgentSession` 的一等公民 API。

## 2. 官方示例：subagent 扩展

官方以扩展形式给出完整参考实现 `examples/extensions/subagent/`（root `package.json` 里的 npm workspace，可带依赖）：

- `agents.ts` 负责子代理发现与配置：从 user/project 目录扫描 Markdown 文件，用 YAML frontmatter 声明 `name` / `description` / `tools` / `model` / `systemPrompt`，产出 `AgentConfig`——子代理就是**一段带 frontmatter 的提示词**，不是运行时实体；
- `agents/` 内置四个角色模板：`planner.md`、`reviewer.md`、`scout.md`、`worker.md`；
- `index.ts` 的机制是**进程级隔离**：每次 subagent 调用 `spawn` 一个独立的 `pi` 进程，用 JSON 模式（见 [15-sdk-transport.md](./15-sdk-transport.md)）捕获结构化输出，输出按字节上限截断后作为工具结果返回，全文保留在 tool details 里。

这正是"Ask Pi to build what you want"的自证：多代理 = 扩展注册一个工具 + 复用 pi 已有的自动化面（JSON 模式、spawn）。任何扩展也可以用 `pi.sendMessage` / `pi.sendUserMessage` / `pi.exec` 自行编排会话内多代理，但那是扩展作者的职责，核心只提供原料。

## 3. durable 子会话：subagent.ts

第二条官方路径在 durable 实验区：`src/experimental/durable/subagent.ts` 是 `@earendil-works/pi-durable` 上的**前台子代理**扩展。它的语义与进程 spawn 完全不同：

- 每次工具调用创建一个**子会话（child conversation）**，所有权归属发起调用的 task（`ownership: { kind: "task", taskId }`）；
- 子会话**存活到调用之外**——调用返回答案后子会话仍在，用户可以切过去继续对话（README 的 `/agents` 列表即此入口）；
- 中止调用会中止子代理；
- 工具标记 `replay: "safe"`：崩溃后重放时，重跑会找到自己创建的子会话与已提交的 submission，靠 requestId 去重不会重复派发；
- 子代理默认**不能再委派**（`configure` 把 Subagent 扩展从子会话中移除），避免无限递归。

## 4. vacation：后台 subagent 自跑 harness

`src/experimental/vacation/` 是一个基于同一 durable Harness 的演示型"自跑"代理（durable 编码代理的拷贝，把编码工具与提示词换成度假规划）。它的多代理要点在**后台**模式：

- `research` 工具在独立会话里启动 subagent 并立即返回；后台 task 负责投递请求，并把子代理的报告作为新消息发回主会话——主会话在研究进行期间可继续对话；
- 子代理的 `search` 调用**并行**执行，各自是 task 面板里的独立 task；
- 崩溃恢复：`search` 可安全重跑，`--continue` 重启后已完成的搜索保留、未完成的重新执行，requestId 防止请求与报告重复投递。

## 5. 与其他 CLI 的对照

| 维度 | pi | 内建 subagent 的 CLI（如 Claude Code / Gemini CLI / OpenCode） |
| --- | --- | --- |
| 核心是否内建 | 否，README 明确声明跳过 | 是，核心工具（Task/Subagent）直接委派 |
| 子代理定义 | 扩展自定（Markdown frontmatter / durable 子会话） | 核心规定格式（如 `.claude/agents/` 的 agent 定义） |
| 隔离边界 | 进程（示例）或 durable 子会话（实验区） | 核心内建的独立上下文 |
| 持久化 | 仅 durable 实验区有检查点恢复 | 依实现而定，通常随会话持久化 |
| 获取方式 | 自己写扩展或 `pi install` 一个 package | 开箱即用 |

## 6. 哲学根源

多代理的缺席不是功能缺口，而是"核心极小"哲学的直接后果：pi 把`AgentSession` 之外的一切能力都推到资源层。代价是**没有标准化的子代理契约**——每个扩展自己决定隔离方式、定义格式与结果聚合；收益是核心不需要理解委派、并发子会话或跨代理权限传递，这些复杂度全部留在了可替换的扩展里。durable Harness（子会话所有权、replay 语义、requestId 去重）目前是这套思路里最接近"内建"的形态，但仍是 experimental。

## 源码锚点

- [`sources/pi/packages/coding-agent/examples/extensions/subagent/`](../../sources/pi/packages/coding-agent/examples/extensions/subagent/)：官方 subagent 扩展示例（进程 spawn + JSON 模式）
- [`sources/pi/packages/coding-agent/src/experimental/durable/subagent.ts`](../../sources/pi/packages/coding-agent/src/experimental/durable/subagent.ts)：durable 前台子代理
- [`sources/pi/packages/coding-agent/src/experimental/durable/README.md`](../../sources/pi/packages/coding-agent/src/experimental/durable/README.md)：durable 编码代理与恢复语义说明
- [`sources/pi/packages/coding-agent/src/experimental/vacation/README.md`](../../sources/pi/packages/coding-agent/src/experimental/vacation/README.md)：后台 subagent 自跑 harness
- [`sources/pi/README.md`](../../sources/pi/README.md)：:19 的"skips features like sub-agents and plan mode"声明
- [`sources/pi/packages/coding-agent/docs/extensions.md`](../../sources/pi/packages/coding-agent/docs/extensions.md)：扩展 API（sendMessage/exec 等编排原料）

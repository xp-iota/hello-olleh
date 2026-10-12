---
title: "工具系统：契约、四档 profile 与大目录策略"
---
# 工具系统：契约、四档 profile 与大目录策略

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 的 agent 通过结构化工具操作文件、shell、浏览器、消息通道乃至 Gateway 自身；本篇对照 `packages/agent-core/src/types.ts`、`src/agents/tool-catalog.ts`、`src/agents/agent-tools.*` 与 `src/claws/`。

**目录**

- [1. AgentTool 契约与扩展元数据](#1-agenttool-契约与扩展元数据)
- [2. 目录、分组与四档 profile](#2-目录分组与四档-profile)
- [3. 分层 policy 管道与审批](#3-分层-policy-管道与审批)
- [4. 工具执行链](#4-工具执行链)
- [5. 大目录策略：tool_search、deferred schemas 与结果预算](#5-大目录策略tool_searchdeferred-schemas-与结果预算)
- [6. claws 不是 tools](#6-claws-不是-tools)

---

## 1. AgentTool 契约与扩展元数据

循环层唯一的工具契约是 `AgentTool`（`packages/agent-core/src/types.ts:548`），与 provider 无关：`label`（UI 展示）、TypeBox `parameters`、可选 `outputSchema`（约束 `AgentToolResult.details`）、可选 `prepareArguments` shim（schema 校验前归一化原始入参）、`execute(toolCallId, params, signal, onUpdate)` 返回 `AgentToolResult`（`content` 给模型、`details` 给 UI/日志、`progress` 给通道进度条、`terminate` 提示提前收束）。`AgentToolResult.progress` 是个显式的隐私契约：`visibility: "channel"` + `privacy: "public"`——进度文本绝不允许携带 secret 或抓取内容。每个工具可自带 `executionMode: "sequential" | "parallel"` 覆盖批次默认。

网关层在其上再叠 `AgentToolWithMeta`（`src/agents/tools/common.ts:25`）：`catalogMode: "direct-only"`（保留模型可见性、禁止目录桥接隐藏）、`requiredClientCaps`（客户端能力门槛）、`getExecutionTimeoutMs`（工具自管超时预算）。工具实现按来源分层：核心文件工具（read/write/edit/apply_patch/ls/exec/process）在 `src/agents/core-coding-tools.ts:202` 组装，OpenClaw 专属工具（sessions、message、gateway、media、cron……）在 `src/agents/tools/` 与 `src/agents/openclaw-tools.ts:93`。

## 2. 目录、分组与四档 profile

`src/agents/tool-catalog.ts` 是纯数据目录（刻意不 import 服务器运行时，否则会把整个 gateway 模块图拖进 Control UI 构建）。它把 60+ 核心工具分到 11 个 section（fs/runtime/web/memory/sessions/ui/messaging/automation/nodes/agents/media），并派生四个内置 profile（`ToolProfileId`，`:29`；`CORE_TOOL_PROFILES`，`:576`）：

| profile | 语义 |
| --- | --- |
| `minimal` | 只含标记为 minimal 的最小工具集 |
| `coding` | coding 段工具 + `bundle-mcp` |
| `messaging` | 面向消息通道的会话工具 |
| `full` | `allow: ["*"]` |

别名表（`src/agents/tool-policy-shared.ts:13`）把历史名字永久映射到当前名：`bash → exec`、`apply-patch → apply_patch`、`cron → automations`——配置里写旧名不报错。section 同时生成 `group:fs`、`group:openclaw` 这样的**分组 glob**，allow/deny 策略可以整组引用。与 pi 不同，OpenClaw 的默认工具面不是"一个编码集"，而是随场景（coding agent vs 通道助理 vs sub-agent）选 profile，再叠加多层 allow/deny。

## 3. 分层 policy 管道与审批

运行时可见性由 `tool-policy-pipeline.ts` 按固定顺序叠层过滤：`profile → providerProfile → global → globalProvider → agent → agentProvider → session → runtime`（每层带 `ToolPolicySource` 诊断，排除永远能指认来源）。模型可见 ≠ 可执行：被策略滤掉的工具如果仍被调用，得到 `TOOL_EXECUTION_GATED_MESSAGE`（"Unavailable in this run. Continue with the tools permitted…"）。

执行前的风险门控走 `beforeToolBatch`/`beforeToolCall` 钩子链（`src/agents/agent-tools.before-tool-call.approval.ts`）：exec 类调用可产生**审批请求**——带 pending id 的工具结果提示用户 "Reply with: /approve"，拒绝是终态（"Do not mention /approve or any other approval command"），超时有上限；有原生审批卡片的通道优先用卡片而不是聊天命令。独立 allowlist 在 hook 合并时用 `attachToolAllowlistIntersection` 挂上交集元数据而不是立即求交——glob 交集无法用单张 glob 表表示，推迟到具体工具面求值。这与 [11-prompt-system.md](./11-prompt-system.md) 的立场一致：prompt 只描述行为，授权由运行时决定。

## 4. 工具执行链

`executeToolCalls()`（`packages/agent-core/src/agent-loop.ts:459`）先把整批 toolCall 逐个 `validateToolCallForBatchAdmission`，再交 `beforeToolBatch` 做**批次准入**——宿主可返回 `intervention` 把整批就地转为干预结果。随后判定执行模式：只要批次里有 `executionMode: "sequential"` 的工具，整批退回串行；并行组则先顺序 prepare（钩子时序可预期）、并发执行、`tool_execution_end` 按完成序发出、结果消息按 assistant 源序回插。串行组在每个调用之间检查 steering 队列（见 [23-input-command-queue.md](./23-input-command-queue.md)），可跳过未开始的尾部调用。批次终止条件保守：`shouldTerminateToolBatch` 要求**全部**已 finalize 的结果都置 `terminate: true`（`:897`）。工具结果预算由 `src/agents/tool-result-limits.ts` 按模型上下文自适应：默认 16k 字符，100k token 以上模型 32k、200k 以上 64k，且不超过上下文窗口的 30%（`MAX_TOOL_RESULT_CONTEXT_SHARE`，`:4`）。

## 5. 大目录策略：tool_search、deferred schemas 与结果预算

OpenClaw 的工具目录大到不能全部声明给模型，于是复用了 pi 式的"目录 + 按需取用"思路（`docs/tools/index.md` 明言 "Search a large OpenClaw tool catalog → Tool Search"）：启用后只有 `tool_search`/`tool_describe`/`tool_call` 等控制工具直连模型，其余目录工具通过 schema 目录被找到。`src/agents/tool-search-directory.ts:23` 的 `MAX_TOOL_SCHEMA_DIRECTORY_PROMPT_CHARS = 18_000` 给目录本身设了与 skills 相同的 prompt 预算，system prompt 里以 `### Deferred Tool Schemas` 节出现（`src/agents/system-prompt.ts:687` 附近）。渲染结果按**目录数组身份**（WeakMap）缓存，保证 prompt 前缀字节稳定——这是冷启动预算之外的 prompt cache 友好设计（见 [08-performance.md](./08-performance.md)）。同名跨来源冲突的工具在进入目录前先被 unique-name gate 拦下，等共享信任检查处理。

## 6. claws 不是 tools

`src/claws/` 容易被误读成工具实现，实际是 **ClawHub 包管理器**：`CLAW_PACKAGE_KINDS = ["skill", "plugin"]`（`src/claws/manifest-contract.ts:5`），把 ClawHub 上的 skill/plugin 包安装进 agent workspace——bootstrap 文件（AGENTS/SOUL/IDENTITY/TOOLS/HEARTBEAT.md）、MCP server、cron 作业、agent config 一次落盘，且兼容 `openclaw/claude/codex/cursor` 四种扩展格式（`CLAW_EXTENSION_FORMATS`）。换言之：tools 是 agent 的可调用函数，claws 是往 agent 生态里装"技能包与插件"的包通道，二者的交叉点只在 claws 安装的插件可以注册新工具。`src/flows/` 则是另一条易混淆线：guided channel-setup 与 doctor 诊断流程，纯控制面交互，不参与工具执行。

## 源码锚点

- [`sources/openclaw/packages/agent-core/src/types.ts`](../../sources/openclaw/packages/agent-core/src/types.ts)：AgentTool 契约与 AgentToolResult
- [`sources/openclaw/packages/agent-core/src/agent-loop.ts`](../../sources/openclaw/packages/agent-core/src/agent-loop.ts)：批次准入、串并行分组与终止条件
- [`sources/openclaw/src/agents/tool-catalog.ts`](../../sources/openclaw/src/agents/tool-catalog.ts)：目录、分组与四档 profile
- [`sources/openclaw/src/agents/tool-policy-shared.ts`](../../sources/openclaw/src/agents/tool-policy-shared.ts)：别名表与执行门控
- [`sources/openclaw/src/agents/tool-policy-pipeline.ts`](../../sources/openclaw/src/agents/tool-policy-pipeline.ts)：分层策略管道
- [`sources/openclaw/src/agents/tools/common.ts`](../../sources/openclaw/src/agents/tools/common.ts)：AgentToolWithMeta 扩展
- [`sources/openclaw/src/agents/tool-result-limits.ts`](../../sources/openclaw/src/agents/tool-result-limits.ts)：按上下文窗口自适应的结果预算
- [`sources/openclaw/src/agents/tool-search-directory.ts`](../../sources/openclaw/src/agents/tool-search-directory.ts)：deferred schema 目录
- [`sources/openclaw/src/agents/agent-tools.before-tool-call.approval.ts`](../../sources/openclaw/src/agents/agent-tools.before-tool-call.approval.ts)：exec 审批生命周期
- [`sources/openclaw/src/claws/manifest-contract.ts`](../../sources/openclaw/src/claws/manifest-contract.ts)：ClawHub 包契约
- [`sources/openclaw/docs/tools/index.md`](../../sources/openclaw/docs/tools/index.md)：工具/技能/插件分工官方文档

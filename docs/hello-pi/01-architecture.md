---
title: "架构全景：minimal, extensible agent harness"
---
# 架构全景：minimal, extensible agent harness

> 基于 `sources/pi/`（pi v1.1.0，Mario Zechner / Earendil Works）源码校对。pi 自我定位为 "minimal, extensible agent harness"：核心极小，一切非核心能力都以扩展形式存在。

**目录**

- [1. 总体形态与关键取舍](#1-总体形态与关键取舍)
- [2. 14 个 workspace 包的分层](#2-14-个-workspace-包的分层)
- [3. 端到端调用链](#3-端到端调用链)
- [4. 架构不变量](#4-架构不变量)

---

## 1. 总体形态与关键取舍

pi 是一个 npm-workspace monorepo：14 个包全部在 `packages/` 下，根 manifest 为 `pi-monorepo`（私有），外加 `packages/coding-agent/examples/extensions/` 下五个示例扩展子工程。它刻意保持了三类"没有"：

| 取舍 | 说明 |
| --- | --- |
| 核心极小、扩展优先 | CONTRIBUTING.md 明言 "PRs that bloat the core will likely be rejected"；MCP、codemode、tool-search、llama.cpp 全是扩展（`packages/coding-agent/src/extensions/index.ts:8-14`） |
| 无内建子代理 / 无计划模式 | `subagent`、`plan-mode` 只是 `examples/extensions/` 下的示例扩展，核心不提供 |
| 无内建权限系统 | `docs/security.md`：模型输出不可信，pi 以用户权限直接执行，没有审批门（approval gates） |

## 2. 14 个 workspace 包的分层

按依赖关系自底向上分层（内部互依用 `^1.1.0` 区间，外部依赖一律精确 pin）：

| 层 | 包（npm 名） | 职责 | pi 依赖 |
| --- | --- | --- | --- |
| 0 | chord、telemetry、tui、mcp、codemode | 应用组装运行时（facet/service/复制状态）、遥测契约、差分渲染 TUI、MCP 客户端、QuickJS 沙箱 | 无 |
| 1 | ai (`pi-ai`) | 统一 LLM API：自动模型发现、~43 家 provider、按 API 协议（非按厂商）分派 | telemetry |
| 2 | durable、agent (`pi-agent-core`)、protocol | durable 会话/任务/文档运行时；通用 agent 循环；CBOR 线协议 | durable←chord+ai；agent←ai；protocol←chord |
| 3 | env、client、server | 远程执行环境（SSH daemon）；远程 pi 会话的客户端/服务端 | env←chord+durable；client/server←chord+protocol |
| 4 | coding-agent (`pi-coding-agent`) | `pi` CLI 本体：read/bash/edit/write 工具、会话管理、四种模式 | chord、agent、ai、codemode、mcp、tui（dev：client/protocol/server） |
| 5 | evals（私有） | 评测 harness | dev：ai、coding-agent |

要点：`agent` 只被 coding-agent 消费；`durable` 目前只被 `env` 和 coding-agent 的实验目录 `src/experimental/durable/` 消费，尚非默认运行时；根 `package.json` 的 build 顺序就是这个拓扑排序（chord → tui → telemetry → … → coding-agent）。

## 3. 端到端调用链

一次提问的主干（详见 [03-agent-loop.md](./03-agent-loop.md)）：

```
Agent.prompt()                    packages/agent/src/agent.ts:373
 └─ runWithLifecycle              packages/agent/src/agent.ts:507
     └─ runAgentLoop              packages/agent/src/agent-loop.ts:102
         └─ runLoop               packages/agent/src/agent-loop.ts:163
             ├─ streamAssistantResponse    agent-loop.ts:381
             │   ├─ transformContext / convertToLlm / normalizeContext
             │   └─ StreamFn = Models.streamSimple     packages/ai/src/models.ts:901
             │       ├─ applyAuth                        models.ts:843
             │       ├─ provider dispatch（按 model.api） models.ts:1072
             │       └─ adapter（如 anthropic-messages stream:571）
             │           → AssistantMessageEventStream（含 Usage+cost）
             └─ executeToolCalls       agent-loop.ts:508
```

`AgentTool` 由宿主注入（`AgentLoopConfig`），pi-agent-core 对 provider 目录零依赖——LLM 调用就是一个可替换的 `StreamFn`（`packages/agent/src/stream-fn.ts`）。

## 4. 架构不变量

- **禁止 inline/dynamic import**：懒加载一律用显式 `.lazy.ts` 文件（如 `src/extensions/codemode/execute.lazy.ts`），不允许 `await import()`。
- **可擦除 TypeScript**：`packages/*/src` 只准用 Node strip-only 语法（无 `enum`、`namespace`），源码在 `node --experimental-strip-types` 下直接运行；相对导入必须写 `.ts` 后缀（`scripts/check-ts-relative-imports.mjs`）。
- **入口即成本契约**：`scripts/check-entry-graphs.mjs` 对每个 `exports` 入口做文件数预算与 `forbid` 列表，防止窄入口拖进整个 barrel。
- **供应链加固**：`.npmrc` 设 `save-exact=true` 与 `min-release-age=2`；安装脚本白名单只放行 `@google/genai`、`esbuild`、`protobufjs` 三个；发布与本地冒烟共用同一打包器 `produceArtifactSet()`。
- **资产解析**：coding-agent 内所有资源路径必须经 `src/config.ts` 的 helper 解析（兼容源码 checkout、npm 安装与单文件二进制三种形态），禁止直接用 `__dirname`。

## 源码锚点

- [`sources/pi/packages/agent/src/agent-loop.ts`](../../sources/pi/packages/agent/src/agent-loop.ts)：runAgentLoop/runLoop/executeToolCalls
- [`sources/pi/packages/ai/src/models.ts`](../../sources/pi/packages/ai/src/models.ts)：streamSimple、applyAuth、calculateCost 与 provider dispatch
- [`sources/pi/packages/coding-agent/src/extensions/index.ts`](../../sources/pi/packages/coding-agent/src/extensions/index.ts)：内建扩展注册表（可被第三方替换）
- [`sources/pi/packages/coding-agent/docs/security.md`](../../sources/pi/packages/coding-agent/docs/security.md)：无审批门的安全模型
- [`sources/pi/CONTRIBUTING.md`](../../sources/pi/CONTRIBUTING.md)：核心极小化哲学与贡献门禁

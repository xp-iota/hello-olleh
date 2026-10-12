---
title: "工具系统：契约、执行链与五种暴露档位"
---
# 工具系统：契约、执行链与五种暴露档位

> 基于 `sources/pi/packages/agent/src/types.ts`（契约与执行链）与 `sources/pi/packages/coding-agent/src/core/tools/`（内建工具）的 pi v1.1.0 源码校对。

**目录**

- [1. AgentTool 契约](#1-agenttool-契约)
- [2. 8 个内建工具与分组](#2-8-个内建工具与分组)
- [3. 工具执行链](#3-工具执行链)
- [4. file-mutation-queue](#4-file-mutation-queue)
- [5. toolExposure 五档与工具的第二来源](#5-toolexposure-五档与工具的第二来源)

---

## 1. AgentTool 契约

`AgentTool`（`packages/agent/src/types.ts:466`）是循环层唯一的工具契约，与 provider 无关：

| 成员 | 说明 |
| --- | --- |
| `name` / `label` / `description` | 标识与 UI 展示（`label` 供 TUI） |
| `parameters` | TypeBox schema，发送给模型前经 `validateToolArguments` 校验 |
| `prepareArguments` | 可选的入参 shim（执行前归一化） |
| `outputSchema` | 可选；声明后结果可携带机器可读的 `structuredContent`（不给模型，给程序调用方） |
| `execute(toolCallId, params, signal, onUpdate)` | 返回 `AgentToolResult`：`content`（给模型的文本/图片块）、`details`（给 UI/日志）、`isError`、`terminate` |
| `replay: "never" \| "safe"` | 持久化意图标记——重放会话时 `safe` 工具可重执行，`never` 只回放结果（`types.ts:490`） |
| `executionMode` | `"sequential" \| "parallel"`，单工具级并发覆盖（`types.ts:498`） |

## 2. 8 个内建工具与分组

`ToolName` 联合（`core/tools/index.ts:95`）：`read | bash | powershell | edit | write | grep | find | ls`。实现各自一个文件（`core/tools/`），`edit` 配 `edit-diff.ts` 做 diff 细节，`grep`/`find` 使用托管二进制 `rg`/`fd`（`~/.pi/agent/bin/`），每个工具另有 TUI 渲染器（`tools/renderers/`）。

两个预置分组：

| 分组 | 工具 | 出处 |
| --- | --- | --- |
| coding 集（默认） | `read, bash, edit, write` | `createCodingTools`（`index.ts:195`）；`DEFAULT_TOOL_NAMES`（`core/settings-manager.ts:215`） |
| read-only 集 | `read, grep, find, ls` | `createReadOnlyTools`（`index.ts:204`） |

默认工具集可用 `defaultTools` 设置改写，支持 `+name`/`-name` 修饰符在默认集上增删（`settings-manager.ts:264` 附近）。`bash` 与 `powershell` 互斥——Windows 上以 PowerShell 作为替代 shell（`core/tools/powershell.ts`）。

## 3. 工具执行链

`executeToolCalls`（`agent-loop.ts:508`）按 `ToolExecutionMode` 选串行（`executeToolCallsSequential`，`:530`）或并行（`executeToolCallsParallel`，`:586`）。单个调用的管道：

1. `prepareToolCall`（`:708`）：查表找工具 → `prepareArguments` shim（`:694`）→ `validateToolArguments`（pi-ai TypeBox 校验，`:727`）→ `beforeToolCall` 钩子（`:728`），钩子可 `{block, reason, terminate}` 把调用就地变成错误结果。
2. `executePreparedToolCall`（`:821`）：调 `tool.execute(...)`；`onUpdate` 部分更新合并后以 `tool_execution_update` 发出；抛错转错误结果；`performance.now()` 计 `durationMs`。
3. `finalizeExecutedToolCall`（`:859`）：`afterToolCall` 钩子可逐字段覆盖 `content`/`details`/`usage`/`structuredContent`/`isError`/`terminate`。

并行模式的确定性：调用**顺序地** prepare（`beforeToolCall` 顺序可预期），再 `Promise.all` 并发执行，`tool_execution_end` 按完成序发出，而工具结果消息按 assistant 源序回插。批次提前终止只在**整批**结果都置 `terminate: true` 时发生（`shouldTerminateToolBatch`，`:690`）。`runToolCall`（`:811`）复用同一管道，供"工具调工具"（如 codemode）时权限钩子仍然生效。结果经 `createToolResultMessage` 变成 `ToolResultMessage` 追加进上下文，驱动下一轮迭代（见 [03-agent-loop.md](./03-agent-loop.md)）。

## 4. file-mutation-queue

`core/tools/file-mutation-queue.ts:32` 的 `withFileMutationQueue(filePath, fn)` 按**文件路径**串行化变更：`edit`（`edit.ts:163`）与 `write`（`write.ts:67`）的执行体都包在里面，防止并行工具调用对同一文件交错读写；`read` 不经队列，容忍读到瞬时中间态。

## 5. toolExposure 五档与工具的第二来源

扩展注册工具时用 `ToolExposure`（`core/extensions/types.ts:516`）控制"模型如何到达工具"：

| 档位 | 语义 |
| --- | --- |
| `direct` | 默认；声明给模型，直接可调 |
| `model-only` | 可被模型调用，但不进 codemode 沙箱脚本 |
| `codemode` | 不声明给模型，仅供 codemode 沙箱脚本调用 |
| `deferred` | 同 codemode，但可被 `tool_search` 找到并动态加载 |
| `hidden` | 对模型完全不可见 |

工具的内建来源之外还有四个第二来源：MCP 服务器工具以 `mcp__<server>__<tool>` 命名空间接入（`core/mcp-servers.ts:40,156`，配置在 `src/extensions/mcp/`）；codemode 把"写 JS 调工具"本身变成一个工具（`src/extensions/codemode/tool.ts`）；tool-search 提供 `tool_search` 动态发现 `codemode`/`deferred` 档工具（`src/extensions/tool-search/tool.ts`）；扩展经 `registerTool` 注入任意 `ToolDefinition`（`core/extensions/types.ts:1643`，TypeBox schema + `execute` + 渲染器 + exposure）。内建的 `codemode`/`tool-search`/`mcp` 扩展本身可被同名第三方扩展整体替换（`src/extensions/index.ts:8-14`）。

## 源码锚点

- [`sources/pi/packages/agent/src/types.ts`](../../sources/pi/packages/agent/src/types.ts)：AgentTool 契约与 ToolExecutionMode
- [`sources/pi/packages/agent/src/agent-loop.ts`](../../sources/pi/packages/agent/src/agent-loop.ts)：executeToolCalls 五段执行链
- [`sources/pi/packages/coding-agent/src/core/tools/index.ts`](../../sources/pi/packages/coding-agent/src/core/tools/index.ts)：8 工具联合与两个分组工厂
- [`sources/pi/packages/coding-agent/src/core/tools/file-mutation-queue.ts`](../../sources/pi/packages/coding-agent/src/core/tools/file-mutation-queue.ts)：文件级变更串行化
- [`sources/pi/packages/coding-agent/src/core/extensions/types.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/types.ts)：ToolExposure 与 registerTool
- [`sources/pi/packages/coding-agent/src/extensions/index.ts`](../../sources/pi/packages/coding-agent/src/extensions/index.ts)：可替换的内建扩展注册表

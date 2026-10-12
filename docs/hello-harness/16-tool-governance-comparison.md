---
title: "工具治理横向对比"
---
<!-- markdownlint-disable MD060, MD024 -->

# 工具治理横向对比

对应项目章节：

- `docs/hello-claude-code/05-tool-system.md`
- `docs/hello-codex/05-tool-system.md`
- `docs/hello-gemini-cli/05-tool-system.md`
- `docs/hello-opencode/05-tool-system.md`

## 1. 一句话结论

| 项目 | 工具治理模型 |
| --- | --- |
| Claude Code | 工具协议、权限 hook、批处理/流式执行紧耦合在 `query()` 主链路旁 |
| Codex | Rust runtime 中央化治理，approval、sandbox、tool output 截断都在运行时闭环内 |
| Gemini CLI | ToolRegistry + Scheduler + PolicyEngine，模型流结束后批量调度工具 |
| OpenCode | Tool service + Permission + durable 消息结算，工具终态是持久历史的一部分 |

## 2. 生命周期对比

![生命周期对比](diagrams/16-tool-governance-comparison-diagram.svg)

**生命周期对比** — [交互版](diagrams/16-tool-governance-comparison-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/16-tool-governance-comparison-diagram.architecture.json)

- **组成**：7 个节点
- **关系**：源图 6 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：model tool call → parse / validate · parse / validate → permission / policy · permission / policy → execute

四个项目都符合这条闭环，但差异在控制点的位置：

| 控制点 | Claude | Codex | Gemini | OpenCode |
| --- | --- | --- | --- | --- |
| 工具声明 | prompt/tool schema 侧 | Rust tool spec | ToolRegistry | Tool service + schema |
| 权限判定 | hook + permission context | approval policy + sandbox | PolicyEngine + scheduler | Permission rule（含持久化 saved rule） |
| 并发模型 | 支持批次和 streaming executor | futures/turn loop 内控制 | Scheduler 批量调度 | provider/工具 fiber 各自保序并行 |
| 结果归一 | tool_result message | ToolOutput/截断策略 | ToolResult/蒸馏 | durable 结算 + 截断（`ToolOutput.truncate`） |
| 安全边界 | 反编译快照需谨慎确认 | 最强，sandbox 是核心设计 | policy 清楚但执行仍依赖工具实现 | durable 可审计，交互阻塞成本较高 |

## 3. 代表源码证据

| 项目 | Registry / Schema | Permission / Policy | Execution / Result |
| --- | --- | --- | --- |
| Claude Code | `sources/claude-code/src/Tool.ts:123`, `sources/claude-code/src/tools.ts` | `sources/claude-code/src/hooks/useCanUseTool.tsx`, `sources/claude-code/src/services/tools/toolOrchestration.ts` | `sources/claude-code/src/services/tools/toolExecution.ts`, `sources/claude-code/src/services/tools/StreamingToolExecutor.ts` |
| Codex | `sources/codex/codex-rs/tools/src/tool_spec.rs:21` | `sources/codex/codex-rs/core/src/tools/orchestrator.rs:107`, `sources/codex/codex-rs/core/src/exec_policy.rs:225` | `sources/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:181` |
| Gemini CLI | `sources/gemini-cli/packages/core/src/tools/tool-registry.ts:247` | `sources/gemini-cli/packages/core/src/policy/policy-engine.ts:242` | `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts:445`, `sources/gemini-cli/packages/core/src/scheduler/tool-executor.ts:65` |
| OpenCode | `sources/opencode/packages/core/src/tool.ts:65` | `sources/opencode/packages/core/src/permission.ts:223`, `sources/opencode/packages/core/src/permission/saved.ts` | `sources/opencode/packages/core/src/session/runner/step.ts:77`, `sources/opencode/packages/core/src/tool-output.ts:67` |

## 4. 文档完善要求

每个项目的 `05-tool-system.md` 应固定包含五段：

1. 工具来源：内建、MCP、plugin、skill、custom command。
2. 权限入口：谁做 allow/deny/ask，审批结果是否持久化。
3. 执行模型：串行、并行、批处理、流式执行。
4. 结果回注：如何回到 message/history/part/thread item。
5. 风险点：sandbox 缺口、参数校验、输出截断、权限缓存。

## 5. 合并后的读法

选安全治理优先看 Codex；选可审计 durable history 看 OpenCode；选 prompt/tool 深度编排看 Claude Code；选轻量 TypeScript monorepo 和 policy 可读性看 Gemini CLI。

## 6. 深度对齐矩阵

工具治理横向阅读时，不能只比较“有没有工具”。更稳定的比较单位是一次 tool call 的五个阶段：声明、选择、审批、执行、回注。

| 阶段 | Claude Code | Codex | Gemini CLI | OpenCode |
| --- | --- | --- | --- | --- |
| 声明 | `Tool` 对象携带 schema、prompt、并发能力和权限元信息 | Rust tool spec 进入 `Prompt.tools`，由 runtime 统一暴露 | `ToolRegistry` 汇总内建、MCP、扩展工具，再导出 function declaration | `Tool` service（`tool.ts:65`）汇总内建、MCP、plugin/custom tool，schema 由 `@opencode/schema` 管理 |
| 选择 | 模型在 `query()` 流内产出 tool_use block | Responses/WebSocket stream 产出 tool call item | `Turn.run()` 解析 Gemini stream，再交 Scheduler | `llm.stream()`（`@opencode/ai`）产出 tool-call 事件 |
| 审批 | `useCanUseTool`、hook、permission context 共同判断 | approval policy、sandbox policy、PermissionRequest hook 共同判断 | `MessageBus.publish()` 先走 `PolicyEngine.check()`，再决定 allow/deny/ask | 工具 context 内 `Permission.ask()`（`permission.ts:223`），已批准规则持久化到 SQLite（`PermissionSaved`），session 级规则在 `SessionTable.permission`（`session/sql.ts:52`） |
| 执行 | `runTools()` 批处理或 `StreamingToolExecutor` 流水线执行 | `ToolRouter` / handler / runtime 执行，shell 路径可进入 sandbox | `Scheduler` 三阶段队列 + `ToolExecutor` 包装单次调用 | `prepared.executeTool()` 调用 tool `execute()`，`SessionStep.attempt()`（`runner/step.ts:77`）把终态 durable 结算 |
| 回注 | tool result 拼入下一轮 `messages` | function call output 记录为 thread/history item | `handleCompletedTools()` 把结果作为 continuation 再提交 | 工具终态结算进 `session_message`（`session.tool.success/failed` 事件），下一 Step 重载投影历史 |

这张表也给项目章节设置了最低门槛：每个 `05-tool-system.md` 至少要能把一个工具调用从“模型看见 schema”追到“下一轮模型重新看见结果”。只列工具清单不算完整工具系统分析。

## 7. 风险分层

| 风险 | Claude Code | Codex | Gemini CLI | OpenCode |
| --- | --- | --- | --- | --- |
| 权限漂移 | hook、settings、plugin、skill 都可能改变工具可用性，需标注来源 | 中央 runtime 强，但 handler 多，需关注 policy 到 runtime 的传递 | PolicyEngine 清楚，但 UI 确认和 Scheduler 状态分离 | durable approval 可审计，但第三方 plugin/custom tool 信任边界更高 |
| 并发误判 | `isConcurrencySafe()` 判断错误会让写操作并发 | `supports_parallel` 或锁策略错误会破坏顺序 | 模型侧 `wait_for_previous` 语义依赖模型正确表达 | 工具 fiber 由 Effect runtime 并发派发，结算保序依赖 `SessionStep.attempt()` 内部逻辑 |
| 输出污染 | 大 tool result 可能压垮 prompt，依赖预算/compact | tool output 归一化和截断需跟 prompt 编译联读 | distillation/masking 可降低 token 压力，但改变可见内容 | 终态只有一份 model-facing content；超出 2000 行/50 KiB 由 `ToolOutput.truncate` 截断（`tool-output.ts:67`） |
| 安全审计 | 反编译快照要分清源码确认与推断 | sandbox 是强项，应优先验证 exec/apply_patch 路径 | policy 可读性好，但工具实现仍需逐个看 | server/API 面宽，需同时审 HTTP auth、permission 和 Bus/SSE |

## 8. 维护补强顺序

项目章继续维护时按这个顺序最稳：

1. 先补 `05-tool-system.md` 的单次 tool call 时序。
2. 再补 `07-error-security.md` 的失败与拒绝路径。
3. 再补 `16-resilience.md` 的重试、回滚、继续同一 turn 的边界。
4. 最后把 MCP/plugin/skill 的工具来源回链到 `06/13/14/24`，避免在 `05` 里展开所有扩展机制。

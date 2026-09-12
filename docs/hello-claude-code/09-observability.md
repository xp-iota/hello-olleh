---
layout: content
title: "可观测性：日志、遥测与运行时状态追踪"
---
# 可观测性：日志、遥测与运行时状态追踪

本文分析 Claude Code 的可观测性基础设施，包括结构化日志、遥测数据采集、用户隐私控制，以及调试模式下的运行时状态追踪。


**目录**

- [1. 可观测性在 Claude Code 中的定位](#1-可观测性在-claude-code-中的定位)
- [2. 日志系统](#2-日志系统)
- [3. 遥测系统](#3-遥测系统)
- [4. `--debug` 模式](#4-debug-模式)
- [5. 性能追踪](#5-性能追踪)
- [6. 运行时状态追踪](#6-运行时状态追踪)
- [7. 与其他系统的对比](#7-与其他系统的对比)

---

## 1. 可观测性在 Claude Code 中的定位

Claude Code 的可观测性服务于两类目标：

| 目标 | 受众 | 实现 |
|------|------|------|
| **产品遥测** | Anthropic 团队 | 匿名化使用数据采集 |
| **开发者调试** | 用户/开发者 | 调试日志、`--debug` 模式 |

## 2. 日志系统

### 2.1 日志级别与输出

Claude Code 通过环境变量控制日志详细程度：

```bash
# 开启调试日志
DEBUG=claude-code:* claude

# 特定模块日志
DEBUG=claude-code:tools,claude-code:api claude
```

调试日志输出到 `stderr`，不干扰正常的 TUI 渲染。

### 2.2 关键日志点

```typescript
// 工具调用日志
log.debug('tool:execute', {
  tool: toolName,
  input: toolInput,
  duration_ms: elapsed,
  success: !error,
});

// API 请求日志
log.debug('api:request', {
  model,
  input_tokens: requestTokens,
  output_tokens: responseTokens,
  cached_tokens: cacheHitTokens,
});

// 会话状态变更
log.debug('session:state', {
  event: 'turn_complete',
  turn_id: turnId,
  tool_calls: toolCallCount,
});
```

## 3. 遥测系统

### 3.1 遥测数据类型

Claude Code 采集以下匿名化事件数据（可选退出）：

| 事件类型 | 内容 | 示例 |
|----------|------|------|
| `session_start` | 版本、平台信息 | `{version: "2.1.87", os: "darwin"}` |
| `command_used` | 使用的 Slash 命令 | `{command: "commit"}` |
| `tool_call` | 工具名称（不含参数） | `{tool: "Edit"}` |
| `error` | 错误类型（不含内容） | `{type: "api_error", code: 429}` |
| `session_end` | 会话时长、轮数 | `{duration_s: 120, turns: 8}` |

### 3.2 隐私控制

```bash
# 禁用遥测
export CLAUDE_CODE_DISABLE_TELEMETRY=1
# 或在 settings.json 中设置
```

```json
// settings.json
{
  "telemetry": {
    "enabled": false
  }
}
```

### 3.3 遥测发送

遥测数据在**会话结束时**批量发送，使用独立的非阻塞 HTTP 请求，不影响正常操作。

## 4. `--debug` 模式

启用 `--debug` 标志后，Claude Code 提供增强的可观测性：

```bash
claude --debug
```

调试模式额外输出：
- **完整 API 请求体**（含系统提示）
- **完整 API 响应**（含 token 用量）
- **工具调用详情**（含输入参数和输出结果）
- **上下文窗口使用情况**（已用/剩余 tokens）
- **缓存命中情况**（prompt cache hit/miss）

## 5. 性能追踪

### 5.1 Token 用量追踪

每轮 turn 结束后，Claude Code 在 TUI 中显示 token 用量统计：

```
✓ Response (8.3s) · 12,450 input tokens (3,200 cached) · 892 output tokens
```

### 5.2 工具执行计时

每个工具调用的耗时通过调试日志记录，方便识别性能瓶颈：

```
[debug] tool:execute Edit completed in 42ms
[debug] tool:execute Bash completed in 3821ms
[debug] tool:execute Read completed in 8ms
```

## 6. 运行时状态追踪

### 6.1 会话状态导出

可以通过 Slash 命令查看当前会话状态：

```
/status   → 显示当前 token 用量、会话 ID、模型版本
/cost     → 显示本次会话的 API 费用估算
```

### 6.2 Transcript 作为可观测性记录

Claude Code 将完整会话 Transcript 持久化到本地：

```
~/.claude/projects/<project-hash>/
  └── <session-id>.jsonl   # 结构化对话记录
```

每条记录包含完整的消息内容、工具调用参数和结果，是事后分析的最完整数据源。

## 7. 与其他系统的对比

| 系统 | 日志方式 | 遥测 | 调试模式 | Transcript |
|------|---------|------|---------|-----------|
| **Claude Code** | DEBUG env var | 匿名化，可退出 | `--debug` | JSONL 持久化 |
| **Codex** | `RUST_LOG` | 无公开遥测 | `--verbose` | Thread 持久化 |
| **Gemini CLI** | `DEBUG` env var | 无公开遥测 | 无专门模式 | Session JSON |
| **OpenCode** | Effect-ts 日志 | 无公开遥测 | 调试 TUI | SQLite |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
|----------|------|------|
| `Logger` | `src/utils/log.ts` | 结构化日志：按 level 过滤，`--debug` 模式下输出详细请求/响应 |
| `setupTelemetry()` | `src/services/telemetry/` | 初始化 telemetry sinks：本地 + 远端 (StatsD/OTel) |
| `recordUsage()` | `src/services/telemetry/` | 记录 token 用量、工具调用次数等关键指标 |
| `SessionStatus` | `src/utils/sessionStatus.ts` | 运行时状态枚举：idle/running/waiting-for-user/error |
| `--debug` flag handler | CLI 入口 | 开启 debug 模式：打印 API 请求参数、响应体、工具调用详情 |
| `performanceObserver` | `src/utils/performance.ts` | 记录关键操作延迟（模型首字节、工具执行时间）|

---

## 代码质量评估

**优点**

- **遥测与核心路径解耦**：`setupTelemetry()` 初始化独立的 sink，核心循环不直接依赖遥测，sink 挂掉不影响主流程。
- **`--debug` 模式全面**：开启后可看到完整 API 请求参数和响应体，比大多数 CLI 工具的调试模式信息量更丰富。
- **多系统对比清晰**：文档中有四系统（Claude Code/Codex/OpenCode/Gemini CLI）可观测性对比表，便于理解各系统的能力差距。

**风险与改进点**

- **遥测数据无本地持久化**：telemetry 以 in-process sink 发送，进程崩溃时在途数据丢失，历史指标无本地存储可供事后分析。
- **`Logger` 无日志文件轮转**：debug 日志输出到文件时，无自动轮转和清理机制，长期运行的 Claude Code Server 模式下日志文件会无限增长。
- **`SessionStatus` 枚举粒度粗**：当前状态只区分 4 种大状态，无法区分"等待工具审批"、"等待 MCP 响应"、"暂停等待人工干预"等细粒度状态，监控报警精度受限。

## 横向对齐补强：Claude 可观测性要补事件关联

Claude Code 有 stream event、telemetry、debug log、MCP debug 和 TUI 状态，但缺少贯穿一次 turn 的统一 trace id。

| 信号 | Claude 侧对象 | 横向对比 |
| --- | --- | --- |
| stream event | query/model/tool 事件 | 对应 Codex thread event、OpenCode Bus |
| telemetry | analytics / GrowthBook 相关事件 | Claude 特有 feature flag 观察面 |
| MCP debug | MCP connection/tool logs | 对应 OpenCode MCP status |
| TUI state | React state | 比 durable state 更难事后重放 |

后续应增加“单次 prompt trace”视角，串起输入、模型请求、工具调用、权限、MCP 和最终渲染。

## 源码锚点补强：把日志、诊断和 query 事件串起来

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/claude-code/src/utils/log.ts:158` | `logError` 统一错误日志出口 | 对应 Codex tracing / OpenCode Log 服务 |
| `sources/claude-code/src/services/diagnosticTracking.ts:30` | 诊断跟踪模块入口 | 说明 Claude 还有 IDE/LSP 诊断面 |
| `sources/claude-code/src/services/diagnosticTracking.ts:132` | diagnostic 事件处理 | 对应 OpenCode 的 Bus 事件投影 |
| `sources/claude-code/src/query.ts:478` | query 主循环中的事件/错误处理点 | 可和 `03-agent-loop.md`、`25-debugging.md` 联读 |
| `sources/claude-code/src/query.ts:1528` | 长流程尾部的状态记录点 | 用于解释为什么 Claude 可观测性分散在 query 层 |

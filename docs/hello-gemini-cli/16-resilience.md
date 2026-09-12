---
layout: content
title: "韧性机制：请求重试、循环恢复与上下文减压"
---
# 韧性机制：请求重试、循环恢复与上下文减压

Gemini CLI 的韧性并不集中在单一的“恢复管理器”里，而是分散在模型请求、流式输出、循环检测、上下文压缩和会话持久化几条链路中协同实现。

**目录**

- [1. 韧性的实际分层](#1-韧性的实际分层)
- [2. API 请求层的重试](#2-api-请求层的重试)
- [3. 流式输出层的恢复](#3-流式输出层的恢复)
- [4. 循环检测与自愈](#4-循环检测与自愈)
- [5. 上下文压力下的韧性](#5-上下文压力下的韧性)
- [6. 会话恢复与 checkpoint](#6-会话恢复与-checkpoint)
- [7. 当前边界](#7-当前边界)
- [8. 一句话总结](#8-一句话总结)

---

## 1. 韧性的实际分层

| 层次 | 代码锚点 | 主要职责 |
| --- | --- | --- |
| 请求重试 | `sources/gemini-cli/packages/core/src/utils/retry.ts:42`、`sources/gemini-cli/packages/core/src/core/client.ts:1134` | 处理 429、499、5xx 和部分网络错误 |
| 流式恢复 | `sources/gemini-cli/packages/core/src/core/geminiChat.ts:89`、`sources/gemini-cli/packages/core/src/core/geminiChat.ts:431` | 处理中途断流、无效内容、异常 tool call |
| 循环自愈 | `sources/gemini-cli/packages/core/src/services/loopDetectionService.ts:133`、`sources/gemini-cli/packages/core/src/core/client.ts:78` | 检测卡死模式并向模型注入恢复反馈 |
| 上下文减压 | `sources/gemini-cli/packages/core/src/context/chatCompressionService.ts:237`、`sources/gemini-cli/packages/core/src/context/toolOutputMaskingService.ts:69` | 压缩旧历史、截断大工具输出、防止上下文爆炸 |
| 持久化恢复 | `sources/gemini-cli/packages/core/src/utils/checkpointUtils.ts:102`、`sources/gemini-cli/packages/cli/src/ui/hooks/useSessionResume.ts:34` | 会话落盘、恢复聊天、可选 checkpoint 回滚 |

## 2. API 请求层的重试

Gemini CLI 的通用重试工具是 `retryWithBackoff()`，默认参数定义在 `sources/gemini-cli/packages/core/src/utils/retry.ts`：

- 默认最多 `10` 次尝试
- 初始延迟 `5000ms`
- 最大延迟 `30000ms`
- 默认重试 429、499、5xx，以及部分瞬时网络错误

`GeminiClient.generateContent()` 会把模型请求包装进这套重试逻辑，并额外挂上：

- `onPersistent429`：持续配额失败时触发 fallback 处理
- `onValidationRequired`：需要用户验证账号或配额时中断并交给外层处理
- `onRetry`：把重试事件发给 `coreEvents`，让 UI 或日志层可见

这里的重点不是“简单重试三次”，而是把配额、认证和可用性策略一起纳入重试决策。

## 3. 流式输出层的恢复

`GeminiChat.sendMessageStream()` 还处理另一类问题：请求已经发出，但流式响应在中途坏掉。

源码里专门定义了 `MID_STREAM_RETRY_OPTIONS`：

- 总共 `4` 次尝试（首次 + 3 次中途重试）
- 初始延迟 `1000ms`
- 指数退避

它要恢复的不只是网络断流，还包括：

- 无 finish reason 的异常响应
- 没有有效文本的响应
- 格式不完整或不符合预期的 function call
- 模型返回了不该出现的工具调用形态

因此 Gemini CLI 的“流式韧性”不是 UI 层补丁，而是 `GeminiChat` 这一层自己负责把坏流修到一个可继续消费的状态。

## 4. 循环检测与自愈

Gemini CLI 不是放任 Agent 无限重试。`LoopDetectionService` 同时做三件事：

- 检测连续相同参数的工具调用
- 检测持续重复的文本输出
- 在 turn 数达到阈值后，调用额外的 LLM 进行二次判定

相关阈值在源码里是显式常量，例如：

- 工具调用重复阈值：`5`
- 内容重复阈值：`10`
- 达到 `30` turns 后开始做 LLM loop check

一旦检测到循环，`GeminiClient._recoverFromLoop()` 不会直接崩掉会话，而是向模型注入一条系统反馈，要求它停下来重新评估当前策略，避免继续重复同样的工具或回答。

此外，`GeminiClient` 还设置了 `MAX_TURNS = 100`，说明系统同时有硬上限和软恢复两层保护。

## 5. 上下文压力下的韧性

Gemini CLI 的另一个现实风险不是“报错”，而是上下文逐轮膨胀到不可用。当前仓库主要靠两种机制缓解。

### 5.1 聊天压缩

`ChatCompressionService` 会在上下文接近模型上限时压缩旧历史：

- 默认在 token 使用达到模型上限的 `50%` 左右开始考虑压缩
- 默认保留最近约 `30%` 的历史窗口
- 对历史中的大工具输出再做额外截断

它不是盲删历史，而是：

- 先保留最近的高价值上下文
- 再把老历史总结成压缩摘要
- 必要时把超大工具输出截断并写到临时文件

### 5.2 工具输出 masking

除了整体压缩，`ToolOutputMaskingService` 还会针对历史里“又大又旧”的工具输出做单独瘦身，把上下文中保留的内容变成更小的占位版本，并把变更同步回会话记录。

这意味着 Gemini CLI 的上下文减压是持续进行的，不是等爆掉之后再一次性清空。

## 6. 会话恢复与 checkpoint

### 6.1 聊天记录落盘

`ChatRecordingService` 会把会话写进：

```text
~/.gemini/tmp/<project>/chats/session-*.json
```

记录内容不仅有用户和模型消息，还包括：

- tool call 与 tool result
- token 统计
- thoughts
- 目录上下文
- 会话摘要

`useSessionResume.ts` 和 `nonInteractiveCli.ts` 在恢复时都会调用 `config.getGeminiClient()?.resumeChat(...)`，把磁盘记录重新装回 UI 历史和客户端历史。

### 6.2 可选 checkpoint 回滚

如果用户开启 `general.checkpointing.enabled`，系统还会为可恢复的工具调用额外写 checkpoint：

```text
~/.gemini/tmp/<project>/checkpoints/
```

这套机制依赖 Git snapshot：

- `checkpointUtils.ts` 负责生成 checkpoint 元数据
- `GitService.createFileSnapshot()` 负责创建可回滚快照
- `/restore` 负责把文件系统和历史一起恢复到旧状态

这和“会话 resume”不是一回事。前者是恢复聊天，后者是恢复项目状态。

## 7. 当前边界

当前实现已经具备比较完整的自愈链路，但仍有几个边界要注意：

- 不是所有错误都能自动恢复，认证和配额问题经常需要用户介入
- checkpoint 依赖 Git，未启用或仓库异常时不能工作
- 压缩和 masking 解决的是上下文预算问题，不保证语义零损失
- Hook、策略和远程代理引入的新失败模式，仍然需要各自模块继续兜底

## 8. 一句话总结

更准确的概括是：Gemini CLI 的韧性体系由“请求重试 + 坏流恢复 + 循环检测 + 上下文减压 + 会话/项目恢复”共同组成，而不是旧文档里那种 `GeminiAgent.run()` + `SessionManager` 的单点叙事。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `retryWithBackoff()` | `sources/gemini-cli/packages/core/src/utils/retry.ts:198` | API 重试：指数退避 + 可重试错误判断 |
| `ChatCompressionService` | `sources/gemini-cli/packages/core/src/context/chatCompressionService.ts:237` | 上下文压缩：阈值触发，保留近期历史 |
| `LoopDetectionService` | `sources/gemini-cli/packages/core/src/services/loopDetectionService.ts:133` | 三层循环检测（工具重复/内容重复/LLM 辅助），支持 session 级禁用 |
| `ToolOutputMaskingService` | `sources/gemini-cli/packages/core/src/context/toolOutputMaskingService.ts:69` | 历史中大工具输出二次瘦身 |
| `useSessionResume()` | `sources/gemini-cli/packages/cli/src/ui/hooks/useSessionResume.ts:34` | TUI resume：把磁盘记录重新装回 client history |
| `GitService.createFileSnapshot()` | `sources/gemini-cli/packages/core/src/services/gitService.ts:140` | Git checkpoint 创建工作区快照 |

---

## 代码质量评估

**优点**

- **多层韧性叠加**：API 重试 + 流式恢复 + 循环检测 + 上下文压缩 + checkpoint 各自独立，任一层失效不会使整个系统崩溃。
- **循环检测多维度**：工具哈希 + 内容去重 + LLM 辅助三类检测覆盖了规则难以捕获的语义级无进展循环。
- **Session 恢复基于文件录制**：`ChatRecordingService` 实时落盘，进程崩溃不会全量丢失对话历史，`--resume` 可以续接中断的会话。

**风险与改进点**

- **重试与压缩行为对用户不透明**：哪些操作触发了重试、触发了压缩，终端 UI 没有明确信号，用户不知道系统在"处于韧性状态"还是"正常运行"。
- **循环检测无法覆盖跨 session 的重复**：`LoopDetectionService` 仅在单次运行内有效，跨会话的相同任务陷入循环无法被检测到。
- **Checkpoint 恢复语义不完整**：Git checkpoint 恢复的是工作区文件变更，不能恢复 tool call 状态、pending approval、内存中的运行时对象图。

## 横向对齐补强：Gemini 韧性核心是 loop detection + checkpoint

Gemini CLI 的韧性应围绕三类机制写：模型/stream 错误恢复、LoopDetectionService、Git checkpoint。

| 机制 | 横向对比 |
| --- | --- |
| LoopDetectionService | Gemini 特色，OpenCode 有 doom loop 类似机制 |
| checkpoint | 对应 Codex ghost snapshot、OpenCode revert |
| retry | 对应 Codex/OpenCode provider retry |
| policy confirmation | 工具安全韧性 |

## Checkpoint 恢复边界

| 对象 | Checkpoint 能否恢复 | 说明 |
| --- | --- | --- |
| 工作区文件修改 | 可以 | checkpoint 主要用于回滚 Git/workspace 文件变化 |
| 对话历史 | 依赖 chat recording/session store | 不是 checkpoint 本身负责 |
| Pending tool call | 不恢复 | 工具进程、future、stdout 状态属于运行时 |
| Pending confirmation | 不恢复 | 用户确认通道不能跨进程静默延续 |
| LoopDetectionService 内存状态 | 不恢复 | 跨 session 重复循环仍可能漏检 |
| MCP / tool registry 连接状态 | 重新初始化 | 由 Config/MCP manager 在启动时重建 |

因此 Gemini checkpoint 更接近 Codex ghost snapshot 的“文件回滚”侧，而不是 OpenCode durable history 那样的“会话事实恢复”。恢复后应先重新检查 diff、会话记录和工具状态，再让模型继续规划。

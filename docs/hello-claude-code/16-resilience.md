---
layout: content
title: "韧性机制：重试策略、Provider 故障转移与长会话稳定性"
---
# 韧性机制：重试策略、Provider 故障转移与长会话稳定性

本文分析 Claude Code 的韧性系统，包括 API 层重试、Provider 故障转移、Token 溢出自愈，以及长会话稳定性保障。

> 另见：[07-error-security](./07-error-security.md) — 错误类型分类与安全边界  
> 另见：[08-performance](./08-performance.md) — Prompt Cache 与长会话性能


**目录**

- [1. 韧性体系层次](#1-韧性体系层次)
- [2. API 层重试策略](#2-api-层重试策略)
- [3. Provider 故障转移](#3-provider-故障转移)
- [4. Context 溢出自愈](#4-context-溢出自愈)
- [5. Transcript 持久化（存储层韧性）](#5-transcript-持久化存储层韧性)
- [6. 工具超时保护](#6-工具超时保护)
- [7. 与其他系统的对比](#7-与其他系统的对比)

---

## 1. 韧性体系层次

Claude Code 的韧性机制分布在三个层次：

| 层次 | 关键机制 | 实现位置 |
|------|---------|---------|
| **API 层** | 重试、退避、Provider 切换 | `api-provider-retry-errors` |
| **Session 层** | Context 压缩、Token 自愈 | `performance-cache-context` |
| **存储层** | Transcript 持久化、会话恢复 | `session-storage-and-resume` |

## 2. API 层重试策略

### 2.1 指数退避重试

```typescript
// src/services/api/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 30000 } = options;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetriable(error) || attempt === maxRetries) throw error;
      
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * 1000, // jitter
        maxDelay
      );
      await sleep(delay);
    }
  }
}
```

### 2.2 可重试错误类型

| HTTP 状态码 | 错误类型 | 重试策略 |
|------------|---------|---------|
| `429` | Rate Limit | 指数退避，尊重 `Retry-After` 头 |
| `500`, `502`, `503` | 服务器错误 | 指数退避 |
| `529` | API Overloaded | 指数退避，最长等待 30s |
| `408` | 请求超时 | 立即重试 1 次 |
| `400`, `401`, `403` | 客户端错误 | **不重试** |

## 3. Provider 故障转移

Claude Code 支持配置多个 API Provider，当主 Provider 失败时自动切换：

```json
// settings.json
{
  "apiProviders": [
    { "type": "anthropic", "priority": 1 },
    { "type": "bedrock", "region": "us-east-1", "priority": 2 },
    { "type": "vertex", "project": "my-gcp-project", "priority": 3 }
  ]
}
```

故障转移逻辑：
```typescript
// 主 Provider 失败 → 按优先级尝试备用 Provider
const providers = sortByPriority(config.apiProviders);
for (const provider of providers) {
  try {
    return await provider.complete(request);
  } catch (err) {
    if (isFatalError(err)) throw err; // 不可恢复错误不尝试切换
    log.warn(`Provider ${provider.type} failed, trying next...`);
  }
}
throw new AllProvidersFailedError();
```

## 4. Context 溢出自愈

当上下文接近 Token 上限时，Claude Code 自动触发 Compaction：

```
上下文使用量
  ↓ 超过阈值（约 70%）
自动触发 /compact
  ↓
生成上下文摘要（调用 LLM）
  ↓
用摘要替换详细历史
  ↓
释放 Token 空间，继续会话
```

这个机制确保长会话不会因 Token 溢出而中断。

## 5. Transcript 持久化（存储层韧性）

每条消息实时写入 Transcript 文件，保障进程崩溃后可恢复：

```typescript
// 每个 turn 结束后立即持久化
await transcriptStorage.append(sessionId, {
  turn_id: turnId,
  role: 'assistant',
  content: response,
  tool_calls: toolCalls,
  tool_results: toolResults,
  timestamp: Date.now(),
});
```

进程崩溃后用户可通过 `claude --resume <session-id>` 从上次状态继续。

## 6. 工具超时保护

```typescript
// src/tools/timeout.ts
const TOOL_TIMEOUTS = {
  Bash: 120_000,      // 2 分钟
  Read: 30_000,        // 30 秒
  WebFetch: 30_000,    // 30 秒
  default: 60_000,     // 1 分钟
};

async function executeWithTimeout(tool: Tool, input: unknown): Promise<unknown> {
  return Promise.race([
    tool.execute(input),
    sleep(TOOL_TIMEOUTS[tool.name] ?? TOOL_TIMEOUTS.default).then(() => {
      throw new ToolTimeoutError(`${tool.name} timed out`);
    }),
  ]);
}
```

## 7. 与其他系统的对比

| 机制 | Claude Code | Codex | Gemini CLI | OpenCode |
|------|------------|-------|-----------|---------|
| **重试** | 指数退避 + jitter | `retry_config` | `retryWithBackoff` | Effect-ts `retry` |
| **Provider 切换** | 多 Provider 故障转移 | 不支持 | 不支持 | 不支持 |
| **Context 自愈** | 自动 `/compact` | 手动 compact | `ToolOutputDistillationService` | Effect-ts compaction |
| **持久化** | JSONL Transcript | Thread 持久化 | Session JSON | SQLite durable |
| **工具超时** | 按工具类型差异化 | 全局 timeout | 无内置超时 | Effect-ts timeout |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
|----------|------|------|
| `withExponentialBackoff()` | `src/utils/retry.ts` | 指数退避重试：对 429/529/5xx 自动重试 |
| `ContextWindowManager` | `src/agent/contextWindow.ts` | context window 监控：计算 token 使用率并触发压缩 |
| `compactConversation()` | `src/agent/conversationManager.ts` | 对话历史压缩：调用 LLM 生成摘要替换长历史 |
| `AbortController` integration | `src/agent/agentLoop.ts` | 全局取消信号：Ctrl-C 触发 abort，传播到所有异步操作 |
| `ErrorBoundary` handler | `src/utils/errors.ts` | 顶层错误分类：区分可重试错误、用户错误、内部错误 |
| session checkpoint | `src/services/sessionManager.ts` | 关键操作前写入检查点，崩溃后可从上次检查点恢复 |

---

## 代码质量评估

**优点**

- **分层错误处理**：`ErrorBoundary` 区分可重试/用户/内部错误，重试策略按错误类型差异化，不会对非可重试错误浪费重试次数。
- **context 压缩内置于主循环**：context window 监控和压缩触发无需外部协调，自动在 token 使用达到阈值时介入。
- **AbortController 统一取消**：取消信号通过 AbortController 统一传播，无需手动检查取消状态，减少遗漏处理的概率。

**风险与改进点**

- **压缩 LLM 调用无熔断器**：压缩调用失败时（如 API 过载）无回退策略，可能在高压情况下级联失败。
- **重试窗口无全局协调**：多个 session 并发重试 429 时，各 session 的退避时钟独立，无法基于共享 rate limit 信息协调重试时机。
- **Ctrl-C 中断无状态保存**：用户中断时正在执行的工具调用结果丢失，下次恢复后可能重复执行某些操作。

## 横向对齐补强：Claude 韧性主要靠 retry、compact 和 fallback

Claude Code 的韧性来自 provider retry、streaming fallback、context overflow 修正、compact 和 stop hook。

| 机制 | 横向对比 |
| --- | --- |
| retry/fallback | 对应 Codex client retry、OpenCode provider retry |
| context overflow | 对应四项目 compaction |
| stop hook | Claude 特有的人类/插件干预路径 |
| tool failure isolation | 对应 Codex/Gemini/OpenCode 工具结果归一 |

## 恢复边界补强

| 错误/中断类型 | 自动恢复能力 | 需要用户动作 | 源码锚点 |
| --- | --- | --- | --- |
| prompt too long / context overflow | 可走 reactive compact；失败时提前返回，避免 stop hook 死循环 | compact 仍失败时需要用户缩短上下文或重提任务 | `sources/claude-code/src/query.ts:1172` |
| max output tokens | 可注入 continuation meta message，最多有限次数继续 | 多次到达上限后需要用户拆分任务 | `sources/claude-code/src/query.ts:1194` |
| stop hook 阻止 | 可把 hook continuation 注入下一轮 | hook 持续阻止时需要用户修正 hook 或请求 | `sources/claude-code/src/query.ts:1281`, `sources/claude-code/src/query.ts:1305` |
| API auth/rate/error | 不进入 stop hook 评估，避免错误- hook -重试循环 | 需要用户修复认证、网络或 provider 配额 | `sources/claude-code/src/query.ts:1262` |
| tool execution 中断 | query 可清理/回收工具上下文，但本地副作用不一定可回滚 | 需要用户确认文件状态或重新执行 | `sources/claude-code/src/query.ts:1489` |

因此，本章的结论应区分“模型请求可继续”和“本地动作可回滚”。Claude Code 韧性强在请求/上下文恢复，不等于所有工具副作用都有事务回滚。

## 源码锚点补强：Claude 韧性分散在 API、query 和 streaming tool

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/claude-code/src/services/api/claude.ts:844` | API 客户端错误和重试相关路径 | 对应 Codex/Gemini provider client |
| `sources/claude-code/src/services/api/claude.ts:1779` | provider 请求异常处理 | 用于判断哪些错误可自动恢复 |
| `sources/claude-code/src/services/api/claude.ts:2604` | 长请求链路中的 fallback/错误分支 | 对应 OpenCode `LLM.stream()` 兼容层 |
| `sources/claude-code/src/query.ts:1123` | query 层恢复和控制流分支 | 说明韧性不只在 API 层 |
| `sources/claude-code/src/query.ts:1220` | context / stream 异常处理点 | 对应四项目 compaction / overflow |
| `sources/claude-code/src/query.ts:1249` | query 继续或退出的边界 | 便于标注“需用户重新提交”的场景 |
| `sources/claude-code/src/services/tools/StreamingToolExecutor.ts:294` | streaming tool 执行错误处理 | 对应 OpenCode processor 的 tool part 收敛 |
| `sources/claude-code/src/services/tools/StreamingToolExecutor.ts:362` | 工具流收尾和异常兜底 | 说明工具失败隔离属于韧性面 |

---
layout: content
title: "OpenCode 深度专题 B04：韧性机制，重试、溢出自愈、回滚清理与交互式阻塞"
---
# OpenCode 深度专题 B04：韧性机制，重试、溢出自愈、回滚清理与交互式阻塞

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

在 `v1.4.14` 中，OpenCode 的“韧性”不是单指重试。它至少包括四类机制：错误分类与重试、上下文溢出后的自愈、revert/unrevert 回滚、以及 permission/question/cancel 这些把执行挂起或终止的交互式阻塞。

---

**目录**

- [1. 错误先被归一成 `MessageV2` 错误类型](#1-错误先被归一成-messagev2-错误类型)
- [2. 重试不是盲目指数退避，而是看错误头和 provider 语义](#2-重试不是盲目指数退避而是看错误头和-provider-语义)
- [3. 上下文溢出后的第一反应不是终止，而是转 compaction](#3-上下文溢出后的第一反应不是终止而是转-compaction)
- [4. Compaction 自愈还有 replay 逻辑](#4-compaction-自愈还有-replay-逻辑)
- [5. Revert 不是 UI 层删除，而是文件快照 + history 清理双轨并行](#5-revert-不是-ui-层删除而是文件快照-history-清理双轨并行)
- [6. Permission/Question 是把执行挂起到用户交互上的机制](#6-permissionquestion-是把执行挂起到用户交互上的机制)
- [7. cancel / busy / doom_loop 也属于韧性的一部分](#7-cancel-busy-doom_loop-也属于韧性的一部分)
- [8. 把 B04 压成一句代码级结论](#8-把-b04-压成一句代码级结论)

---

## 1. 错误先被归一成 `MessageV2` 错误类型

`packages/opencode/src/session/message-v2.ts:900-987` 的 `fromError()` 会把底层异常映射成 runtime 能处理的错误对象：

1. `AbortedError`
2. `AuthError`
3. `APIError`
4. `ContextOverflowError`
5. `StructuredOutputError`
6. `NamedError.Unknown`

这一步的价值在于：

1. provider、网络、系统调用错误先被规约进统一语义
2. `processor` 后续只需要按错误类别做策略分支

因此 OpenCode 的重试和自愈不是靠字符串匹配 everywhere，而是先靠错误模型归一化。

---

## 2. 重试不是盲目指数退避，而是看错误头和 provider 语义

`packages/opencode/src/session/retry.ts:28-100` 里有两套核心逻辑。

### 2.1 `delay(attempt, error)`

优先级是：

1. `retry-after-ms`
2. `retry-after`
3. HTTP 日期格式的 `retry-after`
4. 否则退回指数退避

所以 `v1.4.14` 不是固定 `2s -> 4s -> 8s`，而是尊重 provider 头信息。

### 2.2 `retryable(error)`

它会：

1. 明确排除 `ContextOverflowError`
2. 只对 `APIError.isRetryable === true` 的错误重试
3. 特判 `FreeUsageLimitError`、`Overloaded`、`too_many_requests`、`rate_limit`

`SessionProcessor.process()` 里命中可重试错误时，会把 session 状态切到 `retry`，并通过 `SessionStatus` 广播剩余等待时间。

---

## 3. 上下文溢出后的第一反应不是终止，而是转 compaction

在 `v1.4.14` 中，overflow 有两条触发路径。

### 3.1 软溢出：正常 finish 之后判断 token 接近上限

`SessionCompaction.isOverflow()` 根据：

1. model 上下文上限
2. reserved token 配置
3. 本轮 usage

判断是否需要压缩。若需要，`loop()` 会插入一条 `compaction` task，而不是直接报错。

### 3.2 硬溢出：provider 直接返回 context overflow

`SessionProcessor.process()` catch 到 `ContextOverflowError` 时，会：

1. `needsCompaction = true`
2. 先通过 `Bus.publish(Session.Event.Error, ...)` 广播错误
3. 最终返回 `"compact"`

随后 `loop()` 仍会创建 compaction 任务并继续自愈。

也就是说，OpenCode 当前把 overflow 视为“需要切换编排分支”，而不是“整个 session 终止”。

---

## 4. Compaction 自愈还有 replay 逻辑

`SessionCompaction.process()` 在 `112-130` 会尝试找到 overflow 之前最近一条未 compaction 的 user message 作为 `replay`。

成功后，压缩完成时会：

1. 重新写一条 user message，复制原 `agent/model/format/tools/system/variant`
2. 把旧 replay parts 复制回来
3. 对 media 附件则降级成文本提示

如果找不到可 replay 的历史，则写一条 synthetic continue message，提示模型继续或解释附件过大。

因此 overflow 自愈不是“总结一下就完”，而是尽量把任务重新带回主线。

---

## 5. Revert 不是 UI 层删除，而是文件快照 + history 清理双轨并行

`packages/opencode/src/session/revert.ts` 里的 `revert()` / `cleanup()` / `unrevert()` 组成了另一套韧性机制。

### 5.1 `revert()`

`24-80` 会：

1. 找到目标 message 或 part
2. 从目标之后收集所有 `patch` part
3. 用 `Snapshot.revert(patches)` 回滚文件系统
4. 记录 `session.revert = { messageID, partID?, snapshot, diff }`
5. 计算并写入 `session_diff`

注意：`revert()` 本身不会立即删除 message/part 历史，只是把 session 标记成“待清理回滚态”。

### 5.2 `cleanup()`

真正删除历史发生在下一次 `prompt()` 前，见 `revert.ts:91-137`：

1. 若回滚的是整条 message，就删掉该 message 及其后的所有消息
2. 若回滚的是 part，就只删目标 part 及之后的 parts
3. 删除完成后清空 `session.revert`

这解释了为什么 A03 一开始必须先 `SessionRevert.cleanup(session)`。

### 5.3 `unrevert()`

如果用户取消回滚，则 `82-89` 会用 `Snapshot.restore(snapshot)` 恢复文件现场，再清掉 `session.revert`。

所以 revert 机制不是“软隐藏消息”，而是真正把 durable history 与文件系统状态同时拉回去。

---

## 6. Permission/Question 是把执行挂起到用户交互上的机制

### 6.1 Permission

`packages/opencode/src/permission/index.ts:166-267` 当前逻辑是：

1. 先用 ruleset 求 `allow/deny/ask`
2. `deny` 直接抛 `PermissionDeniedError`
3. `ask` 就创建 pending request，发布 `permission.asked`
4. 等待 UI/CLI 通过 `/permission/:requestID/reply` 回答

`reply === "always"` 还会把批准规则写进 `PermissionTable`，对同项目后续请求生效。

### 6.2 Question

`packages/opencode/src/question/index.ts:131-220` 会：

1. 创建 pending question request
2. 发布 `question.asked`
3. 阻塞等待回答
4. 回答后生成“用户已回答你的问题”形式的工具输出

当前 `question` 工具和 `plan_exit` 都用这套机制。

### 6.3 被拒绝时 loop 是否停止，取决于配置

`SessionProcessor.process()` 里 `shouldBreak = experimental?.continue_loop_on_deny !== true`。默认情况下 permission/question 被拒绝会让本轮 stop；只有显式打开实验开关才允许继续 loop。

---

## 7. cancel / busy / doom_loop 也属于韧性的一部分

### 7.1 busy

`SessionPrompt.assertNotBusy(sessionID)` 会在新操作撞上正在运行的 session 时抛 `Session.BusyError`，避免同一 session 重入。

### 7.2 cancel

`SessionPrompt.cancel()` 会：

1. abort 当前 controller
2. 删除 session 占位
3. 把状态切回 `idle`

shell、loop、task tool 都会监听这个 abort signal。

### 7.3 doom loop

连续三次同工具同输入时，processor 会触发 `Permission.ask({ permission: "doom_loop" })`。这相当于 runtime 主动怀疑自己陷入死循环，并把是否继续执行交给用户。

---

## 8. 把 B04 压成一句代码级结论

`v1.4.14` 的韧性不是某个 retry helper，而是一整套“把失败变成可调度状态”的机制：

1. 错误先归一化
2. 可重试的进入 retry 状态
3. overflow 切到 compaction 分支
4. revert 把文件和历史一起回滚
5. permission/question/busy/cancel 让执行进入可交互挂起

所以 OpenCode 的 resilience 不是简单兜底，而是把异常路径也纳入同一条 durable orchestration 主线。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `MessageV2` error 类型 | `session/message-v2.ts` | 统一错误表示：provider 错误归一化为 durable error part |
| retry 逻辑 | `session/processor.ts catch` 分支 | 按 error header 判断是速率限制还是 fatal，决定是否重试 |
| `compactMessages()` | `session/compact.ts` | 上下文溢出自愈：将超限历史 compaction 后继续 |
| `Session.revert()` | `session/index.ts` | 文件快照 + history 清理双轨并行的 revert 实现 |
| `Permission` / `Question` | `session/index.ts` | 将执行挂起到用户交互（工具审批/输入等待）的机制 |
| doom_loop check | `session/prompt.ts:loop()` | 检测 cancel/doom_loop 标志，安全退出 session 循环 |

---

## 代码质量评估

**优点**

- **错误先归一后自愈**：provider 错误先被翻译为 `MessageV2` error type，再统一进入 retry/compact/fatal 三分支，无特例处理路径。
- **Revert 双轨并行保证一致性**：文件快照恢复和 durable history 清理同时进行，避免"文件恢复了但历史还在"或反过来的不一致状态。
- **Permission/Question 挂起而非阻塞**：工具审批和用户输入等待通过 durable 挂起标志实现，进程可以继续处理其他 session，不是同步 blocking。

**风险与改进点**

- **重试策略依赖 provider 错误 header**：若 provider 返回非标准错误格式（如无 `Retry-After` header），重试策略退化为固定退避，可能与实际速率限制不匹配。
- **Compaction 自愈是重量级操作**：触发 compact 时需要调用 LLM 生成 summary，在高负载时可能进一步加剧 API 速率限制问题。
- **doom_loop 检测阈值不可配置**：连续错误次数超过固定阈值才标记 doom_loop，不同场景下的阈值可能需要不同设置，当前硬编码无法调整。

## 横向对齐补强：OpenCode 韧性来自 durable retry + loop 分支

OpenCode 的韧性机制要和 `SessionPrompt.loop()`、`SessionProcessor.process()`、provider wrapper 和 compaction 一起读。

| 机制 | OpenCode 侧含义 | 横向对比 |
| --- | --- | --- |
| provider retry | wrapper/AI SDK 层处理 | 对应 Codex client retry |
| overflow/compact | loop 分支触发 | 四项目共享 |
| doom loop | processor 检测异常循环 | Gemini 也有 loop detection |
| durable history | 崩溃后可重新推导 | OpenCode 强项 |

## 错误持久化边界

| 错误类型 | 是否写 durable part | 是否发 Bus/Error 事件 | 恢复语义 |
| --- | --- | --- | --- |
| 模型产生的 tool error / provider error | 通常写入 message/part 或错误 part | 是 | 恢复后模型/用户能看到失败事实 |
| 工具执行失败 | 写入 tool result / error part | 是 | 后续 turn 可基于失败结果继续规划 |
| Permission pending / rejected | pending/decision 可写入对应 part 或状态 | 是 | 已决策结果可恢复，等待中的 waiter 不恢复 |
| SSE 客户端断开 | 不写 durable part | 连接层事件 | 前端重新 bootstrap durable state |
| Bus subscriber 处理失败 | 不应污染 durable history | 内部错误/日志 | durable truth 不依赖单个订阅者 |
| Process crash | 只保留已提交事务 | 进程级错误 | 恢复时从 SQLite 已写入事实重新推导 |

这说明 OpenCode 的韧性不是“所有错误都持久化”，而是把影响会话语义的错误写入 durable history，把传输层、订阅层和运行时等待点留在事件/日志层。

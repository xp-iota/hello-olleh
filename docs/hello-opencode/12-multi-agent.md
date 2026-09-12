---
layout: content
title: "OpenCode 深度专题 B03：高级编排，Subagent、Command、Compaction 怎样落回同一条主线"
---
# OpenCode 深度专题 B03：高级编排，Subagent、Command、Compaction 怎样落回同一条主线

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

在 `v1.4.14` 中，OpenCode 并没有引入独立的 workflow engine，但它也绝不只是“模型自己决定下一步用哪个工具”。高级编排主要靠三套机制完成：`task` 子任务、`command` 模板、`compaction` 压缩恢复。它们的共同点是都回写到同一条 session/message/part 历史里。

---

**目录**

- [1. 编排层的真正核心还是 `loop()`](#1-编排层的真正核心还是-loop)
- [2. Subagent 的本体不是线程，而是 child session](#2-subagent-的本体不是线程而是-child-session)
- [3. 父 session 如何感知 subagent 结果](#3-父-session-如何感知-subagent-结果)
- [4. `command` 是编排语法糖，不是另一条执行通道](#4-command-是编排语法糖不是另一条执行通道)
- [5. Compaction 也是显式编排任务，而不是偷偷裁历史](#5-compaction-也是显式编排任务而不是偷偷裁历史)
- [6. 隐藏 agent 是 orchestration 的内部角色](#6-隐藏-agent-是-orchestration-的内部角色)
- [7. 为什么这些能力都能共存而不把状态机搞炸](#7-为什么这些能力都能共存而不把状态机搞炸)

---

## 1. 编排层的真正核心还是 `loop()`

先明确一点：高级编排没有绕开 `SessionPrompt.loop()`。

当前三类编排能力最终都表现为：

1. 向 session history 写入特定的 user part
2. 下一轮 `loop()` 扫到这些 part
3. 进入相应分支继续执行

因此 OpenCode 的 orchestration 不是“另起一套任务图”，而是“让 loop 消费更丰富的 durable state”。

---

## 2. Subagent 的本体不是线程，而是 child session

`task` 工具的实现位于 `packages/opencode/src/tool/task.ts:28-167`。

### 2.1 先过滤可访问 subagent

`29-43` 会：

1. 列出所有 `mode !== "primary"` 的 agents
2. 若当前 caller agent 存在，则用 `Permission.evaluate("task", ...)` 过滤掉被 deny 的 subagent

也就是说，subagent 选择本身受 agent permission 约束。

### 2.2 真正执行前会新建 child session

`68-104` 的关键逻辑是：

1. 若传了 `task_id` 且对应 session 存在，则恢复旧 child session
2. 否则 `Session.create({ parentID: ctx.sessionID, ... })`

并且新 session 会自带一组受限 permission：

1. 默认禁掉 todo 读写
2. 若 subagent 本身不允许 task，则再禁掉 task
3. 可额外允许 `experimental.primary_tools`

因此 subagent 的并发单位是 session，不是 Promise 或线程。

### 2.3 child session 最终还是走 `SessionPrompt.prompt()`

`128-145` 会把 subtask prompt 先过 `resolvePromptParts()`，再调用：

```ts
SessionPrompt.prompt({
  sessionID: session.id,
  model,
  agent: agent.name,
  parts: promptParts,
  tools: { ... }
})
```

所以 subagent 没有自己的执行器，它只是复用同一个 runtime，换了一份 session、agent 和 permission 边界。

---

## 3. 父 session 如何感知 subagent 结果

`TaskTool.execute()` 不会把 child session 全量历史复制回父 session，而是返回一段工具结果：

1. `task_id: ...`
2. `<task_result> ... </task_result>`

父 session 侧的 `loop()` 再把这次执行记录成：

1. 一条 assistant message
2. 一个 `tool: "task"` part

也就是说，父 session 感知的是“调用 subagent 这个工具的结果”，不是把 child session 历史直接内联回来。

这也是为什么 `Session.children(parentID)` 可以单独列子会话，见 `session/index.ts:652-662`。

---

## 4. `command` 是编排语法糖，不是另一条执行通道

`packages/opencode/src/session/prompt.ts:1823-1973` 的 `command()` 经常被当成独立执行器，其实它本质上只是：

1. 读取命令模板
2. 展开参数和 shell 占位符
3. 选择是“直接 prompt”还是“转成 subtask”
4. 最后仍然调用 `prompt()`

### 4.1 模板编译能力

`1790-1879` 支持：

1. `$1`、`$2` 这类位置占位符
2. `$ARGUMENTS`
3. `!` 反引号包裹的 shell 执行替换

### 4.2 决定是否转 subtask

`1920-1945` 的规则是：

1. 如果目标 agent 是 `subagent` 且 `command.subtask !== false`，默认转 subtask
2. 或 `command.subtask === true` 时强制转 subtask
3. 否则把模板展开后的 parts 当普通 prompt 输入

这说明 command 不是独立编排系统，而是一个把“文本模板”编译成 `PromptInput` / `SubtaskPart` 的桥接层。

---

## 5. Compaction 也是显式编排任务，而不是偷偷裁历史

`SessionCompaction` 位于 `packages/opencode/src/session/compaction.ts`。

### 5.1 创建 compaction 任务

`create()` 在 `299-329` 里会插入：

1. 一条 user message
2. 一个 `compaction` part

这一步不直接生成 summary，只是把“需要压缩”编码进 durable history。

### 5.2 处理 compaction 任务

真正执行在 `process()`，`102-297`：

1. 找出当前 user message
2. 必要时构造 replay message
3. 启动隐藏的 `compaction` agent
4. 通过 `SessionProcessor.process()` 生成一条 `summary` assistant message
5. 若 `auto === true`，再决定是 replay 原请求还是补一条 synthetic continue message

因此 compaction 不是“后台清理上下文缓存”，而是一段完整的 session 编排流程。

### 5.3 `prune()` 是另一条更轻的编排线

`54-100` 的 `prune()` 会在会话结束后回头标记旧 `tool` part 的 `state.time.compacted`，只清空老旧 tool output，不动 message 结构。

这又进一步说明 OpenCode 的“压缩”其实分两层：

1. **summary compaction**：插入摘要轮次
2. **tool output prune**：标记旧工具输出已压缩

---

## 6. 隐藏 agent 是 orchestration 的内部角色

当前有三个典型的隐藏 agent：

1. `compaction`
2. `title`
3. `summary`

它们的特点是：

1. `hidden: true`
2. 权限通常全部 deny
3. 只服务 runtime 内部步骤

这说明 OpenCode 的编排层并不依赖“额外脚本服务”，而是用同一个 agent/runtime 体系承载内部 side job。

---

## 7. 为什么这些能力都能共存而不把状态机搞炸

答案不在于它们简单，而在于它们都遵守了同一条约束：

1. 不新建第二套状态存储
2. 不新建第二套事件总线
3. 不绕开 `prompt -> loop -> processor`
4. 不绕开 `MessageV2` / `Part`

Subagent、command、compaction 看起来是高级能力，但在实现上都被压成了：

1. 特定 part
2. 特定 session 关系
3. 特定 loop 分支

这就是 OpenCode 当前编排层的核心风格：**扩展能力很多，但骨架只有一条。**

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `loop()` | `session/prompt.ts` | session 编排核心：while 循环处理 subtask/compaction/overflow/推理分支 |
| `Session.create(parentId)` | `session/index.ts` | 创建 child session（subagent 本体），关联父 session |
| `task` tool | `tool/task.ts` | 触发子代理执行的工具，loop 感知 subtask part 后调用 |
| `compactMessages()` | `session/compact.ts` | 显式编排的 compaction 任务——作为 orchestration 步骤而非隐式裁剪 |
| `hiddenAgent` | `session/prompt.ts` | 内部隐藏代理角色，用于 orchestration 内部步骤（如 summarization） |
| `Bus.publish(SessionStatus.*)` | — | 子 session 状态变化通知父 session |

---

## 代码质量评估

**优点**

- **`loop()` 骨架扩展性强**：subtask/compaction/overflow/推理四条分支共享同一个 while 循环和 durable history，新增分支只需增加 durable 类型，不需要新的执行骨架。
- **Subagent 是 child session**：子代理是完整的独立 session 对象，拥有独立的 durable history 和 `SessionStatus`，父代理不需要管理子代理内部状态。
- **Compaction 显式化**：compaction 不是偷偷裁历史，而是作为显式编排任务被 `loop()` 感知和调度，可追踪、可记录、可重放。

**风险与改进点**

- **`loop()` 函数体庞大（500+ 行）**：四条主分支和所有边界处理集中在单函数中，嵌套层级深，修改某条分支时容易引入边界效应。
- **父 session 感知子 session 结果依赖 Bus 事件**：若 Bus 事件因进程异常丢失，父 session 可能永远等待不到子 session 完成通知，无超时机制。
- **`hiddenAgent` 语义不透明**：内部隐藏角色的触发条件和行为未在公开文档中说明，外部 plugin 难以预测其与 `loop()` 的交互。

## 横向对齐补强：OpenCode 多代理通过 task tool 回到 session loop

OpenCode 的多代理不应理解为独立调度器，而是 `task` 工具创建/驱动子 session，最终仍回到 durable session loop。

| 维度 | OpenCode 侧含义 | 横向对比 |
| --- | --- | --- |
| 子任务入口 | `tool/task.ts` | 对应 Claude AgentTool、Codex multi-agent handlers |
| 权限 | task permission / agent permission | OpenCode 权限粒度更持久 |
| 状态 | 子 session / Bus event | 比 Gemini A2A 更 durable |
| 回传 | message/part 写回 | 与主 loop 同构 |

## 父子 Session 状态边界

| 状态面 | 父 session | 子 session | 共享/隔离判断 |
| --- | --- | --- | --- |
| 创建关系 | `TaskTool` 调用时持有 `ctx.sessionID` | `Session.create()` 写入 `parentID`，形成 child session | 只共享父子指针，不共享消息历史 |
| Prompt 输入 | 父消息中出现 task tool part | 子 session 通过 `Session.prompt()` 接收独立 prompt、agent、permission | prompt 内容由父侧传入，但后续上下文独立增长 |
| Durable history | 父 session 记录 tool invocation / result part | 子 session 记录自己的 message / part / status | 持久化隔离，便于单独恢复和删除 |
| 权限状态 | 父 loop 只等待 task tool 完成 | 子 loop 内部继续走 Permission.ask / updatePart | 权限链路同构，但决策发生在子 session 内 |
| 完成通知 | 通过 Bus 观察 child session 状态 | 子 session 发布 `SessionStatus` 变化 | 事件共享，执行状态不共享 |

源码上，`sources/opencode/packages/opencode/src/tool/task.ts:74` 创建带 `parentID` 的 session，`sources/opencode/packages/opencode/src/tool/task.ts:132`、`sources/opencode/packages/opencode/src/tool/task.ts:137`、`sources/opencode/packages/opencode/src/tool/task.ts:141` 把 prompt、agent 与权限传入子任务；父子关系和 child 查询在 `sources/opencode/packages/opencode/src/session/session.ts:395`、`sources/opencode/packages/opencode/src/session/session.ts:438`、`sources/opencode/packages/opencode/src/session/session.ts:517`、`sources/opencode/packages/opencode/src/session/session.ts:550`。因此 OpenCode 的多代理状态边界比“共享工作线程”更清晰：共享的是 session graph 和事件，总结/权限/消息历史都留在各自 session。

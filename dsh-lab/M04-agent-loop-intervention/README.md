# M04 · Agent 循环干预

一个 turn 内部有它自己的节奏：`turn/start` → 若干 `step`（模型请求 → 工具调用 → 结果回灌）→ `turn/end`。这一章看的是**如何在不重写循环的前提下影响它**。

核心结论先说：**不要自己写 agent 循环**。`dsh-lab chat` 就是这一章最好的示例——它只往 inbox 里塞消息，推进完全由 `dsh-agent-loop` 负责。

## 学习目标

- 分清 `followup` / `steer` / `inject` 三条 inbox 通道的语义；
- 知道 `agent/turn-stopping` 是"turn 即将结束、还能续一步"的时机；
- 理解取消失败与取消成功的边界（协作式取消）；
- 会读 `agent/status`、`agent/assistant-stream` 这些现场事件。

## 运行

```bash
npm run M04
```

M04.1、M04.2 是 `model` 阶段：没有 `LLM_API_KEY` 时它们退化成"只验证事件订阅在位"，并明确打印原因。M04.3～M04.5 纯机制，不需要 key。

## 代码地图

```text
M04-agent-loop-intervention/index.ts
├─ M04.1 observeTurnEvents       # session/event 观察 turn/step 边界
├─ M04.2 steerAtBoundary         # agent/turn-stopping 时 steer，让 turn 续一步
├─ M04.3 compareInboxChannels    # send(msg, channel, wakeup) 与 status 的关系
├─ M04.4 cancelInFlight          # cancel(cause, {keepInbox})
└─ M04.5 observeLiveEvents       # agent/status 订阅
```

## 三条 inbox 通道

| 通道 | 何时被消费 | 语义 | 典型用途 |
|---|---|---|---|
| `next-turn` | 当前 turn 结束后 | "下一轮再处理" | 排队消息、`followup()` |
| `next-step` | 当前 step 结束后 | "这个 turn 里还要用" | `steer()` 续跑 |
| `inject` | 立即作为上下文 | 不产生新的对话轮次 | 注入系统提示、工具结果补丁 |

`agent.send(msg, channel, wakeup)` 的第三个参数控制"要不要唤醒 driver"。M04.3 特意用 `wakeup: false` 验证：消息进了队列，但 agent 仍是 `idle`。这个区分很重要——它让"排队的待办"和"正在跑的活"成为两件独立的事。

### followup vs steer

- `followup(msg)` = 往 `next-turn` 加一条并唤醒。人说话就是这条路径。
- `steer(msg)` = 往 `next-step` 加一条。适合"我改主意了，这个 turn 里就别继续那个方向了"。

M04.2 在 `agent/turn-stopping` 里 steer：这是"turn 本来要结束，但我想让它再走一步"的标准做法。注意它**不是** `turn/end` 之后——那时候已经晚了。

## 取消

`agent.cancel(cause, options)` 的 `cause` 是结构化的：

```ts
{ kind: 'user' } | { kind: 'parent' } | { kind: 'hook'; reason: string } | { kind: 'disposed' }
```

记录 cause 而不是一个布尔值，是为了让重放时能区分"用户主动停"和"父级销毁连带停"——这两种情况在审计里含义完全不同。

`{ keepInbox: true }` 保留排队工作：取消当前 turn，但不要把排好的下一条也丢掉。适合"这一轮跑歪了，重来但别丢我刚才排的事"。

取消是**协作式**的：`execute(args, exec)` 要观察 `exec.signal`，否则进程内的代码无法被硬杀。M01 的 `word_count` 里有 `if (exec.signal.aborted) throw ...` 就是这个约定。

## 现场事件

| 事件 | 载荷要点 |
|---|---|
| `agent/created` / `agent/disposed` | 生命周期 |
| `agent/status` | `idle` / `running` / … |
| `agent/assistant-stream` | `start` / `chunk` / `end` 帧，用于实时渲染 |
| `agent/error` | 未捕获错误 |
| `agent/turn-stopping` | turn 即将结束（可 steer） |

`agent/assistant-stream` 是 `dsh-lab chat` 的实时输出源。它不轮询，也不解析日志——直接订阅帧。

## 排错

| 现象 | 原因 |
|---|---|
| `steer` 没效果 | 在 `turn/end` 之后才调；要在 `agent/turn-stopping` 里 |
| 消息进了 inbox 但 agent 不动 | `wakeup: false` |
| `cancel` 后工具还在跑 | 工具没观察 `exec.signal`（协作式取消） |
| `snapshotEvents()` 报弃用 | 0.2.1 禁止新调用；改用 `ctx.sessionQuery` |

## 练习

1. 把 M04.3 的 `wakeup` 改成 `true`，看 `agent.status` 怎么变。
2. 在 `dsh-lab chat` 里发一条消息，然后立刻 Ctrl-C——观察 `turn/end` 的 `reason`。
3. 给 `steerAtBoundary` 加一个计数上限，验证"最多续 3 步"这类预算。

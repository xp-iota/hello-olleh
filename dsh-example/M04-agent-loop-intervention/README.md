# M04 · Agent 循环与干预面

AgentLoop 的外部控制面由三类稳定边界组成：事件用于观察，生命周期 hook 用于选择时机，inbox 用于注入有来源的输入。

## 学习目标

在不复制主循环的前提下，实现可观测、可解释、可回收的运行时干预。

## 运行

```bash
npm run M04
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察什么 |
|---|---|---|---|
| 1 生命周期遥测 | 教学主线 | `steps/01-agent-events-telemetry.ts` | turn、step、请求、流、消息的事件次序 |
| 2 Steering | 教学主线 | `steps/02-lifecycle-steering.ts` | session-start / pre-step / request / turn-stopping |
| 3 Inbox | 教学主线 | `steps/03-agent-inbox.ts` | send、followup、steer、inject 的 next-turn / next-step 边界 |
| 4 会话遥测 | 扩展面 | `steps/04-session-telemetry.ts` | 内存 backend 捕获逐事件 ledger，不发送网络 |
| 5 运行时不变量 | 扩展面 | `steps/05-invariants.ts` | 失败如何归属到明确 packageName |

## 完整链路

遥测插件只监听事件；steering 在轮末请求继续一步；inbox 保留消息来源并在 step 边界被认领。主循环仍负责状态推进和事件落盘。

## 边界

插件可以提出下一步意图，但不能绕过 AgentLoop 直接改写进行中的内部状态。

**结论：**循环扩展应落在事件与消息边界，主循环保持单一事实来源。

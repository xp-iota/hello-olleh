# M04 · Agent 循环与干预面

AgentLoop 的外部控制面由三类稳定边界组成：事件用于观察，生命周期 hook 用于选择时机，inbox 用于注入有来源的输入。

## 学习目标

在不复制主循环的前提下，实现可观测、可解释、可回收的运行时干预。

## 运行

```bash
npm run M04   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 1 生命周期遥测 | 教学主线 | `impl/01-agent-events-telemetry.ts` | `scenes/01-observe-turn-events.ts` | turn、step、请求、流、消息的事件次序 |
| 2 Steering | 教学主线 | `impl/02-lifecycle-steering.ts` | `scenes/02-steer-at-boundary.ts` | session-start / pre-step / request / turn-stopping |
| 3 Inbox | 教学主线 | `impl/03-agent-inbox.ts` | `scenes/03-compare-inbox-channels.ts` | send、followup、steer、inject 的 next-turn / next-step 边界 |
| 4 会话遥测 | 扩展面 | `impl/04-session-telemetry.ts` | `scenes/04-capture-telemetry-ledger.ts` | 内存 backend 捕获逐事件 ledger，不发送网络 |
| 5 运行时不变量 | 扩展面 | `impl/05-invariants.ts` | `scenes/05-attribute-invariant-failure.ts` | 失败如何归属到明确 packageName |

## 完整链路

遥测插件只监听事件；steering 在轮末请求继续一步；inbox 保留消息来源并在 step 边界被认领。主循环仍负责状态推进和事件落盘。

## 边界

插件可以提出下一步意图，但不能绕过 AgentLoop 直接改写进行中的内部状态。

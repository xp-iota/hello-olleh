# M04 · Agent 循环与干预面

原 06、09、19 共同描述 AgentLoop 的外部控制面：**遥测事件让插件看见循环，生命周期 hook 让插件选择干预时机，inbox 让输入进入明确边界**。

## 运行

```bash
npm run M04
```

## 阶段

| 阶段 | 独立插件 | 观察点 |
|---|---|---|
| 生命周期遥测 | `steps/01-agent-events-telemetry.ts` | turn/start、step、请求、流、消息与 turn/end 的次序 |
| Steering | `steps/02-lifecycle-steering.ts` | session-start / pre-step / request / turn-stopping 与 `agent.steer()` |
| Inbox | `steps/03-agent-inbox.ts` | send、followup、steer、inject 如何落到 next-turn / next-step |

遥测插件只监听事件，不接管主循环；steering 在轮末请求继续一步；inbox 则保留消息来源，并在 step 边界被认领进模型请求。三者组合后，可实现可观测、可解释、可回收的干预，而不需要 fork AgentLoop。

**结论：**对循环的扩展应落在事件和消息边界，主循环保持单一事实来源。


## A4 · 可观测性与运行时契约

- `sessionTelemetry`：内存 backend 捕获逐事件 ledger，不发送网络。
- `invariants`：包自行注册不变量，失败归属到明确 packageName。

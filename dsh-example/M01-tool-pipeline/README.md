# M01 · 工具管线

工具不是孤立函数，而是从**注册与发现**、**按 Agent 披露**、**执行前裁决**到**执行后变换与审计**的完整管线。

## 学习目标

区分“模型能看见”“模型能调用”“调用结果怎样呈现”三个控制面，并理解它们为何不应写死在工具实现中。

## 运行

```bash
npm run M01          # 离线，依次执行五个阶段
npm run M01:real     # 真实 MiniMax；需要 MINIMAX_API_KEY，会发起网络请求
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察什么 |
|---|---|---|---|
| 1 注册 | 教学主线 | `steps/01-word-count.ts` | `defineTool`、结构化 value、模型可见 content、Fiber dispose 反注册 |
| 2 权限门 | 教学主线 | `steps/02-permission-gate.ts` | `tools/pre-execute` 的 allow/deny/ask 与 fail-closed |
| 3 结果变换 | 教学主线 | `steps/03-result-transform.ts` | post-execute 改模型可见结果但不破坏 canonical value |
| 4 可见性 | 教学主线 | `steps/04-tool-restrict.ts` | `agent.ctx.tools.restrict` 的单向收紧和 effect 归属 |
| 5 守卫 | 教学主线 | `steps/05-tool-guard.ts` | guard 在 pre-execute 之后做不可翻案的最终拒绝 |

## 完整链路

1. 注册表建立工具 schema 与执行函数，并把注册绑定到插件 Fiber。
2. Agent Context 通过 restrict 缩小可见集合，不改变全局工具定义。
3. 模型发起调用后，pre-execute 权限门先给出策略决策。
4. 单调 guard 负责不可被后续 allow 覆盖的安全底线。
5. 执行结果保留规范值，同时可改写模型可见 content 并发送审计事件。

## 边界

`index.ts` 只做命名空间聚合；`run.ts` 只做教学编排；所有阶段复用 `runtime/harness.ts`，不复制运行时。

**结论：**工具能力由多个正交控制面组合，扩展它们不需要修改 AgentLoop。

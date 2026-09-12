# M01 · 工具管线

工具不是一个孤立函数，而是一条从**注册与发现**、**按 Agent 披露**、**执行前裁决**到**执行后变换与审计**的完整管线。本模块把原 01、03、07、11、12 五个示例收成一条连续叙事。

## 运行

```bash
npm run M01          # 离线，依次执行五个阶段
npm run M01:real     # 真实 MiniMax；需要 MINIMAX_API_KEY，会发起网络请求
```

## 阶段与观察点

| 阶段 | 独立插件 | 观察什么 |
|---|---|---|
| 1 注册 | `steps/01-word-count.ts` | `defineTool`、结构化 value、模型可见 content、Fiber dispose 反注册 |
| 2 权限门 | `steps/02-permission-gate.ts` | `tools/pre-execute` 的 allow/deny/ask 与 fail-closed |
| 3 结果变换 | `steps/03-result-transform.ts` | post-execute 改模型可见结果但不破坏 canonical value |
| 4 可见性 | `steps/04-tool-restrict.ts` | `agent.ctx.tools.restrict` 的单向收紧和 effect 归属 |
| 5 守卫 | `steps/05-tool-guard.ts` | guard 在 pre-execute 之后做不可翻案的最终拒绝 |

`index.ts` 只做命名空间聚合；每个 `steps/*.ts` 仍可单独交给 `ctx.plugin()`。`run.ts` 只负责教学编排，装配始终复用 `runtime/harness.ts`。

## 完整链路

1. 注册表建立工具 schema 与执行函数，并把注册绑定到插件 Fiber。
2. Agent Context 通过 restrict 只缩小可见集合，不改变全局工具定义。
3. 模型发起调用后，pre-execute 权限门先给出策略决策。
4. 单调 guard 负责不可被后续 allow 覆盖的安全底线。
5. 执行结果保留规范值，同时可改写给模型看的 content 并发送审计事件。

**结论：**“模型能看见”“模型能调用”“调用结果怎样呈现”是三个独立控制面，不应混进工具实现本身。

# M08 · 委派与预设

本模块整合原 15，强调一个容易被误解的边界：装载 `ctx.subagents` **不会自动让模型委派**。它只是具名 Provider 注册表。

## 运行

```bash
npm run M08
```

`steps/01-subagent-delegation.ts` 同时展示两层：

1. 注册 `local-reviewer` Provider，声明 capabilities（含 `agentOptions`）并实现子任务 start/run 生命周期。
2. 注册模型可见的 `review_with_subagent` 工具，由工具 execute 显式调用 `ctx.subagents.start()`。

运行阶段先检查模型可见工具，再模拟模型调用，输出子任务结果的 canonical value 和模型可见 content。这样 Provider 的资源管理与模型的决策接口保持解耦，也可由 preset 选择暴露哪些委派方式。

**结论：**委派必须是显式、可审计的能力；Provider 是执行机制，工具/策略才是模型入口。


## A4 · 三层委派策略

- `agentPresets` 管一次 Session 的插件组合来源。
- `permissionPresets` 组合 sandbox/approval，但拒绝未实现 confinement 的 shell。
- `subagentModelSelection` 只授权精确 provider/model 路由。

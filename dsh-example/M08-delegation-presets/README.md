# M08 · 委派与预设

装载 `ctx.subagents` 不会自动让模型委派；它只提供具名 Provider，模型入口仍须显式暴露。

## 学习目标

分清 Provider、preset、permission 与 model selection 四层职责。

## 运行

```bash
npm run M08   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 1 子代理委派 | 教学主线 | `impl/01-subagent-delegation.ts` | `scenes/01-delegate-a-review.ts` | Provider 生命周期与模型可见工具如何解耦 |
| 2 Agent preset | 扩展面 | `impl/02-agent-presets.ts` | `scenes/02-empty-preset-roster.ts` | 一次 Session 的插件组合来源 |
| 3 Permission preset | 扩展面 | `impl/03-permission-presets.ts` | `scenes/03-reject-unisolated-shell.ts` | sandbox/approval 组合与未隔离 shell 的拒绝 |
| 4 模型选择 | 扩展面 | `impl/04-subagent-model-selection.ts` | `scenes/04-authorize-subagent-route.ts` | 精确 provider/model 路由授权 |

## 完整链路

注册 `local-reviewer` Provider 后，再注册模型可见的 `review_with_subagent` 工具；工具显式调用 `ctx.subagents.start()`。Preset 决定装载组合，权限决定允许的副作用，模型选择限制子任务路由。

## 边界

`start()` 返回运行句柄而不是最终结果，因此开始、结束、取消和资源回收都可独立审计。

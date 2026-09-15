# M10 · 外部能力接入

外部能力既可以是可发现的知识资产，也可以是 MCP、Webhook 或动态 Cordis 扩展等宿主协议。

## 学习目标

判断什么时候应使用数据化 Skill，什么时候需要带生命周期与故障边界的运行时能力。

## 运行

```bash
npm run M10   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 1 Skill | 教学主线 | `impl/01-skill-code-review.ts` | `scenes/01-inject-skill-into-turn.ts` | frontmatter 发现、渲染、inbox 注入与 step 认领 |
| 2 MCP | 扩展面 | `impl/02-mcp-client.ts` | `scenes/02-mcp-round-trip.ts` | 真实 stdio server 的成功往返 + 启动失败的稳定契约 |
| 3 Webhook | 扩展面 | `impl/03-webhook-runtime.ts` | `scenes/03-check-webhook-boundary.ts` | Host-plane 完整依赖边界 |
| 4 Cordis extensions | 扩展面 | `impl/04-cordis-extensions.ts` | `scenes/04-mount-dynamic-tool.ts` | dynamic runner 与 inspect registry |
| 5 默认模型 | 扩展面 | `impl/05-agent-default-model.ts` | `scenes/05-route-default-model.ts` | Webhook 创建 Agent 所需的默认模型路由 |
| M10.d 专项演示 | 模型交互 | `run.ts`（`runSkillCodeReviewMinimax`） | — | 注入 SKILL.md 前后的真实作答对照（需 `LLM_API_KEY`） |

## 完整链路

`assets/SKILL.md` 被解析和注册，渲染内容经 inbox 进入下一 step；MCP 场景两种结果都会跑出来：先拉起 `assets/mcp-word-count-server.mjs`（官方 SDK 实现的真实 stdio server）完成一次跨进程 `tools/call`，再换成不存在的可执行文件演示启动失败 fail loud。Webhook 与动态扩展由宿主管理进程、依赖和失败。所有场景都调用推理服务，需要 `LLM_API_KEY`。

## 边界

Skill 只提供流程知识，不执行副作用；Webhook 不完整时只展示依赖边界，宿主实现不在本模块范围内。

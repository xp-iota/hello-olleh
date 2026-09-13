# M10 · 外部能力接入

外部能力既可以是可发现的知识资产，也可以是 MCP、Webhook 或动态 Cordis 扩展等宿主协议。

## 学习目标

判断什么时候应使用数据化 Skill，什么时候需要带生命周期与故障边界的运行时能力。

## 运行

```bash
npm run M10          # 离线：验证注册、发现、注入与 Host 边界
npm run M10:real     # 真实 MiniMax 对照；需要 MINIMAX_API_KEY
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察什么 |
|---|---|---|---|
| 1 Skill | 教学主线 | `steps/01-skill-code-review.ts` | frontmatter 发现、渲染、inbox 注入与 step 认领 |
| 2 MCP | 扩展面 | `steps/02-mcp-client.ts` | 真实 stdio server 的成功往返 + 启动失败的稳定契约 |
| 3 Webhook | 扩展面 | `steps/03-webhook-runtime.ts` | Host-plane 完整依赖边界 |
| 4 Cordis extensions | 扩展面 | `steps/04-cordis-extensions.ts` | dynamic runner 与 inspect registry |
| 5 默认模型 | 扩展面 | `steps/05-agent-default-model.ts` | Webhook 创建 Agent 所需的 mock 路由 |
| 真实对照 | 可选真实路径 | `real/skill-code-review-minimax.ts` | 同一输入在 Skill 注入前后的行为差异 |

## 完整链路

`assets/SKILL.md` 被解析和注册，渲染内容经 inbox 进入下一 step；MCP 阶段两种结果都会跑出来：先拉起 `assets/mcp-word-count-server.mjs`（官方 SDK 实现的真实 stdio server）完成一次跨进程 `tools/call`，再换成不存在的可执行文件演示启动失败 fail loud。Webhook 与动态扩展由宿主管理进程、依赖和失败。默认路径全部离线，不需要密钥。

## 边界

Skill 只提供流程知识，不执行副作用；Webhook 不完整时只展示依赖边界，不在核心 harness 里伪造宿主。

**结论：**做法、规范和工作流优先数据化；需要执行、监听或提供服务时再升级为插件或 Host 能力。

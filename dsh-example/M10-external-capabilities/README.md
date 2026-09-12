# M10 · 外部能力接入

本模块整合原 08，展示与 Cordis 代码插件互补的扩展方式：一份 `SKILL.md` 就能提供可发现、可注入的流程知识。

## 运行

```bash
npm run M10          # 离线：验证注册、发现、注入与 step 认领
npm run M10:real     # 真实 MiniMax A/B 对照；需要 MINIMAX_API_KEY
```

## 文件职责

- `assets/SKILL.md`：带 frontmatter 的代码审查知识资产，不包含可执行代码。
- `steps/01-skill-code-review.ts`：解析资产，调用 `ctx.skills` 注册，并把渲染内容注入 inbox。
- `phases/01-skill-code-review.ts`：离线确认正文进入模型可见投影且在 step 边界被认领。
- `real/skill-code-review-minimax.ts`：同一 diff 分别在未注入/已注入时跑真实 turn，检查结论优先、问题清单和严重性顺序。

这里的 step 是能力接入 helper，而不是伪装成 `ctx.plugin()` 的数据文件；这正是该模块要保留的结构差异。

**结论：**做法、规范、工作流优先数据化；执行副作用、监听事件或提供服务时再写插件。


## A4 · 外部运行面

- MCP 阶段只启动一个必然不存在的本地命令，验证失败契约，不发网络。
- Webhook 仅展示完整 Host-plane 依赖边界，不把复杂宿主服务塞入核心 harness。
- Cordis extensions 使用真实 dynamic runner 与 inspect registry，离线注册模型工具。

- `agentDefaultModel` 是 Webhook 创建 Agent 的必需支持服务；示例只保存 mock 路由，不读取凭证。

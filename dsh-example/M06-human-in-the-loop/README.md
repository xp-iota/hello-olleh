# M06 · 人在环路

本模块合并原 04 与 13，覆盖人类参与 Agent 系统的两个方向：**主动发命令**与**被动裁决高风险动作**。

## 运行

```bash
npm run M06
```

## 两条路径

| 路径 | 独立插件 | 语义 |
|---|---|---|
| Slash Command | `steps/01-command-hello.ts` | `/hello` 由命令注册表解析和执行，不消耗模型 turn |
| Approval | `steps/02-approval-answerer.ts` | 工具 pre-execute 返回 ask 后，由 approval seam 产出 allow-once/reject |

运行器先展示已注册命令、参数和未知命令行为，再用同一工具调用模拟三种审批局面：无应答器时 fail closed、白名单时单次放行、不在白名单时拒绝。审批结果以结构化事件和工具失败返回模型，而不是靠自然语言约定。

**结论：**人机边界必须是显式协议；命令解决“人要系统做什么”，审批解决“系统是否被允许做什么”。


## A4 · 结构化人在环路

| 步骤 | 服务/能力 | 关键边界 |
|---|---|---|
| 03 | `userQuestions` | scoped answerer waterfall；无 Provider 明确失败 |
| 04 | `planMode` | 状态写入日志投影，退出走稳定工具 |
| 05 | `todo` | 整表替换并投影，不做隐式局部更新 |
| 06 | `messageFeedback` | 经 `sessionPersistence` 读取耐久反馈 |

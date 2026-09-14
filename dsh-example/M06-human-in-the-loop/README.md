# M06 · 人在环路

人类既可以主动发出控制命令，也可以在系统执行高风险动作前作出结构化裁决。

## 学习目标

区分命令、审批、问题、计划、待办和反馈六种人机协议，避免把控制流伪装成自然语言提示。

## 运行

```bash
npm run M06            # 真实 MiniMax（默认）；需要 LLM_API_KEY，会发起网络请求
npm run M06 -- --mock  # 离线确定性机制；不联网、不需要密钥
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察场景 | 观察什么 |
|---|---|---|---|---|
| 1 Slash Command | 教学主线 | `steps/01-command-hello.ts` | `phases/01-dispatch-slash-command.ts` | 命令不消耗模型 turn，未知命令显式失败 |
| 2 Approval | 教学主线 | `steps/02-approval-answerer.ts` | `phases/02-three-approval-outcomes.ts` | ask、allow-once、reject 与无 Provider 时 fail closed |
| 3 用户问题 | 扩展面 | `steps/03-user-questions.ts` | `phases/03-answer-structured-questions.ts` | scoped answerer waterfall |
| 4 计划模式 | 扩展面 | `steps/04-plan-mode.ts` | `phases/04-toggle-plan-mode.ts` | 状态写入日志投影，退出走稳定工具 |
| 5 Todo | 扩展面 | `steps/05-todo.ts` | `phases/05-replace-todo-list.ts` | 整表替换并投影，不做隐式局部更新 |
| 6 消息反馈 | 扩展面 | `steps/06-message-feedback.ts` | `phases/06-read-durable-feedback.ts` | 经持久化服务读取耐久反馈 |

## 完整链路

宿主解析命令或问题；模型请求副作用时，pre-execute 返回 ask；审批 Provider 给出结构化结果；决定写入日志并转换成工具成功或失败。计划、Todo 与反馈同样通过稳定服务和投影表达。

## 边界

没有应答 Provider 时必须明确失败，不能默认放行，也不能无限等待。

**结论：**命令解决“人要系统做什么”，审批解决“系统是否被允许做什么”。

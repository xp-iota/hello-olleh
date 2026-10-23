# M06 · 人机交互

这是本工程"完整人机交互"的核心章节。五个交互面全部以**服务 + waterfall** 的形式存在，终端只是它们的一个消费者：

| 交互面 | 接缝 | 终端表现 |
|---|---|---|
| 审批 | `approval/request` waterfall | `dsh-lab chat` 里弹 y/n |
| 提问 | `user-questions/request` waterfall | 编号菜单 / 自由输入 |
| 命令 | `ctx.commands` | `/plan` `/goal` `/compact` `/feedback` `/permission` |
| 计划 | `ctx.planMode` | 只读探索 + `exit_plan_mode` 审批 |
| 待办 | `ctx.todos` / `todo_write` | 人类可见的任务清单 |

关键设计：这些交互**不是** UI 的逻辑，而是运行时的接缝。换一个前端（Web、IDE 插件），接的是同一批 waterfall。

## 学习目标

- 理解 waterfall 的"认领"语义：返回即终结，`next()` 才继续；
- 知道`approval.request()` 为什么强制要求 open turn；
- 会从 waterfall 层面测试交互，而不必启动终端；
- 分清"命令"（人发起，不进模型）和"工具"（模型发起）。

## 运行

```bash
npm run M06
```

全部 6 个阶段不需要 key。

终端里体验：

```bash
npm run chat
› /help
› /plan
› /permission
```

## 代码地图

```text
M06-human-in-the-loop/index.ts
├─ M06.1 dispatchCommand        # ctx.commands.list(agent) / execute(agent, line, [], signal)
├─ M06.2 approvalOutcomes       # waterfall 三条路径 + service 的 turn 约束
├─ M06.3 structuredQuestions    # userQuestions.ask() 与自动回答器
├─ M06.4 togglePlanMode         # planMode 服务界面
├─ M06.5 todoList               # todo 工具在位
└─ M06.6 messageFeedback        # messageFeedback 服务在位

src/cli/repl.ts                 # 把上面四个接到终端
```

## M06.2：一个真实的 0.2.1 约束

裸调 `ctx.approval.request()` 会失败：

```text
approval.request() outside an open turn: the approval/asked + approval/decided
audit pair must be turn-enclosed (a bare event between turns is crash-tail
garbage on reload). Ask from inside the turn that needs the decision.
```

这不是刁难，是重放一致性的要求：审批的审计事件是**一对**（asked + decided）。如果它们落在 turn 之外，崩溃恢复时就无法区分"真的发生过一次审批"和"上次写到一半崩了"。

于是分两层：

- `approval/request`（waterfall）——纯决策，任何监听都能回答；
- `ctx.approval.request()`（服务）——加了 turn 封装和审计写入。

M06.2 演示 waterfall 的三条路径：

1. 监听返回 `'rejected'` → 拒绝；
2. 监听返回 `'allowed-once'` → 放行一次（**唯一**表示允许的取值）；
3. 没人认领 → 兜底 `'unavailable'`（fail closed）。

然后验证第 4 条：服务层裸调被 turn 约束拒绝。

**fail closed 是重点**：没有回答器时结论是 `unavailable` 而不是 `allowed`。安全默认值必须在"没人管"的时候也成立。

## M06.1：命令与工具的区别

| | 命令 | 工具 |
|---|---|---|
| 发起者 | 人类 | 模型 |
| 进模型上下文吗 | 否 | 是 |
| 例子 | `/compact` `/plan` | `read` `bash` |

`commands.execute(agent, line, attachments, signal)` 的四个参数都有用：`attachments` 是随命令提交的图片/文件回执，`signal` 让 UI 能取消。

`commands.list(agent)` 是**按 agent 求值**的——同一条 `/goal` 在不同 agent 作用域下可能有不同实现。所以 `dsh-lab info` 要借一个临时 agent 才能盘点全局命令。

## 交互在终端里长什么样

`src/cli/repl.ts` 的 `composeAgentScope()` 是全部接线处：

```ts
agentCtx.on('approval/request', async (request) => {
  const allowed = await this.prompter.confirm(`  允许这次调用？`)
  return allowed ? 'allowed-once' : 'rejected'
})

agentCtx.on('user-questions/request', async (request) => {
  // 编号菜单 / 自由输入，返回 { answers: [...] }
})
```

注意它注册在 **agent 作用域**的 ctx 上，不是根 ctx——这样一个 agent 的审批不会劫持另一个 agent 的。

## 排错

| 现象 | 原因 |
|---|---|
| `outside an open turn` | 裸调 `approval.request()`；走 waterfall 或等 turn 打开 |
| 审批没人弹窗 | 监听没装，或装在了错误的 scope |
| 命令执行返回 `undefined` | 语法/名字没解析成功；`parseCommand` 先校验 |
| 工具行、turn 收尾行从不打印 | 见下：`session/event` 的签名 |

### 一个静默的坑：`session/event` 不是 payload 对象

`agent/*` 系列事件收一个 payload 对象：

```ts
ctx.on('agent/assistant-stream', (payload) => { payload.agent; payload.frame })
```

但 `session/event` 是**两个位置参数**：

```ts
'('session/event')(session: Session, event: SessionEvent): void
```

按 payload 解构去写，监听器永远拿不到事件——**而且不报错**，只是安静地什么都不
显示。REPL 的工具行和 turn 收尾行就这样从来没打印过，直到 `scripts/probe-repl.ts`
把一条真实 turn 跑起来才暴露。

这是本工程里最值得记住的一类 bug：类型写成 `any` 之后，签名错误不会在编译期
被拦住，也不会在运行期崩溃，只表现为"某个功能好像没生效"。

## 练习

1. 把 M06.2 的第 2 条改成 `'allowed-always'`，观察被规范化成什么（提示：rogue 返回值 → `'unavailable'`）。
2. 在 `dsh-lab chat` 里触发一次 `ask_user_question`，用编号菜单回答。
3. 给 `composeAgentScope` 加一个"本次会话全部允许"的记忆，看它和 `/permission` 的关系。
4. 跑 `node scripts/probe-repl.ts`，确认工具行与 turn 收尾行都在。

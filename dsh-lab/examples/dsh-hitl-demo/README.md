# dsh-hitl-demo —— 人在回路：审批、提问、命令、todo

> 配套文章：`docs/hello-dsh/` 的人机交互章节。本工程完全独立：整目录拷走，
> `npm install` 后 `npm start`（Node）或 `npm run start:bun`（Bun）即可运行，
> 不需要 API key——模型侧由进程内注册的脚本化 `LlmAdapter` 驱动真实 turn。

## 1. 问题

agent 循环不能是黑箱：模型要执行敏感操作时，人在哪里介入？介入的判决如何
被记录、被回放、被审计？dsh 把"人在回路"拆成四个互不替代的面：

| 面 | 服务/工具 | 回答的问题 |
|:---|:---------|:-----------|
| 审批 | `ctx.approval`（user-approval） | 这个操作**允许吗**？ |
| 提问 | `ctx.userQuestions`（user-questions） | 这个决策**选哪个**？ |
| 命令 | `ctx.commands`（commands） | 用户直接**下达指令**（不经模型） |
| 清单 | `todo_write`（tool-todo） | 模型**自报进度**给人看 |

本示例把四个面全部离线触发，并重点拆解审批的判决链——它不是"弹个框"，
而是 **turn 内的审计事件对 + 封闭结果词汇 + fail-closed 兜底**。

## 2. 装配树

九行 base（与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 相同）+ 四行交互面，
共 13 行。完整 `cordis.patch.yml`：

```yaml
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'
    - id: tools
      name: '@deepseek-ai/dsh-tools'
    - id: tool-executor-native
      name: '@deepseek-ai/dsh-tool-executor-native'
    - id: session
      name: '@deepseek-ai/dsh-session'
    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'
    - id: agent
      name: '@deepseek-ai/dsh-agent'
    - id: llm
      name: '@deepseek-ai/dsh-llm'
    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []
    - id: user-approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: ask
    - id: user-questions
      name: '@deepseek-ai/dsh-user-questions'
    - id: commands
      name: '@deepseek-ai/dsh-commands'
    - id: tool-todo
      name: '@deepseek-ai/dsh-tool-todo'
      config:
        allowParallelInProgress: true
```

依赖链很短：user-approval / user-questions / tool-todo 都注入 `sessionProjections`
（base 已有），tool-todo 另注入 `tools`，commands 无额外服务依赖。
`allowParallelInProgress` 是 tool-todo 的 **required** 配置，缺了装配直接失败。

## 3. 六个场景与实测输出

`npm start`（Node v26.12.1）实测输出，Bun 1.4.4 逐行一致：

```text
runtime = node v26.12.1

=== S1 审批 waterfall：四个结果 + fail-closed ===
五次请求的结果：allowed-once → rejected → unavailable → unavailable → cancelled
审计对：approval/asked × 5，approval/decided × 5

=== S2 turn 约束 + never 策略覆盖 ===
turn 外裸调：approval.request() outside an open turn: the approval/asked + approval/decided …
setApprovalPolicy('never') 后：结果=rejected（回答器在场也被拒），approval/policy 事件 × 1

=== S3 真实 turn 内的工具审批 ===
批准路径：decided=allowed-once，callId 在审计里=true
拒绝路径：decided=rejected，模型看到：Error: the user rejected tool "word_count"
无 agent 降级：isError=true，Error: tool "word_count" requires approval, but the call has no agent to route …

=== S4 userQuestions.ask ===
回答：[{"id":"scope","selected":["只读"]}]
空问题批：UserQuestionError code=EMPTY_QUESTIONS

=== S5 commands.register + execute ===
lab-note 可见：true
execute 结果：kind=success，text=已记录：双运行时一致
生命周期事件：command/run → command/done；未注册命令返回 undefined

=== S6 todo_write ===
有 agent：isError=false，Updated todo list: 1 pending, 1 in progress, 1 completed.
无 agent：isError=true，Error: todo_write requires an owning agent session

HITL_OK
```

### S1 审批词汇表与 fail-closed

`ApprovalOutcome` 是封闭联合：`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`
（`user-approval/src/types.ts:32`）。五种路径各走一遍：

1. 回答器返回 `allowed-once` → 批准；
2. 回答器返回 `rejected` → 拒绝；
3. **没有回答器** → waterfall 兜底 `unavailable`（fail-closed，不抛错）；
4. **回答器抛错** → 异常被缝包容，问题关闭为 `unavailable`，不漏给调用方；
5. 回答器挂起不答、`signal` abort 赢得竞态 → `cancelled`，迟到的回答被构造性丢弃。

每次 `request()` 都先落 `approval/asked`、判决后落 `approval/decided`，同一 `id`
配对（`index.ts:251-259`）。五次请求 = 五对审计事件，全部落在会话日志里。

提问如何进入 turn？本示例用 `agent/turn-stopping` 作挂点：此刻 turn 尚未 end，
`approvalState` 投影的 `turnOpen` 仍为 true，serial 事件会等异步监听完成——
`insideTurn()` 辅助函数就靠它把任意代码放进一个真实 turn 内部。

### S2 turn 约束与 never 覆盖

- turn 外裸调 `approval.request()` 直接抛 `outside an open turn`：审计对必须被
  turn 包络，否则崩溃重载时会留下不完整的垃圾记录（`index.ts:244-250`）。
- `setApprovalPolicy(session, 'never')` 落一条 `approval/policy` 事件作为持久覆盖；
  之后即使有回答器想批准，结果仍是 `rejected`——**never 在服务自己的请求路径上、
  先于任何 waterfall 分发判决**（`index.ts:296-301`）。源码注释明说：`prepend: true`
  的监听器也拦不住它，监听器形状的门禁无法做出这个保证。

### S3 真实工具审批：pre-execute 的 ask 决定

这是权限门的正路，不需要自己调 `approval.request`：

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'word_count') return { kind: 'ask', reason: 'word_count 需要人工批准' }
  return next()
})
```

管线收到 `ask` 后自己走审批缝（`core/tools/src/pipeline.ts:440-480`）：
`ctx.get('approval')` 机会性消费服务 → 带真实 `callId` 调 `request()` →
四个结果一一映射：`allowed-once` 放行；其余三个变成带 `ApprovalError`
（`APPROVAL_REJECTED` / `APPROVAL_CANCELLED` / `APPROVAL_UNAVAILABLE`）的 deny，
拒绝原因作为工具结果传给模型。两条降级也实测了：没装配 approval 服务、
或调用没有 agent（无会话可审计、无 UI 可路由）→ 一律降级 deny。

### S4 结构化提问

`userQuestions.ask({ agent, questions })` 走 `user-questions/request` waterfall；
回答器返回 `{ answers: [{ id, selected }] }` 即认领，答案按问题 id 回声。
空问题批抛 `UserQuestionError` code `EMPTY_QUESTIONS`。与审批不同，ask 不要求
open turn，但要求 agent 是注册表里的精确活实例（`CALLER_NOT_LIVE`），且拒绝
subagent 身份的委派调用方（`DELEGATED_CALLER`）。

### S5 自定义斜杠命令

`commands.register({ name, description, handler })` 返回解除句柄；
`execute(agent, '/lab-note …', [], signal)` 先落 `command/run`、handler 结算后落
`command/done`（同一 `commandId` 配对）。命令**不经模型**——handler 直接对接收
agent 执行。未注册的名字返回 `undefined` 而不是抛错。

### S6 todo_write

清单是"每 agent 会话"的状态：工具把整份清单落成 `todo/write` 事件，返回
`counts` 汇总；`todos` 投影在下一个 `turn/start` 清零（turn/end 保留完成的清单
可见）。没有归属 agent 的调用被明确拒绝（`todo_write requires an owning agent
session`），而不是静默 no-op。

## 4. 坑（全部实测）

1. **审批必须 turn 内发起**。turn 外裸调抛错，不是返回 unavailable——想演示审批，
   先有一个真实 turn（本示例用 `agent/turn-stopping` 挂点，见 `insideTurn()`）。
2. **never 先于回答器**。别想用 `prepend` 监听器在 never 策略下"抢救"批准；
   判决发生在服务的请求路径上，早于 waterfall 分发。
3. **回答器抛错 ≠ 调用失败**。缝把异常包容成 `unavailable`（fail-closed），
   调用方拿到的是封闭词汇里的值，不是异常。
4. **waterfall 监听挂在根 ctx 上不随插件 fiber 销毁**——每个 `ctx.on` 都要拿
   `off` 句柄手动解除，否则 S1 的回答器会泄漏到 S3。
5. **tool-todo 的 `allowParallelInProgress` 是 required**，patch 里必须显式给。
6. **类型增补靠导入**：`ctx.approval` / `ctx.userQuestions` / `ctx.commands` 的
   Context 增补分别来自三个包，`import type {} from '…'` 不能省。

## 5. 从零复现

目录结构（`node_modules`、`.dsh-home` 运行后生成，均已 gitignore）：

```text
dsh-hitl-demo/
├── package.json              # 20 个依赖，全部 pin 精确版本
├── cordis.yml                # 根配置留空：[]
├── cordis.patch.yml          # 上面第 2 节的 13 行树
├── tsconfig.json
└── src/
    ├── index.ts              # 六场景主程序
    ├── tools.ts              # callTool 单次调用封装（批接口 → 单调用）
    └── plugins/
        ├── word-count.ts     # 演示工具（与 tool-pipeline-demo 同款）
        └── scripted-adapter.ts  # 脚本化 LlmAdapter（与 agent-loop-demo 同款）
```

版本面：`@deepseek-ai/*` 一律 `0.2.2-rc.3`（npm `next` 通道，与
`sources/deepseek-harness` 快照同版），peer `@deepseek-ai/cordis` 用 `4.1.0`，
cordis 官方插件 loader/include/group `1.1.0`、timer `1.2.0`。
也可以直接从 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 复制脚手架，
再按第 2 节加四行、按 `package.json` 加四个包。

```bash
npm install
npm start          # Node >= 22.18（原生 TypeScript type stripping）
npm run start:bun  # Bun >= 1.4.4
npm run typecheck  # tsc --noEmit，0 错误
```

本示例不挂 ptc/subprocess 两条缝，Bun 无需任何补丁，`start:bun` 直接 `bun src/index.ts`。

## 6. 小结

- 审批 = turn 内审计事件对（`approval/asked` + `approval/decided`）+ 封闭结果词汇
  + fail-closed 判决链；`unavailable` 是正常结果，不是异常。
- 权限门正路是 pre-execute 返回 `{ kind: 'ask' }`，管线自动带 `callId` 走审批缝，
  并把拒绝原因翻译成模型可见的工具结果。
- 提问、命令、todo 是另外三个独立面：结构化回答、不经模型的指令、每会话进度清单。
- 兄弟示例：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)（pre/post-execute
  与 guard）、[dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)（turn-stopping 挂点）、
  [dsh-session-demo](../dsh-session-demo/README.md)（审计事件的持久化与回放）。
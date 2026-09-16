# 第 09 课 · 长任务与编排：运行句柄 vs 目标状态机

> **本课任务**：启动一个长跑 Job 并增量读它的输出；用 `kill` 终止它、用 `wait` 等它结算；
> 再驱动一个 Goal 走完 create → pause → resume → block → complete → clear，并用一条过期
> `GoalRef` 撞出 CAS 冲突；最后在 worker thread 里跑一个 workflow 脚本、把一个计划挂到耐久会话上。
> **运行命令**：`cd dsh-example && npm run M09`
> **你将看到**：Job 被颁发 `bash-1`；连续两次 `read` 第二次只拿到增量；`kill` 把 live 推到 `stopping`
> 再结算成 `killed`；卸掉 controller 后 `start` **被拒绝**；Goal 的每一跳都追加一条携带完整状态的
> `goal/change` 事件，过期的 ref 被拒。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

"长时间工作"听起来像一件事，在 DSH 里是**两个正交对象**：

| 对象 | 是什么 | 谁拥有状态 | 本课对应实现 |
|---|---|---|---|
| **Job**（`ctx.jobs`） | **可取消的运行句柄** | 注册表持有身份/生命周期，**生产者持有执行资源与读游标** | `impl/01-jobs-background.ts` |
| **Goal**（`ctx.goals`） | **可回放的目标状态机** | **没有自己的存储**，状态完全折叠自所属会话日志 | `impl/02-goal-lifecycle.ts` |

把两者混起来是最常见的误解：Job 关心"这活跑完了吗、能不能停"，Goal 关心"我们朝哪个目的推进到哪一阶段"。
一个 Job 结束就结束了，**没有历史**；一个 Goal 的每一步都**永久留在日志里**，可以回放重建。

本课外加两个编排面：

| 面 | 回答的问题 | 对应实现 |
|---|---|---|
| **workflow engine** | 多步脚本在哪跑（阻塞隔离在哪） | `impl/03-workflow-engine.ts` |
| **schedule** | 计划如何挂到耐久会话上 | `impl/04-schedule.ts` |

```bash
cd dsh-example && npm run M09
```

---

## 2. 真实输出

```text

████ M09 · 长任务与编排：运行句柄与目标状态 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M09.1 · 管理后台 Job 的启动、读取、终止与等待 ────
① 启动一个长跑任务（JobHooks：run() 同步返回 { cancel, done, readOutput }）:
   颁发 id = bash-1 （<kind>-N 形）

② read 是增量读（连续读不重复；游标归生产者）:
   第一次读: "进度 1/3\n"
   第二次读: "" （只剩增量）

③ wait：等结算或超时（不取消任务）:
  [jobs] 完成通告：bash-1 → completed (exit code: 0) (owner=demo-session)
   结算状态 = completed | detail = exit code: 0 | reported = true

④ 属主栅栏：非属主读取被拒:
   job bash-1 belongs to another session

⑤ kill：live → stopping → killed（reason 原样转发给 hooks.cancel）:
   kill → requested
  [jobs] 完成通告：bash-2 → killed (演示取消)
   结算 = killed

⑥ 准入：没有 controller 时 start 被拒（先卸掉插件的 controller）:
   background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)
REAL_STAGE_OK M09.1 calls=1 ms=449 in=0 out=49 finish=stop

──── M09.2 · 以追加日志和 CAS 推进 Goal 生命周期 ────
① create：创建并 arm（rev=1, phase=active, activation=armed）
  [goal/change] seq=0 → rev=1 phase=active "重构支付模块"
   → active armed rev=1

② pause：active → paused（撤 arm）
  [goal/change] seq=1 → rev=2 phase=paused "重构支付模块"
   → paused disarmed rev=2

③ CAS 冲突：用旧 ref 操作被拒
   stale goal ref "goal-80c1f6b9-71b0-4cfe-808d-78bf6dce0b2e" revision 1; current is "goal-80c1f6b9-71b0-4cfe-808d-78bf6dce0b2e" revision 2

④ resume：paused → active（重新 arm）
  [goal/change] seq=2 → rev=3 phase=active "重构支付模块"
   → active armed rev=3

⑤ block：→ blocked（携带人机可读 reason）
  [goal/change] seq=3 → rev=4 phase=blocked "重构支付模块"
   → blocked (code=needs-human) rev=4

⑥ complete：→ complete 并撤 arm
  [goal/change] seq=4 → rev=5 phase=complete "重构支付模块"
   → complete disarmed rev=5

⑦ clear：追加 null 墓碑，折叠结果回到 undefined
   goals.get(agent) = undefined

⑧ 日志即状态：回放 6 条 goal/change 事件即可重建全程
REAL_STAGE_OK M09.2 calls=1 ms=539 in=0 out=129 finish=stop

──── M09.3 · 在 worker thread 执行工作流脚本 ────
workflowEngine: {
  provider: 'WorkerThreadWorkflowEngine',
  stopReason: 'completed',
  value: { ok: true, value: 42 },
  agentsStarted: 0
}
REAL_STAGE_OK M09.3 calls=1 ms=654 in=0 out=70 finish=stop

──── M09.4 · 把计划调度注册到耐久会话 ────
schedule: {
  persistence: 'JsonlSessionPersistence',
  tools: [ 'schedule_create', 'schedule_list', 'schedule_delete' ]
}
REAL_STAGE_OK M09.4 calls=1 ms=9295 in=0 out=52 finish=stop

REAL_MODULE_OK M09 stages=4 calls=4 failed=0
```

**对照自己的输出**：最后一行必须逐字是

```text
REAL_MODULE_OK M09 stages=4 calls=4 failed=0
```

（`stages=4` 对应 `run.ts` 里注册的四个 stage。）另外 `calls=4` 是 `runtime/harness.ts` 的
**真调用校验**：每个 stage 都必须有一次成功的真实推理服务调用，缺证据就 fail loud。

`M09.2` 的 ⑧ 那行是 `6 条 goal/change`，不是 5 条也不是 7 条——**数一数上面打出的
`[goal/change] seq=`（0…4 是 5 条）**，第 6 条是 ⑦ 的 clear 墓碑（它打印成 `goals.get(agent) = undefined`，
其事件由 `impl/02` 的监听器单独分支处理，所以没有 `seq=` 行）。这个差额本身就是一个知识点。

---

## 3. Job：拉模型 + 准入，先看 `run()` 的契约

打开 [`impl/01-jobs-background.ts`](../M09-long-running-orchestration/impl/01-jobs-background.ts)。

```ts
export const name = 'jobs-background'
export const inject = ['jobs']          // 依赖 ctx.jobs，满足后 apply 才运行

export function apply(ctx: Context) {
  // 挂接一个 effect 级 controller：start 只向有 controller 服务的属主放行。
  ctx.effect(() => ctx.jobs.attachController('job-controller-demo'))

  ctx.effect(() => ctx.jobs.onJobDone((snapshot, owner) => {
    console.log(`  [jobs] 完成通告：${snapshot.id} → ${snapshot.status}${snapshot.detail ? ` (${snapshot.detail})` : ''}${owner ? ` (owner=${owner.id})` : ''}`)
  }))
}
```

两个 `ctx.effect(...)` 都挂在**插件 fiber** 上，所以 `fiber.dispose()` 会同时卸掉 controller 和监听器。
第 2 节 ⑥ 就是靠这个性质做出来的：

```text
⑥ 准入：没有 controller 时 start 被拒（先卸掉插件的 controller）:
   background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)
```

**准入控制的理由是"生产的活必须有人收、有人停"**：没有 controller 服务这个属主，`start()` 就拒绝，
而不是安静地起一个没人能收集结果、也没人能停掉的野任务。这是 fail-loud，不是缺省放行。

打开 [`scenes/01-job-start-read-kill.ts`](../M09-long-running-orchestration/scenes/01-job-start-read-kill.ts)，
看 `start()` 的实参长什么样：

```ts
const id = jobs.start({
  kind: 'bash',
  label: '编译前端',
  owner: agent, // owner 是 Agent；访问按它的会话 id 栅栏
  run: () => {
    // 生产者拥有自己的执行资源与读游标；注册表只管身份与生命周期状态。
    let output = ''
    let cursor = 0
    let cancelled = false
    const done = (async (): Promise<JobOutcome> => {
      for (let i = 1; i <= 3; i++) {
        if (cancelled) return { status: 'killed', detail: 'cancelled' }
        await new Promise((resolve) => setTimeout(resolve, 30))
        output += `进度 ${i}/3\n`
      }
      return { status: 'completed', detail: 'exit code: 0' }
    })()
    return {
      cancel: () => { cancelled = true }, // 契约：同步、幂等
      done, // 契约：Promise<JobOutcome>，不 reject（运行期把拒绝转换为 failed）
      readOutput: () => {
        const delta = output.slice(cursor)
        cursor = output.length
        return delta
      },
    }
  },
})
console.log('   颁发 id =', id, '（<kind>-N 形）')
```

三条契约逐条对应输出：

| 契约 | 为什么这么设计 | 输出证据 |
|---|---|---|
| `run()` **同步**返回 `{ cancel, done, readOutput? }` | 注册必须在 `start()` 返回前完成，返回 id 时任务已在册 | `颁发 id = bash-1` |
| `cancel(reason)` 同步、幂等；`done` **不 reject**（运行期把 reject 转成 `failed`） | 清理路径不能被异常卡死 | ⑤ 的 `kill → requested` |
| `readOutput()` 是**拉式增量**，**游标归生产者** | 注册表不该替生产者决定"读到哪了" | ② 的两次读 |

---

## 4. `read` 是增量、`wait` 不取消、`kill` 转发 reason

### `read` 返回"自上次以来的增量"

```ts
console.log('   第一次读:', JSON.stringify(jobs.read(id, agent).text))
console.log('   第二次读:', JSON.stringify(jobs.read(id, agent).text), '（只剩增量）')
```

```text
② read 是增量读（连续读不重复；游标归生产者）:
   第一次读: "进度 1/3\n"
   第二次读: "" （只剩增量）
```

第二次是**空串**而不是 `"进度 1/3\n"` 的重复——这就是"游标属于生产者"最直接的证据。
`read(id)` 返回的是 `{ text, snapshot }`：`text` 是拿走的增量，`snapshot` 是**读之后**的只读投影。

### `wait` 等的是"结算或超时"，**signal 取消的是等待本身，不是任务**

```ts
const final = await jobs.wait(id, 5_000, agent)
console.log('   结算状态 =', final.status, '| detail =', final.detail, '| reported =', jobs.read(id, agent).snapshot.reported)
```

```text
③ wait：等结算或超时（不取消任务）:
  [jobs] 完成通告：bash-1 → completed (exit code: 0) (owner=demo-session)
   结算状态 = completed | detail = exit code: 0 | reported = true
```

`wait` 可传 `signal`：超时/中止只会让 `wait` 自己返回或抛 `wait aborted`，**不会去动那个 Job**。
这跟下面 `kill` 形成对照——想停任务只有一条路，就是 `kill`。

注意输出顺序：**完成通告在结算行之前**。原因是通告由 `onJobDone`（`impl/01`）在 `settle` 的最后一步
发出，而 `wait` 的调用方是在被释放后才继续；`owner=demo-session` 来自 `runtime/harness.ts` 的
`DEMO_SESSION`。`reported = true` 的语义是：**读过终态记录 = 这条记录已被上报**。

### `kill` 转发 reason，结算成 `killed`

```text
⑤ kill：live → stopping → killed（reason 原样转发给 hooks.cancel）:
   kill → requested
  [jobs] 完成通告：bash-2 → killed (演示取消)
   结算 = killed
```

同一个场景里能同时看到两个东西：`kill()` 的返回值是 `'requested'`（还活着）或
`'already-finished'`（已经终态）；`reason` 被**原样**交给生产者的 `cancel`：

```ts
return { cancel: (reason?: string) => controller.abort(reason), done }
```

生产者"尊重取消"才能提前以 `killed` 收工——`cancel` 只是**请求**终止，注册表随后把记录标成 `stopping`。
生命周期因此是 `running → stopping → completed | killed | failed`。

### 属主栅栏

```text
④ 属主栅栏：非属主读取被拒:
   job bash-1 belongs to another session
```

`JobStart.owner` 是一个 **Agent**，访问按它的**会话 id** 栅栏（`ownerSession`）。
ids 是可预测的（`bash-1`、`bash-2`…），所以这里的边界是**授权，不是保密**——
知道 id 不等于能读，拿别的 agent 去 `get`/`read`/`kill`/`wait` 一律被拒。

> **原理对照**：`ctx.jobs` 的包构成与"在 turn 内还是 turn 外"见
> [09 § 9.19–9.20](../../docs/hello-dsh/09-host-runtime-and-storage.md)；五种机制的选型表见 [09 § 9.26](../../docs/hello-dsh/09-host-runtime-and-storage.md)。

---

## 5. Goal：日志即状态，revision 是并发控制

打开 [`impl/02-goal-lifecycle.ts`](../M09-long-running-orchestration/impl/02-goal-lifecycle.ts)：

```ts
export function apply(ctx: Context) {
  ctx.on('session/event', (_session: any, event: any) => {
    if (event.type !== 'goal/change') return
    const goal = event.data.goal
    console.log(`  [goal/change] seq=${event.seq} →`, goal === null ? '（墓碑：已清除）' : `rev=${goal.revision} phase=${goal.phase} "${goal.objective}"`)
  })
}
```

它一行状态都不存，只是把会话日志里的 `goal/change` 事件打出来。这就是本节的中心论点：

> **Goal 服务没有自己的存储，所属会话的日志就是唯一本体。**

所以每一跳的输出都是"**一条事件 + 折叠出来的视图**"成对出现：

```text
① create：创建并 arm（rev=1, phase=active, activation=armed）
  [goal/change] seq=0 → rev=1 phase=active "重构支付模块"
   → active armed rev=1
```

`→ active armed rev=1` 这行是 `scenes/02` 打印的**视图**：

```ts
let view = goals.create(agent, { objective: '重构支付模块', maxGoalRounds: 5 })
console.log('   →', view.phase, view.activation, `rev=${view.revision}`)
```

### whole-value rule：事件携带**完整**的变更后状态

每条 `goal/change` 带的不是 diff，而是**整份快照**（外加一个自增的 `revision`）。
好处是折叠不需要顺序状态机，坏处是事件更大——这是刻意的取舍：日志可回放优先。

### CAS：`GoalRef { id, revision }` 是乐观并发

```ts
const staleRef = { id: view.id, revision: view.revision }   // rev=1 的引用被留了下来
```

```text
③ CAS 冲突：用旧 ref 操作被拒
   stale goal ref "goal-80c1f6b9-71b0-4cfe-808d-78bf6dce0b2e" revision 1; current is "goal-80c1f6b9-71b0-4cfe-808d-78bf6dce0b2e" revision 2
```

**同一目标、不同 revision**：id 完全一样，只有 `revision` 过期。这就是乐观并发——
不做锁，而是让每个变更带上"我以为的当前版本"，不匹配就抛
`GoalError('GOAL_STALE_REVISION')`。后续每一步都必须用**刚拿到的** `view` 现构 ref：

```ts
view = goals.resume(agent, { id: view.id, revision: view.revision })
```

### `activation` 是进程内状态，**永不落日志**

这是本节最容易记错的一点。把 `phase` 和 `activation` 分开看：

| 字段 | 落在哪 | 会不会进日志 |
|---|---|---|
| `phase`（`active \| paused \| blocked \| complete`） | 会话日志的 `goal/change` | **会** |
| `revision` | 同上（CAS 用） | **会** |
| `activation`（`armed \| disarmed`） | **进程内 runtime 状态** | **不会** |

输出里 `activation` 只出现在 `→ ... armed/disarmed ...` 的视图行，**从不出现在 `[goal/change]` 行**——
那行只有 `rev=` 和 `phase=`。所以 `pause`、`complete` 会 `disarm`（撤掉推进），
但"没被 arm"这件事是**进程内**的：重启后回放日志只能重建阶段，重建不了激活态。

### `clear` 追加 null 墓碑

```text
⑦ clear：追加 null 墓碑，折叠结果回到 undefined
   goals.get(agent) = undefined
```

`clear` 不删除历史，而是再追加一条**墓碑**事件（`operation: 'clear'`，带清除到的 `id/revision`）。
`goals.get(agent)` 之所以能变回 `undefined`，是因为折叠到墓碑后当前目标为空——
**历史还在，只是当前目标没了**。这也解释了 ⑧ 的计数：

```ts
const changes = agent.session.snapshotEvents().filter((event) => event.type === 'goal/change')
```

```text
⑧ 日志即状态：回放 6 条 goal/change 事件即可重建全程
```

把日志里的 `goal/change` 全部回放一遍，就能重建整个生命周期——**这就是"可回放"的含义**。

> **原理对照**：Goal 的四个包（definition / 推进器 / consumer / 人类命令）见
> [09 § 9.23](../../docs/hello-dsh/09-host-runtime-and-storage.md)；和 subagent 的区别
> （同会话演进 vs 派生新会话）见 [08 § 8.31](../../docs/hello-dsh/08-execution-services.md)。

---

## 6. workflow engine：worker thread 隔离的是阻塞，不是安全

打开 [`impl/03-workflow-engine.ts`](../M09-long-running-orchestration/impl/03-workflow-engine.ts)，整个文件只有四行：

```ts
/** worker-thread Provider 实现 workflowEngine；线程是阻塞隔离，不是安全边界。 */
export { default } from '@deepseek-ai/dsh-workflow-worker-thread'
export type { Config } from '@deepseek-ai/dsh-workflow-worker-thread'
export { WorkflowError, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
```

场景 [`scenes/03-run-script-in-worker.ts`](../M09-long-running-orchestration/scenes/03-run-script-in-worker.ts)
挂上它并跑一个**不发网络**的脚本：

```ts
await harness.loadPlugin(WorkerThreadWorkflowEngine, {
  provider: 'local-reviewer',
  maxConcurrentAgents: 2,
  maxTotalAgents: 4,
  maxItemsPerCall: 16,
  syncTimeoutMs: 1_000,
  disposeGraceMs: 1_000,
})
const run = harness.ctx.workflowEngine.start({
  parent: harness.agent,
  meta: { name: 'offline-flow', description: '不发网络的 worker-thread 教学工作流' },
  script: "phase('Compute'); log('worker is alive'); return { ok: true, value: 6 * 7 }",
})
```

```text
workflowEngine: {
  provider: 'WorkerThreadWorkflowEngine',
  stopReason: 'completed',
  value: { ok: true, value: 42 },
  agentsStarted: 0
}
```

三个输出字段各自说明一件事：

- `provider: 'WorkerThreadWorkflowEngine'` —— `harness.ctx.workflowEngine.constructor.name`，
  **换 provider 就是换这一行**（definition 包负责注册 `ctx.workflowEngine` 这个 seam，provider 负责实现）。
- `stopReason: 'completed'` —— 脚本正常跑完（而不是超时/被杀）。
- `agentsStarted: 0` —— 这个脚本**一个 subagent 都没起**（`6 * 7` 在 worker 里算完就返回）。

关键结论写在标题里：**线程隔离保护的是事件循环，不是安全边界**。把阻塞代码丢进 worker thread
是为了不让它卡住主线程；**它不构成沙箱**，不能拿来当安全隔离（真正的沙箱是另一个包，见
[08 § 8.18–8.21](../../docs/hello-dsh/08-execution-services.md)）。

---

## 7. schedule：函数式插件 + 耐久会话

打开 [`impl/04-schedule.ts`](../M09-long-running-orchestration/impl/04-schedule.ts)：

```ts
/** schedule 是消费 agents/sessions/tools/persistence 的函数式插件，不注册同名 Service。 */
export { name, inject, apply, registerScheduleTools, scheduleView } from '@deepseek-ai/dsh-schedule'
```

注意它**导出的是 `name` / `inject` / `apply`**，而不是一个 Service 类——
也就是说 schedule 是**函数式插件**：它消费 `agents/sessions/tools/persistence`，**不注册同名 Service**。
所以你不会看到 `ctx.schedule` 这种东西。

```ts
const harness = await createHarness({ plugins: [[JsonlSessionPersistence, { root, compression: 'none' }], [schedule]] })
const tools = harness.visibleTools().filter(name => name.includes('schedule'))
console.log('schedule:', { persistence: harness.ctx.sessionPersistence.constructor.name, tools })
```

```text
schedule: {
  persistence: 'JsonlSessionPersistence',
  tools: [ 'schedule_create', 'schedule_list', 'schedule_delete' ]
}
```

两行输出各是一个事实：

1. `persistence: 'JsonlSessionPersistence'` —— 计划要**重启后还在**，所以必须先有耐久会话落盘
   （这里用 JSONL provider；`root` 是场景里 `mkdtemp` 出来的临时目录，`finally` 里删掉）。
2. `tools` 三个名字——schedule 把自己的能力**注册成模型可见的工具**，模型才能自己建/列/删计划。
   这就是"把计划注册到耐久会话"的落点：**计划是会话的一部分，工具是模型的手**。

> **原理对照**：Schedule 是 2003 行的单包、没有 provider/consumer 拆分，见
> [09 § 9.21](../../docs/hello-dsh/09-host-runtime-and-storage.md)；JSONL 持久化见
> [09 § 9.30](../../docs/hello-dsh/09-host-runtime-and-storage.md)。

---

## 8. 排障：`jobs.start()` 抛 "no job controller serves this agent"

### 症状

某个 producer 插件（`tool-bash`、`tool-subagent`、或你自己写的后台任务）一调用 `ctx.jobs.start(...)` 就抛：

```text
background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)
```

界面上的直接感受是"长命令跑不起来""子代理起不来"。

### 定位

1. 先确认错误里的**主语**：`no job controller serves this agent`——问题不在 producer，
   而在**这个 agent 的 composition 里没有 controller**。
2. 再看 controller 是怎么挂的。本课 `impl/01` 的写法是：

   ```ts
   ctx.effect(() => ctx.jobs.attachController('job-controller-demo'))
   ```

   它是 **effect 级**的：一旦插件 fiber 被 dispose，controller 就没了（第 2 节 ⑥ 正是这么造出来的）。
3. 所以排查顺序是：**controller 插件装了吗？装在了哪个 scope？还在不在？**
   注册是 owner-relative 的——在 agent composition scope 下挂的 controller 只服务该 composition 里的 agent。

### 原因与修改

准入是**故意的**：没有 controller 服务这个属主，谁去收集它的结果、谁去停它？
所以修改方向不是绕过 `start`，而是**把 controller 放进 composition**（生产环境就是
`@deepseek-ai/dsh-tool-jobs` 那一行，错误信息里点名了它）。本课为了教学，用
[`impl/01-jobs-background.ts`](../M09-long-running-orchestration/impl/01-jobs-background.ts) 手工挂了一个最小 controller。

这个坑和 [第 01 课 § 7](01-tool-pipeline.md) 的"工具注册了模型却看不见"是同一类：
**程序不报错，只是安静地少了一个东西**——只不过 Job 这里选择了 fail loud。

---

## 9. 代码在哪

```bash
cd dsh-example && ls M09-long-running-orchestration/impl M09-long-running-orchestration/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-jobs-background.ts`](../M09-long-running-orchestration/impl/01-jobs-background.ts) | `inject = ['jobs']`；两个 `ctx.effect`（controller + `onJobDone`） |
| [`impl/02-goal-lifecycle.ts`](../M09-long-running-orchestration/impl/02-goal-lifecycle.ts) | 只监听 `session/event` 的 `goal/change`；`goal === null` 的墓碑分支 |
| [`impl/03-workflow-engine.ts`](../M09-long-running-orchestration/impl/03-workflow-engine.ts) | 四行 re-export：provider + `Config` + `WorkflowError` |
| [`impl/04-schedule.ts`](../M09-long-running-orchestration/impl/04-schedule.ts) | 导出 `name/inject/apply`（不是 Service 类） |
| [`scenes/01-job-start-read-kill.ts`](../M09-long-running-orchestration/scenes/01-job-start-read-kill.ts) | `run()` 的 `cursor`；`jobs.wait(id, 5_000, agent)`；`fiber.dispose()` 后故意再 `start` |
| [`scenes/02-goal-cas-conflict.ts`](../M09-long-running-orchestration/scenes/02-goal-cas-conflict.ts) | `staleRef` 的构造与复用；每步现构 `{ id: view.id, revision: view.revision }`；⑧ 的 `snapshotEvents()` 过滤 |
| [`scenes/04-attach-schedule.ts`](../M09-long-running-orchestration/scenes/04-attach-schedule.ts) | `mkdtemp` 临时 root；`JsonlSessionPersistence` 先于 `schedule` 装载 |
| [`run.ts`](../M09-long-running-orchestration/run.ts) | 四个 `StageSpec`，`kind: 'mechanism'` |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。

---

## 10. 动手练习

### 练习 A：把"游标归生产者"改成生产者不留游标

打开 [`scenes/01-job-start-read-kill.ts`](../M09-long-running-orchestration/scenes/01-job-start-read-kill.ts)，
把 `readOutput` 从增量改成**每次都返回全量**：

```ts
readOutput: () => output,   // 原来的实现是 output.slice(cursor) 并推进 cursor
```

**验证命令**

```bash
cd dsh-example && node M09-long-running-orchestration/scenes/01-job-start-read-kill.ts
```

**可验证答案**：② 的第二次读**不再是空串**，而是重复了第一次那份内容（前缀含 `进度 1/3\n`）。
注册表对这件事**完全无感**——它把 `readOutput()` 的返回值当增量原样交给调用方。
所以"连续读不重复"不是注册表的保证，是**生产者遵守契约**的结果：`readOutput()` 的文档就写着
"Consume output produced since the previous call"，且"每个 job 只有一个消费游标"。
（真实日志里它第二次是 `""`——**这就是契约被遵守的样子**。）

### 练习 B：区分"等待超时"与"取消任务"

把 ③ 的等待超时从 5 秒改成 1 毫秒：

```ts
const final = await jobs.wait(id, 1, agent)
```

**验证命令**

```bash
cd dsh-example && node M09-long-running-orchestration/scenes/01-job-start-read-kill.ts
```

**可验证答案**：`wait` **不会抛错**，只是返回一个**未结算**的快照——第 ③ 行的
`结算状态` 从日志里的 `completed` 变成仍在运行的 `running`，且 `detail` 为空；
**但任务没有被取消**：随后的 `[jobs] 完成通告：bash-1 → completed` 依然会出现。
`wait(id, timeoutMs, caller?, signal?)` 里 `signal` abort 时只是让这个 `wait` 拒绝
（`wait aborted`）或超时返回；想真正停掉任务只能 `kill`。

### 练习 C（进阶）：证明 `activation` 不落日志

在 [`scenes/02-goal-cas-conflict.ts`](../M09-long-running-orchestration/scenes/02-goal-cas-conflict.ts)
的 ⑦ 之后、⑧ 之前，把事件体打出来，例如：

```ts
console.log(changes.map((event) => Object.keys(event.data as object)))
```

**验证命令**

```bash
cd dsh-example && npm run M09
```

**可验证答案**：每条 `goal/change` 的字段里只有 `kind/version/operation/goal/roundsStarted/createdAt/updatedAt`
（clear 那条是 `cleared/clearedAt` 形态），**没有 `activation`**；而 `goals.get(agent)` 与每步的 `view`
里有 `activation`。结论：`phase`/`revision` 是日志状态，`activation` 是**进程内** continuations 激活态——
即使日志里最后是 `phase=complete`，重启回放也重建不出"当时被 arm 过"这件事。

---

**下一课** → [第 10 课 · 外部能力接入](10-external-capabilities.md)：外部能力既可以是可发现的知识资产，也可以是 MCP、Webhook 或动态 Cordis 扩展等宿主协议。

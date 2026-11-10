# M09 · 长期运行的工作

一次对话可能产生三类"活得比一个 turn 更久"的东西：

| 类型 | 服务 | 特点 |
|---|---|---|
| 后台任务 | `ctx.jobs` | 命令跑很久，输出要能持续读 |
| 目标 | `ctx.goals` | 跨轮次的完成目标，驱动自动续跑 |
| 工作流 | `ctx.workflowEngine` | 用脚本把大量子任务编排出去 |

三者共同的模式是：**注册 + 持久化 + 可观测**。状态落在会话日志或存储里，而不是只活在某个 Promise 里。

## 学习目标

- 理解 `JobSpec.run(handle)` 的"生产者自己推输出"模型；
- 知道 job 的输出环（ring buffer）为什么有界；
- 分清 job（流式输出）与 goal（跨轮次目标）；
- 认识 PTC 模式（`run_code`）与 native 模式的差别。

## 运行

```bash
npm run M09
```

不需要 key。

## 代码地图

```text
M09-long-running-work/index.ts
├─ M09.1 backgroundJob    # JobSpec.run(handle) + append/updateProgress + read
├─ M09.2 goalLifecycle    # goals.create / get，目标落在日志里
├─ M09.3 workflowEngine   # PtcWorkflowEngine + workflow 工具
├─ M09.4 ptcRuntime       # run_code 在 native 模式下不注册
└─ M09.5 scheduling       # 本工程刻意不挂 schedule
```

## M09.1：job 的生产者契约

`JobSpec` 没有 `command` 字符串这种字段。取而代之：

```ts
const id = ctx.jobs.start({
  kind: 'bash',
  label: 'M09.1 后台任务',
  owner: handle.agent.session.id,
  run(job) {
    job.append('输出写在 ring 里\n', { channel: 'stdout' })
    job.updateProgress('1/1 done')
    return {
      cancel: () => {},                                  // 必须同步、幂等
      done: Promise.resolve({ status: 'completed' }),     // 必须不 reject
    }
  },
})
```

为什么是"生产者自己写"而不是"registry 帮你看进程"？

因为 job 的来源很多：bash 子进程、另一个 agent、一个工作流。让每个生产者直接 `append` 字节，registry 只需要维护**一个有界环 + 一套读取面**，三类来源就统一了。如果 registry 去理解每种来源，它会长成一个进程管理器。

`cancel` 和 `done` 都是**必需**的，缺了会当场炸（registry 会 `hooks.cancel.bind(hooks)`）。这个设计逼生产者想清楚"我怎么停下来"——不能停的长期任务迟早会变成僵尸。

### 输出环为什么有界

`append` 按 UTF-8 字节推进偏移，环超过容量就丢最旧的。丢掉时读取方会看到 `lossy: true`，而不是报错——**有损但要诚实**，比假装完整更安全。

模型用游标消费（读一次推进一次），观察者用绝对偏移读（互不干扰）。同一批字节，两种读法。

## M09.2：目标

`ctx.goals` 管理跨轮次目标。目标是**投影重建**的：它从会话日志算出来，所以重启后仍在。

这解释了一个容易困惑的现象：你在 `/goal` 里设的目标，为什么在 `dsh-lab traj` 里能看到对应事件。因为它不是内存里的一个变量，是日志里的一段记录。

## M09.3 / M09.4：工作流与 PTC

`workflowEngine` 是 `PtcWorkflowEngine`：工作流脚本通过 `phase()` / `agent()` / `pipeline()` 这些 hook 把子任务 fan-out 出去。

`run_code`（PTC = programmatic tool calling）在 **native 执行器**下不注册——M09.4 打印 `run_code 工具已注册：false` 就是在确认这一点。0.2.2 把执行器拆成了独立包：要启用 PTC，挂 `@deepseek-ai/dsh-tool-executor-ptc`（并保留 `ptc-runtime`），而不是改某个 `tools.mode` 配置——那个字段在 0.2.2 已被移除。

两者不是"新旧"关系：native 模式下模型一次调一个工具，PTC 模式下模型写一段代码调用多个工具。前者简单可审计，后者省 token。本工程选 native，因为教学要看清每一次调用。

## M09.5：为什么没挂 schedule

定时提醒需要长期驻留的定时器，在测试/一次性运行里会干扰进程退出。示例工程不需要它，所以不加——但 README 说明"需要时加 `dsh-schedule` + `dsh-tool-schedule` 两行"。

## 排错

| 现象 | 原因 |
|---|---|
| `hooks.cancel.bind` 报 undefined | `run()` 没返回 `cancel` / `done` |
| `append` 报类型错 | 参数是 `(text, {channel})`，不是 `{data: Buffer}` |
| job 读不到 | owner 不匹配；`list(caller)` / `read(id, caller)` 都按 owner 围栏 |
| `run_code` 不存在 | native 执行器；改挂 `dsh-tool-executor-ptc`（`tools.mode` 已在 0.2.2 移除） |

## 练习

1. 在 M09.1 的 `run` 里追加 100 条大输出，观察 ring 的容量限制与 `lossy` 标记。
2. 把 `owner` 去掉，用另一个 session 去 `read`，看围栏是否生效。
3. 给 M09.2 的目标加 `maxGoalRounds`，观察自动续跑的次数上限。

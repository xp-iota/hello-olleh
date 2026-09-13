# M09 · 长任务与编排

长时间工作至少包含两个正交对象：**Job 是可取消的运行句柄，Goal 是可回放的目标状态机**。

## 学习目标

理解运行状态、任务意图、工作流隔离与耐久调度为何不能塞进一个“任务对象”。

## 运行

```bash
npm run M09
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察什么 |
|---|---|---|---|
| 1 Job registry | 教学主线 | `steps/01-jobs-background.ts` | controller 准入、start/read/kill/wait 与属主隔离 |
| 2 Goal lifecycle | 教学主线 | `steps/02-goal-lifecycle.ts` | 状态推进、revision CAS 与日志折叠 |
| 3 Workflow engine | 扩展面 | `steps/03-workflow-engine.ts` | worker thread 隔离阻塞，但不提供安全沙箱 |
| 4 Schedule | 扩展面 | `steps/04-schedule.ts` | 耐久会话如何承载计划和模型工具 |

## 完整链路

Job 管理当前执行及其输出；Goal 用追加日志表达目的和阶段；workflow engine 提供运行容器；schedule 将计划注册到耐久 Session。属主和 revision 阻止隐式全局写入与并发覆盖。

## 边界

线程隔离只保护事件循环，不等于安全隔离；没有 controller 时 Job 必须拒绝启动。

**结论：**运行句柄与目标状态分离后，恢复、并发控制和故障处置都有明确责任人。

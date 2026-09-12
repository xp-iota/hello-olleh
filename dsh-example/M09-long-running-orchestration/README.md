# M09 · 长任务与编排

本模块合并原 21、22，把长时间工作拆成两个正交对象：**Job 是可取消的运行句柄，Goal 是可回放的目标状态机**。

## 运行

```bash
npm run M09
```

## 两个控制面

| 控制面 | 独立插件 | 能力 |
|---|---|---|
| Job registry | `steps/01-jobs-background.ts` | controller 准入、start/read/kill/wait、增量输出、属主隔离 |
| Goal lifecycle | `steps/02-goal-lifecycle.ts` | create/arm/update/complete/clear、revision CAS、goal/change 日志折叠 |

Job 解决进程或异步任务当前是否还在跑、怎样终止和读取结果；Goal 解决任务意图、阶段、激活状态和并发更新。运行器分别验证无 controller 时拒绝启动、取消后的结算，以及旧 revision 更新被拒、墓碑清除后回放为空。

**结论：**不要用一个“任务对象”混装意图和进程状态；分离后，恢复、并发控制和故障处置都更清晰。


## A4 · 编排服务

- `workflowEngine` 由 worker-thread Provider 实现；线程隔离阻塞，但不是安全沙箱。
- `schedule` 消费耐久 session 日志并为每个 root Agent 注册计划工具。

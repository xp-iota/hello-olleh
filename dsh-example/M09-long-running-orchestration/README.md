# M09 · 长任务与编排

长时间工作至少包含两个正交对象：**Job 是可取消的运行句柄，Goal 是可回放的目标状态机**。

## 学习目标

理解运行状态、任务目标、工作流隔离与持久化调度的职责划分。

## 运行

```bash
npm run M09   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 1 Job registry | 教学主线 | `impl/01-jobs-background.ts` | `scenes/01-job-start-read-kill.ts` | controller 准入、start/read/kill/wait 与属主隔离 |
| 2 Goal lifecycle | 教学主线 | `impl/02-goal-lifecycle.ts` | `scenes/02-goal-cas-conflict.ts` | 状态推进、revision CAS 与日志折叠 |
| 3 Workflow engine | 扩展面 | `impl/03-workflow-engine.ts` | `scenes/03-run-script-in-worker.ts` | worker thread 隔离阻塞，但不提供安全沙箱 |
| 4 Schedule | 扩展面 | `impl/04-schedule.ts` | `scenes/04-attach-schedule.ts` | 耐久会话如何承载计划和模型工具 |

## 完整链路

Job 管理当前执行及其输出；Goal 用追加日志表达目的和阶段；workflow engine 提供运行容器；schedule 将计划注册到耐久 Session。属主和 revision 阻止隐式全局写入与并发覆盖。

## 边界

线程隔离只保护事件循环，不等于安全隔离；没有 controller 时 Job 必须拒绝启动。

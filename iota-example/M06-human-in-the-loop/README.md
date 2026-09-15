# M06 · 人在环路

> **对照关系：语义等价 + 结构性边界**

DSH 把命令、审批、结构化问题、计划模式、todo 与消息反馈都做成显式协议。iota 这边只拥有权限决策这一条，其余归内核或宿主。

对位的 DSH 模块：[M06 人在环路](../../dsh-example/M06-human-in-the-loop/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

看清无人值守时权限如何闭合，以及命令、计划模式、待办与反馈分别归谁。

## 运行

```bash
uv run python -m runtime.runner M06
uv run python M06-human-in-the-loop/run.py
uv run python -m M06-human-in-the-loop.run --scene 01_commands_are_kernel_owned
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M06.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M06.1 斜杠命令由内核自己解析 | `mechanism` | [01_commands_are_kernel_owned.py](scenes/01_commands_are_kernel_owned.py) | 内核声明 `goal_commands`；编排层没有命令注册面 |
| M06.2 权限请求必定得到答复 | `mechanism` | [02_answer_with_configured_policy.py](scenes/02_answer_with_configured_policy.py) | reject 与 allow 两种策略下都返回 `selected` 和明确 optionId |
| M06.3 无匹配选项时 fail closed | `mechanism` | [03_fail_closed_without_option.py](scenes/03_fail_closed_without_option.py) | 只给放行选项而策略是拒绝时抛 `KernelError` |
| M06.4 计划模式归内核或宿主 | `mechanism` | [04_plan_mode_is_host_owned.py](scenes/04_plan_mode_is_host_owned.py) | `AgentConfig` 不伪造 plan_mode 字段 |
| M06.5 todo/kanban 按能力声明归属 | `mechanism` | [05_kanban_is_declared_capability.py](scenes/05_kanban_is_declared_capability.py) | 配置里有 kanban 开关，但当前内核没有声明原生待办工具集 |
| M06.6 消息反馈不在编排层 | `mechanism` | [06_no_message_feedback_seam.py](scenes/06_no_message_feedback_seam.py) | 编排层没有反馈注册面，`Message` 也不带反馈字段 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核自己解析斜杠命令（声明了 `goal_commands`），并在权限策略下作答。 |
| iota 编排层本地断言 | 权限答复、fail-closed 方向、能力声明与字段边界都在本地断言。 |
| 明确不属于 iota | 斜杠命令、计划模式、原生待办工具集与消息反馈都不在编排层。 |

## 完整链路

1. 适配器带着部署时声明的 `permission_policy` 构造，默认 `reject`。
2. `session/request_permission` 按 `kind` 匹配选项：匹配得到就回 `selected`。
3. 匹配不到时报错而不是随便挑一个 —— 随便挑可能变成授予。
4. 命令、计划模式、待办与反馈都在能力声明或宿主一侧，编排层没有对应注册面。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

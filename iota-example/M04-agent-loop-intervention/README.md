# M04 · Agent 循环与干预面

> **对照关系：语义等价 + 结构性边界**

DSH 的干预面是事件、steering 与四种 inbox 通道；iota 的干预面只在节点边界，进行中的一轮属于内核。

对位的 DSH 模块：[M04 Agent 循环与干预面](../../dsh-example/M04-agent-loop-intervention/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。
本模块课件：[第 04 课 · Agent 循环与干预面](../lessons/04-agent-loop-intervention.md)。

## 学习目标

找到编排层能插手的位置：节点 hook 与编译期校验；并确认「往进行中的一轮里插消息」在 iota 不是契约。

## 运行

```bash
uv run python -m runtime.runner M04
uv run python M04-agent-loop-intervention/run.py
uv run python -m M04-agent-loop-intervention.run --scene 01_observe_event_order
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M04.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M04.1 观察一轮的标准事件顺序 | `model` | [01_observe_event_order.py](scenes/01_observe_event_order.py) | `system_init → text_delta → final` 以子序列成立 |
| M04.2 生命周期边界上没有 steering 入口 | `model` | [02_no_mid_turn_steering.py](scenes/02_no_mid_turn_steering.py) | 真实跑完一轮；`AgentConfig`、运行时公开面与事件流里都没有注入入口 |
| M04.3 节点 hook 是唯一干预通道 | `mechanism` | [03_hook_node_result.py](scenes/03_hook_node_result.py) | `after_node_result` 拿到 `succeeded`，整图运行成功 |
| M04.4 捕获运行遥测账本 | `mechanism` | [04_capture_run_telemetry.py](scenes/04_capture_run_telemetry.py) | run_id 由 RunStore 分配，状态与事件可读回 |
| M04.5 未注册引用在编译期被拒 | `mechanism` | [05_compile_rejects_unknown_reference.py](scenes/05_compile_rejects_unknown_reference.py) | 未注册的 `code_handler_ref` 在编译期被点名拒绝 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核在真实循环里产出标准事件流，节点边界之外的过程属于它。 |
| iota 编排层本地断言 | 事件子序列、节点 hook、运行账本与编译期引用校验都在本地断言。 |
| 明确不属于 iota | mid-turn 注入与 steering 不属于编排契约，公开面上也没有对应入口。 |

## 完整链路

1. 真实一轮产出标准事件，`require_event_order` 按子序列校验，允许内核插入自己的事件。
2. hook 与 code handler 按名字注册，图只引用名字；`after_node_result` 在节点边界拿到结果。
3. `RunStore` 按 run_id 记账状态与事件，另一个消费者可以读回。
4. 引用了没注册的 handler，编译当场失败 —— 这是编排层的运行前不变量。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

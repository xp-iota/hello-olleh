# M09 · 长任务与编排

> **对照关系：语义等价（iota 提供更多耐久语义）**

DSH 用 Job、Goal、workflow worker 与 schedule 表达长任务。iota 用带租约、尝试预算与 checkpoint 的任务队列，worker 由调用方驱动。

对位的 DSH 模块：[M09 长任务与编排](../../dsh-example/M09-long-running-orchestration/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

看清长任务需要哪些不在单次运行里的状态：幂等键、租约、尝试次数与恢复序号。

## 运行

```bash
uv run python -m runtime.runner M09
uv run python M09-long-running-orchestration/run.py
uv run python -m M09-long-running-orchestration.run --scene 01_claim_and_ack
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M09.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M09.1 入队、认领与确认 | `mechanism` | [01_claim_and_ack.py](scenes/01_claim_and_ack.py) | worker 取得租约、ack 之后队列保存 succeeded |
| M09.2 幂等键推进任务生命周期 | `mechanism` | [02_enqueue_idempotently.py](scenes/02_enqueue_idempotently.py) | 同一条任务提交两次仍是同一个 task_id |
| M09.3 worker 由调用方驱动 | `mechanism` | [03_worker_is_caller_driven.py](scenes/03_worker_is_caller_driven.py) | 没有 worker 时任务保持 pending；队列没有拉起 worker 的入口 |
| M09.4 checkpoint 记录恢复序列 | `mechanism` | [04_save_checkpoint.py](scenes/04_save_checkpoint.py) | 节点状态与 `sequence` 被显式保存，可读回最新一条 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核只负责单次运行；断点续跑所需的状态不在它手里。 |
| iota 编排层本地断言 | 入队幂等、租约认领、无 worker 时的等待状态与 checkpoint 序号都在本地断言。 |
| 明确不属于 iota | 单次运行内部的重试细节属于内核；拉起 worker 进程属于宿主。 |

## 完整链路

1. `GraphTask` 把幂等键、run_id 与 `max_attempts` 写在数据里。
2. 队列按 task_id 去重，`claim()` 发放带时限的租约。
3. 没有人来 claim，任务就一直 pending —— 队列不自带执行进程。
4. `build_checkpoint()` 保存节点状态与序号，长任务据此从中间恢复。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

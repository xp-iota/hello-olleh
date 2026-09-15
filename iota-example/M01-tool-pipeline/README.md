# M01 · 工具管线

> **对照关系：机制补齐 + 结构性边界**

DSH 的工具管线有注册、pre 裁决、post 变换、按 Agent 收紧和单调守卫五个控制面。iota 这边只有一层具名可逆包装，其余控制面归内核。

对位的 DSH 模块：[M01 工具管线](../../dsh-example/M01-tool-pipeline/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

看清 `ToolPipeline` 能做到哪一步：具名 stage、幂等安装、按身份回收；以及哪几件事必须由内核提供 —— 三态审批协议、per-Agent 可见集合、不可翻案的单调守卫。

## 运行

```bash
uv run python -m runtime.runner M01
uv run python M01-tool-pipeline/run.py
uv run python -m M01-tool-pipeline.run --scene 01_register_and_dispose
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M01.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M01.1 注册包装与 effect 回收 | `mechanism` | [01_register_and_dispose.py](scenes/01_register_and_dispose.py) | 安装报告 installed/missing；重复安装返回 `already` 不叠包装；退出后恢复原 handler 并保留工具注册 |
| M01.2 pre-execute 权限门 | `mechanism` | [02_deny_before_execute.py](scenes/02_deny_before_execute.py) | 包装在调用到达 handler 之前抛拒绝；编排层没有审批注册面，三态协议归内核 |
| M01.3 post-execute 结果变换 | `mechanism` | [03_transform_after_execute.py](scenes/03_transform_after_execute.py) | 包装改写返回值；后装的 stage 在外层，`stages` 声明顺序不自动重排；没有 canonical/content 双通道 |
| M01.4 按 Agent 收紧可见工具 | `mechanism` | [04_no_per_agent_visibility.py](scenes/04_no_per_agent_visibility.py) | `AgentConfig.tools` 只是请求清单；注册面是进程级的，没有 per-Agent 视图，披露由内核裁定 |
| M01.5 单调守卫：只能拒绝，不能放行 | `mechanism` | [05_stages_are_not_monotonic.py](scenes/05_stages_are_not_monotonic.py) | 外层包装把内层拒绝改写成成功 → 不是单调守卫；能被机制拒绝的只有错名 stage |
| M01.d 专项真实演示：内核自主决定调用工具 | `model` | [06_kernel_chooses_tool.py](scenes/06_kernel_chooses_tool.py) | 内核自己决定调用 Bash 算出词数（编排层没有注册这个工具） |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核按自己的工具可见性规则作答，并自己决定调用哪个工具（M01.d 是这条的真实证据）。 |
| iota 编排层本地断言 | stage 安装、幂等、执行前拒绝、包装顺序、错名拒绝与身份安全回收都在本地断言，不依赖模型。 |
| 明确不属于 iota | allow/deny/ask 三态协议、per-Agent 披露收紧、单调守卫语义都不在编排层。 |

## 完整链路

1. `Backend` 提供工具注册表协议，`ToolPipeline` 声明允许安装的 stage 名。
2. `install()` 把包装应用到当前 handler，并向 effect 栈登记 disposer。
3. 包装可以在执行前拒绝，也可以改写返回值；但外层能吞掉内层拒绝 —— 所以单调性不是包装自带的。
4. effect 退出时按 LIFO 回收，且先比身份：外部换过的 handler 不会被覆盖。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

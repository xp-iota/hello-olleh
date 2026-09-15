# M07 · 执行侧后端

> **对照关系：结构性边界**

DSH 有 fs、subprocess、shell、terminal 与 sandbox 五层可换后端。iota 一层都不拥有：副作用由内核执行，编排层只转发并观察事件。

对位的 DSH 模块：[M07 执行侧后端](../../dsh-example/M07-execution-backends/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

用不可猜测的证据确认执行归内核，并看清编排层剩下的两件事：往内核工作目录放输入、读内核回传的工具事件。

## 运行

```bash
uv run python -m runtime.runner M07
uv run python M07-execution-backends/run.py
uv run python -m M07-execution-backends.run --scene 01_kernel_runs_bash
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M07.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M07.1 内核执行副作用 | `model` | [01_kernel_runs_bash.py](scenes/01_kernel_runs_bash.py) | 工具调用 start 事件来自内核进程内部 |
| M07.2 消费工具结果与执行证据 | `model` | [02_kernel_reports_tool_results.py](scenes/02_kernel_reports_tool_results.py) | 至少一条成功工具结果，且本次 token 出现在结果或回答里 |
| M07.3 沙箱策略是内核侧配置 | `mechanism` | [03_sandbox_is_kernel_owned.py](scenes/03_sandbox_is_kernel_owned.py) | 装配层只有 `allow_shell` 一个开关；编排层没有沙箱/策略注册面 |
| M07.4 编排层不注册 shell 工具 | `mechanism` | [04_empty_shell_registry.py](scenes/04_empty_shell_registry.py) | `registry.tools.list()` 为空 —— 这就是边界证据 |
| M07.5 工作目录是唯一输入通道 | `mechanism` | [05_workspace_is_the_only_input.py](scenes/05_workspace_is_the_only_input.py) | 编排层只能往内核 cwd 写文件，没有任何编排层工具参与 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | shell 副作用由内核用自带工具完成，并以工具事件回传；许可模式与工具白名单是内核侧配置。 |
| iota 编排层本地断言 | 工具注册表为空、装配开关只有一个、工作目录是唯一输入通道，这些都在本地断言。 |
| 明确不属于 iota | fs/shell/sandbox/terminal 执行栈都不属于 iota。 |

## 完整链路

1. `plant_token()` 在内核工作目录里写下本次运行独有的 token。
2. iota 只转发提示词，内核用自己的 Bash 工具去读。
3. 工具事件从内核回传，编排层据此观察 start 与 result。
4. 编排层工具注册表始终为空，沙箱策略是适配器构造参数。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

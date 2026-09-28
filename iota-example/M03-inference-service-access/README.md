# M03 · 推理服务接入

> **对照关系：结构性边界**

DSH 的替换单位是 Provider 与流中间件；iota 的替换单位是整个 `KernelAdapter`。编号与 dsh 逐一对齐：M03.1 对位流中间件控制面，M03.d 是专项真实演示。

对位的 DSH 模块：[M03 推理服务接入](../../dsh-example/M03-inference-service-access/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。
本模块课件：[第 03 课 · 推理服务接入](../lessons/03-inference-service-access.md)。

## 学习目标

看清替换粒度与拒绝时机：换内核只换一个适配器；跨进程内核只声明验证过的能力，节点要求兑现不了的能力时在编译期就被拒绝。

## 运行

```bash
uv run python -m runtime.runner M03
uv run python M03-inference-service-access/run.py
uv run python -m M03-inference-service-access.run --scene 01_reject_model_middleware
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M03.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M03.1 包装单次模型调用被编译期拒绝 | `mechanism` | [01_reject_model_middleware.py](scenes/01_reject_model_middleware.py) | 替换单元是 KernelAdapter；ACP 不声明 per_session_middleware；引用它的图编译期被拒 |
| M03.d 专项真实演示：同一事件消费循环接真实内核 | `model` | [02_consume_kernel_stream.py](scenes/02_consume_kernel_stream.py) | 真实事件流的类型统计、finish、usage 与文本样本，消费循环不认供应商 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 切换 MiniMax/Fuyao 只换内核配置这一个替换单元，编排层代码一行未改；事件流按协议回传。 |
| iota 编排层本地断言 | Provider 注册粒度、ACP 能力声明与编译期拒绝在本地断言；事件协议不变量在真实流上核对。 |
| 明确不属于 iota | 单次模型调用的 middleware 属于内核，跨进程内核不声明未验证过的能力。 |

## 完整链路

1. `register_adapter()` 以整个适配器为单位登记 Provider，并返回 disposer。
2. `KernelCapabilities.from_adapter_payload()` 把适配器声明投影成编译器读得懂的能力。
3. 节点引用模型 middleware 时，`GraphCompiler` 在运行前抛 `GraphValidationError`。
4. 同一个事件消费循环接真实内核：`text_delta → final` 的协议不变量在真实流上成立。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

# M12 · 框架机制本体

> **对照关系：语义等价 + 结构性边界**

DSH 展示 Cordis 的五种派发模式、Fiber 状态机、realm 隔离与 intercept 配置链。iota 只借可逆 effect 与注册表，不搬那套架构。

对位的 DSH 模块：[M12 框架机制本体](../../dsh-example/M12-framework-mechanisms/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

看清 iota 借了哪些机制：LIFO 可逆回收、身份安全 disposer、定义期能力校验、标准 entry-point 与配置分层。

## 运行

```bash
uv run python -m runtime.runner M12
uv run python M12-framework-mechanisms/run.py
uv run python -m M12-framework-mechanisms.run --scene 01_dispose_lifo
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M12.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M12.1 effect 按 LIFO 拆除且拒绝复活 | `mechanism` | [01_dispose_lifo.py](scenes/01_dispose_lifo.py) | 后装先拆、重复 dispose 不重复执行、已释放的栈拒绝新 effect |
| M12.2 跨真实运行的 Provider 注册与回收 | `model` | [02_dispose_provider_after_run.py](scenes/02_dispose_provider_after_run.py) | Provider 登记期间内核照常作答，回收后立刻不再在册 |
| M12.3 错名 capability 定义期拒绝 | `mechanism` | [03_reject_unknown_capability.py](scenes/03_reject_unknown_capability.py) | 拼错的 capability 在类定义期抛 `ConfigError` |
| M12.4 同名注册的身份隔离 | `mechanism` | [04_identity_safe_disposer.py](scenes/04_identity_safe_disposer.py) | 旧 disposer 不删除覆盖后的新值 |
| M12.5 配置按层叠加 | `mechanism` | [05_layer_agent_config.py](scenes/05_layer_agent_config.py) | 调用点覆盖装配默认，`extra` 保留各层自己的键 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核可整体替换，替换动作本身走可逆 effect，登记期间照常作答。 |
| iota 编排层本地断言 | LIFO 拆除、幂等 dispose、失效后拒绝、身份安全回收、能力校验与配置叠加都在本地断言。 |
| 明确不属于 iota | Cordis 的事件总线、Proxy Context 与运行期热替换不属于 iota。 |

## 完整链路

1. `EffectStack` 按 LIFO 拆除，dispose 幂等，失效后拒绝新 effect。
2. 注册表 disposer 先比身份再删除，覆盖后的值不会被旧 disposer 带走。
3. `provides` 在类定义期校验，Provider 通过标准 entry-point group 发现。
4. 配置分层：装配给默认值，调用点覆盖，`extra` 各层互不覆写。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

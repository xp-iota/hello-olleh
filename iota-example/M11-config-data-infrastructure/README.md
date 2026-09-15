# M11 · 配置与数据设施

> **对照关系：语义等价 + 结构性边界**

DSH 有 settings、storage domain、attachment、file reference、credential 与 workspace 六层。iota 治理配置投影与存储协议，凭证与附件归宿主。

对位的 DSH 模块：[M11 配置与数据设施](../../dsh-example/M11-config-data-infrastructure/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。

## 学习目标

看清哪些配置与数据由 iota 治理：profile 投影成真实文件、存储按协议分层；以及凭证只来自环境、附件不进 `AgentConfig`。

## 运行

```bash
uv run python -m runtime.runner M11
uv run python M11-config-data-infrastructure/run.py
uv run python -m M11-config-data-infrastructure.run --scene 01_project_config_profile
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M11.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M11.1 配置投影成真实文件 | `mechanism` | [01_project_config_profile.py](scenes/01_project_config_profile.py) | profile 生成的配置文件真实存在 |
| M11.2 运行存储按协议读写 | `mechanism` | [02_route_run_store.py](scenes/02_route_run_store.py) | run_id 由 RunStore 分配，状态按协议更新 |
| M11.3 凭证与附件归宿主 | `mechanism` | [03_credentials_are_host_owned.py](scenes/03_credentials_are_host_owned.py) | `AgentConfig` 不伪造 credential/attachment 字段 |
| M11.4 投影目录布局可检查 | `mechanism` | [04_inspect_projected_layout.py](scenes/04_inspect_projected_layout.py) | 投影目录里的条目可以列举检查 |
| M11.5 凭证只来自环境配置 | `mechanism` | [05_credentials_come_from_env.py](scenes/05_credentials_come_from_env.py) | 装配报告里没有凭证字段，凭证项是声明过的配置 |
| M11.6 不支持的布局明确拒绝 | `mechanism` | [06_reject_unsupported_layout.py](scenes/06_reject_unsupported_layout.py) | 不支持 iota-managed 布局的内核抛 `ConfigError` |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核在本次配置投影下真实启动并作答，读的是投影出来的那份文件。 |
| iota 编排层本地断言 | 投影文件存在、目录布局可检查、存储协议可换、不支持布局被拒绝都在本地断言。 |
| 明确不属于 iota | 凭证与附件归宿主，`AgentConfig` 不伪造这些字段。 |

## 完整链路

1. `settings_source()` 写下一份来源配置。
2. `ConfigProfileManager.prepare()` 按适配器投影出真实文件与目录。
3. 运行存储与会话存储是两条协议，各自可换。
4. 凭证只从环境/.env 读取，装配报告里不带凭证本体。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

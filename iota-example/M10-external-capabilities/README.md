# M10 · 外部能力接入

> **对照关系：语义等价**

DSH 有 Skill、跨进程 MCP、Webhook Host plane、动态 Cordis 扩展与默认模型路由。iota 这边 Skill 是文件投影、MCP 是协议、Host plane 归宿主。

对位的 DSH 模块：[M10 外部能力接入](../../dsh-example/M10-external-capabilities/README.md)。阶段编号与它逐一对齐 ——
同一个编号指向同一个控制面，看 iota 这边是"有等价机制"还是"能力归内核/宿主"。
本模块课件：[第 10 课 · 外部能力接入](../lessons/10-external-capabilities.md)。

## 学习目标

区分三条接入路径：数据资产（Skill）、工具协议（MCP）、运行时注册（工具与模型路由）；并看清宿主平面不在编排层。

## 运行

```bash
uv run python -m runtime.runner M10
uv run python M10-external-capabilities/run.py
uv run python -m M10-external-capabilities.run --scene 01_sync_filesystem_skill
```

日志骨架与 dsh 一致：模块 banner + `provider=… model=… timeout=…ms` → 每阶段
`──── M10.n · 标题 ────` + 观察到的事实 + `REAL_STAGE_OK` → 模块末行 `REAL_MODULE_OK`。
`mechanism` 阶段在跑本地断言之前先用完整装配链打一次真实内核 probe，`model` 阶段由场景自己
调用内核；任一阶段没有真实调用证据即 `REAL_STAGE_FAIL`。

## 实现与场景

| 阶段 | 类型 | 场景脚本 | 观察什么 |
|---|---|---|---|
| M10.1 同步文件系统 Skill | `mechanism` | [01_sync_filesystem_skill.py](scenes/01_sync_filesystem_skill.py) | `sync_skills()` 按名字报告被投影的 Skill |
| M10.2 进程内 MCP 往返 | `mechanism` | [02_mcp_round_trip.py](scenes/02_mcp_round_trip.py) | `tools/list` 列出 greet，`tools/call` 返回 `hello iota` |
| M10.3 Host plane 不在编排层 | `mechanism` | [03_host_plane_is_not_orchestrated.py](scenes/03_host_plane_is_not_orchestrated.py) | Registry 的注册面里没有 webhook/upload/http 这类宿主能力 |
| M10.4 运行时装配工具并回收 | `mechanism` | [04_register_tool_at_runtime.py](scenes/04_register_tool_at_runtime.py) | 运行时注册的工具在册，effect 退出后被回收 |
| M10.5 默认模型路由 | `mechanism` | [05_default_model_routing.py](scenes/05_default_model_routing.py) | 默认模型来自当前装配，显式模型覆盖默认 |
| M10.d 专项真实演示：同一请求在注入格式约定前后的真实作答 | `model` | [06_prompt_changes_answer.py](scenes/06_prompt_changes_answer.py) | 同一问题：注入格式约定前后的真实作答对照 |

## 三类边界

| 分类 | 内容 |
|---|---|
| Anthropic 兼容内核行为 | 内核读投影进来的 Skill 与系统提示后作答 —— 换的是数据，不是主循环。 |
| iota 编排层本地断言 | Skill 同步、MCP 往返、运行时注册与回收、默认模型路由都在本地断言。 |
| 明确不属于 iota | webhook、上传、UI 这些宿主能力没有编排层注册面。 |

## 完整链路

1. Skill 是数据：写进文件系统就能被发现并投影进内核 home。
2. MCP server 在进程内注册工具，`tools/list` 与 `tools/call` 按协议往返。
3. 工具可以运行时注册，disposer 交给 effect 栈按 LIFO 回收。
4. 每个 agent 都带显式模型出场；换数据（系统提示）就能改变真实作答格式。

实现位置与架构决策见[逐模块对照表](../docs/dsh-vs-iota.md)。

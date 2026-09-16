# 第 10 课 · 外部能力接入：Skill、MCP 与运行时扩展

> **本课任务**：分清三条接入外部能力的路径——数据资产（Skill）、工具协议（MCP）、运行时注册
> （工具与模型路由）；并用一条负证据确认 webhook、上传、HTTP 这类宿主能力在编排层没有注册面：
> Host plane 归宿主。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M10`
> **你将看到**：`copied = [demo-greeter]`——写进文件系统的 SKILL.md 被按名字投影；
> `host_surface = []`——Registry 的十二个注册面里没有一个是宿主能力；M10.d 里同一句
> `3 加 4 等于多少？`，A 组答 `without_convention = 3 + 4 = 7`，B 组答
> `with_convention = 结论：3 加 4 等于 7。`。

前置：[第 09 课 · 长任务与编排](09-long-running-orchestration.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/10-external-capabilities.md](../../dsh-example/lessons/10-external-capabilities.md)——那边讲"数据优先，协议其次"，本课讲 iota 的三条接入路径与宿主平面的边界。

---

## 1. 本课任务

DSH 的 M10 演了五件外部能力：Skill、跨进程 MCP、Webhook Host plane、动态 Cordis 扩展、默认模型
路由。iota 把它们收进**三条接入路径**，对照关系是**语义等价**——逐模块对照与源码符号见
[`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md)：

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| Skill：注册进 `ctx.skills` 再渲染注入的数据资产 | **数据资产**：`sync_skills()` 文件投影——SKILL.md 写进源目录，按名字复制进内核 home（M10.1） | 语义等价：Skill 是数据 |
| 跨进程 MCP：`dsh-mcp-client` 拉起 stdio server 并同步工具 | **工具协议**：`IotaMcpServer` 进程内 JSON-RPC——同一套 `tools/list` / `tools/call`（M10.2） | 语义等价：边界在协议，不在进程 |
| 动态 Cordis 扩展：运行时执行面 + 暴露成模型工具 | **运行时注册**：`registry.tools.register()` 返回 disposer，交 effect 栈按 LIFO 回收（M10.4） | 语义等价：能力运行期加入且生命周期受管 |
| 默认模型路由：`agentDefaultModel` 供 Webhook 建 Agent | 装配的 `harness.model` 作默认，`AgentConfig.model` 显式覆盖（M10.5） | 语义等价：默认模型来自当前装配 |
| Webhook Host plane：宿主进程提供六项依赖 | 没有——`Registry` 的注册面里没有 webhook/upload/http（M10.3） | **结构性边界**：Host plane 归宿主 |

```bash
cd iota-example && uv run python -m runtime.runner M10
```

---

## 2. 真实输出

```text
████ M10 · 外部能力接入：Skill、MCP 与运行时扩展 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M10.1 · 同步文件系统 Skill ────
   copied = [demo-greeter]
   asset = SKILL.md
REAL_STAGE_OK M10.1 calls=1 ms=4370 in=12239 out=10 finish=success

──── M10.2 · 进程内 MCP 往返 ────
   tools = [greet]
   call_result = hello iota
   transport = in-process
REAL_STAGE_OK M10.2 calls=1 ms=3433 in=12240 out=10 finish=success

──── M10.3 · Host plane 不在编排层 ────
   registry_facets = [agent_specs, code_handlers, graphs, mcps, model_profiles, node_hooks, node_middlewares, service_facades, skill_actions, skills, tools, toolsets]
   host_surface = []
   host_plane_owner = host application
REAL_STAGE_OK M10.3 calls=1 ms=27093 in=12240 out=10 finish=success

──── M10.4 · 运行时装配工具并回收 ────
   registered = [m10-echo]
   after_dispose = []
REAL_STAGE_OK M10.4 calls=1 ms=779 in=12239 out=10 finish=success

──── M10.5 · 默认模型路由 ────
   assembly_model = fuyao-coding
   default_agent_model = fuyao-coding
   explicit_agent_model = explicit-model
REAL_STAGE_OK M10.5 calls=1 ms=2007 in=12240 out=10 finish=success

──── M10.d · 专项真实演示：同一请求在注入格式约定前后的真实作答 ────
   without_convention = 3 + 4 = 7
   with_convention = 结论：3 加 4 等于 7。
   changed_by = data (system prompt), not the loop
REAL_STAGE_OK M10.d calls=2 ms=4134 in=24463 out=23 finish=success "结论：3 加 4 等于 7。"

REAL_MODULE_OK M10 stages=6 calls=7 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M10 stages=6 calls=7 failed=0`。`calls=7` 的账很好算：
五个 `mechanism` 阶段各打一次真实内核 probe，M10.d 的 A/B 两组各发起一次真调用（`calls=2`）；
核心证据就是 M10.d 的那两行作答（第 7 节展开）。真实日志里每个阶段还会夹一行
`[claude-code:unrecognized_model] {"model":"fuyao-coding","query_source":"sdk"}`——不是错误（见
[第 00 课](00-getting-started.md)第 7 节），本课引用时省略；`ms=` 与 `in=` 随端点速度浮动。

---

## 3. Skill 是数据：写进文件系统，投影进内核 home

打开 [`impl/skill_source.py`](../M10-external-capabilities/impl/skill_source.py) 与
[`scenes/01_sync_filesystem_skill.py`](../M10-external-capabilities/scenes/01_sync_filesystem_skill.py)。
资产本体只有两行——frontmatter 里一个 `name:`，正文一行标题：

```python
SKILL_NAME = "demo-greeter"
SKILL_BODY = f"---\nname: {SKILL_NAME}\n---\n# Demo greeter\n"
```

`write_skill()` 把这份正文写进 `root/source/greeter/SKILL.md`，返回可同步的源目录；场景随后
只调一个函数：

```python
with TemporaryDirectory(prefix="iota-m10-") as temp:
    root = Path(temp)
    report = sync_skills(write_skill(root), hermes_home=root / "kernel-home", quiet=True)
require(report["copied"] == [SKILL_NAME], "同步一个文件系统 Skill", report)
```

对应日志两行事实：`copied = [demo-greeter]`、`asset = SKILL.md`。链路里没有出现任何"注册"
调用——`sync_skills()` 用 `rglob("SKILL.md")` 扫描源目录（跳过 `.git` / `.github` / `.hub`），
skill 名读的是 frontmatter 的 `name:`，然后把整个 skill 目录复制进 `{hermes_home}/skills/`
——内核 home 的 skills 目录。impl 的模块注释就是判据原文："Skill 是**数据**：写进文件系统就能
被发现、被投影给内核，内容变化不需要改任何机制代码。"

目标侧还有一份 manifest 记录每个 skill 的源哈希——**新 skill 复制；源变了且用户没动过就更新；
用户手改过的跳过；用户删掉的尊重，不再加回来**：改一份 Markdown 就能扩展知识，但不会吞掉用户
目录里的手工修改（排障展开见第 8 节）。与 DSH 的结构差别：DSH 把 SKILL.md 放在 `assets/`，用
`ctx.skills.register()` 注册进控制面（`provider = runtime`）再渲染注入 `inbox.nextStep`；iota
连注册都不经过——`Registry` 里虽有 `skills` 这个名字（第 5 节会看到全部十二个面），本阶段演示
的是更彻底的数据路径：文件从源目录直达内核 home，发现权在文件系统。

> **原理对照**：`iota-core/src/iota_core/skill_sync.py::def sync_skills`。
> DSH 侧等价物是 `ctx.skills.register()` + filesystem provider（见 dsh 第 10 课第 4 节）——
> 两边都把 Skill 当数据；差别在 DSH 注册进控制面再渲染注入，iota 直接把文件投影进内核 home。

---

## 4. MCP 是协议：进程内的完整往返

打开 [`impl/mcp_server.py`](../M10-external-capabilities/impl/mcp_server.py) 与
[`scenes/02_mcp_round_trip.py`](../M10-external-capabilities/scenes/02_mcp_round_trip.py)。
impl 的第一段注释就是设计意图，值得逐字读：

```text
外部能力接入的边界在协议上：同一套 `tools/list` / `tools/call` 消息，换成跨进程 server 也成立，
所以示例不需要网络就能观察完整往返。
```

server 侧注册一个 `greet` 工具，`request()` 把消息拼装成普通 dict
（`{"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}`）：

```python
server = IotaMcpServer(name="m10-server", version="1.0.0")
server.register_tool(
    ToolDef(
        name=TOOL,
        description="Return a greeting",
        input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
    ),
    lambda arguments: f"hello {arguments['name']}",
)
```

场景侧把两种消息各发一次，再从响应 dict 里取结果：

```python
listed = require_not_none(
    await server.handle_message(request("tools/list", {})), "MCP tools/list 返回响应"
)
called = require_not_none(
    await server.handle_message(
        request("tools/call", {"name": TOOL, "arguments": {"name": "iota"}}, request_id=2)
    ),
    "MCP tools/call 返回响应",
)
names = [tool["name"] for tool in listed["result"]["tools"]]
text = called["result"]["content"][0]["text"]
require(names == [TOOL], f"MCP 列出 {TOOL} 工具", listed)
require(text == "hello iota", "MCP 调用返回问候", called)
```

对应日志三行事实：`tools = [greet]`、`call_result = hello iota`、`transport = in-process`。
为什么进程内能算"协议往返"？因为 `handle_message` 本来就是一个普通的 `dict -> dict | None`
函数，`serve_stdio` 只是架在它上面的一层薄传输；iota-core 里 `IotaMcpServer` 的承诺：三个
方法（`initialize`、`tools/list`、`tools/call`）、换行分隔的 JSON-RPC 2.0、未知方法回
"method not found" 而不是沉默、`register_tool` 遇重名直接抛错——静默覆盖会让两个能力共用
一个名字、由导入顺序决定胜负。

与 DSH 的方向差异：DSH M10.2 是编排层**消费**外部 MCP server（拉起真实 stdio 子进程，把工具
同步进 `ctx.tools`）；iota 的 `IotaMcpServer` 是**发布**侧——iota-core 的模块文档说：对任何
进程外的内核，MCP 是 iota 工具能过去的唯一通道。同一套协议，两个方向。

> **原理对照**：`iota-core/src/iota_core/mcp/server.py::class IotaMcpServer`。
> DSH 侧是 `dsh-mcp-client` 插件与 stdio 子进程（见 dsh 第 10 课第 6 节）——两边共用同一套
> JSON-RPC 消息；差一个方向：DSH 用它消费外部工具，iota 用它发布自己的工具。

---

## 5. 负证据：Host plane 不在编排层

打开 [`scenes/03_host_plane_is_not_orchestrated.py`](../M10-external-capabilities/scenes/03_host_plane_is_not_orchestrated.py)，
整个场景的核心是四行：

```python
HOST_WORDS = ("webhook", "upload", "http", "server", "desktop", "web")

facets = sorted(vars(Registry()))
host_surface = sorted(name for name in facets if any(word in name for word in HOST_WORDS))
require(host_surface == [], "编排层没有 Host plane 注册面", host_surface)
```

`vars(Registry())` 枚举出注册面的全部十二个名字，日志原样打印：

```text
   registry_facets = [agent_specs, code_handlers, graphs, mcps, model_profiles, node_hooks, node_middlewares, service_facades, skill_actions, skills, tools, toolsets]
```

逐个看，每个面都是"把定义登记进图编译"的面——工具、MCP server 配置（`mcps`，交给内核的连接
配置）、skill 声明、图、hook、middleware；用六个宿主词过滤，`host_surface = []`，而
`host_plane_owner = host application` 把归属写进日志。两点值得强调：

- **负证据写法**：断言的是"不存在"，与[第 01 课](01-tool-pipeline.md)的 `approval_surface = []`
  同一种方法——先枚举全部面，再用关键词证明目标面不在其中。
- **对照 DSH**：DSH M10.3 检查 webhook runtime 的六项宿主依赖，如实报告 `loaded: false`——
  宿主面存在，但依赖归宿主进程给；iota 更进一步：编排层的 `Registry` 根本没有这个面，
  也不打算有。

---

## 6. 运行时注册与默认模型：能力可以后装，且必须可回收

### M10.4：注册一个工具，退出时回收

[`scenes/04_register_tool_at_runtime.py`](../M10-external-capabilities/scenes/04_register_tool_at_runtime.py)
的 docstring 先把机制说完："工具可以在进程里注册进来，disposer 交给 effect 栈按 LIFO 回收"：

场景先用 `ToolDef(name="m10-echo", …)` 定义一个工具，然后把它挂进 effect 栈：

```python
with EffectStack("m10-runtime-tool") as effects:
    effects.push(harness.registry.tools.register(tool.name, tool), f"tool:{tool.name}")
    listed = harness.registry.tools.list()
    require(listed == [tool.name], "运行时注册的工具在册", listed)
require(harness.registry.tools.list() == [], "effect 退出后工具被回收")
```

`registry.tools.register()` 返回 disposer，`effects.push(disposer, label)` 把它挂进 effect 栈，
`with` 退出时按 LIFO 回收——日志两行事实：`registered = [m10-echo]` → `after_dispose = []`。
这与第 01 课的 `ToolPipeline.install()` 是同一条纪律：**注册必须挂在可逆资源上**。对照 DSH
M10.4 的动态 Cordis 扩展（`DynamicCordisRunnerService` 执行面 + 七个 `cordis_*` 工具）：iota
没有动态插件执行面，对位物是"运行期往 Registry 登记工具定义"——等价点相同：能力可以在
运行期加入，且生命周期受管。

### M10.5：默认模型来自当前装配

[`scenes/05_default_model_routing.py`](../M10-external-capabilities/scenes/05_default_model_routing.py)：

```python
default_agent = harness.agent(name="m10-default")
pinned = harness.agent(name="m10-pinned", model="explicit-model")
require(
    default_agent.config.model == harness.model,
    "默认模型来自当前装配",
    default_agent.config,
)
require(pinned.config.model == "explicit-model", "显式模型覆盖默认", pinned.config)
```

日志三行事实把覆盖关系摆平：`assembly_model = fuyao-coding`、
`default_agent_model = fuyao-coding`、`explicit_agent_model = explicit-model`。默认值来自装配
——`harness.agent()` 的实现就是 `config.setdefault("model", self.model)`；显式传 `model=` 则
覆盖。场景 docstring 是这条纪律：**"每个 agent 都带着显式模型出场，装配不留'由内核随便挑'的
空档"**——第 00 课见过它的另一半：三档默认模型别名统一指向配置的模型，防止内核悄悄挑一个
自带的默认。对照 DSH M10.5 的 `agentDefaultModel`（Webhook 建 Agent 用的路由，只存路由不存
密钥）：iota 的默认模型是装配属性，随每个 `AgentConfig` 显式出场。

---

## 7. M10.d：A/B 对照——换的是数据，不是主循环

打开 [`scenes/06_prompt_changes_answer.py`](../M10-external-capabilities/scenes/06_prompt_changes_answer.py)。
两组跑的是**同一个问题、同一个模型、同一个主循环**，唯一差别是 B 组 agent 多带一份系统提示：

```python
QUESTION = "3 加 4 等于多少？"
VERDICT = "结论："
CONVENTION = f"回答必须以 {VERDICT} 开头，然后只写一句话。"

plain = await harness.runtime.run(harness.agent(name="m10-plain"), QUESTION)
guided = await harness.runtime.run(
    harness.agent(name="m10-guided", system_prompt=CONVENTION), QUESTION
)
```

场景开头的注释把设计意图钉死了：**"问题刻意与外部信息无关：两组唯一的差别是那份被注入的
数据，而不是模型要不要去查资料。"**判分也不是靠肉眼：

```python
require(bool(plain_text), "A 组拿到真实回答", plain_text)
require(bool(guided_text), "B 组拿到真实回答", guided_text)
require(guided_text.startswith(VERDICT), "注入的数据改变了作答格式", guided_text)
```

真实作答对照（`sample(..., 60)` 截取）：

```text
   without_convention = 3 + 4 = 7
   with_convention = 结论：3 加 4 等于 7。
   changed_by = data (system prompt), not the loop
```

A 组是模型自己的习惯写法；B 组逐字服从了注入的格式约定。`REAL_STAGE_OK M10.d calls=2`——
A、B 各一次真实调用，正好是模块总账 `calls=7` 里的最后两个；若模型不守约，`startswith(VERDICT)`
会让阶段 fail loud——A/B 对照不是抽查，是验收。与 DSH 同编号阶段对照：**相同**的是证据形态
——两组唯一差异是一份数据，可观察行为改变了，主循环一行没动；**不同**的是注入位置——DSH 把
SKILL.md 正文经 `agent.inject()` 排进 `inbox.nextStep`，iota 能控制的是装配数据里的系统提示
（`system_prompt=`）。落点不同，证明的是同一条判据：**能用一份数据表达的能力，不需要动机制**
——场景 docstring 的收尾就是本课结论："换的是数据，不是主循环，也不是模型。"

---

## 8. 排障：能力"挂不上"，或"不生效"

### 症状

两种最典型的困惑：① 想给编排层挂一个 webhook / 上传 / HTTP 入口，翻遍 API 找不到该调谁；
② 写了一份 SKILL.md，同步完内核那边像没见过一样。

### 定位

① 先跑 `uv run python -m runtime.runner M10 --scene 03_host_plane_is_not_orchestrated`，
看 `host_surface = []` 和十二个 `registry_facets`：全是"登记定义"的面，没有一个开进程、收 HTTP。

② 看 `sync_skills()` 的返回报告——六组键：`copied` / `updated` / `skipped` / `user_modified` /
`cleaned` / `total_bundled`（场景只断言 `copied`，REPL 里直接调它能看到全量）。三种最常见的
"没生效"：

- **名字不对**：skill 名读的是 frontmatter 的 `name:`，读不到才回退目录名——先查 frontmatter；
- **位置不对**：目标是 `{hermes_home}/skills/`，`hermes_home` 不传时用 `~/.hermes`（或
  `$HERMES_HOME`）——内核读的是它自己的 home，两边的 home 不是同一个目录；
- **被保护跳过**：目标侧副本被你手改过（进 `user_modified`），或曾被你删除（进 `skipped`，
  尊重删除、不再加回来）——manifest 记录的哈希说了算。

### 原因与修改

① 这不是 bug，是边界。webhook、上传、UI 是宿主平面的能力：DSH 那边由宿主进程提供六项依赖
（dsh 第 10 课 7.1 的 `loaded: false` 是如实的组合边界声明）；iota 这边连依赖声明都没有——
`Registry` 上没有这个面，将来也不会有。修改方向：把 webhook 服务写进**宿主应用**（你自己的
进程），让它作为 iota 的使用者驱动编排层；不要试图给 `Registry` 补一个 `webhook` 属性绕过边界。

② 修改全在数据侧：改 frontmatter 的 `name:`；把 `hermes_home` 指到内核真正读取的 home；
删掉目标目录里被改坏的副本再重新同步。manifest 的保护语义（新→复制、源变且用户未动→更新、
用户手改→跳过、用户删除→尊重）是刻意的：**它宁可跳过，也不覆盖你的手工修改**。

---

## 9. 代码在哪

```bash
cd iota-example && ls M10-external-capabilities/impl M10-external-capabilities/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/skill_source.py`](../M10-external-capabilities/impl/skill_source.py) | `SKILL_BODY` 的 frontmatter；`write_skill()` 现场生成可同步的源目录 |
| [`impl/mcp_server.py`](../M10-external-capabilities/impl/mcp_server.py) | `greeter_server()` 注册 `greet`；`request()` 造 JSON-RPC 消息 |
| [`scenes/01_sync_filesystem_skill.py`](../M10-external-capabilities/scenes/01_sync_filesystem_skill.py) | `sync_skills()` 报告按名字断言 |
| [`scenes/02_mcp_round_trip.py`](../M10-external-capabilities/scenes/02_mcp_round_trip.py) | `tools/list` 与 `tools/call` 的协议往返 |
| [`scenes/03_host_plane_is_not_orchestrated.py`](../M10-external-capabilities/scenes/03_host_plane_is_not_orchestrated.py) | `vars(Registry())` 负证据与宿主词表 |
| [`scenes/04_register_tool_at_runtime.py`](../M10-external-capabilities/scenes/04_register_tool_at_runtime.py) | `registry.tools.register()` + effect 栈 LIFO 回收 |
| [`scenes/05_default_model_routing.py`](../M10-external-capabilities/scenes/05_default_model_routing.py) | 装配默认模型与显式覆盖 |
| [`scenes/06_prompt_changes_answer.py`](../M10-external-capabilities/scenes/06_prompt_changes_answer.py) | A/B 对照；`system_prompt=CONVENTION` 是两组唯一差异 |
| [`run.py`](../M10-external-capabilities/run.py) | 阶段清单：五个 `mechanism` + 一个 `model` |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言（`require(…)`）就是这一
阶段的"可验证答案"。与 dsh 侧不同，这里没有 `assets/` 目录——SKILL.md 由 `write_skill()`
现场生成，因为 M10.1 要演示的本来就是"文件系统上的一份文件就能被发现"。

---

## 10. 动手练习

### 练习 A：给 Skill 换名字

把 [`impl/skill_source.py`](../M10-external-capabilities/impl/skill_source.py) 里的 `SKILL_NAME`
改成 `"demo-greeter-2"`（只改这一行），重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M10 --scene 01_sync_filesystem_skill
```

**可验证答案**：`copied = [demo-greeter-2]`——名字来自 frontmatter 数据，场景断言用的是同一个
变量，机制代码一行没动。这就是"Skill 是数据"的最小闭环。

### 练习 B：让 A/B 判分跟着数据走

把 [`scenes/06_prompt_changes_answer.py`](../M10-external-capabilities/scenes/06_prompt_changes_answer.py)
里的 `VERDICT` 改成 `"答案："`，重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M10 --scene 06_prompt_changes_answer
```

**可验证答案**：`with_convention = 答案：3 加 4 等于 7。`——注入的约定文本与
`startswith(VERDICT)` 判分用的是同一个变量，改一处数据，注入与验收一起变；A 组答案不受影响。
若模型偶尔不守约定，阶段会 fail loud——这正是 M10.d 用断言而不是肉眼对照的原因。

---

**下一课** → [第 11 课 · 配置与数据设施](11-config-data-infrastructure.md)：M10 证明了"换数据就能改变行为"——下一课看这份数据本身如何被分层治理，凭证为什么永远不进编排层。

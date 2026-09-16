# 第 08 课 · 委派与预设：显式 DAG、空 roster 与模型路由

> **本课任务**：看清 iota 的委派为什么从编译期就是确定的——handler 与 agent_spec 按名字注册、
> `compile_graph()` 冻结拓扑顺序、绑定充当节点间的数据通道、模型路由解析到具名 `ModelProfile`；
> 再对照 DSH 的反直觉结论：注册了 provider，模型却还不会委派。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M08`
> **你将看到**：`topological_order = [research, review]` 在任何节点运行之前就编译出来；
> 装配刚结束 roster 就是空的（`roster_after_assembly = []`，
> `discovery = explicit registration only`）；整图跑完后
> `review_output = {approved: research:iota}`——review 拿到的是 research 的产出。

前置：[第 07 课 · 执行侧后端](07-execution-backends.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见
[dsh-example/lessons/08-delegation-presets.md](../../dsh-example/lessons/08-delegation-presets.md)——那边讲"注册了 provider，模型却还不会委派"，本课讲 iota 的委派为什么从编译期就是确定的。

---

## 1. 本课任务

M08 回答一个问题：**"委派发生在哪一层？"** DSH 的答案是"注册面 + 模型的自由决策"——
provider、preset 与模型路由都注册好了，委派却仍然是模型看见工具后自己决定的事。iota 的答案是
**显式 DAG**：委派对象、执行顺序、数据流向与模型路由全部按名字写出来，`compile_graph()` 在
任何节点运行之前逐一核验。四个阶段各拆一层：

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| subagent Provider：注册"怎么跑"，再包成模型可见工具——委派与否由模型当场决定（M08.1） | 显式 DAG：handler 按名字注册进 `Registry`，`depends_on` 定顺序、`input_bindings` 定数据流（M08.1 / M08.3） | **语义等价**：委派从"模型可能调用"变成"图一定执行" |
| agentPreset：服务照常装载，但不扫任何目录（M08.2） | `Registry.agent_specs`：装配后 roster 为空，显式注册才在册，回收后回到空（M08.2） | **语义等价**：两边都是 explicit registration only |
| permissionPreset：只接受能真实 confine 的 shell（M08.3） | 本模块没有对位阶段——iota 侧的权限决策在第 06 课（人在环路）展开 | 归第 06 课口径：适配器带 `permission_policy` 构造，本课不重复 |
| modelSelection：授权精确 provider/model 对（M08.4） | 具名 `ModelProfile`：节点按名字引用，编译期解析，回收后立刻不在册（M08.4） | **语义等价**：路由单位是声明出的条目，不是散落的模型名 |

```bash
cd iota-example && uv run python -m runtime.runner M08
```

---

## 2. 真实输出

```text
████ M08 · 委派与预设：显式 DAG、空 roster 与模型路由 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M08.1 · 注册委派节点并编译顺序 ────
   topological_order = [research, review]
REAL_STAGE_OK M08.1 calls=1 ms=5604 in=12240 out=65 finish=success

──── M08.2 · 不扫描用户目录的空 roster ────
   roster_after_assembly = []
   roster_after_register = [m08-reviewer]
   discovery = explicit registration only
REAL_STAGE_OK M08.2 calls=1 ms=7573 in=12240 out=124 finish=success

──── M08.3 · 委派图运行与上游绑定 ────
   graph_status = succeeded
   review_output = {approved: research:iota}
   binding = $nodes.research.output
REAL_STAGE_OK M08.3 calls=1 ms=2423 in=12240 out=10 finish=success

──── M08.4 · 具名模型路由 ────
   profile = m08-reviewer-model
   model = fuyao-coding
   request_overrides = {temperature: 0}
REAL_STAGE_OK M08.4 calls=1 ms=1117 in=12240 out=10 finish=success

REAL_MODULE_OK M08 stages=4 calls=4 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M08 stages=4 calls=4 failed=0`。四个阶段都是
`mechanism`：每阶段先用完整装配链打一次真实内核 probe（`calls=1` 就是它的证据），本地断言才
决定结论。`ms=` 与 `in=` 随端点速度浮动，不影响结论。`[claude-code:unrecognized_model]` 行是
内核 CLI 对不在它模型目录里的名字的保守提示（第 00 课已解释），本课省去。

---

## 3. 委派写成图：handler 在册，图只引用名字

打开 [`impl/delegation_graph.py`](../M08-delegation-presets/impl/delegation_graph.py) 与
[`scenes/01_compile_topological_order.py`](../M08-delegation-presets/scenes/01_compile_topological_order.py)。
场景只做三件事：注册 handler、注册图、编译并断言顺序：

```python
install_handlers(harness.registry)
ref = harness.runtime.register_graph(delegation_graph("m08-order"), overwrite=True)
plan = await harness.runtime.compile_graph(ref, agent=harness.agent(name="m08-order"))
require(
    plan.topological_order == ("research", "review"),
    "拓扑顺序为 research→review",
    plan.topological_order,
)
```

handler 是两个本地函数，按名字注册进 `Registry.code_handlers`；图本身长这样：

```python
return GraphSpec(
    name=name,
    version="1.0.0",
    nodes=[
        NodeSpec(
            node_id="research",
            executor_type="code",
            code_handler_ref=RESEARCH,
            input_bindings={"topic": "$input.topic"},
        ),
        NodeSpec(
            node_id="review",
            executor_type="code",
            code_handler_ref=REVIEW,
            depends_on=["research"],
            input_bindings={"draft": "$nodes.research.output"},
        ),
    ],
    outputs={"review": "$nodes.review.output"},
)
```

三个性质直接对上 M08.1 的事实行 `topological_order = [research, review]`：

- **图只引用名字**：`code_handler_ref=RESEARCH` 是字符串 `"m08-research"`，不是 Python
  callable。GraphSpec 从不携带函数——图定义因此保持可序列化，也不能往运行里走私代码。名字必须
  先在册：编译期会解析每个引用，`m08-research` 不在 `Registry.code_handlers` 里，就在这一步
  抛错。
- **顺序写在图里**：review 的 `depends_on=["research"]` 是唯一的顺序信息，编译把它排成
  `("research", "review")`。这一行在**任何节点运行之前**就检查完毕。
- **计划是冻结的**：`compile_graph()` 的产物是 frozen execution plan——名字、依赖、绑定、能力
  声明全部在编译期校验，不进运行期。

> **原理对照**：`iota-core/src/iota_core/graph/types.py::class GraphSpec`（docstring：
> "Author-time declaration of a DAG"）与
> `iota-core/src/iota_core/graph/compiler.py::class GraphCompiler`
> （"Turns a validated ``GraphSpec`` into a frozen execution plan"）。DSH 侧等价物是
> subagent Provider + 模型可见工具（dsh 第 08 课第 3 节）——那边 provider 注册好了，模型仍可能
> 一次也不委派；这边 `compile_graph()` 一返回，research 就一定先于 review。

---

## 4. 空 roster：装配不扫描任何目录

打开 [`scenes/02_agent_specs_are_explicit.py`](../M08-delegation-presets/scenes/02_agent_specs_are_explicit.py)。
它是一条三段式时间线：空 → 在册 → 回到空。

```python
require(harness.registry.agent_specs.list() == [], "装配后 roster 为空")
spec = AgentSpec(
    name="m08-reviewer",
    version="1.0.0",
    config=AgentConfig(name="m08-reviewer", kernel=harness.kernel),
)
disposer = harness.registry.agent_specs.register(spec.name, spec)
listed = harness.registry.agent_specs.list()
disposer()
require(listed == ["m08-reviewer"], "显式注册后才在册", listed)
require(harness.registry.agent_specs.list() == [], "回收后回到空 roster")
```

- **装配后为空**：`create_harness()` 构造完 `Registry()`，`agent_specs` 就是空表——装配代码
  没有任何"去用户目录发现 agent"的步骤。委派对象不是被发现的，是被声明的。
- **显式注册才在册**：`AgentSpec` 带稳定名字与版本，连同一个最小 `AgentConfig`（内核名）
  注册进 `Registry.agent_specs`，`listed` 里出现且只出现 `"m08-reviewer"`。
- **注册返回 disposer**：调用它，roster 立刻回到空。M08.2 的三行事实
  `roster_after_assembly = []`、`roster_after_register = [m08-reviewer]`、
  `discovery = explicit registration only` 就是这条时间线。

> **原理对照**：`iota-core/src/iota_core/agent_spec.py::class AgentSpec`
> （"Everything a caller needs to construct one logical Agent"）。DSH 侧等价物是 agentPreset
> 服务：dsh M08.2 用 `configuredRoots: 0, discovered: 0` 说同一件事——服务是真的，目录是真的
> 没扫。两边共用同一条纪律：**在册必须是显式注册的结果**。

---

## 5. 运行与绑定：数据通道就是 `$nodes.research.output`

打开 [`scenes/03_run_delegation_graph.py`](../M08-delegation-presets/scenes/03_run_delegation_graph.py)。

```python
install_handlers(harness.registry)
ref = harness.runtime.register_graph(delegation_graph("m08-delegation"), overwrite=True)
result = await harness.runtime.run_graph(
    harness.agent(name="m08-delegation"), ref, {"topic": "iota"}
)
require(result.status == "succeeded", "委派图运行成功", result.status)
require(
    result.outputs["review"]["approved"] == "research:iota",
    "review 消费 research 的输出",
    result.outputs,
)
```

两个节点的"工作"是两个本地 handler——这里只是字符串拼接，但足以演示数据通道：

```python
registry.code_handlers.register(
    RESEARCH, lambda ctx: {"draft": f"research:{ctx.inputs['topic']}"}, overwrite=True
)
registry.code_handlers.register(
    REVIEW, lambda ctx: {"approved": ctx.inputs["draft"]["draft"]}, overwrite=True
)
```

数据沿着绑定走三步：

1. `run_graph(..., {"topic": "iota"})` 把输入交给整图。research 的
   `input_bindings={"topic": "$input.topic"}` 把它接进本节点，handler 返回
   `{"draft": "research:iota"}`。
2. review 的 `input_bindings={"draft": "$nodes.research.output"}` 把 research 的**整个输出**接进
   来，handler 从 `ctx.inputs["draft"]["draft"]` 取出 `research:iota`，返回
   `{"approved": "research:iota"}`。
3. 图级 `outputs={"review": "$nodes.review.output"}` 把 review 的输出指认为整图输出，所以
   `result.outputs["review"] == {"approved": "research:iota"}`。

**review 没有重新提问**——它的输入全部来自绑定，绑定即数据通道。M08.3 的两行事实正好是
"结果 + 通道"：`review_output = {approved: research:iota}` 与
`binding = $nodes.research.output`。

两个注意点：

- `run_graph()` 内部先 `compile_graph()` 再执行——计划冻结之后才跑。
- 本图两个节点都是 `executor_type="code"`（本地 handler，断言因此完全确定）。换成 `react`
  执行器，节点就由内核按各自的提示词作答——但无论哪种执行器，**委派顺序由图决定**。

> **原理对照**：M08 README 的边界表写得直白：**"内核按节点提示词分别作答，委派顺序由图决定
> 而不是模型自由发挥。"** 这是与 DSH"模型会不会委派"的关键对照点：dsh 那边委派是一次模型
> 看得见的工具调用，调不调由模型决定；iota 这边委派是图上的一条边，编译期就定死。

---

## 6. 具名模型路由：解析单位是 `ModelProfile`

打开 [`scenes/04_route_node_model.py`](../M08-delegation-presets/scenes/04_route_node_model.py)。

```python
profile = ModelProfile(
    name="m08-reviewer-model",
    version="1.0.0",
    model=harness.model or "unknown",
    request_overrides={"temperature": 0},
)
disposer = harness.registry.model_profiles.register(profile.name, profile)
resolved = harness.registry.model_profiles.get(profile.name)
agent = harness.agent(name="m08-routed", model_profile=profile.name)
disposer()
require(resolved.model == profile.model, "按名字解析回同一个 profile", resolved)
require(agent.config.model_profile == profile.name, "节点按名字引用 profile", agent.config)
require(harness.registry.model_profiles.list() == [], "回收后 profile 不再在册")
```

四个动作对上 M08.4 的三行事实（`profile = m08-reviewer-model`、`model = fuyao-coding`、
`request_overrides = {temperature: 0}`）：

- **路由单位是具名 profile**：名字、版本、模型与请求覆盖（`temperature: 0`）打包成一条在册
  条目，而不是在各处散写模型名。
- **按名字解析回同一个对象**：`get(profile.name)` 拿回的 `resolved.model` 与注册时的
  `profile.model` 相等。
- **节点引用的是名字**：`agent.config.model_profile` 上只有字符串 `m08-reviewer-model`——解析
  发生在图编译期（`ModelProfile` 的 docstring："Versioned model request policy resolved at
  graph compile time"），节点定义里不存解析结果。
- **回收后立刻不在册**：disposer 一调，`model_profiles.list()` 回到空。

> **原理对照**：DSH 侧等价物是 modelSelection 白名单：dsh M08.4 授权的是精确 provider/model
> **对**（`allowedModels: [ { provider: 'anthropic-compat', model: 'fuyao-coding' } ]`）；iota
> 把同样的声明做成在册的具名 `ModelProfile`，节点按名字引用。两边共享同一条纪律：路由是
> 声明出来的，不是运行时拍脑袋。

---

## 7. 排障：图一编译就报引用错误；或想让模型自己决定委派给谁

### 症状

两种典型困惑长得很不一样，根子是同一个：

1. `GraphSpec` 写好了，`compile_graph()` 一调用就抛 `GraphValidationError`，错误里列着
   `unknown code_handler '...'`、`reads node '...' which is not in depends_on` 之类的条目。
2. 你希望模型在运行时"看情况"决定把工作委派给谁——发现 iota 里根本找不到这个口子。

### 定位

1. 读错误信息里的问题清单，每条都自带 `node '...'` 定位：`unknown code_handler 'm08-review'`
   表示图引用的 handler 名字没在 `Registry.code_handlers` 里——图只引用名字，名字必须先注册
   （对照第 3 节的顺序：先 `install_handlers`，再注册图，最后编译）。
2. `input_bindings.draft reads node 'research' which is not in depends_on` 表示跨节点读取没有
   声明依赖支撑——数据通道必须跟着 `depends_on` 走，这条规则编译期就替你检查。
3. 想要"模型自己决定委派"：这不是故障，是对面工程的语义——dsh 那边模型看得见工具，调不调
   由它决定；iota 的图里没有这个自由度。

### 原因与修改

iota 的委派是**显式 DAG**：谁委派给谁、按什么顺序、传什么数据、用哪个模型，全部按名字写
出来，`compile_graph()` 在任何节点运行之前逐一核验。所以修改方向只有一个：**显式声明一切**——
handler 与 agent_spec 先注册进 `Registry`、依赖与绑定写进 `GraphSpec`、模型路由注册成具名
`ModelProfile`。把"委派与否"留给模型当场决策，在 iota 没有对应机制；要让决策可检查，就把它
变成图上的一条边，让编译期替你把关。

---

## 8. 代码在哪

```bash
cd iota-example && ls M08-delegation-presets/impl M08-delegation-presets/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/delegation_graph.py`](../M08-delegation-presets/impl/delegation_graph.py) | `install_handlers` 的两次具名注册（`overwrite=True`）；`delegation_graph` 的 `depends_on`、`input_bindings` 与图级 `outputs` |
| [`scenes/01_compile_topological_order.py`](../M08-delegation-presets/scenes/01_compile_topological_order.py) | `register_graph` → `compile_graph` → `topological_order` 断言 |
| [`scenes/02_agent_specs_are_explicit.py`](../M08-delegation-presets/scenes/02_agent_specs_are_explicit.py) | 空 → 在册 → 回到空 的三段断言 |
| [`scenes/03_run_delegation_graph.py`](../M08-delegation-presets/scenes/03_run_delegation_graph.py) | `run_graph` 的输入 `{"topic": "iota"}`；review 消费上游输出 |
| [`scenes/04_route_node_model.py`](../M08-delegation-presets/scenes/04_route_node_model.py) | `ModelProfile` 的注册、按名字解析与 disposer |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。本模块只有一个 impl 文件——
两个 handler 加一张图，整份不到 50 行，适合整读。

---

## 9. 动手练习

### 练习 A：删掉依赖，看编译期怎么拦你

把 [`impl/delegation_graph.py`](../M08-delegation-presets/impl/delegation_graph.py) 里 review 节点的
`depends_on=["research"],` 一行删掉（保留 `input_bindings`），重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M08 --scene 01_compile_topological_order
```

**可验证答案**：编译当场抛 `GraphValidationError`，问题清单里有一条
`node 'review': input_bindings.draft reads node 'research' which is not in depends_on; cross-node reads must follow a declared dependency`，
进程非零退出——跨节点的读取必须跟着声明的依赖走，这条规则在运行前生效。

### 练习 B：证明 disposer 才是"回到空 roster"的那只手

把 [`scenes/02`](../M08-delegation-presets/scenes/02_agent_specs_are_explicit.py) 里的 `disposer()`
注释掉再跑：

```bash
cd iota-example && uv run python -m runtime.runner M08 --scene 02_agent_specs_are_explicit
```

**可验证答案**：最后一条 `require` 抛 `TeachingCheckError`——期望"回收后回到空 roster"，实际
观察是 `['m08-reviewer']`。在册是显式注册的副作用，回收同样要显式调用。

### 练习 C：按名字取一个已回收的 profile

在 [`scenes/04`](../M08-delegation-presets/scenes/04_route_node_model.py) 最后一条 `require` 之后补
一行 `harness.registry.model_profiles.get(profile.name)`，再跑：

```bash
cd iota-example && uv run python -m runtime.runner M08 --scene 04_route_node_model
```

**可验证答案**：抛 `ConfigError`，信息是 `Unknown model_profile: m08-reviewer-model`。此时
`agent.config.model_profile` 上仍留着名字——节点引用的只是字符串，解析以注册表为准，回收后
立刻失效。

---

**下一课** → [第 09 课 · 长任务与编排](09-long-running-orchestration.md)：整图一次跑完是最短路径——下一课看长任务怎么靠幂等入队、租约与 checkpoint 活过中断。

# 第 04 课 · Agent 循环与干预面：事件、节点 hook 与编译期不变量

> **本课任务**：对照 DSH 的事件、steering 与 inbox 四通道，确认 iota 的干预面收窄到**节点
> 边界**：一轮真实运行产出标准事件且按**子序列**成立；mid-turn 注入在三处公开面上都找不到
> 入口（负证据）；节点 hook 在节点边界拿到真实结果；未注册引用在编译期被点名拒绝。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M04`
> **你将看到**：`events = [step_start, text_delta, final, step_end]` 里标准
> 三事件按序出现，两头是内核自己插的事件；`mid_turn_injection = kernel-owned`——三处
> 注入入口全为空；`refusal = node 'work': unknown code_handler 'm04-not-registered'`。

前置：[第 03 课 · 推理服务接入](03-inference-service-access.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/04-agent-loop-intervention.md](../../dsh-example/lessons/04-agent-loop-intervention.md)——那边讲事件域/干预域与 inbox 四通道，本课讲 iota 的节点边界与编译期校验。

---

## 1. 本课任务

DSH 把 Agent 循环的干预面拆成事件观察、生命周期 hook、回合收尾、输入路由（inbox 四通道）与
失败归属五块，真正能改变结果的写入点只有 inbox 一处（"data decides"，dsh 第 04 课 § 5–§ 6）。
iota 的对照关系是**语义等价 + 结构性边界**（判定口径见 [`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md)）：
事件流、遥测账本与编译期校验语义等价；"往进行中的一轮里插消息"不是契约——进行中的一轮
属于内核，干预面只在节点边界。

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| 事件观察（`session/event` 只读事实流） | `AgentEvent` 流 + `require_event_order` 子序列校验（M04.1） | **语义等价**：编排层可观察 |
| 生命周期 hook（`agent/*` waterfall，可否决步、换 config） | 没有对位物——进行中的一轮属于内核（M04.2 负证据） | **结构性边界**：mid-turn 归内核 |
| 回合收尾 + 输入路由（`turn-stopping` + inbox 四通道） | 没有 inbox；干预收窄到节点边界（M04.3 `after_node_result`） | **结构性边界**：干预面 = 节点边界 |
| 遥测账本（`MemorySessionTelemetry`） | `RunStore` 按 run_id 记状态与事件，可换实现（M04.4） | **语义等价** |
| 失败归属（`InvariantError` 带 `packageName`） | `GraphValidationError` 在编译期点名未注册引用（M04.5） | **语义等价**：不变量收在运行前 |

```bash
cd iota-example && uv run python -m runtime.runner M04
```

---

## 2. 真实输出

```text
████ M04 · Agent 循环与干预面：事件、节点 hook 与编译期不变量 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M04.1 · 观察一轮的标准事件顺序 ────
   events = [step_start, text_delta, final, step_end]
   standard_subsequence = [text_delta, final]
REAL_STAGE_OK M04.1 calls=1 ms=1375 in=12225 out=7 finish=success "事件顺序已观察。"

──── M04.2 · 生命周期边界上没有 steering 入口 ────
   agent_config_fields = []
   runtime_api = []
   injection_events = []
   mid_turn_injection = kernel-owned
REAL_STAGE_OK M04.2 calls=1 ms=1991 in=12224 out=5 finish=success "一轮已完成。"

──── M04.3 · 节点 hook 是唯一干预通道 ────
   graph_status = succeeded
   node_hook = [[observe, succeeded]]
REAL_STAGE_OK M04.3 calls=1 ms=2940 in=12240 out=10 finish=success

──── M04.4 · 捕获运行遥测账本 ────
   run_id_assigned_by = RunStore
   run_status = succeeded
   recorded_events = [text_delta]
REAL_STAGE_OK M04.4 calls=1 ms=4181 in=12242 out=10 finish=success

──── M04.5 · 未注册引用在编译期被拒 ────
   refusal = node 'work': unknown code_handler 'm04-not-registered'
   rejected_at = compile-time
REAL_STAGE_OK M04.5 calls=1 ms=1353 in=12240 out=10 finish=success

REAL_MODULE_OK M04 stages=5 calls=5 failed=0
```

**对照自己的输出**：末行必须原样出现 `REAL_MODULE_OK M04 stages=5 calls=5 failed=0`；
`ms=` / `in=` / `out=` 随端点浮动。要盯的是结构：M04.1 的 `standard_subsequence` 恒为
`[text_delta, final]`，`events` 因内核而异，子序列成立即可（第 3 节）；
M04.2 的三个列表恒为 `[]`，非空即 `REAL_STAGE_FAIL`；M04.5 恒点名 `m04-not-registered`。
若混着 `[claude-code:unrecognized_model]` 行，见第 00 课第 7 节——它不是错误。

---

## 3. M04.1 · 事件顺序：标准三事件按**子序列**成立

打开 [`scenes/01_observe_event_order.py`](../M04-agent-loop-intervention/scenes/01_observe_event_order.py)。
整个场景只有一次真实调用加一个断言——`harness.stream()` 是 `runtime.stream()` 的薄封装，
一次完整往返收成 `list[AgentEvent]`：

```python
STANDARD = ("text_delta", "final")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    events = [event.type for event in await harness.stream("请只回复：事件顺序已观察。")]
    require_event_order(events, STANDARD)
    return {"events": events, "standard_subsequence": list(STANDARD)}
```

真实日志观察到 `events = [step_start, text_delta, final, step_end]`：4 个事件
里 3 个是标准事件，`step_start` 与 `step_end` 是**内核自己插进来的**。断言交给
[`runtime/harness.py`](../runtime/harness.py) 的 `require_event_order`，按**子序列**校验：

```python
def require_event_order(observed: Sequence[str], expected: tuple[str, ...]) -> None:
    """按**子序列**校验事件顺序。

    不同内核会在标准事件之间插入自己的事件（step、thinking、工具调用…），
    所以"顺序正确"应表述为"这几个标准事件按序出现"，而不是"事件列表完全等于某个字面量"。
    写成相等会让示例只在某一个内核的事件序列下成立，那正是本工程要避免的假象。
    """
```

这是"不同内核都能通过"的关键设计，值得讲透：

- **契约只锚定编排层自己的语义**：内核自有事件（如 claude 的 `system_init`）先于
  `text_delta`（过程叙述），`final`（内核裁定的终态答案）在最后——与第 01 课
  "`final` 与 `text_delta` 不能拼接"是同一条顺序语义。
- **不锚定某个内核的事件清单**：游标只向前、不要求相邻；换成会产出 `thinking`、工具调用
  事件的内核，断言同样成立。写成相等断言，本课这次真实运行**当场就挂**。

> **原理对照**：`iota-core/src/iota_core/types.py::AgentEvent`——带 `type` 判别器的联合
> （`TextDeltaEvent | ThinkingDeltaEvent | ToolCallStartEvent | ToolCallResultEvent |
> StepStartEvent | StepEndEvent | SystemInitEvent | FinalEvent | AbortEvent | ErrorEvent`），
> 标准三件套是语义骨架，其余类型是内核的自由插入空间。DSH 的 `session/event`（dsh 第 04 课
> § 3）同样只读事实，但靠插件订阅广播、装晚了收不到 emit；iota 直接消费返回值里的事件列表。

---

## 4. M04.2 · 负证据：三处公开面上都没有 mid-turn 注入入口

DSH 的 `agent.steer()` 能在 `turn-stopping` 边界往 inbox 写一条消息、让同一轮多跑一步，
`inject` / `followup` / `send` 是另外三条输入通道（dsh 第 04 课 § 6.1）。iota 有没有？
[`scenes/02_no_mid_turn_steering.py`](../M04-agent-loop-intervention/scenes/02_no_mid_turn_steering.py)
的做法是**先真实跑完一轮，再在三个面上找注入入口**：

```python
    config_fields = sorted(
        name for name in AgentConfig.model_fields if any(word in name for word in MID_TURN_WORDS)
    )
    runtime_api = sorted(
        name
        for name in dir(harness.runtime)
        if not name.startswith("_") and any(word in name for word in MID_TURN_WORDS)
    )
```

第三个面查事件流；三处断言都必须是空列表：

```python
    require(config_fields == [], "AgentConfig 不声明 mid-turn 注入字段", config_fields)
    require(runtime_api == [], "运行时公开面没有 mid-turn 注入入口", runtime_api)
    require(injected == [], "事件流里也没有注入类事件", injected)
```

对应日志：

```text
   agent_config_fields = []
   runtime_api = []
   injection_events = []
   mid_turn_injection = kernel-owned
```

负证据的写法有三条纪律：**先证明这一轮真的跑完了**（M04.2 的证据行 `REAL_STAGE_OK` 带
`calls=1`，末尾还有 `"一轮已完成。"`），否则"找不到入口"可能是"根本没跑"；**三面覆盖能力
暴露的必经位置**——配置面、运行时公开面（`dir(harness.runtime)` 非下划线名）、事件流（注入
必然伴随事件）；**词表是假设检验**：

```python
#: DSH 的 inbox/steering 语汇；编排层若真提供该能力，会以这些词出现在公开面上。
MID_TURN_WORDS = ("inbox", "splice", "steer", "followup", "interject")
```

三个空列表合起来，结论就是最后一行 `mid_turn_injection = kernel-owned`。

> **原理对照**：mid-turn 状态由内核拥有：`iota-core/docs/develop/architecture/graph-node-hooks.md::执行顺序`
> （对照表 M04 行的口径）——"模型调用发生在内核内部……iota-core 无法替内核承诺什么"。
> `runtime.run()` / `runtime.stream()` 是一次完整往返，await 期间没有中间句柄。

---

## 5. M04.3 · 节点 hook：唯一的干预通道

mid-turn 进不去，那编排层能插手的位置在哪？
[`impl/node_hooks.py`](../M04-agent-loop-intervention/impl/node_hooks.py) 给出答案：
**节点边界**。hook 与 code handler 都按名字注册进 `Registry`，图只引用名字：

```python
    def audit(scope: Any, payload: dict[str, Any]) -> None:
        seen.append((scope.node_id, payload["result"]["status"]))

    registry.node_hooks.register(AUDIT_HOOK, audit)
    registry.code_handlers.register(CODE_HANDLER, lambda ctx: {"input": ctx.inputs["v"]})
```

图只引用名字，语法是 `"<hook 点>:<名字>"`——`hook_refs=[f"after_node_result:{AUDIT_HOOK}"]`；
`code_handler_ref=CODE_HANDLER` 同理。场景把两者接起来（[`scenes/03_hook_node_result.py`](../M04-agent-loop-intervention/scenes/03_hook_node_result.py)）：

```python
    install_audit(harness.registry, seen)
    graph = harness.runtime.register_graph(audited_graph())
    result = await harness.runtime.run_graph(harness.agent(name="m04-graph"), graph, {"v": 7})
    require(result.status == "succeeded", "图运行成功", result.status)
    require(seen == [("observe", "succeeded")], "after_node_result 观察成功结果", seen)
```

日志给出 `graph_status = succeeded` 与 `node_hook = [[observe, succeeded]]`——两个注册面、两个角色，别混：

- **code handler 是节点的执行体**（图作者的面）：`executor_type="code"` 的节点做什么，
  由 `code_handler_ref` 指到的函数决定——这里只是把输入原样打包返回。
- **node hook 是宿主侧的干预通道**（不动图也能挂）：`after_node_result` 在**节点结果提交后**
  拿到 `(scope, payload)`，把 `(node_id, status)` 追加进 `seen`——观察已发生的事实，不否决它。

与 DSH 的结构性差别一句话：DSH 的 `agent/pre-step` 能否决一步、`agent/request` 能换请求
config——干预在**一轮之内的每个 step 边界**；iota 的 hook 只在**图的节点边界**
（dsh 第 04 课 § 4），内核往返的内部没有编排层的拦截点。

> **原理对照**：`iota-core/docs/develop/architecture/graph-node-hooks.md::执行顺序`——"差别在于**谁的
> 执行栈**：节点结果的提交发生在 iota-core 的引擎里，所以 iota-core 能保证 hook 一定被调用；
> 模型调用发生在内核内部……iota-core 无法替内核承诺什么。"**能保证被调用的边界才有资格
> 当干预面**；`on_node_error`（attempt 失败时触发、携带 `will_retry`）同属节点边界。

---

## 6. M04.4 · RunStore：按 run_id 记账，另一个消费者可读回

[`scenes/04_capture_run_telemetry.py`](../M04-agent-loop-intervention/scenes/04_capture_run_telemetry.py)
演示账本协议的五个动作——开户、记事件、记状态、读状态、读事件：

```python
    store = InMemoryRunStore()
    # 账本按 Agent 开户：run_id 由存储分配，调用方不自己编。
    run_id = await store.create_run(harness.agent(name="m04-telemetry"))
    await store.append_event(run_id, TextDeltaEvent(text="观察到一段输出"))
    await store.update_run(run_id, status="succeeded")
    record = require_not_none(await store.get_run(run_id), "账本里有这次运行")
    events = await store.get_events(run_id)
    require(record["status"] == "succeeded", "状态更新被记账", record)
    require([event.type for event in events] == ["text_delta"], "事件按序记账", events)
```

日志给出 `run_id_assigned_by = RunStore`、`run_status = succeeded`、`recorded_events = [text_delta]`。
三件事值得记：

- **run_id 的分配权在存储**：`create_run` 返回 id，调用方不自己编。
- **状态与事件是两个写入口**（`update_run` / `append_event`），也是两个读面——拿着 run_id
  的**另一个消费者**随时能读回状态与事件序列。
- **账本是协议**：`InMemoryRunStore` 是单进程默认实现，`IotaRuntime` 接受注入任何 `RunStore`
  实现——生产里换耐久存储，调用方不改一行。

> **原理对照**：`iota-core/src/iota_core/storage/run_store.py::InMemoryRunStore`（`RunStore`
> 协议在同一文件）。DSH 侧等价物是 `MemorySessionTelemetry`（dsh 第 04 课 § 6.3）：
> 账本跟着事实走，不跟着 provider 走，生产里换 backend 即可。

---

## 7. M04.5 · 编译期不变量：未注册引用当场点名拒绝

按名字注册（第 5 节）给了进程内任何组件自由，也带来名字引用的风险：拼错、漏注册。
[`scenes/05_compile_rejects_unknown_reference.py`](../M04-agent-loop-intervention/scenes/05_compile_rejects_unknown_reference.py)
构造一张单节点图（`GraphSpec` 的 `name="m04-unknown-reference"`，输出绑定
`outputs={"value": "$nodes.work.output"}`），节点 `code_handler_ref="m04-not-registered"`
谁都没注册过。然后编译它，断言"必须在这里失败"：

```python
    compiler = GraphCompiler(
        Registry(), capabilities={"code": KernelCapabilities.code_executor()}
    )
    try:
        compiler.compile(spec, default_kernel="code", default_model="m04-model")
    except GraphValidationError as exc:
        refusal = "; ".join(exc.problems)
    else:  # pragma: no cover
        fail("未注册的 code handler 引用在编译期被拒绝")
    require("m04-not-registered" in refusal, "拒绝信息点名缺失的引用", refusal)
```

日志给出 `refusal = node 'work': unknown code_handler 'm04-not-registered'` 与
`rejected_at = compile-time`。三件事一起看：

- **编译期，不是运行期**：校验发生在 `compile()`，图还没执行任何节点；`register_graph`
  只登记 spec，编译发生在 `run_graph` 内部——无论从哪个入口编译，校验都先于任何节点执行。
- **拒绝信息点名三样**：节点（`node 'work'`）、种类（`code_handler`）、名字
  （`m04-not-registered`）——失败要可归属，与 DSH 的 `InvariantError` 带 `packageName`
  是同一条纪律。`problems` 聚起一次编译的**所有**问题（场景用 `"; ".join` 拼接，暗示复数）。
- **验收写法**：`try/except GraphValidationError` + `else: fail(...)`——**预期失败没发生
  本身就是失败**；`# pragma: no cover` 标注的 else 分支只在校验失效（回归）时才走到。

> **原理对照**：`iota-core/src/iota_core/graph/compiler.py::class GraphCompiler`；引用语法
> 与校验规则见 `iota-core/docs/develop/architecture/graph-node-hooks.md::引用语法与校验`（对照表 M03 行的
> 口径）：引用的名字必须已在 Registry 注册，`"<point>:<name>"` 的 point 前缀拼错同样在
> 编译期报错——**不存在静默降级路径**。

---

## 8. 排障：想在一轮进行中给内核插一条新指令，找不到入口

### 症状

你希望像 DSH 那样在 Agent 跑到一半时 `steer()` 一条新指令，翻遍 `AgentConfig` 的字段与
`runtime` 的公开方法也没找到入口；事件流里也没有能回写的通道。程序不报错——只是没有这个功能。

### 定位

1. 先分清要**观察**还是**干预**：观察有现成的只读面——事件流（M04.1）与 RunStore 账本（M04.4）。
2. 用 M04.2 的三面清单自查：`AgentConfig.model_fields` / `dir(runtime)` 公开名 / 事件类型，过滤
   `("inbox", "splice", "steer", "followup", "interject")`——本课真实运行下三个都是 `[]`。
3. 确认这一轮的形态：`runtime.run()` / `runtime.stream()` 是一次完整内核往返，await 期间没有
   中间句柄，没有"进行到一半"可以插话的对象。

### 原因与修改

这不是 bug，是边界——mid-turn 状态由内核拥有（对照表 M04 行的架构边界）。修改按需求选：

| 你想要的效果 | 在 iota 怎么做 |
|---|---|
| 这轮结束后补充新指令 | 等它结束，再调一次 `run()` / `stream()`，新指令进新的一轮；对话历史由 `ConversationStore` 维护（第 05 课） |
| 在过程边界上观察/干预 | 把工作拆成图节点，用 `after_node_result` hook 在节点边界拿结果（M04.3） |
| 内核真的要支持中途输入 | 换一个提供该能力的内核/适配器——那是内核能力，不是编排契约 |

契约里没有的东西，换内核时不会悄悄失效；"没有入口"比"有但语义不明"更安全。

---

## 9. 代码在哪

```bash
cd iota-example && ls M04-agent-loop-intervention/impl M04-agent-loop-intervention/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/node_hooks.py`](../M04-agent-loop-intervention/impl/node_hooks.py) | `install_audit` 的两个按名字注册；`hook_refs=[f"after_node_result:{AUDIT_HOOK}"]` 引用语法 |
| [`scenes/01_observe_event_order.py`](../M04-agent-loop-intervention/scenes/01_observe_event_order.py) | 全部 15 行：一次 `stream()` + 一个子序列断言 |
| [`scenes/02_no_mid_turn_steering.py`](../M04-agent-loop-intervention/scenes/02_no_mid_turn_steering.py) | `MID_TURN_WORDS` 词表与三面负证据 |
| [`scenes/03_hook_node_result.py`](../M04-agent-loop-intervention/scenes/03_hook_node_result.py) | `install_audit` → `register_graph` → `run_graph` 完整链路 |
| [`scenes/04_capture_run_telemetry.py`](../M04-agent-loop-intervention/scenes/04_capture_run_telemetry.py) | `create_run` / `append_event` / `update_run` 与两个读回面 |
| [`scenes/05_compile_rejects_unknown_reference.py`](../M04-agent-loop-intervention/scenes/05_compile_rejects_unknown_reference.py) | 未注册引用的 spec；`try/except GraphValidationError` 的验收写法 |
| [`runtime/harness.py`](../runtime/harness.py) | `require_event_order` 的游标实现与"为什么是子序列"的 docstring |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言（`require(…)`）就是这一阶段的"可验证答案"。

---

## 10. 动手练习

### 练习 A：把子序列断言换成相等断言

在 [`scenes/01`](../M04-agent-loop-intervention/scenes/01_observe_event_order.py) 里把
`require_event_order(events, STANDARD)` 临时改成
`require(events == list(STANDARD), "事件列表完全相等", events)`：

```bash
cd iota-example && uv run python -m runtime.runner M04 --scene 01_observe_event_order
```

**可验证答案**：进程非零退出，抛 `TeachingCheckError`（带期望与实际值），实际值里能看到
`step_start` 与 `step_end`——相等断言在真实内核的事件序列下当场失败；改回后末行恢复
`REAL_MODULE_OK M04 stages=1 calls=1 failed=0`。**相等断言只对一个内核的事件清单成立，
子序列对所有内核成立**。

### 练习 B：给自己的负证据换一个关键词

在 [`scenes/02`](../M04-agent-loop-intervention/scenes/02_no_mid_turn_steering.py) 的
`MID_TURN_WORDS` 里加上 `"run"`，重新运行
`uv run python -m runtime.runner M04 --scene 02_no_mid_turn_steering`：

**可验证答案**：这次 `runtime_api` 不再是空——`run`、`run_graph`、`run_store`（还有
`get_graph_run`）被命中，场景在"运行时公开面没有 mid-turn 注入入口"上抛 `TeachingCheckError`。
负证据的强度取决于词表：五个 DSH 语汇是"该能力若存在会长什么样"的假设检验，`"run"` 不是。

### 练习 C（进阶）：重名注册要响亮地失败

在 [`impl/node_hooks.py`](../M04-agent-loop-intervention/impl/node_hooks.py) 的
`install_audit` 里把 `registry.node_hooks.register(AUDIT_HOOK, audit)` 连着调两次，重新运行
`uv run python -m runtime.runner M04 --scene 03_hook_node_result`：

**可验证答案**：进程非零退出，注册处抛 `ConfigError`，消息原文
`node_hook 'm04-audit' is already registered`——按名字注册默认拒绝重名（除非显式
`overwrite=True`）。这与 dsh 第 04 课的 `duplicateNamesFailLoud: true` 是同一条纪律：
**能在注册期拒绝的，不要拖到运行期**。

---

**下一课** → [第 05 课 · 会话面](05-session-surface.md)：消息按序落盘、可查询、可换实现；DSH 的 seq/surface 不变量 iota 不承诺。

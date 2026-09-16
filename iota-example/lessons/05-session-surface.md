# 第 05 课 · 会话面：消息存储、运行记录与 schema 边界

> **本课任务**：看清 iota 的两条存储协议——`ConversationStore` 保存有序消息、`RunStore` 保存
> 运行状态与事件流；验证一轮真实对话按 user/assistant 顺序落盘、存储实现可换、语料可查、
> 运行记录可读回；最后用负证据确认 iota 的事件 schema 不承诺 DSH 的 seq/surface 不变量。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M05`
> **你将看到**：`roles = [user, assistant]`——一轮真实对话按序持久化；
> `run_status = succeeded`——运行状态与事件流整份读回；`dsh_fields_present = []`——
> 事件 schema 里没有 DSH 的 seq/sequence/surface 字段。

前置：[第 04 课 · Agent 循环与干预面](04-agent-loop-intervention.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见
[dsh-example/lessons/05-session-surface.md](../../dsh-example/lessons/05-session-surface.md)——那边讲"日志是事实、surface 是投影"，本课讲 iota 的两条存储协议与它不承诺的 seq/surface 语义。

---

## 1. 本课任务

DSH 的会话面分五层：事实日志与模型可见 surface 的双视图，外加 JSONL persistence、query、
projection checkpoint 与 title。iota 这边的回答是**两条都可换的存储协议**：`ConversationStore`
管会话消息，`RunStore` 管运行状态与事件流（对照关系：**语义等价 + 结构性边界**，判定见
[`M05-session-surface/README.md`](../M05-session-surface/README.md)）。"消息与运行事实按顺序
落盘、可查询、可换实现"是语义等价的那一半；"事件 schema 不承诺 seq/surface"是结构性边界
的那一半：

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| 事实日志 + surface 投影，`seq === 数组下标`，`replace` 位置性替换 | `ConversationStore`：一份按插入顺序的消息 | **语义等价**（模型可见内容可读回）+ **结构性边界**（没有第二视图与序号不变量） |
| JSONL persistence Provider | 存储是协议：`load_conversation_store` 给 memory / file / redis 三个后端 | **语义等价**：后端可替换 |
| session query（live-preferred 语料） | `list_sessions()` + `search_messages()` 写在协议里 | **语义等价**：跨会话查询面 |
| projection checkpoint（可丢弃加速层） | `RunStore`：运行状态 + 事件流本体 | **语义等价**（运行事实可读回）+ **结构性边界**（没有投影，也就没有投影缓存） |
| title latest-wins 事件 | 没有——事件 schema 没有 seq/surface/title 字段 | **结构性边界**：可执行的负证据 |

```bash
cd iota-example && uv run python -m runtime.runner M05
```

阶段清单在 [`M05-session-surface/run.py::STAGES`](../M05-session-surface/run.py)，五个编号与
dsh 同名阶段一一对应；逐模块对照与源码引用见 [`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md)。

---

## 2. 真实输出

```text
████ M05 · 会话面：消息存储、运行记录与 schema 边界 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M05.1 · 一轮真实对话按序持久化 ────
   roles = [user, assistant]
   messages = 2
REAL_STAGE_OK M05.1 calls=1 ms=858 in=12225 out=6 finish=success "会话已记录。"

──── M05.2 · 装载可换的消息存储 ────
   protocol = [append_message, clear, ensure_session, get_messages, list_sessions, search_messages]
   swapped_store = InMemoryConversationStore
   messages = [demo]
REAL_STAGE_OK M05.2 calls=1 ms=42195 in=12241 out=10 finish=success

──── M05.3 · 查询会话语料 ────
   sessions = [m05-a, m05-b]
   search_hits = 1
   query = 库存
REAL_STAGE_OK M05.3 calls=1 ms=1516 in=12241 out=74 finish=success

──── M05.4 · 运行记录可读回 ────
   run_status = succeeded
   events = [step_start, system_init, text_delta, final, step_end]
REAL_STAGE_OK M05.4 calls=1 ms=689 in=12225 out=6 finish=success "会话已记录。"

──── M05.5 · 事件 schema 不承诺 seq/surface ────
   checked_schemas = [final, text_delta]
   dsh_fields_present = []
   sequence_contract = not part of the iota event schema
REAL_STAGE_OK M05.5 calls=1 ms=5712 in=12241 out=221 finish=success

REAL_MODULE_OK M05 stages=5 calls=5 failed=0
```

**对照自己的输出**：末行必须是 `REAL_MODULE_OK M05 stages=5 calls=5 failed=0`。
`ms=` 与 `in=` 随端点速度浮动（这次 M05.2 的 probe 慢到了 42195ms），不影响结论。
两个 `model` 阶段（M05.1 / M05.4）行尾带引号的真实回答样本 `"会话已记录。"`；三个
`mechanism` 阶段（M05.2 / M05.3 / M05.5）的 `calls=1` 来自入口 probe——完整装配链 +
真实内核先打一遍，场景断言本身在本地完成。真实终端里每个阶段还会各出现一行
`[claude-code:unrecognized_model]`，它不是错误（第 00 课讲过原因）。

---

## 3. 按序持久化：谁写的，读回来的是什么

打开 [`impl/session_probe.py`](../M05-session-surface/impl/session_probe.py) 与
[`scenes/01_persist_conversation.py`](../M05-session-surface/scenes/01_persist_conversation.py)。
M05.1 / M05.4 两个场景共用 `run_one_turn`，先读它。它用复述型提示词
（`PROMPT = "请只回复：会话已记录。"`）跑一轮，然后把这一轮在两条存储上留下的全部事实
读回来：

```python
async def run_one_turn(harness: WorkshopHarness, *, namespace: str) -> Turn:
    agent = harness.agent(name=namespace, memory_namespace=namespace)
    result = await harness.runtime.run(agent, PROMPT)
    run_id = require_not_none(result.run_id, "运行生成 run_id")
    record = require_not_none(await harness.run_store.get_run(run_id), "RunStore 返回运行记录")
    return Turn(
        run_id=run_id,
        messages=list(await harness.conversation_store.get_messages(agent.memory_namespace)),
        run_record=record,
        events=list(await harness.run_store.get_events(run_id)),
    )
```

impl 的模块注释说明了这条设计纪律——**每个场景都自己跑一轮**：

```text
每个场景都自己跑一轮真实对话：日志与运行记录只有在真的发生过一轮之后才存在，
共享一次运行会让"读回来的东西是这轮写进去的"这件事不再可验证。
```

场景 M05.1 只是把读回来的消息排成角色序列再断言：

```python
turn = await run_one_turn(harness, namespace="m05-conversation")
roles = [message.role for message in turn.messages]
require(roles == ["user", "assistant"], "会话按 user/assistant 顺序持久化", roles)
return {"roles": roles, "messages": len(turn.messages)}
```

对应第 2 节 M05.1 的两行事实：`roles = [user, assistant]` 与 `messages = 2`。

谁把消息写进去的？**不是场景，也不是编排层**——`IotaRuntime.run()` 在调用内核前后自己写
存储。user 这条发生在提示词交给内核之前（`iota-core/src/iota_core/runtime.py`）：

```python
user_message = Message(role="user", content=prompt)
async with self._span_cm(
    "iota.memory.append_user",
    agent,
    append_user_attrs,
):
    await self._store.append_message(ns, user_message)
```

内核返回后，assistant 的回答作为新消息追加进同一命名空间。顺序因此天然是 user →
assistant，**不需要谁维护序号**——`get_messages` 的协议承诺就是插入顺序：

```python
    async def get_messages(self, session_id: str) -> list[Message]:
        """Return all messages for a session in insertion order."""
        ...
```

> **原理对照**：`iota-core/src/iota_core/storage/conversation_store.py::class ConversationStore`。
> DSH 侧等价物是事实日志 + `deriveMessages()` 投影（见 dsh 第 05 课第 3 节）——两边都回答
> "模型看见的内容有没有被记录、能不能读回"；差别在 DSH 存**两份视图**（append-only 日志 +
> surface 投影），iota 只存**一份有序消息**。"user/assistant 按序"在 iota 是唯一的存储事实，
> 不存在"投影与日志不一致"的问题——因为没有投影。

---

## 4. 存储是协议：换一个实现照样成立

打开 [`scenes/02_swap_conversation_store.py`](../M05-session-surface/scenes/02_swap_conversation_store.py)。

```python
protocol = sorted(
    name for name in dir(harness.conversation_store) if not name.startswith("_")
)
store = InMemoryConversationStore()
await store.ensure_session("m05-swap", source="example")
await store.append_message("m05-swap", Message(role="user", content="demo"))
messages = await store.get_messages("m05-swap")
require(messages[0].content == "demo", "换一个实现照样读回消息", messages)
require("append_message" in protocol and "get_messages" in protocol, "协议方法一致", protocol)
```

三个事实行：`protocol = [append_message, clear, ensure_session, get_messages, list_sessions,
search_messages]`、`swapped_store = InMemoryConversationStore`、`messages = [demo]`。

- `harness.conversation_store` 本来就是装配好的 `InMemoryConversationStore`
  （[`runtime/harness.py`](../runtime/harness.py) 的 `create_harness()`）；场景再构造一个
  **新实例**照样写入读回——协议方法与读回结果不依赖"那一个"对象。**存储是协议，不是全局单例**。
- 列出来的六个方法就是协议的全部：`ConversationStore(Protocol)` 上没有第七个方法，
  也没有任何一个能改写既有消息。
- 真正换后端的入口在内核侧：`iota-core/src/iota_core/storage/backend_loader.py` 的
  `load_conversation_store` 按 `conversation_backend` 给出 memory / file / redis 三个实现。
  `FileConversationStore` 是"JSONL-per-session"——每会话一个 `.jsonl` 文件，与 dsh M05.2
  装载的 `JsonlSessionPersistence` 同一格式家族；`RedisConversationStore` 甚至显式继承了这个
  Protocol。练习 C 让你把文件后端亲手换上。

> **原理对照**：`iota-core/src/iota_core/storage/backend_loader.py::def load_conversation_store`。
> DSH 侧等价物是 `ctx.plugin(sessionPersistence)` 装载 JSONL Provider（见 dsh 第 05 课第 6 节）
> ——两边都证明"运行时面向接口而不是后端"；差别在 DSH 换 Provider 要走插件装载与生命周期，
> iota 换后端只是构造另一个对象。

---

## 5. 查询面：list_sessions 与 search_messages

打开 [`scenes/03_search_conversation_messages.py`](../M05-session-surface/scenes/03_search_conversation_messages.py)。

```python
store = InMemoryConversationStore()
for namespace, content in (("m05-a", "订单已创建"), ("m05-b", "库存已扣减")):
    await store.ensure_session(namespace, source="example")
    await store.append_message(namespace, Message(role="user", content=content))
sessions = sorted(meta.session_id for meta in await store.list_sessions())
hits = await store.search_messages("库存")
require(sessions == ["m05-a", "m05-b"], "两个会话都在册", sessions)
require(len(hits) == 1, "检索命中一条消息", hits)
```

对应第 2 节 M05.3 的三行事实：`sessions = [m05-a, m05-b]`、`search_hits = 1`、`query = 库存`。

- 场景用**新建的 store**，不是 harness 里那个——两个会话刚好是本场景写入的，断言才干净。
  查询面对任何实例都一样，这是第 4 节结论的又一次兑现。
- `list_sessions()` 返回 `SessionMeta`（session_id / source / kernel / model /
  parent_session_id / started_at 等字段），协议约定按 `started_at` 倒序。
- `search_messages("库存")` 为什么只命中一条？内存实现的匹配规则就一行
  （`if q and q not in (m.content or "").lower()`）——**子串匹配、不分大小写**：
  "订单已创建"不含"库存"，"库存已扣减"含。
- 协议对返回值的承诺写在 `search_messages` 的文档里：

```text
Returns a list of dicts containing at least ``session_id``, ``role``,
``content``. ``current_session_id`` (if set) is excluded from results.
```

这就是 iota 的会话语料查询面：跨会话、可排除当前会话、可按角色过滤——**写在协议里**，
每个后端都得提供。

> **原理对照**：`iota-core/src/iota_core/storage/conversation_store.py::class ConversationStore`
> 的 `list_sessions` / `search_messages`。DSH 侧等价物是 `SessionQueryEngine`（见 dsh 第 05 课
> 第 6 节）——精确读取在基类共用，全文检索是抽象方法、必须由 Provider 提供。iota 把两者
> **都写进协议**：不存在"只支持精确读取"的后端，检索能力与存储能力同价。

---

## 6. 运行记录：状态与事件流读回

打开 [`scenes/04_read_run_record.py`](../M05-session-surface/scenes/04_read_run_record.py)，
再看 [`runtime/harness.py`](../runtime/harness.py) 里的 `require_event_order`。

```python
turn = await run_one_turn(harness, namespace="m05-run")
events = [event.type for event in turn.events]
require(turn.run_record["status"] == "succeeded", "运行记录状态成功", turn.run_record)
require_event_order(events, ("system_init", "text_delta", "final"))
return {"run_status": turn.run_record["status"], "events": events}
```

日志里事件有 5 条（`events = [step_start, system_init, text_delta, final, step_end]`），
断言却只点名 3 条——因为校验是**子序列**：

```python
def require_event_order(observed: Sequence[str], expected: tuple[str, ...]) -> None:
    """按**子序列**校验事件顺序。

    不同内核会在标准事件之间插入自己的事件（step、thinking、工具调用…），
    所以"顺序正确"应表述为"这几个标准事件按序出现"，而不是"事件列表完全等于某个字面量"。
    写成相等会让示例只在某一个内核的事件序列下成立，那正是本工程要避免的假象。
    """
```

这次多出来的 `step_start` / `step_end` 是 Claude 内核适配器在流两端加的
（`iota-core/src/iota_core/adapters/claude.py` 里 `yield StepStartEvent(name="claude")` 开流、
`yield StepEndEvent(name="claude", ok=not result_meta.get("is_error", False))` 收流）。
写成全等断言换个内核就碎；写成子序列，断言的是**协议事件**，不是某个内核的序列长相。

`run_status = succeeded` 从哪来？`IotaRuntime.run()` 成功收尾时自己落账：先把
`result.events` 逐条 `await self._run_store.append_event(run_id, event)`，再
`update_run(status="succeeded")`。失败路径同构——异常走 `update_run(status="failed", …)`，
取消走 `status="cancelled"`。

运行记录在 `create_run` 时先落一条 `status="running"` 的账，字段里 `conversation_id`
就是 agent 的 `memory_namespace`——运行与会话在记录里互相指认；`update_run` 在
succeeded / failed / cancelled 三个终态上补 `finished_at`。运行记录是一条有始有终的账，
不是一组可变字段。

读回**不是拿回原对象**——`InMemoryRunStore` 落账时把事件序列化成 JSON 字符串
（`append_event` 里那行 `self._events.setdefault(run_id, []).append(event.model_dump_json())`），
读回时重新验证：

```python
    async def get_events(self, run_id: str) -> list[AgentEvent]:
        async with self._lock:
            raw_events = list(self._events.get(run_id, []))
        return [_AGENT_EVENT_ADAPTER.validate_json(raw) for raw in raw_events]
```

`get_events` 的协议文档同样只承诺插入顺序（"Return persisted events in insertion order."）。

> **原理对照**：`iota-core/src/iota_core/storage/run_store.py::class RunStore`。
> DSH 侧同编号阶段（M05.4）装载的是 projection checkpoint——**可丢弃**的加速层，落后于日志
> 是允许的、丢了可以从日志重算（见 dsh 第 05 课第 6 节）。iota 没有投影层，所以也没有这层
> 缓存：`RunStore` 保存的就是运行事实本体。同编号、同一个控制面（"运行之后，事实与派生状态
> 还能不能拿回来"），两边的答案一个是"加速"，一个是"落账"。

---

## 7. 负证据：事件 schema 里没有 seq/surface

打开 [`scenes/05_no_sequence_contract.py`](../M05-session-surface/scenes/05_no_sequence_contract.py)。
负证据的写法是：先声明 DSH 不变量字段的集合，再到**真实事件模型**上检查交集——

```python
#: DSH 会话日志的不变量字段；iota 的事件 schema 里不应出现同名承诺。
DSH_FIELDS = frozenset({"seq", "sequence", "surface"})


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    schemas = {
        "text_delta": set(TextDeltaEvent.model_fields),
        "final": set(FinalEvent.model_fields),
    }
    promised = sorted(
        f"{name}.{field}" for name, fields in schemas.items() for field in fields & DSH_FIELDS
    )
    require(promised == [], "事件 schema 不承诺 DSH sequence/surface 字段", promised)
```

对应第 2 节 M05.5 的三行事实：`checked_schemas = [final, text_delta]`、
`dsh_fields_present = []`、`sequence_contract = not part of the iota event schema`。
"负证据"的意思是**用字段缺失本身当断言**——`model_fields` 是 pydantic 模型的真实字段表，
交集为空是可执行的证据，不是文档里的口头声称。

把两个模型的字段摊开（`iota-core/src/iota_core/types.py`），一共 13 个：

| 事件模型 | 全部字段 |
|---|---|
| `TextDeltaEvent` | `type`、`text` |
| `FinalEvent` | `type`、`text`、`usage`、`session_id`、`subtype`、`is_error`、`errors`、`num_turns`、`duration_ms`、`duration_api_ms`、`total_cost_usd` |

没有 `seq` / `sequence` / `surface` 中的任何一个——`TextDeltaEvent` 的全部定义就是
`type: Literal["text_delta"] = "text_delta"` 与 `text: str` 两行。

这条边界直接推出三件事，逐条与 dsh 第 05 课对照：

1. **顺序的承诺是"插入顺序"，不是"编号日志"**。`get_messages` 与 `get_events` 的协议文档
   都只说 insertion order；iota 不承诺 `seq === 数组下标` 那种可重放不变量，也没有 `fork`
   的"稳定前缀"检查。
2. **没有 surface/replace/位置性折叠**。DSH 用 `surfaceOp={"op":"replace",…}` 在投影上
   原地折叠历史（见 dsh 第 05 课第 4 节）；`ConversationStore` 上能改变存储状态的只有
   `ensure_session` / `append_message` / `clear`——没有任何"改写第 N 条"的入口。
3. **没有 latest-wins 标题投影**。DSH 的 title 是 `session/title` 日志事件折叠出来的
   （见 dsh 第 05 课第 6 节）；iota 的 `AgentEvent` 是十个事件模型的判别联合
   （discriminator 是 `type`），里面没有任何标题事件。想要标题，宿主自己存。

> **原理对照**：`iota-core/src/iota_core/types.py::AgentEvent`。这不是"还没实现"，是
> **结构性边界**：DSH 的 seq/surface 不变量属于它的日志模型；iota 的事件 schema 只承诺
> 类型与插入顺序，重放、折叠、标题这类不变量要由宿主在存储之上自建。第 8 节的排障
> 就是这条边界的日常形态。

---

## 8. 排障：拿着 DSH 的 seq/surface 语义找字段

### 症状

你想把 dsh 第 05 课的直觉搬过来：读 `event.seq` 给事件编页码，或者想找"折叠历史"的
`surfaceOp` / `replace` 入口，或者想给会话改个标题。翻遍 `ConversationStore` / `RunStore`
与事件模型，都找不到——没有 `seq` 字段，没有 replace，没有 title。

### 定位

1. 先跑本课 M05.5：`dsh_fields_present = []` 就是"字段不存在"的可执行证据；在自己的
   REPL 里打印 `set(TextDeltaEvent.model_fields)` / `set(FinalEvent.model_fields)` 能看到
   全部字段。
2. 再看协议面：`dir(store)` 只有六个方法（M05.2 的 `protocol = [...]`）；
   `RunStore` 只有 `create_run` / `update_run` / `append_event` / `get_run` / `get_events`
   ——没有任何改写或投影入口。
3. 想确认"顺序到底承诺了什么"：读 `get_messages` / `get_events` 的协议文档——两处都只写
   insertion order，没有编号。

### 原因与修改

这不是缺功能，是结构性边界：事件 schema 属于内核侧，示例改不动，也不该改。三个合法的
修改方向：

- **要序号**：在宿主消费事件时自己编——`enumerate` 一次 `get_events` 的结果，或写进
  `Message.metadata`；序号是宿主视图，不是事件事实。
- **要折叠 / 标题**：在 store 之上自建一层投影。这正是 DSH 把 title 做成"日志事件 +
  latest-wins 折叠"的原因——它也是派生视图，不是字段；iota 给你 append-only 的事实，
  派生自己做。
- **确实要日志级不变量**（seq 连续、fork 稳定前缀、fail-closed 校验）：那是 DSH 日志模型的
  承诺，换用提供它的框架，不要在 iota 的事件模型上模拟——自己给 pydantic 事件加字段，
  内核一升级就没了。

---

## 9. 代码在哪

```bash
cd iota-example && ls M05-session-surface/impl M05-session-surface/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/session_probe.py`](../M05-session-surface/impl/session_probe.py) | `run_one_turn`：跑一轮再把消息与运行记录读回来；为什么每个场景各跑一轮 |
| [`scenes/01_persist_conversation.py`](../M05-session-surface/scenes/01_persist_conversation.py) | `roles == ["user", "assistant"]` 的顺序断言 |
| [`scenes/02_swap_conversation_store.py`](../M05-session-surface/scenes/02_swap_conversation_store.py) | 协议方法清单与换实例读回 |
| [`scenes/03_search_conversation_messages.py`](../M05-session-surface/scenes/03_search_conversation_messages.py) | `list_sessions` / `search_messages` 查询面 |
| [`scenes/04_read_run_record.py`](../M05-session-surface/scenes/04_read_run_record.py) | `run_record["status"]` 与子序列校验 |
| [`scenes/05_no_sequence_contract.py`](../M05-session-surface/scenes/05_no_sequence_contract.py) | `DSH_FIELDS` 负证据：`model_fields` 交集必须为空 |
| [`run.py`](../M05-session-surface/run.py) | 阶段清单：五个编号与 dsh 同名阶段对位 |

读法：先读 scene 看它怎么"演"。这一课的 impl 不是机制本体，只是"跑一轮再读回"的探针——
**真正的机制在 iota-core 的 storage 层**（`conversation_store.py` / `run_store.py` /
`in_memory.py`），拿 scene 里的断言当索引去读协议。

---

## 10. 动手练习

### 练习 A：只跑一个场景

```bash
cd iota-example && uv run python -m runtime.runner M05 --scene 03_search_conversation_messages
```

**可验证答案**：只输出 `──── M05.3 · 查询会话语料 ────` 一段，末行变成
`REAL_MODULE_OK M05 stages=1 calls=1 failed=0`。阶段过滤发生在编排层——验收契约不变，
粒度到单场景。

### 练习 B：换一个检索词

把 [`scenes/03`](../M05-session-surface/scenes/03_search_conversation_messages.py) 里的
`search_messages("库存")` 与返回值里的 `"query": "库存"` 一起换成 `"订单"`，重跑：

```bash
cd iota-example && uv run python -m runtime.runner M05 --scene 03_search_conversation_messages
```

**可验证答案**：`search_hits = 1`、`query = 订单`——这次命中的是 m05-a 的"订单已创建"。
再换成 `"已"`（两句话都含它）：`search_hits = 2`。检索就是子串匹配，检索词换了，
命中集就换——断言只认条数，不认内容。

### 练习 C（进阶）：真的换一个后端

把 [`scenes/02`](../M05-session-surface/scenes/02_swap_conversation_store.py) 里的
`store = InMemoryConversationStore()` 换成文件后端：

```python
from iota_core.storage.file_backend import FileConversationStore

store = FileConversationStore("/tmp/m05-file-store")
```

重跑并查看磁盘：

```bash
cd iota-example && uv run python -m runtime.runner M05 --scene 02_swap_conversation_store
ls /tmp/m05-file-store/conversations/
```

**可验证答案**：`swapped_store = FileConversationStore`、`messages = [demo]` 照旧；磁盘上
多出 `m05-swap.jsonl` 与 `m05-swap.meta.json`，前者正好一行 JSON 消息。协议六方法在文件
后端上同样成立——而且"每会话一个 JSONL 文件"正是 dsh M05.2 那个
`JsonlSessionPersistence` 的格式家族。**语义等价在这里的意思是：换实现，行为不换。**

---

**下一课** → [第 06 课 · 人在环路](06-human-in-the-loop.md)：M05 只回答"发生过什么"；下一课让 Agent 在关键处停下来，把"接下来做什么"交还给人。

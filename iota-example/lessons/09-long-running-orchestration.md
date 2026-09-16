# 第 09 课 · 长任务与编排：幂等入队、租约与 checkpoint

> **本课任务**：看清长任务需要哪些不在单次运行里的状态——幂等键、租约、尝试预算与恢复序号；
> 并确认两条边界：单次运行内部的重试细节属于内核，拉起 worker 进程属于宿主。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M09`
> **你将看到**：worker `claim()` 到 30 秒租约，`ack()` 之后 `queue_status = succeeded`；
> 同一条任务提交两次仍是 `task_id = m09-task`；而队列的公开 API 是
> `queue_api = [ack, claim, enqueue, fail, get, heartbeat, list_dlq]`——没有任何拉起 worker 的入口。

前置：[第 08 课 · 委派与预设](08-delegation-presets.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/09-long-running-orchestration.md](../../dsh-example/lessons/09-long-running-orchestration.md)——那边讲运行句柄 vs 目标状态机，本课讲 iota 的幂等键、租约与恢复序号。

---

## 1. 本课任务

DSH 把长任务拆成两个正交对象——**Job**（可取消的运行句柄）与 **Goal**（可回放的目标状态机），
外加 workflow worker 与 schedule 两个编排面。iota 的答案是**带租约、尝试预算与 checkpoint 的
任务队列**：任务是一行可以反复提交的数据，worker 由调用方驱动。对照判定是
[`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md) 里少见的一档——**语义等价（iota 提供更多耐久
语义）**，也是 12 个模块里唯一这样标注的一行：DSH 的 Job 状态在注册表里、Goal 状态靠会话日志
折叠；iota 把幂等对账、租约时限、尝试预算与恢复序号全部写成任务与 checkpoint 的显式字段。

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| Job：可取消运行句柄（start / read / wait / kill） | `GraphTask` 数据 + `claim()` 租约 + `ack()` 结算 | **语义等价**：运行状态是数据字段，不是注册表句柄 |
| Goal：目标状态机（日志即状态 + revision CAS） | checkpoint：节点状态 + `sequence` 恢复序号，`latest()` 读回最新一条 | **语义等价**：断点续跑在 iota 是显式落盘，在 DSH 靠折叠会话日志 |
| workflow worker（worker thread 执行脚本） | 队列 API 没有 worker / spawn / start 入口；`GraphWorker.run_once()` 由调用方驱动 | **结构性边界**：拉起 worker 进程归调用方 / 宿主 |
| schedule（把计划挂到耐久会话） | 没有对位面；退避节奏由 `fail()` 写进 `available_at` | **结构性边界**：定时计划归宿主 |

两条纪律（模块 README 三类边界的后两行）：**单次运行内部的重试细节属于内核**（`max_attempts`
管的是整条任务最多被认领几次）；**拉起 worker 进程属于宿主**——第 5 节用负证据证明队列没有这个入口。

```bash
cd iota-example && uv run python -m runtime.runner M09
```

---

## 2. 真实输出

```text
████ M09 · 长任务与编排：幂等入队、租约与 checkpoint ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M09.1 · 入队、认领与确认 ────
   owner = worker-a
   queue_status = succeeded
REAL_STAGE_OK M09.1 calls=1 ms=1240 in=12241 out=10 finish=success

──── M09.2 · 幂等键推进任务生命周期 ────
   task_id = m09-task
   enqueued_twice = True
REAL_STAGE_OK M09.2 calls=1 ms=4212 in=12241 out=10 finish=success

──── M09.3 · worker 由调用方驱动 ────
   status_without_worker = pending
   queue_api = [ack, claim, enqueue, fail, get, heartbeat, list_dlq]
   worker_entrypoints = []
   execution_driver = caller
REAL_STAGE_OK M09.3 calls=1 ms=6619 in=12239 out=10 finish=success

──── M09.4 · checkpoint 记录恢复序列 ────
   checkpoint_sequence = 1
   node_statuses = {prepare: succeeded}
REAL_STAGE_OK M09.4 calls=1 ms=6419 in=12239 out=10 finish=success

REAL_MODULE_OK M09 stages=4 calls=4 failed=0
```

**对照自己的输出**：末行必须逐字是 `REAL_MODULE_OK M09 stages=4 calls=4 failed=0`（四个
`Stage` 全部 `mechanism`，见 [`run.py`](../M09-long-running-orchestration/run.py)：每个阶段先打
一次真实内核 probe，再跑本地机制断言）。`ms=` 与 `in=` 随端点速度浮动。你还会看到
`[claude-code:unrecognized_model] {"model":"fuyao-coding","query_source":"sdk"}`——
[第 00 课](00-getting-started.md)讲过它不是错误，本课为省版面略去。

---

## 3. M09.1 租约：`claim()` 认领，`ack()` 结算

打开 [`impl/durable_task.py`](../M09-long-running-orchestration/impl/durable_task.py) 与
[`scenes/01_claim_and_ack.py`](../M09-long-running-orchestration/scenes/01_claim_and_ack.py)。
素材只有一个构造函数——耐久语义全部写在数据形状里：

```python
def graph_task(task_id: str = "m09-task") -> GraphTask:
    return GraphTask(
        task_id=task_id,
        agent_spec_ref="agent@1.0.0",
        graph_ref=GraphRef(name="long-task", version="1.0.0"),
        inputs={"work": "m09"},
        run_id=RUN_ID,
        max_attempts=2,
    )
```

`task_id` 是幂等键，`run_id` 标识这次长运行，`max_attempts=2` 是尝试预算；impl 的模块 docstring
把归属一句话说死：

> 耐久语义靠**数据形状**表达：task_id 是幂等键，`max_attempts` 是重试预算，租约由队列发放 ——
> 这些都不在单次运行内部，所以它们不属于内核。

场景一侧是 worker 三步——认领、结算、回读：

```python
    queue = InMemoryGraphTaskQueue()
    await queue.enqueue(graph_task())
    claimed = require_not_none(
        await queue.claim(owner="worker-a", lease_seconds=30), "worker 取得队列租约"
    )
    await queue.ack(claimed.task_id, owner="worker-a", result_status="succeeded")
    finished = require_not_none(await queue.get(claimed.task_id), "队列保存完成状态")
```

场景断言 `finished.status == "succeeded"`；两个事实 `owner = worker-a` 与
`queue_status = succeeded` 分别是 claim 写进数据的属主、ack 保存的最终状态。`claim()` 在
iota-core 里做的就是"把租约写进数据"（`InMemoryGraphTaskQueue.claim`）：

```python
                update={
                    "status": "running",
                    "attempt": task.attempt + 1,
                    "lease_owner": owner,
                    "lease_expires_at": now + lease_seconds,
                    "updated_at": now,
                },
```

**谁拿的**（`lease_owner`）、**什么时候到期**（`lease_expires_at = now + lease_seconds`）、
**第几次尝试**（`attempt + 1`）一次写齐。租约到期后任务重新可被认领——`claim` 的候选集包含
"running 且租约已过期"的任务，死掉的 worker 不会把任务永远占住。`ack()` 只认属主：不是租约的
owner 来结算，当场抛 `graph task 'm09-task' is not leased by 'worker-b'`；结算后 `lease_owner`
清空、`result_status` 落进数据——**最终状态由队列保存，而不只存在于 worker 的返回值里**。

> **原理对照**：`iota-core/src/iota_core/graph/task_queue.py::class GraphTask`；
> `InMemoryGraphTaskQueue` 的 docstring 写明 "Reference queue implementation with the same
> lease semantics as Redis"——教学内存队列与生产用的 `RedisGraphTaskQueue` 共享同一套租约语义。
> DSH 侧的运行句柄见 dsh 第 09 课第 3 节：那边准入靠 controller，这边"准入"就是 claim 到租约本身。

---

## 4. M09.2 幂等：同一个 task_id 提交两次，还是同一条任务

打开 [`scenes/02_enqueue_idempotently.py`](../M09-long-running-orchestration/scenes/02_enqueue_idempotently.py)：

```python
    queue = InMemoryGraphTaskQueue()
    request = graph_task()
    first = await queue.enqueue(request)
    duplicate = await queue.enqueue(request)
    require(first.task_id == duplicate.task_id, "重复入队保持 task id 幂等", duplicate.task_id)
```

两个事实：`task_id = m09-task`（提交两次，队列里仍然只有这一条）、`enqueued_twice = True`。
为什么需要它：提交后网络断了、进程重启了，调用方**不知道**上一次 enqueue 有没有成功——唯一
安全的做法是原样再提交一次，队列保证"同键 = 同一条任务"。iota 的幂等发生在**入队口**，比
DSH 的 Goal 用 revision CAS 防并发写入更早一层。

但幂等不只是去重，还有**对账**——`GraphTask.identity()` 列出 `task_id` 保护的全部字段：

```python
    def identity(self) -> tuple[Any, ...]:
        """Fields protected by ``task_id`` idempotency."""
```

保护的六项是 `agent_spec_ref`、`graph_ref`、`inputs`、`run_id`、`timeout_seconds`、
`max_attempts`。同一个 `task_id` 换一份 `inputs` 再提交，`enqueue` 不会悄悄合并，而是当场抛
`graph task 'm09-task' already exists with conflicting identity`——同键不同身份 = 冲突，fail
loud。iota-core 的 `ExecutionOutbox.submit(idempotency_key=…)` 是同一约定的封装：不传键就生成
`graph-task-<uuid>`，传了键它就是 `task_id`。

幂等键之所以能"推进任务生命周期"，是因为生命周期本来就跨 attempt：一条任务可能被认领多次
（重试、租约回收），每次都是**同一条任务**的第 N 次尝试，直到预算耗尽：

```text
enqueue ─▶ pending ─claim─▶ running ─ack─▶ succeeded
                         ├─ fail（预算未尽）─▶ retry ─到期后再次被 claim─▶ running …
                         └─ fail（预算耗尽）─▶ dlq（list_dlq() 可查）
```

`fail()` 的判定是 `attempt >= max_attempts`：预算内回 `retry` 并把 `available_at` 推到退避
之后，预算外进 `dlq`。`GraphWorker.run_once()` 对此有一条注释：worker 可能在图跑完、ack 之前
崩溃，回收者必须先确认那次**耐久成功**，而不是在下一个 attempt 里把副作用再执行一遍。

---

## 5. M09.3 worker 归属：队列只发租约，不自带执行进程

打开 [`scenes/03_worker_is_caller_driven.py`](../M09-long-running-orchestration/scenes/03_worker_is_caller_driven.py)。
它分两幕：先证明"没人来就永远不跑"，再证明"调用方来了才开始"。

```python
    queue = InMemoryGraphTaskQueue()
    enqueued = await queue.enqueue(graph_task("m09-waiting"))
    pending = require_not_none(await queue.get(enqueued.task_id), "任务在队列里")
    require(pending.status == "pending", "没有 worker 认领时任务保持等待", pending.status)

    api = sorted(name for name in dir(queue) if not name.startswith("_"))
    spawns = [name for name in api if "worker" in name or "spawn" in name or "start" in name]
    require(spawns == [], "队列不提供拉起 worker 的入口", spawns)
```

```text
   status_without_worker = pending
   queue_api = [ack, claim, enqueue, fail, get, heartbeat, list_dlq]
   worker_entrypoints = []
   execution_driver = caller
```

中间两行是**负证据**：队列的公开 API 只有这七个方法，没有名字带 worker / spawn / start 的。
入队成功不等于开始执行——`enqueue()` 只是把一行数据放进队列；`heartbeat` 只是续租、`fail`
只是记账，**没有一个方法会"开始干活"**。第二幕在同文件后半：调用方
`queue.claim(owner="worker-b", lease_seconds=30)` 认领到同一条任务——执行的开端是**调用方**
的 claim，这就是 `execution_driver = caller`。

iota-core 并非没有 worker——同一个文件里就有 `GraphWorker`，docstring 是
"Claim one task, run it idempotently, then ack/retry/DLQ it."。但看它的形状：

```python
    async def run_once(self) -> GraphTask | None:
        """Process at most one due task."""
```

`run_once`——**处理至多一条到期任务**。它是库，不是进程：你构造它、你调用它、你决定它的
生死与节奏。这就是"拉起 worker 进程属于宿主"：队列负责把"谁能拿、拿多久、拿几次"写清楚，
**谁去拿**是宿主的事。

> **原理对照**：DSH 侧的 workflow worker（worker thread 里跑脚本）见 dsh 第 09 课第 6 节——
> 那边 provider 拉起线程、脚本在隔离环境里执行；iota 的队列连"有没有人在跑"都不持有，
> `execution_driver = caller` 是唯一事实。

---

## 6. M09.4 checkpoint：节点状态与 `sequence` 显式落盘

打开 [`scenes/04_save_checkpoint.py`](../M09-long-running-orchestration/scenes/04_save_checkpoint.py)：

```python
    store = InMemoryCheckpointStore()
    await store.save(
        build_checkpoint(
            run_id=RUN_ID,
            plan_fingerprint="m09-plan",
            node_statuses={"prepare": "succeeded"},
            node_attempts={"prepare": 1},
            sequence=1,
        )
    )
    latest = require_not_none(await store.latest(RUN_ID), "读取最新 checkpoint")
    require(latest.sequence == 1, "checkpoint sequence 为 1", latest.sequence)
```

两个事实：`checkpoint_sequence = 1`、`node_statuses = {prepare: succeeded}`。一次
`build_checkpoint()` 提交五样东西：`run_id`（哪次运行）、`plan_fingerprint`（哪个计划版本）、
`node_statuses`（哪些节点到了什么状态）、`node_attempts`（各节点已提交到第几次尝试）与
`sequence`（恢复序号）。iota-core 的模块 docstring 把"记什么、不记什么"说得最准：

```python
A checkpoint is written once per node terminal state. It records just enough to
rebuild scheduling state after a crash: which nodes reached which status, under
which plan fingerprint. Node *payloads* stay in the ``NodeResultStore``; the
checkpoint is the index, not the data.
```

节点 **payload 不在 checkpoint 里**——"checkpoint 是索引，不是数据"，结果留在 `NodeResultStore`，
checkpoint 只存重建调度状态所需的最小集。`store.latest(RUN_ID)` 读回**最新一条**
（`InMemoryCheckpointStore` 按追加序保存同一 run 的 checkpoint，`latest` 取末尾），`sequence`
因此是对账序号：崩溃后重启的进程读 `latest()`，拿到的是"最新已提交的调度状态"——
`prepare: succeeded` 的节点不必重跑，恢复从下一个节点开始。这就是场景 docstring 所说的
"长任务因此可以从中间恢复"的数据基础。

> **原理对照**：`iota-core/src/iota_core/graph/checkpoint.py::def build_checkpoint`。
> DSH 侧的对位物是 Goal 的"日志即状态"（dsh 第 09 课第 5 节）：那边靠折叠会话日志重建
> 目标；这边把恢复所需的调度状态连同 `sequence` 显式写进 checkpoint——这也是本套模块里
> "iota 提供更多耐久语义"最直观的一处。

---

## 7. 排障：任务入队了，却永远不跑

### 症状

`enqueue()` 正常返回，`get(task_id)` 一直是 `pending`；没有报错、没有日志、没有任何进程
被拉起。模块也不会失败——**"没人执行"在队列看来根本不是错误**。

### 定位

1. 先用 `queue.get(task_id)` 确认状态：`pending` 说明任务在队列里、数据完好，只是没人
   `claim`。
2. 再数一遍队列的公开 API（第 5 节的做法）：
   `queue_api = [ack, claim, enqueue, fail, get, heartbeat, list_dlq]`——七个方法里没有
   worker、没有 spawn、没有 start。**这不是缺配置，是这个面根本不存在**。
3. 如果你在 iota-core 里找到了 `GraphWorker`，注意它的入口是 `run_once()`——
   "Process at most one due task"：你不调用它，它一步都不走。

### 原因与修改

这是边界，不是 bug：**拉起 worker 进程属于宿主**。修改方向是在宿主侧补驱动循环——自己写
claim → 执行 → ack/fail，或构造 iota-core 的 `GraphWorker` 并由你的进程调度它的节奏；队列
永远不会替你拉起任何东西。顺手分清另一条边界：**单次运行内部的重试细节属于内核**——
`max_attempts` 是"这条任务最多被认领几次"的预算；一次内核调用内部怎么重试，队列既不知道
也不该知道。

---

## 8. 代码在哪

```bash
cd iota-example && ls M09-long-running-orchestration/impl M09-long-running-orchestration/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/durable_task.py`](../M09-long-running-orchestration/impl/durable_task.py) | `graph_task()`：task_id / run_id / `max_attempts=2` 全在数据里 |
| [`scenes/01_claim_and_ack.py`](../M09-long-running-orchestration/scenes/01_claim_and_ack.py) | `claim(owner, lease_seconds)` → `ack()` → `get()` 验证 `succeeded` |
| [`scenes/02_enqueue_idempotently.py`](../M09-long-running-orchestration/scenes/02_enqueue_idempotently.py) | 同一 request 提交两次，`task_id` 不变 |
| [`scenes/03_worker_is_caller_driven.py`](../M09-long-running-orchestration/scenes/03_worker_is_caller_driven.py) | `pending` 等待、`dir(queue)` 负证据、调用方 claim |
| [`scenes/04_save_checkpoint.py`](../M09-long-running-orchestration/scenes/04_save_checkpoint.py) | `build_checkpoint(…)` 的五个实参与 `store.latest(RUN_ID)` |
| [`run.py`](../M09-long-running-orchestration/run.py) | 四个 `Stage`，全部 `mechanism` |

读法：先读 scene 看它怎么"演"，再读 impl 看素材怎么搭。本模块的 impl 只有一份构造函数——
**真正的机制都在 iota-core**：`iota-core/src/iota_core/graph/task_queue.py`（队列、租约、
DLQ 与 `GraphWorker`）与 `…/graph/checkpoint.py`（`build_checkpoint` 与 `CheckpointStore`）。

---

## 9. 动手练习

### 练习 A：租约只认属主

把 [`scenes/01`](../M09-long-running-orchestration/scenes/01_claim_and_ack.py) 里 `ack` 的属主
换掉——`worker-a` 认领，`worker-b` 想结算：
`await queue.ack(claimed.task_id, owner="worker-b", result_status="succeeded")`。

```bash
cd iota-example && uv run python -m runtime.runner M09 --scene 01_claim_and_ack
```

**可验证答案**：进程非零退出，错误信息是 `graph task 'm09-task' is not leased by 'worker-b'`
——知道 task_id 不等于有权结算，`queue_status = succeeded` 那行事实不会出现。租约认属主，
这就是 `owner = worker-a` 必须由 claim 写进数据的原因。

### 练习 B：幂等键的另一半——对账

在 [`scenes/02`](../M09-long-running-orchestration/scenes/02_enqueue_idempotently.py) 的两次
enqueue 之间，把第二次的 `inputs` 改掉再提交：

```python
    first = await queue.enqueue(request)
    drifted = request.model_copy(update={"inputs": {"work": "m09-other"}})
    await queue.enqueue(drifted)
```

```bash
cd iota-example && uv run python -m runtime.runner M09 --scene 02_enqueue_idempotently
```

**可验证答案**：抛 `graph task 'm09-task' already exists with conflicting identity`——同键
不同身份当场失败，不会悄悄合并。幂等 = 去重**加**对账；缺了后半句，重试提交就会把错误配置
悄悄送进队列。

### 练习 C：checkpoint 读回的是"最新一条"

在 [`scenes/04`](../M09-long-running-orchestration/scenes/04_save_checkpoint.py) 第一条 save
之后追加第二条：`sequence=2`，`node_statuses` 与 `node_attempts` 里各加一个 `execute` 节点
（如 `{"prepare": "succeeded", "execute": "running"}`），并把场景断言同步改成
`require(latest.sequence == 2, …)`。

```bash
cd iota-example && uv run python -m runtime.runner M09 --scene 04_save_checkpoint
```

**可验证答案**：`checkpoint_sequence = 2`、
`node_statuses = {prepare: succeeded, execute: running}`——`latest()` 按追加序取最后一条。
恢复的进程读到的永远是"最新已提交的调度状态"，`sequence` 就是这串追加的对账序号。

---

**下一课** → [第 10 课 · 外部能力接入](10-external-capabilities.md)：Skill 是文件投影、MCP 是协议、Host plane 归宿主——外部能力从不进编排层的注册面。

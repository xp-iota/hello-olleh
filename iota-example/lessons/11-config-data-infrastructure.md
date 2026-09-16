# 第 11 课 · 配置与数据设施：投影、存储协议与宿主边界

> **本课任务**：看清 iota 在"配置与数据"上治理哪两件事——把来源配置**投影**成内核读的真实文件、
> 把运行事实交给一条**可换的存储协议**；再用三条证据确认边界：`AgentConfig` 不伪造凭证/附件字段、
> 装配报告不带凭证本体、没有 iota-managed 布局的内核当场抛 `ConfigError`。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M11`
> **你将看到**：`config_file = settings.json`、`projection = real file`——投影出来的是真实文件；
> `protocol = [append_event, create_run, get_events, get_run, update_run]`——存储是一条五个方法的协议；
> 而 M11.6 的拒绝原文以 `config_profile is not supported for adapter 'dsh'` 开头。

前置：[第 10 课 · 外部能力接入](10-external-capabilities.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/11-config-data-infrastructure.md](../../dsh-example/lessons/11-config-data-infrastructure.md)——那边讲分层解析与内容寻址，本课讲 iota 的投影、协议与"不读秘密"。

---

## 1. 本课任务

DSH 在这个编号上装了六层：settings、storage domain、attachment、file reference、credential 与
workspace（对照关系：**语义等价 + 结构性边界**，证据表见 [`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md)）。
iota 治理其中两件——**配置投影**与**存储协议**，凭证与附件归宿主：

| DSH 控制面 | iota 侧机制 | 归属 |
|---|---|---|
| **settings**：schema 默认值 → base → user 三层解析，`revision` 做乐观并发 | `ConfigProfileManager.prepare()` 按适配器把来源配置投影成真实文件（M11.1 / M11.4） | 语义等价：治理的都是"内核读哪份配置"；解析权移交给内核，分层叠加与 CAS 没有对位物 |
| **storage domain**：Storage hub + backend + 声明式路由 | `RunStore` / `ConversationStore` 两条可换协议，`InMemoryRunStore` 是进程内默认（M11.2） | 语义等价：换后端不改调用方；没有路由层，"落在哪"由协议消费方决定 |
| **attachment**：内容寻址，id 就是 `sha256:` 摘要 | 没有——`AgentConfig` 不伪造 attachment 字段（M11.3） | 结构性边界：附件归宿主 |
| **file reference**：按 Agent workspace 索引，只给相对路径 | 没有——编排层没有文件索引面，本课六个阶段也不涉及它 | 结构性边界：候选文件归内核/宿主 |
| **credential / authorization**：safe description 只报布尔 | 凭证只从环境/.env 读，装配报告不带凭证本体（M11.5） | 结构性边界：凭证归宿主环境 |
| **workspace**：注册表组合 storage 与 Session 持久化 | 没有 workspace 组合面——运行存储与会话存储各走各的协议（M11.2） | 结构性边界：组合归宿主 |

```bash
cd iota-example && uv run python -m runtime.runner M11
```

---

## 2. 真实输出

```text
████ M11 · 配置与数据设施：投影、存储协议与宿主边界 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M11.1 · 配置投影成真实文件 ────
   config_file = settings.json
   projection = real file
REAL_STAGE_OK M11.1 calls=1 ms=1518 in=12241 out=10 finish=success

──── M11.2 · 运行存储按协议读写 ────
   run_status = succeeded
   protocol = [append_event, create_run, get_events, get_run, update_run]
   storage = memory
REAL_STAGE_OK M11.2 calls=1 ms=3132 in=12240 out=10 finish=success

──── M11.3 · 凭证与附件归宿主 ────
   faked_host_fields = []
   credentials_attachments = host-owned
REAL_STAGE_OK M11.3 calls=1 ms=892 in=12241 out=10 finish=success

──── M11.4 · 投影目录布局可检查 ────
   config_file = settings.json
   projected_entries = [settings.json]
   profile_env_keys = [CLAUDE_CONFIG_DIR]
REAL_STAGE_OK M11.4 calls=1 ms=3965 in=12241 out=172 finish=success

──── M11.5 · 凭证只来自环境配置 ────
   config_variables = [LLM_API_KEY, LLM_VENDOR, LLM_BASE_URL, LLM_MODEL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL]
   report_keys = [cli, kernel, model, sdk, vendor]
   leaked_fields = []
   credential_owner = host environment
REAL_STAGE_OK M11.5 calls=1 ms=3244 in=12240 out=10 finish=success

──── M11.6 · 不支持的布局明确拒绝 ────
   dsh_profile_refusal = config_profile is not supported for adapter 'dsh': it has no iota-managed config home to project into. Adapters that do: ['claude', 'hermes', 'hermes_direct']. …
REAL_STAGE_OK M11.6 calls=1 ms=3873 in=12239 out=10 finish=success

REAL_MODULE_OK M11 stages=6 calls=6 failed=0
```

**对照自己的输出**：最后一行必须是 `REAL_MODULE_OK M11 stages=6 calls=6 failed=0`。六个阶段全是
`mechanism`：每阶段的 `calls=1` 是入口 probe（真实内核复述），机制断言本身不消耗模型调用；`ms=` /
`in=` / `out=` 随端点浮动；事实行缩进来自 `runtime/runner.py::print_facts`，M11.6 行尾的 `…` 是
观测渲染的 160 字符截断。省略的 `[claude-code:unrecognized_model]` 行不是错误（[第 00 课](00-getting-started.md)）。

---

## 3. 投影：来源配置变成内核读的真实文件

打开 [`scenes/01_project_config_profile.py`](../M11-config-data-infrastructure/scenes/01_project_config_profile.py)
与 [`impl/profile_fixture.py`](../M11-config-data-infrastructure/impl/profile_fixture.py)——后者是 M11
唯一的 impl，全文 25 行。场景只做三件事：写一份来源配置、声明一份投影请求、把投影结果当真实文件检查：

```python
        profile = ConfigProfileManager(root / "profiles").prepare(
            adapter="claude",
            spec=claude_spec(root, settings_source(root)),
            kernel_name="claude-kernel",
            agent_name="m11",
        )
        config_file = require_not_none(profile.config_file, "profile 返回配置文件路径")
        require(Path(config_file).is_file(), "profile 配置文件真实存在", config_file)
```

素材就两个函数：`settings_source()` 写下**来源配置**——调用方自己拥有的文件；`claude_spec()` 是
投影请求，`source` 说"从这份文件投影"，`target_dir` 说"落到这个目录"：

```python
def settings_source(root: Path) -> Path:
    source = root / "settings.json"
    source.write_text(json.dumps({"model": "demo"}), encoding="utf-8")
    return source


def claude_spec(root: Path, source: Path) -> dict[str, Any]:
    return {"source": str(source), "target_dir": str(root / "projected")}
```

`prepare()` 按适配器解析请求（`iota-core/src/iota_core/config_profiles/manager.py::class ConfigProfileManager`）。
Claude 投影器把来源复制成 profile 目录里的 `settings.json`（没有来源时只认已存在的同路径文件），
再把 `CLAUDE_CONFIG_DIR` 指向 profile 目录：

```python
        settings_file: Path | None = None
        if spec.source:
            settings_file = profile_dir / "settings.json"
            self._copy_file(Path(spec.source).expanduser(), settings_file)
```

```python
        env = dict(spec.env)
        env["CLAUDE_CONFIG_DIR"] = str(profile_dir)
```

对上 M11.1 的两行事实：`config_file = settings.json`、`projection = real file`——**投影出来的是
真实文件**：它在磁盘上、能被 `Path.is_file()` 检查、能被内核子进程读取（场景返回的是文件名，
完整路径在临时目录下）。这不是"内存里组装一个配置对象"，而是"把调用方的文件放到内核认的位置，
再用环境变量把内核指过去"。配套纪律：spec 的键是白名单（`ConfigProfileSpec` 用 `extra="forbid"`，
写错键名装配期就抛 `ConfigError`）；文件以 0600 写入、目录 0700、复制走"临时文件 + 原子替换"。

> **原理对照**：这条投影路径不是教学专用——真实装配里 `ClaudeAdapter.create_session` 对每个带
> `extra["config_profile"]` 的 `AgentConfig` 调同一个 `prepare(adapter="claude", …)`，把
> `profile.claude_options`（含 `settings` 与 `CLAUDE_CONFIG_DIR`）合并进 SDK 选项
> （`iota-core/src/iota_core/adapters/claude.py::class ClaudeAdapter`）。DSH 的三层解析与 `revision`
> CAS 在框架内（dsh 第 11 课第 3、4 节）；iota 不解析配置内容，**只治理内核读到哪份文件**。

---

## 4. 存储协议：run_id 由 RunStore 分配，状态按协议更新

打开 [`scenes/02_route_run_store.py`](../M11-config-data-infrastructure/scenes/02_route_run_store.py)。
场景 docstring 已经把命题说完："运行存储：RunStore 是另一条协议，运行事实与会话消息分开治理。"

```python
    store = InMemoryRunStore()
    run_id = await store.create_run(harness.agent(name="m11-run"))
    await store.append_event(run_id, FinalEvent(text="done"))
    await store.update_run(run_id, status="succeeded")
    record = require_not_none(await store.get_run(run_id), "运行记录可读回")
    protocol = sorted(name for name in dir(store) if not name.startswith("_"))
```

注意第一行**换了一个全新的** `InMemoryRunStore`——场景不碰 harness 里装配好的那条存储，单独验证
协议本身。日志三条事实 `run_status = succeeded`、`storage = memory` 之外，最值得读的是协议面：

- **run_id 由存储分配**：`create_run()` 返回 `run-{uuid4().hex}`，调用方不发明 id；记录里写的是
  `agent_id` 与 `conversation_id`，运行事实和会话消息从第一行起就分开治理。
- **状态按协议更新**：`status` 是自由字符串，但只有 `succeeded/failed/cancelled` 三个终态会落
  `finished_at`。
- **协议面就是那五个方法**：`protocol = [append_event, create_run, get_events, get_run, update_run]`
  是 `dir(store)` 的过滤结果，与 `iota-core/src/iota_core/storage/run_store.py::class RunStore`
  声明的 `Protocol` 一一对应；`InMemoryRunStore` 只是它的进程内默认实现。

运行存储与会话存储是**两条协议**：装配处把它们作为两个独立参数递给 `IotaRuntime`
（`conversation_store=…` 与 `run_store=…`，见 [`runtime/harness.py`](../runtime/harness.py)）。

> **原理对照**：DSH 的 storage 是 hub + backend + **domain 声明式路由**（dsh 第 11 课第 5 节）；
> iota 没有路由层——`IotaRuntime` 直接选择协议实现，"可换"体现在 `Protocol` 上而不是路由表上
> （会话那条协议见 `iota-core/src/iota_core/storage/conversation_store.py::class ConversationStore`，
> 第 05 课）。语义等价：两边换后端都不改调用方。

---

## 5. 宿主边界一：AgentConfig 不伪造凭证/附件字段

打开 [`scenes/03_credentials_are_host_owned.py`](../M11-config-data-infrastructure/scenes/03_credentials_are_host_owned.py)，
全文 19 行，核心是一次字段名扫描：

```python
HOST_WORDS = ("credential", "attachment", "secret", "token")


async def run(harness: WorkshopHarness) -> dict[str, Any]:
    faked = sorted(
        name for name in AgentConfig.model_fields if any(word in name for word in HOST_WORDS)
    )
    require(faked == [], "AgentConfig 不伪造凭证/附件字段", faked)
```

`AgentConfig.model_fields` 是 pydantic 的字段表（`iota-core/src/iota_core/types.py::AgentConfig`：
name、kernel、model、tools、mcps、skills、memory_namespace…）。把每个字段名拿去和四个宿主词比对：

```text
   faked_host_fields = []
   credentials_attachments = host-owned
```

`faked_host_fields = []` 是**负证据**：这张配置表里没有任何凭证/附件字段——iota 不是"有字段但
先不填"，而是**根本不给它们留位置**；`credentials_attachments = host-owned` 是场景对归属的结论行。
一个诚实的脚注：`AgentConfig` 有一个 `extra: dict[str, Any]`，但那是**适配器选项的通道**（第 3 节的
`config_profile` 就从这里读）——塞进去的键 iota 不解释、不承诺脱敏；把密钥放进 `extra` 不会
"绕过"边界，只会让它脱离一切治理。

---

## 6. 布局可检查：投影目录可以用 Path 列举

打开 [`scenes/04_inspect_projected_layout.py`](../M11-config-data-infrastructure/scenes/04_inspect_projected_layout.py)。
它与 M11.1 用同一份素材，检查对象从"文件存在"扩大到"目录布局"：

```python
        config_file = Path(require_not_none(profile.config_file, "profile 返回配置文件路径"))
        projected = sorted(item.name for item in config_file.parent.iterdir())
        env_keys = sorted(profile.env) if getattr(profile, "env", None) else []
        require(config_file.is_file(), "配置文件真实存在", config_file.name)
        require(projected != [], "投影目录里有内容", projected)
```

因为投影是真实目录，检查它**不需要任何专用 API**：`Path.iterdir()` 列举出
`projected_entries = [settings.json]`——`ls` 同一个目录得到同一个列表；`config_file = settings.json`
与 M11.1 那行相同，这次检查的是**目录**。`profile_env_keys = [CLAUDE_CONFIG_DIR]` 是布局的另一半：
**文件落到哪 + 用哪个环境变量把内核指过去**，两半合起来才是完整的"投影布局"。DSH settings 的
解析值在内存里，检查靠 API（`describe()` / `get()`）；iota 的投影在磁盘上，检查靠文件系统——
这也是"投影"这个名字的由来。

---

## 7. 宿主边界二：凭证只来自环境，装配报告不带本体

打开 [`scenes/05_credentials_come_from_env.py`](../M11-config-data-infrastructure/scenes/05_credentials_come_from_env.py)。
三条断言对三条事实：

```python
    report = dict(harness.preflight_report)
    leaked = sorted(key for key in report if "token" in key.lower() or "key" in key.lower())
    require(leaked == [], "装配报告里没有凭证字段", leaked)
    require("LLM_API_KEY" in CONFIG_VARIABLES, "凭证是声明过的配置项", CONFIG_VARIABLES)
    require(redact("token=abc") == "token=abc", "脱敏只作用于真实凭证与端点")
```

- `report_keys = [cli, kernel, model, sdk, vendor]`：装配报告（[`runtime/harness.py`](../runtime/harness.py)
  的 `preflight()`）只有五个键，**没有一个是凭证**——都是"装配了什么"的元数据，不是配置的本体。
- `config_variables = [LLM_API_KEY, …, ANTHROPIC_MODEL]`（全文见第 2 节）：凭证是**声明过的配置项**
  ——`CONFIG_VARIABLES` 的白名单，从 `iota-example/.env` 或环境读；内核子进程通过
  `ANTHROPIC_AUTH_TOKEN` 拿到它，但报告里只有名字。
- `redact("token=abc") == "token=abc"`：脱敏不按关键词——只替换**真实的**凭证值、端点 URL 与绝对
  路径。碰巧叫 token 的字符串不会被误伤；真实密钥无论出现在哪都会被换成 `<redacted-key>`。

DSH 的 credentials 暴露 `describe()` 的两个布尔——配置面知道"配了没有"，不知道"是什么"（dsh 第
11 课第 7 节）。iota 更进一步：**连 credential provider 都没有**，宿主环境就是凭证库，装配报告只
描述装配（哪个内核、哪个 vendor、哪个模型、哪个 SDK、哪个 CLI）。

---

## 8. 明确拒绝：没有 iota-managed 布局当场抛 ConfigError

打开 [`scenes/06_reject_unsupported_layout.py`](../M11-config-data-infrastructure/scenes/06_reject_unsupported_layout.py)。
这次投影请求换成 `dsh_spec`——**只有 source，没有 target_dir**——场景对 `adapter="dsh"` 调同一个
`prepare()`，结果不是"一份被忽略的配置"，而是当场报错：

```python
def dsh_spec(source: Path) -> dict[str, Any]:
    return {"source": str(source)}
```

```text
   dsh_profile_refusal = config_profile is not supported for adapter 'dsh': it has no iota-managed config home to project into. Adapters that do: ['claude', 'hermes', 'hermes_direct']. …
```

（160 字符截断见第 2 节；完整报错接着给出可执行指引——指向 `command` 与 `env`，见
`iota_core.providers.resolve_config_profile_projector`。）场景用 `except ConfigError` 接住它，并给
"本该失败却成功"准备了兜底：

```python
        except ConfigError as exc:
            refusal = str(exc)
        else:  # pragma: no cover
            fail("不支持 iota-managed layout 的 DSH profile 明确拒绝")
```

为什么 dsh 拿不到投影？**投影的本质是布局**：哪些文件落到哪、用哪个环境变量把内核指过去。dsh 从
命令行 `--config <cordis.yml>` 读自己的配置，没有"被 iota 管理的配置家目录"，也就没有可投影的
布局——projector 注册表里没有它，只登记了三个：

```python
register_config_profile_projector("hermes", ConfigProfileManager.project_hermes)
register_config_profile_projector("hermes_direct", ConfigProfileManager.project_hermes)
register_config_profile_projector("claude", ConfigProfileManager.project_claude)
```

日志里 `Adapters that do: ['claude', 'hermes', 'hermes_direct']` 正是这张注册表的内容。

> **原理对照**：`iota-core/docs/architecture/kernel-replacement.md::不登记 dsh`——config profile
> 的本质是投影布局，dsh 用命令行读配置、没有可投影的布局，硬造只会生成内核永远不读的 profile
> 目录，因此继续 fail-loud，错误信息改成可执行的指引。

---

## 9. 排障：最典型的困惑

### 症状

给 `AgentConfig` 塞了凭证或附件（`AgentConfig(..., api_key=…)`，或 `extra={"api_key": …}`），
"好像没生效"：环境里没配密钥时照样在模块开始前抛 `KernelUnavailable`，附件也从来没被读过。

### 定位

先跑 M11.3——`faked_host_fields = []` 说明字段表里根本没有这些名字。再确认：pydantic 对未声明
字段默认 `extra='ignore'`，多传的关键字参数在构造时被**静默丢弃**，连 `extra` 都进不去；手动放进
`extra` 的键，iota 只按适配器选项解释（如 `config_profile`），没有谁带凭证语义去读它。

### 原因与修改

这是刻意的归属设计，不是漏实现。凭证的通道是**宿主环境**：`.env` 里的 `LLM_API_KEY` 由 harness
读出、转发为 `ANTHROPIC_AUTH_TOKEN`（M11.5 的 `config_variables` 就是这条白名单）；附件归内核的
工具能力（第 07 课）或宿主自己管理。把凭证写回环境，**不要**给 `AgentConfig` 加字段来"修"它——
加了字段就是把秘密塞进可序列化的配置对象。

同方向的另一类困惑：接一个从命令行读配置的内核（dsh 就是这样），`config_profile` 一指过去，
`prepare()` 当场抛 `ConfigError`。定位同 M11.6——报错正文就是判据；修改二选一：注册一个 projector
（`register_config_profile_projector`，实现可参照 `project_claude`），或按报错指引走 `command` /
`env` 显式递配置。没有"被管理的配置家目录"的内核，正确答案就是后者——**尊重边界，不要为了
消除报错而造出无人读取的目录**。

---

## 10. 代码在哪

```bash
cd iota-example && ls M11-config-data-infrastructure/impl M11-config-data-infrastructure/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/profile_fixture.py`](../M11-config-data-infrastructure/impl/profile_fixture.py) | `settings_source`（写来源配置）、`claude_spec`（source + target_dir）、`dsh_spec`（只有 source） |
| [`scenes/01_project_config_profile.py`](../M11-config-data-infrastructure/scenes/01_project_config_profile.py) | `prepare(adapter="claude", …)` 与 `Path(config_file).is_file()` 检查 |
| [`scenes/02_route_run_store.py`](../M11-config-data-infrastructure/scenes/02_route_run_store.py) | `create_run/append_event/update_run` 序列与 `dir(store)` 协议面 |
| [`scenes/03_credentials_are_host_owned.py`](../M11-config-data-infrastructure/scenes/03_credentials_are_host_owned.py) | `HOST_WORDS` 扫描 `model_fields` 的负证据 |
| [`scenes/04_inspect_projected_layout.py`](../M11-config-data-infrastructure/scenes/04_inspect_projected_layout.py) | `iterdir()` 列举投影目录、`profile.env` 的键 |
| [`scenes/05_credentials_come_from_env.py`](../M11-config-data-infrastructure/scenes/05_credentials_come_from_env.py) | `preflight_report` 键扫描、`CONFIG_VARIABLES`、`redact` 的作用域 |
| [`scenes/06_reject_unsupported_layout.py`](../M11-config-data-infrastructure/scenes/06_reject_unsupported_layout.py) | `except ConfigError` 分支与 `fail(…)` 兜底 |
| [`run.py`](../M11-config-data-infrastructure/run.py) | 六个 Stage 的编号、类型与场景名 |

iota-core 侧按 `pyproject.toml` 的 editable source 定位：`src/iota_core/config_profiles/manager.py`
（投影器与注册表）、`src/iota_core/storage/run_store.py`（协议与内存实现）、
`src/iota_core/types.py::AgentConfig`（字段表）、`src/iota_core/errors.py::ConfigError`、
`src/iota_core/providers.py`（projector 解析与报错正文）。读法：**先读 scene 看它"演"哪几行输出，
再读 impl 看素材怎么写**——M11 的 impl 只有一个 25 行的 fixture。

---

## 11. 动手练习

### 练习 A：走一遍投影的失败路径

把 [`scenes/01`](../M11-config-data-infrastructure/scenes/01_project_config_profile.py) 里的
`claude_spec(root, settings_source(root))` 换成 `claude_spec(root, root / "missing.json")`（来源
文件不存在），重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M11 --scene 01_project_config_profile
```

**可验证答案**：入口 probe 照常发起并作答，随后进程以非零退出结束，traceback 最后一行是
`iota_core.errors.ConfigError: Config profile source file does not exist: …`，且**没有**
`REAL_MODULE_OK` 行——`_copy_file` 对不存在的来源当场拒绝，投影不会静默生成空 profile。

### 练习 B：换一条状态路径

把 [`scenes/02`](../M11-config-data-infrastructure/scenes/02_route_run_store.py) 里的
`await store.update_run(run_id, status="succeeded")` 改成
`await store.update_run(run_id, status="failed", error="demo")`，并在 `return` 前加一行
`require(record["error"] == "demo", "error 按协议记录", record)`：

```bash
cd iota-example && uv run python -m runtime.runner M11 --scene 02_route_run_store
```

**可验证答案**：观察行变成 `run_status = failed`，新断言通过。再把 status 换成自造词（例如
`paused`）：断言照样通过——协议对 status 不设枚举，形参就是 `str`——但 `record["finished_at"]`
仍是 `None`：只有 `succeeded/failed/cancelled` 三个终态会落完成时间。

### 练习 C（进阶）：不给 target_dir，看默认布局

把 [`impl/profile_fixture.py`](../M11-config-data-infrastructure/impl/profile_fixture.py) 的
`claude_spec` 改成只返回 `{"source": str(source)}`，再给
[`scenes/04`](../M11-config-data-infrastructure/scenes/04_inspect_projected_layout.py) 的 return
加一条 `"parent": config_file.parent.name`：

```bash
cd iota-example && uv run python -m runtime.runner M11 --scene 04_inspect_projected_layout
```

**可验证答案**：`config_file = settings.json`、`profile_env_keys = [CLAUDE_CONFIG_DIR]` 不变；新增的
`parent` 形如 `m11-layout-<12 位十六进制>`——没有 `target_dir` 时，`_profile_dir` 用
`base_dir/claude/<安全名>-<来源哈希前 12 位>` 决定布局，哈希来自 `source`/`env_file`/`profile_name`
的 SHA-256（`_source_token`）。同一条投影请求永远落进同一个目录名。

---

**下一课** → [第 12 课 · 框架机制本体](12-framework-mechanisms.md)：投影生成了磁盘上的真实文件与目录，注册过的内核与资源靠什么收干净？`EffectStack` 的 LIFO 拆除、身份安全回收与配置叠加，把前十一课反复借用的可逆机制收进机制本体。

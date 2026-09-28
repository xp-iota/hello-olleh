# 第 00 课 · 跑起来：环境、命令与验收契约

> **本课任务**：把 12 个对照模块里的任意一个真正跑起来，并看懂它的输出结构。
> **运行命令**：`cd iota-example && uv sync --extra dev --extra hermes && uv run python -m runtime.runner M12`
> **你将看到**：末行输出 `REAL_MODULE_OK M12 stages=5 calls=5 failed=0`。

这一课不涉及任何 iota 概念。它只解决一件事：**让你能用真实内核跑通第一个模块，并知道"跑通了"长什么样**。
不先做完这一课，后面 12 课的输出都对不上。

---

## 1. 这套工程是什么

`iota-example/` 是 `dsh-example/M01–M12` 的**同编号 Python 对照工程**：目录名、阶段编号与
验收口径逐一相等，同一个编号在两边指向同一个控制面。iota 侧要么给出**语义等价**的机制，
要么给出**结构性边界**的可运行证据（"编排层没有这个注册面，能力归内核"），不为凑编号编造能力。

有四件事和常见的"示例仓库"不一样，直接决定了你接下来的体验：

| 事实 | 含义 |
|---|---|
| iota-core `2026.9.16` 以**本地 editable source** 装配（`[tool.uv.sources]` 指向本地源码树） | 你读到的是本地真实实现，不是 PyPI 快照 |
| **没有 mock，没有离线路径** | 每个阶段都真的调用推理服务；缺密钥就当场抛 `KernelUnavailable` |
| 默认内核是 `hermes_direct`（同进程、**OpenAI 兼容**协议）；也可切到 `claude`（Claude Agent SDK + CLI、Anthropic 兼容） | "内核"是一份真实实现，编排层只是它的一个消费者；**换内核不改编排层** |
| 12 个模块共享一套装配（`runtime/harness.py`）与编排（`runtime/runner.py`） | 日志骨架与 `dsh-example` 逐行对齐，两边输出可对读 |

工程共 **60 个阶段**，与 dsh 同一套编号（含三个 `.d` 专项演示）。
逐模块对照与源码引用见 [`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md)。

---

## 2. 前置条件

| 要求 | 为什么 |
|---|---|
| **Python `>=3.11,<3.14`** + [uv](https://docs.astral.sh/uv/) | 依赖锁定与 editable source 装配都走 uv |
| 一个可用的推理服务密钥与端点 | 所有阶段都要真实调用模型 |
| —— 走默认的 `hermes_direct` 时 —— | |
| `hermes-agent`（`uv sync --extra hermes`） | 同进程内核实现 |
| 一个 **OpenAI 兼容**端点（`/v1/chat/completions`） | Hermes 的协议 |
| —— 走 `claude` 时（`IOTA_KERNEL=claude`）—— | |
| `claude-agent-sdk`（`uv sync --extra real`） | 驱动内核子进程 |
| `claude` CLI 在 `PATH` 上 | SDK 靠它拉起内核 |

先确认解释器版本：

```bash
python3 --version   # 需要 3.11 … 3.13
uv --version
```

`runtime/harness.py::preflight()` 在每个模块启动前核对凭证与所选内核的依赖，缺任何一样都会
**在模块开始前失败**，不会跑到一半才挂。

---

## 3. 配置密钥

配置放在工程根的 `.env`，模板是 [`.env.example`](../.env.example)：

```bash
IOTA_KERNEL=hermes_direct        # 或 claude
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=fuyao-coding
```

> **shell 里的同名变量优先级更高**：`load_project_env` 只填空缺、不覆盖已有 env。若发现
> 跑起来的端点不是 `.env` 里写的，先 `unset` 掉 shell 里那几个（`env | grep -E '^(LLM|ANTHROPIC|HERMES)_'`）。
> 这个坑很难自查——`preflight` 报的 model 和你以为的配置不一致时，第一嫌疑就是它。

[`runtime/harness.py`](../runtime/harness.py) 启动时自动加载它（`load_project_env()`）。
两种内核读同一份配置：`hermes_direct` 用 `HERMES_BASE_URL / HERMES_API_KEY / HERMES_MODEL`，
缺失时回落到 `LLM_*`；`claude` 用 `LLM_*`（兼容 `ANTHROPIC_*`），并把凭证、端点与模型
翻译成 `ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL` 交给子进程，
三档默认模型别名统一指向配置的模型，防止内核悄悄挑一个自带的默认模型。

**缺密钥时会立即抛错，不存在静默退化**：

```text
KernelUnavailable: 运行缺少配置：LLM_API_KEY（兼容 ANTHROPIC_AUTH_TOKEN）。
  配置来源：iota-example/.env（已被 git 忽略；模板见 .env.example）
  推荐配置：LLM_API_KEY / LLM_VENDOR / LLM_BASE_URL / LLM_MODEL
  没有配置就没有内核：工程不提供任何替代模型的本地实现。
```

也可以临时注入，不写 `.env`：

```bash
LLM_API_KEY=<your-key> uv run python -m runtime.runner M12
```

---

## 4. 安装并跑第一个模块

```bash
cd iota-example
uv sync --extra dev --extra hermes
```

先跑 **M12**——它观察的是编排层自己的机制（effect 栈、注册表），对模型回答内容不敏感，
最适合用来确认链路通了：

```bash
uv run python -m runtime.runner M12
```

> 为什么选 M12 而不是 M01：M01.d 要检查"内核是否**自主**调用了工具"，对模型行为敏感；
> M12 只观察可逆机制，内核只负责 probe 复述。**先用 M12 确认链路，再用 M01 研究内核行为。**

---

## 5. 看懂输出：验收契约

模块输出分三段。以 M12 的第一段为例：

```text
████ M12 · 框架机制本体：可逆 effect、身份安全与配置叠加 ████   ← ① 模块 banner
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M12.1 · effect 按 LIFO 拆除且拒绝复活 ────               ← ② 阶段分隔
   lifo = [outer, inner]
   idempotent_dispose = True
   inactive_refusal = cannot push effect 'late' onto disposed stack 'm12-lifo'
REAL_STAGE_OK M12.1 calls=1 ms=4784 in=12239 out=10 finish=success   ← ③ 阶段结论

REAL_MODULE_OK M12 stages=5 calls=5 failed=0                    ← ③ 模块结论
```

**你只需要认准最后一行**：

```text
REAL_MODULE_OK M12 stages=5 calls=5 failed=0
```

| 字段 | 含义 |
|---|---|
| `stages=5` | 本模块跑完了 5 个阶段 |
| `calls=5` | 一共产生了 5 次真实内核调用证据 |
| `failed=0` | 没有失败的调用 |

全量跑 `--all` 先输出环境检查行，末行是：

```text
REAL_PREFLIGHT_OK kernel=hermes_direct vendor=openai-compat model=fuyao-coding sdk=hermes-agent cli=(in-process)
REAL_ALL_OK modules=12 stages=60 provider=openai-compat
```

### 阶段分两类，但都必须留下真实证据

这是本工程最重要的一条设计，与 `dsh-example` 同一口径：

| 类型 | 谁驱动模型 | 检查什么 |
|---|---|---|
| `mechanism` | 阶段**入口先跑一次 probe**（完整装配链 + 真实内核），再由场景跑本地机制断言 | 既证明装配链通，又验证机制 |
| `model` | 场景脚本自己发起真实请求 | 内核驱动的行为 |

`mechanism` 阶段的 probe 用的是**复述型指令**——内核没有拒答的理由，所以它只在链路真的断了时
才失败。这就是为什么纯机制阶段（如 M12.1 的 LIFO 对照）也要求 `calls >= 1`。
[`runtime/runner.py`](../runtime/runner.py) 逐阶段校验：

```python
if failures:                      # 适配器抛异常
    raise RuntimeError(f"REAL_STAGE_FAIL {stage.id} 真实调用失败：…")
if errored:                       # 内核把失败当"错误终态"送回
    raise RuntimeError(f"REAL_STAGE_FAIL {stage.id} 内核返回错误终态：…")
if not slice_:
    raise RuntimeError(f"REAL_STAGE_FAIL {stage.id} 本阶段没有产生任何内核调用证据")
if not answered:
    raise RuntimeError(f"REAL_STAGE_FAIL {stage.id} 真实调用返回空文本且无工具调用")
```

四种失败形态：**调用失败**、**内核返回错误终态**、**没有调用证据**、**返回空文本且无工具调用**。

第三种值得单独说：认证失败、限流、内核内部错误都会以"错误终态 + 一段错误文案"的形式回来，
而**错误文案本身是非空文本**。只查"有没有文本"就会把一次 403 放行成 `REAL_STAGE_OK`——
验收契约会因此彻底失去意义。所以 `finish=error` 与抛异常同等对待，都判失败。

空回答最多重试 3 次，仍为空即失败——重试**同一个真实内核**不是回退，静默接受或换模型顶上才是。
任一阶段失败即非零退出，`--all` 随即停止。

### 参数会脱敏

写进证据账本的参数先经过 `redact()`——**密钥、endpoint、绝对路径都不落日志**：

```python
def redact(value: str) -> str:
    out = value
    for name in ("LLM_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        token = os.environ.get(name, "")
        if len(token) > 6:
            out = out.replace(token, "<redacted-key>")
    out = re.sub(r"https?://[^\s\"')]+", f"<{ENDPOINT_LABEL}>", out)
    out = re.sub(r"/(?:Users|home|private|var|tmp)/[^\s\"')]+", "<path>", out)
    return out
```

---

## 6. 全部可用命令

```bash
cd iota-example
uv sync --extra dev --extra hermes     # 安装依赖（hermes = 默认内核，dev = 检查工具）

uv run python -m runtime.runner M12     # 跑单个模块（M01 … M12）
uv run python -m runtime.runner M12 --scene 01_dispose_lifo   # 只跑该模块清单里的一个场景
uv run python M12-framework-mechanisms/run.py                # 按路径运行模块入口（任意 cwd）
uv run python -m runtime.runner --all    # 12 个模块 60 阶段全量验收（隔离子进程）

uv run python -m runtime.learn --list    # 精选学习入口（带导读的路线选择）
uv run python -m runtime.learn --tour    # 路线：M01 → M02 → M03

uv run ruff check .                     # E/F/I/UP/B，行宽 100
./runtime/typecheck.sh                  # 共享层 + 12 个模块，末行 IOTA_TYPECHECK_OK
uv run python -m runtime.surface_coverage  # 覆盖面统计，门槛 45
uv run pytest -q                        # 阶段清单门禁、启动错误、文档引用与输出脱敏
```

两种 `-m` 形式要求工作目录是 `iota-example/`（`-m` 从当前目录解析模块）；
`uv run python MXX-name/run.py` 在任何目录下都能跑——入口按文件位置解析工程根。

### 时间成本

⏱️ **全量运行会发起 60 次以上内核请求**（每个 `mechanism` 阶段一次 probe），
按当前端点通常需要几十分钟。**学习时不要用 `--all`**，按课节单独跑对应模块即可。

---

## 7. 排障：四条最常遇到的错误

### 症状 A：Python 版本不对

```text
Requires-Python >=3.11,<3.14
```

**定位**：`python3 --version`。
**修改**：用 uv 自动管理解释器（`uv sync` 会按 `requires-python` 拉起正确版本），或把默认
解释器切到 3.11–3.13。

### 症状 B：`运行缺少配置：LLM_API_KEY`

```text
KernelUnavailable: 运行缺少配置：LLM_API_KEY（兼容 ANTHROPIC_AUTH_TOKEN）。
  配置来源：iota-example/.env（已被 git 忽略；模板见 .env.example）
```

**定位**：`ls -a iota-example/ | grep env` 看 `.env` 在不在。
**修改**：`cp .env.example .env` 再填密钥。注意 `.env` 必须在 **`iota-example/` 目录下**，
不是仓库根目录——`load_project_env()` 按工程根解析路径。

### 症状 C：内核依赖缺失（`缺少 hermes-agent` / `找不到 Claude Code CLI`）

```text
KernelUnavailable: 缺少 claude-agent-sdk（真实内核的运行依赖）。
  安装：uv sync --extra real
```

**定位**：preflight 报错会写明缺的是哪一个。
**修改**：`uv sync --extra real` 装 SDK；确保 `claude` 在 `PATH` 上（或设
`CLAUDE_CLI_PATH=<binary>`）。

### 症状 D：跑了几十分钟还没结束

**这不是错误**。全量真实验收本来就要发起 60+ 次请求。
**修改**：换单个模块跑 `uv run python -m runtime.runner M12`，或只跑一个场景 `--scene …`。

### 一条不是错误的输出

```text
[claude-code:unrecognized_model] {"model":"fuyao-coding","query_source":"sdk"}
```

这行来自 Claude Code CLI：`MiniMax-M3` / `fuyao-coding` 不在它自带的模型目录里，所以它按
200k 上下文窗口保守处理。请求照常发出、照常作答，模块仍会输出 `REAL_MODULE_OK`。
真正会让运行失败的是另外几种输出：缺配置抛 `KernelUnavailable`、场景断言失败抛
`TeachingCheckError`（带期望值与实际值）、内核连续 3 次返回空文本。

---

## 8. 代码在哪

| 文件 | 作用 |
|---|---|
| [`pyproject.toml`](../pyproject.toml) | 依赖与工具链；`[tool.uv.sources]` 指向本地 iota-core editable source |
| [`.env.example`](../.env.example) | 真实 provider 配置模板 |
| [`runtime/harness.py`](../runtime/harness.py) | 唯一装配枢纽：环境加载、内核适配器、证据账本与断言 |
| [`runtime/runner.py`](../runtime/runner.py) | 编排入口：阶段清单、probe、逐阶段证据核验、`--all` 隔离子进程 |
| [`runtime/learn.py`](../runtime/learn.py) | 精选学习入口：`--list` / `--tour` / `--module` |
| [`MXX-name/run.py`](../M12-framework-mechanisms/run.py) | 各模块唯一入口：阶段清单（编号、标题、场景脚本名） |

---

## 9. 动手练习

### 练习 A：确认环境

```bash
cd iota-example && uv run python -m runtime.runner M12
```

**可验证答案**：末行是 `REAL_MODULE_OK M12 stages=5 calls=5 failed=0`。
每个 `REAL_STAGE_OK` 行都有 `calls=` 和 `finish=` 字段。

### 练习 B：观察验收契约如何失败

把 `.env` 临时改名，再跑 M12：

```bash
cd iota-example && mv .env .env.bak && uv run python -m runtime.runner M12; mv .env.bak .env
```

**可验证答案**：进程非零退出，并抛出 `KernelUnavailable` 与配置来源说明。
**它不会静默降级成 mock**——这是本工程刻意的设计。

### 练习 C：只跑一个阶段

```bash
cd iota-example && uv run python -m runtime.runner M12 --scene 01_dispose_lifo
```

**可验证答案**：只输出 `──── M12.1 · effect 按 LIFO 拆除且拒绝复活 ────` 一段，
末行变成 `REAL_MODULE_OK M12 stages=1 calls=1 failed=0`——阶段过滤发生在编排层，
`--scene` 是"只上一节课"的开关。

### 练习 D：和 dsh-example 对读

同一个编号在两边指向同一个控制面。跑完 iota 的 M01 后，到 `dsh-example` 跑同编号模块
（`npm run M01`），对照两边 `M01.d` 的 `REAL_STAGE_OK` 行：dsh 侧 `tools=word_count`，
iota 侧 `tools=Bash`——**工具从编排层注册变成内核自带**，这就是"结构性边界"在日志里的样子。

---

**下一课** → [第 01 课 · 工具管线](01-tool-pipeline.md)：一层具名可逆包装能做什么、不能做什么。

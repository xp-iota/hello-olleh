---
title: "配置与设置：config.toml、环境变量与运行时策略"
---
# 配置与设置：config.toml、环境变量与运行时策略

本文分析 Codex 的配置系统，包括配置文件结构、环境变量、优先级规则和运行时策略注入。

**目录**

- [1. 配置来源与优先级](#1-配置来源与优先级)
- [2. config.toml 完整结构](#2-configtoml-完整结构)
- [3. 主要配置字段说明](#3-主要配置字段说明)
- [4. 环境变量](#4-环境变量)
- [5. 配置加载流程](#5-配置加载流程)
- [6. 项目级输入与信任决策](#6-项目级输入与信任决策)
- [7. 与其他系统的对比](#7-与其他系统的对比)

---

## 1. 配置来源与优先级

![配置来源与优先级](diagrams/17-settings-config-diagram.svg)

**配置来源与优先级** — [交互版](diagrams/17-settings-config-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/17-settings-config-diagram.architecture.json)

- **组成**：7 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：CLI 参数 (--model, --sandbox,… · 末节点：内置默认值（最低优先级）

## 2. config.toml 完整结构

完整 schema 由 `sources/codex/codex-rs/config/src/config_toml.rs:166` 的 `ConfigToml` 定义，模型、审批等字段全部是平铺顶层键，不存在 `[model]` / `[approval]` 这类小节：

```toml
# $CODEX_HOME/config.toml（默认 ~/.codex/config.toml）

# —— 模型 ——
model = "gpt-5.2-codex"                 # 覆写默认模型 ID
model_provider = "openai"               # model_providers map 中的 provider key
model_reasoning_effort = "medium"       # 推理强度：minimal / low / medium / high / xhigh
model_context_window = 272000           # 上下文窗口大小（tokens）
model_auto_compact_token_limit = 200000 # 触发自动压缩的 token 阈值

# —— 审批与沙箱 ——
approval_policy = "on-request"           # untrusted / on-request / granular / never
sandbox_mode = "workspace-write"       # 沙箱模式
default_permissions = ":workspace-write" # 命名权限 profile（":" 前缀引用内置 profile）

# sandbox_mode 为 workspace-write 时可追加可写根与网络开关
[sandbox_workspace_write]
writable_roots = ["/tmp"]
network_access = false

# —— 指令注入 ——
instructions = "你是一个专注于 Rust 开发的代码助手。" # 用户自定义 instructions
developer_instructions = "以中文回复。"           # 以 developer 角色消息注入
model_instructions_file = "/path/to/instructions.md" # 覆写内置 base instructions（不推荐）
project_doc_max_bytes = 32768               # AGENTS.md 注入字节上限

# —— 历史 ——
[history]
persistence = "save-all"                   # save-all / none
max_bytes = 10485760                        # 历史文件大小上限，超出时淘汰最旧条目

# —— profile（一组可整体切换的覆写）——
profile = "work"
[profiles.work]
model = "gpt-5.2-codex"

# —— MCP servers（map 形态，不是 array-of-tables）——
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

# —— 项目信任决策（记录在全局配置里，键为项目路径）——
[projects."/path/to/repo"]
trust_level = "trusted"
```

## 3. 主要配置字段说明

### 3.1 模型配置

| 字段 | 类型 | 说明 |
| :------| :------| :------|
| `model` | string | 覆写默认模型 ID（`config_toml.rs:168`）|
| `model_provider` | string | `model_providers` map 中的 provider key |
| `model_reasoning_effort` | enum | 推理强度，变体见 `protocol/src/openai_models.rs:60`|
| `model_context_window` | int | 上下文窗口大小（tokens）|
| `model_auto_compact_token_limit` | int | 触发历史自动压缩的 token 阈值 |

### 3.2 审批策略

`approval_policy` 的取值由 `protocol/src/protocol.rs:1002` 的 `AskForApproval` 定义：

| 取值 | 说明 |
| :------| :------|
| `untrusted` | 未信任项目的默认策略：命令需要审批，除非 exec policy 规则显式放行 |
| `on-request` | 由模型决定何时请求审批（默认值，别名 `on-failure`）|
| `granular` | 细粒度开关（`GranularApprovalConfig`）：分别控制沙箱审批、exec policy prompt、skill 审批、MCP elicitation 等是否放行 |
| `never` | 从不请求审批，失败直接返回给模型 |

此外 0.162 引入命名权限 profile：`default_permissions` 引用内置 profile（`:` 前缀）或 `[permissions]` 中自定义的条目（`config/src/permissions_toml.rs:25`），支持 `extends` 继承链。CLI 侧 `--dangerously-bypass-approvals-and-sandbox`（`cli/src/main.rs:2013`）一次性推导 `never` + 全访问组合。

### 3.3 历史持久化

`[history]` 由 `config/src/types.rs:222` 的 `History` 定义：

| 策略 | 说明 |
| :------| :------|
| `save-all` | 将历史条目写入 `~/.codex/history.jsonl`（默认）|
| `none` | 不落盘 |

`max_bytes` 限制历史文件大小，超出时淘汰最旧条目。

## 4. 环境变量

| 变量 | 说明 |
| :------| :------|
| `CODEX_HOME` | 覆写 Codex 状态根目录（默认 `~/.codex`），见 `core/src/config/mod.rs:967` |
| `RUST_LOG` | 日志过滤级别，经 `EnvFilter::try_from_default_env()` 读取（`tui/src/startup_orchestration.rs:818`）|
| provider `env_key` | 每个 provider 可声明从哪个环境变量读 API key（`model-provider-info/src/lib.rs:149`）；内置 openai provider 默认走 ChatGPT 登录，`env_key` 为 `None`（`model-provider-info/src/lib.rs:526`）|

## 5. 配置加载流程

Codex 的配置加载不是一个单独 `load_config()` 函数，而是 `Config`、`ConfigOverrides`、profile TOML、CLI 参数和 config layer stack 组合出的运行时快照。

| 阶段 | 源码锚点 | 说明 |
| --- | --- | --- |
| 配置主结构 | `sources/codex/codex-rs/core/src/config/mod.rs:612` | `Config` 持有模型、权限、MCP、feature、project doc 等运行时字段 |
| 审批策略 | `sources/codex/codex-rs/core/src/config/mod.rs:330` | `approval_policy` 是 `Constrained<AskForApproval>`，权限语义见 `permissions` 字段（`:661`）|
| CLI 覆写 | `sources/codex/codex-rs/core/src/config/mod.rs:2645` | `ConfigOverrides` 承接命令行传入的 model、cwd、approval、sandbox、workspace roots 等 |
| profile 字段 | `sources/codex/codex-rs/config/src/profile_toml.rs:24` | `ConfigProfile` 定义单个 profile 可覆写的字段，map 见 `config_toml.rs:363` |
| CLI 免审批 | `sources/codex/codex-rs/cli/src/main.rs:2013` | `--dangerously-bypass-approvals-and-sandbox` 推导 approval policy 与 sandbox 组合 |
| AGENTS.md 字节上限 | `sources/codex/codex-rs/core/src/config/mod.rs:930` | `project_doc_max_bytes` 控制项目指令注入量，默认值解析见 `:4380` |
| MCP 配置 | `sources/codex/codex-rs/core/src/config/mod.rs:894` | `mcp_servers` 作为受约束 map 进入 runtime |

## 6. 项目级输入与信任决策

0.162 中不存在项目内 `.codex/config.toml` 覆写文件。项目级输入有三类：

- **项目指令**：从 cwd 向上探测 `AGENTS.override.md`、`AGENTS.md` 以及 `project_doc_fallback_filenames` 配置的候选名（`core/src/agents_md.rs:43` / `:45` / `:274`），合并结果受 `project_doc_max_bytes` 限制。
- **Skill 根**：项目根到 cwd 之间每个目录的 `.agents/skills` 都会注册为 repo skill root（`ext/skills/src/host_roots.rs:24` / `:154`）。
- **信任决策**：`trust_level` 记录在全局 config.toml 的 `[projects."<path>"]` 表里（`config/src/config_toml.rs:469`，`ProjectConfig::trust_level` 见 `:606`），不信任项目会回落到 `untrusted` 审批策略。

## 7. 与其他系统的对比

| 系统 | 配置格式 | 项目级 | 层级数 | 主要特色 |
| :------| :---------| :-------| :--------| :---------|
| **Codex** | TOML | AGENTS.md / `.agents/skills`（无项目级 config 覆写）| 4层 | 命名权限 profile |
| **Claude Code** | JSON | 项目 `settings.json` | 3层 | Managed Policy |
| **Gemini CLI** | JSON | `.gemini/settings.json` | 4层 | Trust 模型 |
| **OpenCode** | 多格式 | `.opencode/` | 3层 | Effect-ts 驱动 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Config` | `sources/codex/codex-rs/core/src/config/mod.rs:612` | 运行时配置快照，session/turn/tool 都读取它 |
| `ConfigOverrides` | `sources/codex/codex-rs/core/src/config/mod.rs:2645` | CLI 或外部入口传入的高优先级覆写 |
| `ConfigToml` | `sources/codex/codex-rs/config/src/config_toml.rs:166` | config.toml 的完整反序列化 schema |
| `ConfigProfile` | `sources/codex/codex-rs/config/src/profile_toml.rs:24` | profile 层可覆写的字段集合 |
| `AskForApproval` | `sources/codex/codex-rs/protocol/src/protocol.rs:1002` | 审批策略枚举：untrusted / on-request / granular / never |
| `History` | `sources/codex/codex-rs/config/src/types.rs:222` | 历史持久化设置（save-all / none + max_bytes）|
| `load_global_mcp_servers()` | `sources/codex/codex-rs/core/src/config/mod.rs:2303` | 从 merged TOML 中读取 `mcp_servers` |
| `filter_mcp_servers_by_requirements()` | `sources/codex/codex-rs/core/src/config/mod.rs:2191` | 按 requirements 裁剪 MCP server |

---

## 代码质量评估

**优点**

- **分层覆写链清晰**：system managed config → `$CODEX_HOME/config.toml` → profile → CLI 覆写（`ConfigOverrides`）的顺序直觉友好，与 git config 等工具一致。
- **TOML 格式人类可读**：`config.toml` 比 JSON 更易读写，注释支持使配置自文档化，且 schema 由 `ConfigToml` 结构体严格约束（deny unknown fields）。
- **profile 支持整体切换**：`profile` + `[profiles.<name>]` 让多套工作配置（模型、审批、沙箱）一键切换，无需多份配置文件。

**风险与改进点**

- **配置 schema 无版本管理**：config.toml 格式变更时无兼容性检查，旧配置文件的失效字段被静默忽略。
- **项目级覆写缺失**：没有项目内 config 覆写文件，团队共享配置只能依赖全局 config.toml 或 AGENTS.md 间接表达。
- **CLI flag 与配置字段无双向映射文档**：用户难以知道哪些 CLI flag 对应哪个 config.toml 键，缺少自动生成的对照表。

## 配置是 Rust runtime 的策略输入

Codex 配置不只是 CLI 参数集合，而是影响 turn loop、approval、sandbox、AGENTS.md、compact prompt、transport 和工具集的策略输入。

| 配置面 | 源码入口 | 影响 |
| --- | --- | --- |
| TOML schema | `sources/codex/codex-rs/config/src/config_toml.rs:166` | 模型、approval、sandbox、history、MCP、feature 的完整键面 |
| AGENTS.md 限制 | `sources/codex/codex-rs/core/src/config/mod.rs:930` | `project_doc_max_bytes` 控制项目指令注入量，候选文件名见 `agents_md.rs:274` |
| approval/sandbox | `sources/codex/codex-rs/core/src/config/mod.rs:330` | `approval_policy`（Constrained）与 `permissions`（`:661`）决定 shell/apply_patch/network 是否需要审批 |
| MCP servers | `sources/codex/codex-rs/core/src/config/mod.rs:894` | 动态扩展可用工具集合 |
| session 指令 | `sources/codex/codex-rs/core/src/session/mod.rs:448` | `SessionInstructions`（定义在 `agents_md_manager.rs:29`）在 session 初始化时进入上下文 |

横向看，Codex 配置的优势是类型化和测试覆盖强；代价是很多行为需要跨 config、session、tools 三层才能看完整。

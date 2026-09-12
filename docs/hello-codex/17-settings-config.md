---
layout: content
title: "配置与设置：config.toml、环境变量与运行时策略"
---
# 配置与设置：`config.toml`、环境变量与运行时策略

本文分析 Codex 的配置系统，包括配置文件结构、环境变量、优先级规则和运行时策略注入。

**目录**

- [1. 配置来源与优先级](#1-配置来源与优先级)
- [2. config.toml 完整结构](#2-configtoml-完整结构)
- [3. 主要配置字段说明](#3-主要配置字段说明)
- [4. 环境变量](#4-环境变量)
- [5. 配置加载流程](#5-配置加载流程)
- [6. 项目级配置（`.codex/` 目录）](#6-项目级配置codex-目录)
- [7. 与其他系统的对比](#7-与其他系统的对比)

---

## 1. 配置来源与优先级

```
CLI 参数 (--model, --sandbox, --approval-policy)
    ↓ 覆写（最高优先级）
环境变量 (CODEX_RS_MODEL, OPENAI_API_KEY, ...)
    ↓ 覆写
.codex/config.toml（项目级）
    ↓ 覆写
~/.config/codex/config.toml（用户全局）
    ↓ 覆写
内置默认值（最低优先级）
```

## 2. config.toml 完整结构

```toml
# ~/.config/codex/config.toml

[model]
name = "o3"                     # 使用的模型 ID
reasoning_effort = "medium"     # 推理强度：low / medium / high

[instructions]
user_instructions = """
你是一个专注于 Rust 开发的代码助手。
...
"""

[approval]
# 自动批准模式：suggest（建议）/ auto-edit（自动编辑）/ full-auto（全自动）
mode = "suggest"

# 细粒度工具审批控制
auto_approve_tools = ["read_file", "list_directory"]
require_approval_tools = ["write_file", "run_command"]

[sandbox]
enable = false                  # 是否启用沙箱隔离
# Linux 下使用 bubblewrap，macOS 下使用 sandbox-exec

[history]
persistence = "saveall"         # 历史持久化策略：saveall / never / ephemeral
max_turns = 100                 # 最大对话轮数

[[mcp_servers]]
name = "filesystem"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
```

## 3. 主要配置字段说明

### 3.1 模型配置

| 字段 | 类型 | 说明 |
| :------| :------| :------|
| `model.name` | string | OpenAI 模型 ID（如 `o3`, `o4-mini`）|
| `model.reasoning_effort` | string | 推理强度（影响 o3/o4 系列速度与质量）|

### 3.2 审批策略

| 模式 | 说明 |
| :------| :------|
| `suggest` | 仅建议，不执行任何工具（最保守）|
| `auto-edit` | 自动执行文件编辑，Shell 命令需审批 |
| `full-auto` | 自动执行所有工具（需要沙箱或信任环境）|

### 3.3 历史持久化

| 策略 | 说明 |
| :------| :------|
| `saveall` | 保存所有会话历史（可 resume）|
| `never` | 不保存（隐私优先）|
| `ephemeral` | 仅内存中保留，进程退出即丢失 |

## 4. 环境变量

| 变量 | 说明 |
| :------| :------|
| `OPENAI_API_KEY` | OpenAI API 密钥（必填） |
| `OPENAI_BASE_URL` | 自定义 API endpoint（兼容 OpenAI 协议的服务）|
| `CODEX_RS_MODEL` | 覆写模型选择 |
| `CODEX_APPROVAL_MODE` | 覆写审批模式 |
| `RUST_LOG` | Rust 日志级别（如 `info`, `debug`, `trace`）|

## 5. 配置加载流程

Codex 的配置加载不是一个单独 `load_config()` 函数，而是 `Config`、`ConfigOverrides`、profile TOML、CLI 参数和 config layer stack 组合出的运行时快照。

| 阶段 | 源码锚点 | 说明 |
| --- | --- | --- |
| 配置主结构 | `sources/codex/codex-rs/core/src/config/mod.rs:233` | `Config` 持有模型、权限、MCP、cwd、feature、project doc 等运行时字段 |
| 权限策略 | `sources/codex/codex-rs/core/src/config/mod.rs:191` | `approval_policy` 与 `sandbox_policy` 是 constrained policy |
| CLI 覆写 | `sources/codex/codex-rs/core/src/config/mod.rs:1374` | `ConfigOverrides` 承接命令行传入的 model、cwd、approval、sandbox 等 |
| profile 字段 | `sources/codex/codex-rs/config/src/profile_toml.rs:31` | profile 可覆写 approval、model、model instruction file 等 |
| CLI full-auto | `sources/codex/codex-rs/cli/src/main.rs:1258` | `--full-auto` 会推导 approval policy 与 sandbox 组合 |
| AGENTS.md 字节上限 | `sources/codex/codex-rs/core/src/config/mod.rs:420` | `project_doc_max_bytes` 控制项目指令注入量 |
| MCP 配置 | `sources/codex/codex-rs/core/src/config/mod.rs:393` | `mcp_servers` 作为受约束 map 进入 runtime |

## 6. 项目级配置（`.codex/` 目录）

```
project/
├── .codex/
│   ├── config.toml    # 项目级配置覆写
│   └── instructions/  # 可选：结构化 AGENTS.md 分片
└── AGENTS.md          # 主项目指令文件
```

项目级 `config.toml` 通常只覆写少数字段，如：

```toml
# .codex/config.toml（项目级）
[approval]
mode = "full-auto"  # 在 CI 中使用全自动模式
```

## 7. 与其他系统的对比

| 系统 | 配置格式 | 项目级 | 层级数 | 主要特色 |
| :------| :---------| :-------| :--------| :---------|
| **Codex** | TOML | `.codex/config.toml` | 4层 | 细粒度工具审批 |
| **Claude Code** | JSON | 项目 `settings.json` | 3层 | Managed Policy |
| **Gemini CLI** | JSON | `.gemini/settings.json` | 4层 | Trust 模型 |
| **OpenCode** | 多格式 | `.opencode/` | 3层 | Effect-ts 驱动 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Config` | `sources/codex/codex-rs/core/src/config/mod.rs:233` | 运行时配置快照，session/turn/tool 都读取它 |
| `ConfigOverrides` | `sources/codex/codex-rs/core/src/config/mod.rs:1374` | CLI 或外部入口传入的高优先级覆写 |
| `ProfileToml` | `sources/codex/codex-rs/config/src/profile_toml.rs:31` | profile 层可覆写 approval、model、instructions 等 |
| `load_global_mcp_servers()` | `sources/codex/codex-rs/core/src/config/mod.rs:1100` | 从 merged TOML 中读取 `mcp_servers` |
| `filter_mcp_servers_by_requirements()` | `sources/codex/codex-rs/core/src/config/mod.rs:1005` | 按 requirements 裁剪 MCP server |
| `uses_deprecated_instructions_file()` | `sources/codex/codex-rs/core/src/config/mod.rs:2563` | 识别废弃的 instructions 配置并发 warning |

---

## 代码质量评估

**优点**

- **四层优先级链清晰**：global → project → env → CLI 的覆盖顺序直觉友好，与 git config 等工具一致。
- **TOML 格式人类可读**：`config.toml` 比 JSON 更易读写，注释支持使配置自文档化。
- **项目级配置隔离**：`.codex/config.toml` 存于项目目录，可纳入版本控制，团队共享配置无需额外工具。

**风险与改进点**

- **配置 schema 无版本管理**：config.toml 格式变更时无兼容性检查，旧配置文件的失效字段被静默忽略。
- **env override 键名无前缀规范**：环境变量名不够 namespaced（如 `MODEL` 可能与其他工具冲突），建议统一 `CODEX_` 前缀。
- **CLI flag 与配置字段无双向映射文档**：用户难以知道哪些 CLI flag 对应哪个 config.toml 键，缺少自动生成的对照表。

## 横向对齐补强：配置是 Rust runtime 的策略输入

Codex 配置不只是 CLI 参数集合，而是影响 turn loop、approval、sandbox、AGENTS.md、compact prompt、transport 和工具集的策略输入。

| 配置面 | 源码入口 | 影响 |
| --- | --- | --- |
| TOML/Profiles | `sources/codex/codex-rs/core/src/config/mod.rs:1542` | 模型、approval、sandbox、feature、provider |
| AGENTS.md 限制 | `sources/codex/codex-rs/core/src/agents_md.rs:125` | 项目指令搜索、合并、最大字节数 |
| approval/sandbox | `sources/codex/codex-rs/core/src/config/mod.rs:1872` | 决定 shell/apply_patch/network 是否需要审批 |
| MCP servers | `sources/codex/codex-rs/core/src/config/mod.rs:2224` | 动态扩展可用工具集合 |
| session 配置 | `sources/codex/codex-rs/core/src/session/mod.rs:520` | session 初始化时解析 user instructions |

横向看，Codex 配置的优势是类型化和测试覆盖强；代价是很多行为需要跨 config、session、tools 三层才能看完整。

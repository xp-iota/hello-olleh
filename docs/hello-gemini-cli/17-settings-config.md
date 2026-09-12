---
layout: content
title: "配置与设置：分层 settings、工作区信任与运行时装配"
---
# 配置与设置：分层 settings、工作区信任与运行时装配

Gemini CLI 的配置系统并不是“读两个 `settings.json` 再覆盖一下”这么简单。当前实现同时处理多作用域 settings、`.env`、工作区信任、CLI 参数覆盖，以及这些配置如何最终落到 `Config` 运行时对象上。

**目录**

- [1. 设置来源与真实优先级](#1-设置来源与真实优先级)
- [2. 配置目录与状态目录](#2-配置目录与状态目录)
- [3. `.env` 与环境变量](#3-env-与环境变量)
- [4. schema 驱动的设置结构](#4-schema-驱动的设置结构)
- [5. 运行时是如何被装配出来的](#5-运行时是如何被装配出来的)
- [6. 工作区信任是配置系统的一部分](#6-工作区信任是配置系统的一部分)
- [7. 更准确的总结](#7-更准确的总结)

---

## 1. 设置来源与真实优先级

配置合并的核心在 `sources/gemini-cli/packages/cli/src/config/settings.ts`。

静态 settings 的基础顺序是：

```text
Schema Defaults
  -> system-defaults.json
  -> system settings
  -> ~/.gemini/settings.json
  -> ./.gemini/settings.json
```

但这里有两个很重要的修正：

- 项目级 `./.gemini/settings.json` 只有在工作区被判定为 trusted 时才会真正参与合并
- CLI 参数和部分环境变量并不在 `mergeSettings()` 内完成，而是在后续 `loadCliConfig()` / `parseArguments()` 阶段继续覆盖

所以更准确的整体图是：

```text
Schema / System Defaults
  -> System Settings
  -> User Settings
  -> Workspace Settings（仅 trusted workspace）
  -> .env / process.env 注入
  -> CLI flags 最终覆盖
```

## 2. 配置目录与状态目录

结合 `sources/gemini-cli/packages/core/src/config/storage.ts`，当前仓库里最重要的路径如下：

```text
~/.gemini/settings.json                  # 用户级 settings
~/.gemini/GEMINI.md                      # 全局 memory/context 文件
~/.gemini/history/                       # 兼容旧历史目录
~/.gemini/tmp/<project>/chats/           # 自动保存的聊天记录
~/.gemini/tmp/<project>/checkpoints/     # 可恢复工具调用的 checkpoint
~/.gemini/skills/                        # 用户级 skills
~/.gemini/agents/                        # 用户级 agents

./.gemini/settings.json                  # 项目级 settings
./.gemini/policies/                      # 项目级 policy
./.gemini/agents/                        # 项目级 agents
```

一个常见误解是把 `GEMINI.md` 写成只存在于 `./.gemini/GEMINI.md`。源码实际不是这样：

- 全局 memory 默认文件是 `~/.gemini/GEMINI.md`
- 项目 memory 会通过 `memoryDiscovery.ts` 在工作区、父目录、项目根以及向下扫描中发现 `GEMINI.md`
- 文件名本身还可以被 `setGeminiMdFilename()` 改写

## 3. `.env` 与环境变量

`settings.ts` 里还有一条单独的环境加载链：

- 优先找工作区中的 `.gemini/.env`
- 再考虑项目 `.env`
- 也会读取 `~/.gemini/.env`

如果工作区不可信，环境变量并不会毫无保留地进入运行时。源码会结合 trust 状态和沙箱状态，对可注入的变量做收敛。

认证相关白名单也不是旧文档里的那一组，当前实际列出的核心变量包括：

- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`

## 4. schema 驱动的设置结构

`sources/gemini-cli/packages/cli/src/config/settingsSchema.ts` 说明 Gemini CLI 的 settings 已经是 schema 驱动，而不是松散 JSON。

当前最关键的几组配置是：

| 配置段 | 例子 | 作用 |
| --- | --- | --- |
| `general.defaultApprovalMode` | `default` / `auto_edit` / `plan` | 默认审批模式 |
| `general.checkpointing.enabled` | `true` / `false` | 是否启用 `/restore` 所需的 checkpoint |
| `general.sessionRetention` | `maxAge` / `maxCount` | 自动清理旧会话 |
| `ui.theme` | 主题名 | 控制 TUI 主题 |
| `mcpServers` | 每个 server 的 transport/config | MCP 服务器配置 |
| `tools.sandboxAllowedPaths` | 路径数组 | 补充沙箱可访问路径 |
| `tools.sandboxNetworkAccess` | 布尔值 | 沙箱网络能力 |
| `extensions.*` | 禁用、允许列表、registry 地址 | 扩展系统策略 |
| `security.auth.selectedType` | 认证类型 | 选择 auth 路径 |

旧文档里举的 `contextWindow`、`autoAcceptTools`、`trustedFolders` 这类顶层字段，并不能准确代表当前 schema。

## 5. 运行时是如何被装配出来的

真正把这些设置变成可执行系统的是 `sources/gemini-cli/packages/cli/src/config/config.ts`。

这一步至少做了几件事：

- 解析 CLI 参数，决定交互式、非交互式、ACP 等宿主模式
- 把 `--yolo` / `--approval-mode` 翻译成 `ApprovalMode`
- 对不可信工作区强制收紧审批模式，避免 workspace settings 越权
- 载入 hierarchical memory
- 初始化 `ExtensionManager`
- 构建 `PolicyEngineConfig`
- 装配 sandbox 配置
- 把最终结果注入 `Config`

最终的 `Config` 不是一个“配置对象”，而是整个运行时的组合根，里面会继续初始化：

- `PolicyEngine`
- `MessageBus`
- `HookSystem`
- `SkillManager`
- `AgentRegistry`
- `McpClientManager`
- `GeminiClient`

## 6. 工作区信任是配置系统的一部分

Gemini CLI 的一个关键特点是：工作区 trust 不是外围功能，而是配置合并本身的一部分。

实际效果包括：

- 不可信工作区下，项目级 settings 会被剥离
- 非默认审批模式可能被降回 `default`
- 项目级 agents / skills / 部分环境注入会被限制

所以与其说 Gemini CLI 是“配置优先”，不如说它是“配置 + trust 联合裁决”。

## 7. 更准确的总结

当前仓库里的配置系统可以概括为：

- 用 schema 定义 settings 形状
- 用多作用域文件做静态合并
- 用 trust 决定 workspace 配置是否生效
- 用 `.env`、环境变量和 CLI flags 做运行时覆盖
- 最终在 `loadCliConfig()` 中装配出真正可运行的 `Config`

这比旧文档里“`settings.json` + 一些环境变量 + `.gemini/GEMINI.md`”的描述要更接近源码事实。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Config` class | `sources/gemini-cli/packages/core/src/config/config.ts` | 组合根兼服务容器：装配所有核心依赖，是运行时唯一真相源 |
| `Config.initialize()` | `sources/gemini-cli/packages/core/src/config/config.ts:1289` | 装配入口：创建 ToolRegistry、MCP servers、GeminiClient、SkillManager |
| `Config.getSettings()` | `config.ts` | 读取合并后配置，按 global → project → 环境变量 → CLI flag 优先级返回 |
| `loadDotEnv()` | `sources/gemini-cli/packages/core/src/config/` | 加载 `.gemini/.env`，注入环境变量到进程 |
| `Config.getWorkspaceTrustPolicy()` | `config.ts` | 返回当前工作区信任等级，影响工具权限与 sandbox 策略 |
| `Storage.initialize()` | `sources/gemini-cli/packages/core/src/config/storage.ts` | 计算全局/项目级持久化根目录，确保目录存在 |

---

## 代码质量评估

**优点**

- **配置优先级显式**：CLI flag > 环境变量 > project 配置 > global 配置，层次清晰，覆盖行为可预测。
- **Schema 驱动配置结构**：配置字段有 TypeScript 类型约束，避免配置键拼错或类型错误在运行时才暴露。
- **工作区信任集成在配置系统**：sandbox 权限与工作区信任等级绑定，安全策略由配置决定而不是代码硬编码。

**风险与改进点**

- **`Config` 类职责过重**：它同时是服务容器、配置读取器、状态持有者、初始化协调器，测试时 mock 成本很高，是当前技术债单点。
- **配置热加载不支持**：配置文件变更需要重启 CLI 才能生效，开发时频繁修改配置体验差。
- **工作区信任配置存储在项目目录**：`.gemini/settings.json` 中的信任等级可被项目文件覆盖，存在跨项目信任污染的风险（若共享工程配置被注入恶意信任提升）。

## 横向对齐补强：Gemini Config 是服务容器

Gemini CLI 的 `Config` 同时承担配置读取、服务初始化、ToolRegistry、PolicyEngine、PromptProvider 和 MCP 管理的粘合职责。

| 配置影响面 | 横向对比 |
| --- | --- |
| ToolRegistry | 对应 OpenCode/Codex registry |
| PolicyEngine | 对应 Codex approval、OpenCode Permission |
| PromptProvider | Gemini prompt 中心 |
| MCP manager | 扩展发现 |
| IDE/headless | bridge/transport 配置 |

## Config 初始化顺序与职责拆分

```mermaid
flowchart TD
    Flags[CLI flags] --> Settings[settings/env/project/global merge]
    Env[.gemini/.env] --> Settings
    Settings --> Config[Config instance]
    Config --> Storage[Storage paths]
    Config --> Trust[Workspace trust]
    Config --> Policy[PolicyEngine]
    Config --> Tools[ToolRegistry]
    Config --> Prompt[PromptProvider]
    Config --> MCP[MCP manager]
```

| 类别 | 代表字段/服务 | 生命周期 | 风险 |
| --- | --- | --- | --- |
| 配置值 | model、sandbox、workspace trust、paths、MCP server config | 启动时合并，运行中基本固定 | 热加载缺失，变更需重启 |
| 运行时服务 | ToolRegistry、PolicyEngine、PromptProvider、MCP manager、Storage | 由 Config 初始化并持有 | `Config` 变成 service locator，测试 mock 成本高 |
| 派生状态 | discovery state、server last error、workspace root | 运行中变化 | 容易和静态配置混写，造成职责模糊 |

源码阅读应区分“配置来源优先级”和“运行时服务装配”：前者解释值怎么来，后者解释 agent loop 为什么能拿到工具、prompt、policy 和 MCP 状态。

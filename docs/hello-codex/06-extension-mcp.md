---
title: "扩展性：MCP Server 集成、Plugin/Skill 加载与新增工具的修改点"
---
# 扩展性：MCP Server 集成、Plugin/Skill 加载与新增工具的修改点

主向导对应章节：`扩展性`

**目录**

- [扩展机制总览](#扩展机制总览)
- [MCP Server 集成](#mcp-server-集成)
- [插件系统](#插件系统)
- [技能系统](#技能系统)
- [动态工具](#动态工具)
- [MCP Server 模式（codex 作为 MCP server）](#mcp-server-模式codex-作为-mcp-server)
- [Connector / App 发现](#connector-app-发现)
- [新增工具的修改点](#新增工具的修改点)

---

## 扩展机制总览

Codex 的扩展体系分为五层：

| 层 | 机制 | 管理器 | 注册路径 |
| --- | --- | --- | --- |
| MCP 协议层 | 标准 MCP tool/resource 发现与执行 | `McpManager` + `McpConnectionManager` | config.toml `[mcp_servers]` |
| 插件管理层 | 把 skills + MCP servers + apps 打包成可安装单元 | `PluginsManager` | config.toml `[plugins]` / marketplace |
| 技能系统层 | 声明式可复用能力，带依赖注入 | `SkillsManager` | skill 目录结构 |
| 动态工具层 | 运行时注册的工具 | Session 内 `dynamic_tools` | 程序化注册 |
| 内建工具层 | 硬编码的 30+ handler | `ToolRegistry` | 代码修改 |

![扩展机制总览](diagrams/06-extension-mcp-diagram-01.svg)

**扩展机制总览** — [交互版](diagrams/06-extension-mcp-diagram-01.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-extension-mcp-diagram-01.architecture.json)

- **组成**：10 个节点
- **关系**：源图 10 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：MCP Servers / (rmcp) → McpConnectionManager · Plugins / (marketplace) → PluginsManager · Skills / (声明式) → SkillsManager

## MCP Server 集成

### McpManager（`core/src/mcp.rs:111`）

```rust
impl McpManager {
    pub fn new(plugins_manager: Arc<PluginsManager>) -> Self
    pub fn new_with_extensions(plugins_manager, extensions, codex_apps_tools_cache) -> Self
    pub async fn configured_servers(&self, config: &Config) -> HashMap<String, McpServerConfig>
    pub async fn effective_servers(&self, config: &Config, auth: Option<&CodexAuth>) -> HashMap<String, McpServerConfig>
}
```

- `configured_servers()`（:452）：列出配置中声明的所有 MCP server
- `effective_servers()`（:464）：应用认证过滤后的可用 server
- （rust-v0.162 起：0.154 的 `tool_plugin_provenance()` 已从 `mcp.rs` 移除，工具→插件的归属追踪改由 `core-plugins` 与 `codex-mcp` 的 catalog 侧维护）

### McpConnectionSet（`codex-mcp/src/connection_manager.rs:226`）

（rust-v0.162 起由 `McpConnectionManager` 更名为 `McpConnectionSet`，连接聚合拆分到 `connection_manager/` 子模块。）每个 MCP server 对应一个 `RmcpClient` 连接。工具聚合规则：

1. **全限定名**：`mcp__<server>__<tool>`
2. **名称清洗**：仅保留字母数字和下划线（OpenAI Responses API 要求）
3. **冲突处理**：名称过长或冲突时使用 SHA1 哈希后缀（最长 64 字符）

ToolInfo 结构（`codex-mcp/src/tools.rs:25`）：

```rust
pub struct ToolInfo {
    server_name: String,             // 路由工具调用时的原始 server 名
    supports_parallel_tool_calls: bool,
    server_origin: Option<String>,   // 遥测/诊断来源
    callable_name: String,           // 模型可见工具名（旧序列化名 tool_name）
    callable_namespace: String,      // 模型可见命名空间（延迟加载用）
    namespace_description: Option<String>,
    tool: Tool,                      // 原始 MCP 工具定义
    ...
}
```

### McpConfig（`codex-mcp/src/mcp/mod.rs:124`）

```rust
pub struct McpConfig {
    pub chatgpt_base_url: String,
    pub codex_home: PathBuf,
    pub mcp_oauth_credentials_store_mode: OAuthCredentialsStoreMode,
    pub mcp_oauth_callback_port: Option<u16>,
    pub skill_mcp_dependency_install_enabled: bool,
    pub approval_policy: Constrained<AskForApproval>,
    pub apps_enabled: bool,
    pub configured_mcp_servers: HashMap<String, McpServerConfig>,
    pub plugin_capability_summaries: Vec<PluginCapabilitySummary>,
}
```

## 插件系统

### PluginsManager（`core-plugins/src/manager.rs`，3,838 行；rust-v0.162 起从 core 拆到独立的 `core-plugins` crate）

核心结构（:548）：

```rust
pub struct PluginsManager {
    codex_home: PathBuf,
    store: PluginStore,
    featured_plugin_ids_cache: RwLock<Option<CachedFeaturedPluginIds>>,
    cached_enabled_outcome: RwLock<Option<PluginLoadOutcome>>,
    remote_sync_lock: Mutex<()>,
    restriction_product: Option<Product>,
    analytics_events_client: RwLock<Option<AnalyticsEventsClient>>,
}
```

### 主要操作

| 操作 | 行号 | 签名 |
| --- | --- | --- |
| 发现 | 813 | `plugins_for_config(&self, config: &PluginsConfigInput) -> PluginLoadOutcome` |
| 安装 | 2066 | `install_plugin(request) -> Result<PluginInstallOutcome>` |
| 卸载 | 2323 | `uninstall_plugin(&self, plugin_id) -> Result<()>` |
| 远程同步 | 2122 / 2891 起 | `install_plugin_with_remote_sync()` / `uninstall_plugin_with_remote_sync()`，与 ChatGPT 后端对账 |
| 列出市场 | 2389 | `list_marketplaces_for_config(&self, config, additional_roots)` |
| 读取插件 | 2536 | `read_plugin_for_config(&self, config, request)` |

### McpManager（`core/src/mcp.rs:111`）

| 方法 | 行号 | 作用 |
| --- | --- | --- |
| `new()` | 112 | 构造实例，注入 PluginsManager |
| `configured_servers()` | 452 | 返回 config.toml 中声明的所有 MCP server |
| `effective_servers()` | 464 | 应用认证过滤后的可用 server 映射 |

### McpConnectionSet（`codex-mcp/src/connection_manager.rs:226`）

| 方法 | 行号 | 作用 |
| --- | --- | --- |
| `new()` | 229 | 建立并维护各 MCP server 的 RmcpClient 连接 |
| `shutdown()` | 931 | 断开所有 server 连接 |
| `wait_for_server_ready()` | 964 | 等待指定 server 就绪 |
| `call_tool()` | 977 | 通过 server 执行工具调用 |
| 工具聚合 | `connection_manager/tool_catalog.rs` | 聚合全限定名、去冲突（SHA1 后缀）、裁决模型可见性（`tool_is_model_visible`） |

### SkillsManager（`core/src/skills.rs`）

（0.154 中 `SkillsManager` 由 `core/src/skills.rs` 重导出的行号区间在 0.162 已不适用；`skills.rs` 现保留两个入口函数，技能加载主体在 `codex-skills` / `codex-skills-extension` crate。）

| 函数 | 行号 | 作用 |
| --- | --- | --- |
| `skills_load_input_from_config()` | 29 | 从 config 和 skill root 构建加载输入 |
| `maybe_emit_implicit_skill_invocation()` | 132 | 检测隐式技能调用，发射遥测计数器 |

（rust-v0.162 起：0.154 的 `resolve_skill_dependencies_for_turn()`（技能 env 依赖解析）已不在 `skills.rs`；技能依赖检查改由 turn 准备阶段 `build_skills_and_plugins()` 内部处理，MCP 依赖安装提示在 `core/src/mcp_skill_dependencies.rs:40`。）

### DynamicTool 注册路径（rust-v0.162 起移入工具注册层）

| 步骤 | 位置 | 说明 |
| --- | --- | --- |
| 注册标记 | `core/src/tools/registry.rs:81` | `is_third_party_tool()` 标记 MCP/app 与客户端动态工具（built-in 同名也不抢占）|
| 执行响应 | `session/handlers.rs:658` | `Op::DynamicToolResponse` 路由到工具输出 |
| 执行处理 | `core/src/tools/handlers/dynamic.rs` | 动态工具调用的执行 handler |

（0.154 的 `codex.rs:577+` 延迟加载过滤在 0.162 移入 `ToolRouter::model_visible_specs()` 与 `core/src/tools/spec_plan.rs` 的 deferred third-party tools 处理，见下文"工具过滤"。）

### 插件清单结构

每个插件的目录结构：

![插件清单结构](diagrams/06-extension-mcp-diagram-02.svg)

**插件清单结构** — [交互版](diagrams/06-extension-mcp-diagram-02.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-extension-mcp-diagram-02.architecture.json)

- **组成**：6 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：<pluginroot>/ · 末节点：.app.json # App/Connector 配置

### 插件加载管线（`core-plugins/src/loader.rs`，`load_plugin()` :824）

1. 从 config name 解析 plugin ID
2. 从 PluginStore 解析 active root
3. 加载 `.codex-plugin/plugin.json` 清单
4. 从 manifest.paths.skills 加载技能
5. 从 `.mcp.json` 加载 MCP servers
6. 从 `.app.json` 加载 Apps

### MCP Server 加载（`core-plugins/src/loader.rs:1592`）

`load_mcp_servers_from_file()` 的规范化处理：

- 移除 transport type 字段
- 将相对 CWD 路径转为绝对路径
- 对不支持的 OAuth 回调发出警告
- 按 `McpServerConfig` schema 验证

### LoadedPlugin 结构

```rust
pub struct LoadedPlugin {
    config_name: String,
    manifest_name: Option<String>,
    manifest_description: Option<String>,
    root: AbsolutePathBuf,
    enabled: bool,
    skill_roots: Vec<PathBuf>,
    disabled_skill_paths: HashSet<PathBuf>,
    has_enabled_skills: bool,
    mcp_servers: HashMap<String, McpServerConfig>,
    apps: Vec<AppConnectorId>,
    error: Option<String>,
}
```

### Marketplace 系统

- **策划仓库**：OpenAI marketplace（`openai-curated`）
- **同步进程**（`core-plugins/src/manager.rs:149`，`CURATED_REPO_SYNC_STARTED`）：每进程运行一次（`AtomicBool` 防重复），后台线程刷新缓存
- **远程同步**（`core-plugins/src/manager.rs:2122` 起的 `*_with_remote_sync` 系列，对账逻辑约 :2891 起）：与 ChatGPT 后端对账，返回 `installed / enabled / disabled / uninstalled` 列表

## 技能系统

### SkillsManager（`core/src/skills.rs`）

从技能 crate 重导出（rust-v0.162 为 `codex-skills` / `codex-skills-extension`；0.154 为 `codex_core_skills`）：

- `SkillsManager` — 主技能加载器
- `SkillLoadOutcome` / `SkillMetadata` — 技能信息
- `SkillError` / `SkillPolicy` — 错误/策略类型
- `SkillDependencyInfo` — 依赖定义

### 技能加载（`core/src/skills.rs:29`）

```rust
pub(crate) fn skills_load_input_from_config(
    config: &Config,
    effective_skill_roots: Vec<PathBuf>,
) -> SkillsLoadInput {
    SkillsLoadInput::new(
        config.cwd.clone().to_path_buf(),
        effective_skill_roots,
        config.config_layer_stack.clone(),
        config.bundled_skills_enabled(),
    )
}
```

### 依赖解析（rust-v0.162 起：`resolve_skill_dependencies_for_turn()` 已移除）

0.154 中此处是 `resolve_skill_dependencies_for_turn()`（`skills.rs`）；rust-v0.162 起该函数已不在 `core/src/skills.rs`，技能 env 依赖在回合准备阶段由 `build_skills_and_plugins()`（`session/turn.rs:1030`）内部处理，MCP 依赖安装提示由 `maybe_prompt_and_install_mcp_dependencies()`（`core/src/mcp_skill_dependencies.rs:40`）承担。

原 0.154 流程（保留作参考）：

```rust
pub(crate) async fn resolve_skill_dependencies_for_turn(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    dependencies: &[SkillDependencyInfo],
)
```

流程：

1. 检查现有 session env
2. 从 `env::var()` 加载缺失值
3. 通过 UI 请求缺失值（标记为 secret/密码输入）
4. 存储到 session dependency env

### 隐式技能调用（`core/src/skills.rs:132`）

```rust
pub(crate) async fn maybe_emit_implicit_skill_invocation(
    sess: &Session,
    turn_context: &TurnContext,
    command: &str,
    workdir: &Path,
)
```

- 检测命令是否匹配技能名称
- 每轮跟踪已见技能（防重复）
- 发射 `codex.skill.injected` 遥测计数器

## 动态工具

### DynamicToolSpec（`codex_protocol::dynamic_tools`）

Session 级动态工具注册：

```rust
pub(crate) dynamic_tools: Vec<DynamicToolSpec>,
```

来源：

1. 显式 session 参数
2. 从 rollout 数据库持久化
3. 从对话历史检索

### 工具过滤（rust-v0.162 起移入工具注册层）

延迟加载的动态工具不会进入模型可见工具列表，等待按需启用。0.154 中这段过滤写在 `codex.rs:577-599`；rust-v0.162 起拆为三处：

```rust
// core/src/tools/registry.rs:81 —— 注册层标记第三方工具
/// True for MCP/app and client-supplied dynamic tools.
/// A built-in stays false even if a client's tool has the same name.
fn is_third_party_tool(&self) -> bool { false }

// 模型可见性统一由 ToolRouter::model_visible_specs() 裁决，
// 延迟启用的 deferred 第三方工具在 core/src/tools/spec_plan.rs 处理
// （spec_plan.rs:887：Deferred third-party tools still need an exec route to be discoverable）
```

### 事件流

- `EventMsg::DynamicToolCallRequest(_)` — 工具执行请求
- `EventMsg::DynamicToolCallResponse(_)` — 工具结果
- Handler：`Op::DynamicToolResponse { id, response }`（`session/handlers.rs:658`）

### 持久化（`state/migrations/0004_thread_dynamic_tools.sql` + `state/src/runtime/threads.rs`）

```rust
// state/src/runtime/threads.rs —— thread_dynamic_tools 表的写入/清理
sqlx::query("INSERT INTO thread_dynamic_tools (thread_id, position, name, description, input_schema) ...")   // :2025
sqlx::query("DELETE FROM thread_dynamic_tools WHERE thread_id = ?")                                          // :1185
```

（0.154 的 `state_db_bridge.rs` 动态工具 re-export 在 0.162 已不在；`core/src/state_db_bridge.rs` 现只桥接 `init_state_db()` / `StateDbHandle`。会话历史侧的检索入口是 `history/src/lib.rs:441` 的 `get_dynamic_tools()`。）

## MCP Server 模式（codex 作为 MCP server）

**（rust-v0.162 起：已移除。）** 0.154 中的 `mcp-server` crate（`mcp-server/src/lib.rs` 的 `run_main()`、`message_processor.rs` 的 `MessageProcessor`、`codex_tool_runner.rs` 的 `run_codex_tool_session()`）在 0.162 快照中已整体删除，`run_main` / `run_codex_tool_session` 等入口不再存在。`codex mcp` 子命令保留，但语义变为 **MCP client 管理**（add / remove / login / logout，`cli/src/mcp_cmd.rs`），而非把 Codex 自身暴露为 MCP server。以下为 0.154 行为的存档分析：

### 入口（0.154：`mcp-server/src/lib.rs:56-179`）

```rust
pub async fn run_main(
    arg0_paths: Arg0DispatchPaths,
    cli_config_overrides: CliConfigOverrides,
) -> IoResult<()>
```

架构：3 个并发任务 + channel 通信

| 任务 | 职责 |
| --- | --- |
| stdin reader | 反序列化 JSON-RPC |
| message processor | 处理请求/响应 |
| stdout writer | 序列化输出消息 |

### MessageProcessor（0.154：`message_processor.rs:52-158`）

处理的请求类型：

| 请求 | 用途 |
| --- | --- |
| `InitializeRequest` | 初始化 MCP server |
| `ListToolsRequest` | 列出可用工具 |
| `CallToolRequest` | 执行工具 |
| `ListPromptsRequest` / `GetPromptRequest` | Prompts API |
| `ListResourcesRequest` / `ReadResourceRequest` | Resources API |

### CodexToolRunner（0.154：`codex_tool_runner.rs:55-142`）

```rust
pub async fn run_codex_tool_session(
    id: RequestId,
    initial_prompt: String,
    config: CodexConfig,
    outgoing: Arc<OutgoingMessageSender>,
    thread_manager: Arc<ThreadManager>,
    ...
)
```

执行流程：

1. 通过 `thread_manager.start_thread(config)` 启动新线程
2. 提交初始 prompt（`sub_id = MCP request_id`）
3. 流式传送所有回合事件作为 MCP notifications
4. 返回最终结果为 `CallToolResult`（含 `thread_id` 和回合完成消息）

## Connector / App 发现

### list_accessible_connectors_from_mcp_tools（`core/src/connectors.rs:71`）

```rust
pub async fn list_accessible_connectors_from_mcp_tools(
    config: &Config,
) -> anyhow::Result<Vec<AppInfo>>
```

缓存策略：

- Key：Account ID + ChatGPT User ID + workspace status
- TTL：1 小时（`codex-connectors` crate `CONNECTORS_CACHE_TTL`，`connectors/src/lib.rs:56`；0.154 为 15 分钟）
- 静态缓存 + instant-based 过期

## 新增工具的修改点

### 情况 A：新增外部 MCP server 暴露的工具

通常**不需要改 core 主链路**。原因：

- `ToolRouter::build_tool_call()` 已能识别 namespaced MCP tool
- （0.154 的 `build_specs_with_discoverable_tools()` 在 0.162 已不在；MCP 工具经 `codex-mcp` 的 tool catalog 并入 `ToolRouter::model_visible_specs()`）
- `McpHandler` 已是通用处理器

需要做的工作：

1. 让新 server/tool 出现在 MCP 配置或插件发现结果里
2. 确认 tool schema 能被 `rmcp` 和 tool registry 正常发现
3. 若是 Apps/Connector 工具，检查启用条件和 connector 过滤逻辑

### 情况 B：新增 Codex 内建的一类新工具

需要修改以下核心位置：

| 修改位置 | 文件 | 说明 |
| --- | --- | --- |
| Handler 实现 | `core/src/tools/handlers/<new>.rs` | 实现 `ToolHandler` trait（trait 在 `core/src/tools/registry.rs`） |
| 工具规范 | `core/src/tools/spec_plan.rs` | 声明 spec 与可见性计划（0.154 为 `tools/spec.rs` 的 `build_specs_with_discoverable_tools()`） |
| 路由器 | `core/src/tools/router.rs` | 添加新的 `ToolHandlerKind` 变体 |
| 协议类型 | `codex_protocol` | 若涉及新参数类型 |
| 编排器 | `core/src/tools/orchestrator.rs` | 若涉及新审批/沙箱语义 |

### 缓存策略总结

| 对象 | 缓存机制 | TTL |
| --- | --- | --- |
| Plugins | `RwLock` 保护，force reload 重算 | 按需 |
| Featured Plugins | 时间戳缓存 | 3 小时 |
| Accessible Connectors | 静态缓存 + 认证 key | 1 小时（0.154 为 15 分钟） |
| MCP Tools | 每用户账户缓存 | 连接生命周期 |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `McpConnectionSet::new()` | `codex-rs/codex-mcp/src/connection_manager.rs:229` | 建立各 MCP server 的 RmcpClient 连接（连接生命周期管理）|
| `McpConnectionSet::call_tool()` | `codex-rs/codex-mcp/src/connection_manager.rs:977` | 调用单个 MCP 工具 |
| 工具聚合 / 可见性 | `codex-rs/codex-mcp/src/connection_manager/tool_catalog.rs` | 聚合全限定名、去冲突、裁决模型可见性（`tool_is_model_visible`）|
| `PluginsManager::plugins_for_config()` | `codex-rs/core-plugins/src/manager.rs:813` | 发现并加载 plugin 配置 |
| Featured plugins 缓存 | `codex-rs/core-plugins/src/manager.rs:551`（`featured_plugin_ids_cache`） | 带时间戳缓存的 featured plugin 获取 |
| `skills_load_input_from_config()` | `codex-rs/core/src/skills.rs:29` | 从 config 与 skill roots 构建技能加载输入 |
| 动态工具 handler | `codex-rs/core/src/tools/handlers/dynamic.rs` | 客户端/会话动态工具的执行处理（延迟启用见 `tools/registry.rs:81`）|
| `codex_serve()` | （rust-v0.162 起：已移除） | 0.154 的 MCP server 模式入口；0.162 起 `codex mcp` 仅为 client 管理子命令（`cli/src/mcp_cmd.rs`） |

---

## 代码质量评估

**优点**

- **四类扩展点统一**：MCP 工具、Plugin、Skill、Dynamic Tool 通过统一的工具注册表接入，扩展机制不需要修改核心 loop。
- **缓存策略分级**：Featured Plugins 3 小时、Connector 15 分钟、MCP 连接内缓存，不同生命周期的数据有各自合适的 TTL。
- **Codex 能反向作为 MCP server**（0.154）：`codex_serve()` 让 Codex 自身能被其它 AI 工具复用，拓展了生态集成场景。（rust-v0.162 起：该模式已随 `mcp-server` crate 移除，此优势不再成立）

**风险与改进点**

- **MCP 连接错误无 fallback**：MCP server 不可用时工具直接消失，模型会收到"工具不存在"错误而非降级提示。
- **Plugin `RwLock` 阻塞读写**：并发请求场景下，force reload 会独占写锁导致所有读请求阻塞，可考虑 per-plugin 细粒度锁。
- **Skill 文件信任边界模糊**：Skill 是 `.md` + prompt 注入，文件内容直接注入 system prompt，若 skill 文件被篡改，后果等价于 prompt injection。
- **动态工具 schema 无版本校验**：远程 MCP 工具升级 schema 后，客户端无感知更新，可能在工具调用时才发生参数类型不兼容。

## Codex 扩展入口最终回到工具和 prompt

Codex 的扩展体系要按三条线阅读：AGENTS/skill 改变 prompt，MCP 改变工具集合，hooks 改变 turn 前后控制流。

| 扩展线 | Codex 侧对象 | 对齐章节 |
| --- | --- | --- |
| 指令扩展 | `AGENTS.md`, skills | `11`, `13` |
| 工具扩展 | MCP / dynamic tools | `05`, `24` |
| 生命周期扩展 | hooks | `19` |
| 安全治理 | approval/sandbox | `07` |

横向看，Codex 没有复杂 plugin marketplace，但扩展进入 runtime 后治理最集中。

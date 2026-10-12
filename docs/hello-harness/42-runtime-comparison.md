---
title: "OpenCode vs Hermes Agent: 运行时对比分析"
---
# OpenCode vs Hermes Agent: 运行时对比分析

> 为可插拔模块设计提供决策依据

本文档详细对比 OpenCode 和 Hermes Agent 两个运行时在上下文管理和记忆系统方面的实现差异，为统一抽象层的设计提供依据。

---

## 1. 核心架构对比

| 维度 | OpenCode v2.0.27 | Hermes Agent v2026.9.24（包 0.21.5） |
| :------| :-----------------| :---------------------|
| **语言** | TypeScript | Python 3.11+ |
| **运行时** | Bun (原生 HTTP/SQLite) | CPython (标准库) |
| **并发模型** | Effect runtime 单线程事件循环 + fiber 并发 | asyncio 事件循环（gateway/CLI 一致） |
| **HTTP 服务器** | Effect HTTP handler graph in Server | aiohttp（`gateway/platforms/api_server.py`） |
| **数据库** | SQLite (`@opencode/effect-drizzle-sqlite`) | SQLite (sqlite3 标准库) |
| **事件机制** | Core durable events + Server EventFeed (SSE) | 生命周期钩子 (同步回调) |

---

## 2. 消息模型对比

### 2.1 OpenCode: durable message and tool-event model

OpenCode v2 的公共消息形状由 `packages/schema` 管理，Core 通过 durable Session events 和 projections 维护消息、pending input、context 与 tool outcome。每次工具调用携带 Session、agent、assistant message 和 call ID，调用终态先持久化，再由下一 Step 重载投影历史。

**特点**：

- durable identity：工具调用归属到具体 assistant message；
- canonical outcome：成功只有一份 model-facing content，失败只有一份 error 和可选 partial snapshot；
- projection boundary：客户端读取权威投影，replay consumer 读取 durable Session log；
- transport separation：Server SSE 只负责公开事件选择、编码和连接交付。

### 2.2 Hermes Agent: 扁平消息列表

```python
# 扁平的 messages 列表
messages = [
    {'role': 'user', 'content': '...'},
    {'role': 'assistant', 'content': '...', 'tool_calls': [...]},
    {'role': 'tool', 'content': '...', 'tool_call_id': '...'}
]
```

**特点**：

- 简单直接：符合 OpenAI API 格式
- 易于序列化：直接 JSON 存储
- 工具调用内嵌：`tool_calls` 和 `tool` role 处理工具
- 适合批处理：整条消息一次性写入

### 2.3 统一抽象的挑战

| 挑战 | 解决方案 |
| :------| :---------|
| 消息粒度不匹配 | 在 OpenCode 适配器中用 `toLLMMessages()` 把 durable history 聚合成完整 message |
| 流式更新语义 | 统一接口只处理完整消息，流式更新由适配器内部处理 |
| 工具调用表示 | 使用 `metadata.toolCalls` 统一表示，适配器负责转换 |

---

## 3. 上下文编译对比

### 3.1 OpenCode: 运行时编译模型

```typescript
// 六个上下文来源
1. 用户原始输入 (SessionPrompt.prepare, session/prompt.ts:29)
2. 文件/MCP/agent 附件展开 (materializeAttachment)
3. Agent/用户 system 覆盖 (session/model-request.ts:110)
4. 内置 runner 系统提示 (session/system-prompt.ts + runner/prompt/system.txt)
5. 指令文件 (session/instructions.ts)
6. Durable history 投影 (SessionHistory → toLLMMessages)

// 编译流程
prompt() → SessionPrompt.prepare() → 持久化到 Session inbox（session_inbox 表）
  → SessionRunner.drain() 出队消费 (session/runner/llm.ts:54)
  → context.load() 投影历史 → toLLMMessages() 编译 (runner/to-llm-message.ts:330)
  → llm.stream()（@opencode/ai）
```

**特点**：

- **主动展开**：文件附件在持久化前就被读取和展开
- **Synthetic text**：系统生成的解释性文本（如 "@agent 改写"）
- **多层合并**：system prompt 是 agent override、内置 runner 提示和 tool 清单的运行时合并结果
- **指令发现**：指令文件经 `SessionInstructions` 在 Step 准备时进入 instruction baseline

### 3.2 Hermes Agent: 分层组装模型

```python
# 三个主要组件
1. prompt_builder 模块函数（无类）: 组装 system prompt
   - Identity (DEFAULT_AGENT_IDENTITY, prompt_builder.py:158)
   - Platform hints (PLATFORM_HINTS, prompt_builder.py:634)
   - Skills index (build_skills_system_prompt, prompt_builder.py:1262)
   - Context files (.hermes.md → build_context_files_prompt, prompt_builder.py:1733)
   - Memory guidance (build_memory_guidance, prompt_builder.py:191)

2. MemoryManager: 预取记忆
   - prefetch_all() 从所有 provider 收集上下文
   - build_memory_context_block() 包装成 fenced block

3. ContextEngine: 管理压缩
   - should_compress() 判断是否需要压缩
   - compress() 执行压缩策略
```

**特点**：

- **分层清晰**：system prompt / memory / compression 各司其职
- **Provider 抽象**：支持多个 memory provider 并行工作
- **Fenced context**：记忆上下文用 `<memory-context>` 标签隔离
- **Platform-aware**：根据平台（Telegram/Discord/CLI）调整提示

### 3.3 统一抽象的映射

| 统一接口方法 | OpenCode 实现 | Hermes 实现 |
| :-------------| :--------------| :-------------|
| `compileSystemPrompt()` | `session/system-prompt.ts` + `model-request.ts` 多层合并 | `prompt_builder` 模块函数（无类） |
| `compileMessages()` | `toLLMMessages()` 投影（`runner/to-llm-message.ts:330`） | 直接返回 messages 列表 |
| `injectReminders()` | `runner/prompt/system.txt` 的 system-reminder 段 | 通过 system prompt 注入 |
| `resolveInstructions()` | `SessionInstructions`（`session/instructions.ts`） | `_find_hermes_md()`（`prompt_builder.py:139`） |

---

## 4. 记忆系统对比

### 4.1 OpenCode: Session 级文件变更追踪

```typescript
// SessionDiff 核心功能（session/diff.ts:38）
1. turn(): 以 user/idle 消息为边界计算 turn 范围文件 diff
   （跨 location 切换的范围会被拒绝而不是算错）

// 数据结构（@opencode/schema/file-diff.ts）
interface FileDiff {
  file: string
  additions: number
  deletions: number
  changes: number
}

// 存储位置
SessionTable.summary_diffs（session/sql.ts:43，JSON 列）
```

**特点**：

- **Session 作用域**：记忆不跨 session
- **文件中心**：追踪文件级别的变更
- **缓存驱动**：diff 结果缓存进 `SessionTable.summary_diffs`，避免重算
- **实时推送**：通过 Bus 推送 diff 事件到前端

### 4.2 Hermes Agent: 跨 Session 持久化知识

```python
# MemoryManager 核心功能（agent/memory_manager.py:336）
1. prefetch_all(): 从所有 provider 预取相关记忆
2. sync_all(): 同步当前轮次到所有 provider
3. handle_tool_call(): 路由 memory tool 调用

# 内置记忆存储（tools/memory_tool_store.py 的 MemoryStore）
- 维护 MEMORY.md / USER.md（有字符上限，写入门控）
- get_tool_schemas()/handle_tool_call() 由 provider 暴露工具（memory_provider.py）

# 跨 session 检索
- session_search tool：FTS5 全文搜索历史对话
- MemoryProvider 钩子（on_pre_compress 等）参与压缩前提取

# 数据结构
MEMORY.md: 持久化事实和偏好
USER.md: 用户画像和背景
SessionDB（hermes_state.py:451）: SQLite + FTS5 索引
```

**特点**：

- **跨 Session**：记忆在所有对话中共享
- **知识中心**：追踪事实、偏好、技能
- **FTS5 搜索**：全文搜索历史对话
- **Provider 抽象**：支持外部记忆后端（Honcho）

### 4.3 统一抽象的桥接

| 统一接口方法 | OpenCode 实现 | Hermes 实现 |
| :-------------| :--------------| :-------------|
| `prefetch()` | 读取 session diff（`session/diff.ts`，扩展） | `MemoryManager.prefetch_all()` |
| `syncTurn()` | 工具/assistant 终态由 runner durable 结算 | `MemoryManager.sync_all()` |
| `write()` | 写自定义表（`@opencode/effect-drizzle-sqlite`） | `memory` tool → MEMORY.md |
| `search()` | 基于 session diff 或自定义索引（扩展） | `session_search` tool + FTS5 |

---

## 5. 压缩策略对比

### 5.1 OpenCode: SessionCompaction

```typescript
// 触发机制（session/compaction.ts:205）
1. auto：每个 Step 前检查（runner/llm.ts:217）
2. manual：用户显式触发（inbox 投递 compaction 输入）
3. overflow：provider 报上下文溢出后重试本步（runner/llm.ts:265）
4. 调用 summary 模板生成摘要
5. 旧历史被 compaction 边界替代，投影只保留 summary

// 投影方式
checkpoint 作为一条 user message 进入后续请求（compaction.ts:261-270）：
  <conversation-checkpoint>
    <summary>…</summary>
    <recent-context>…</recent-context>
  </conversation-checkpoint>

// 特点
- Agent-driven: 由 summary 模板（buildPrompt）+ 模型生成摘要
- Durable: compaction 以 durable events 结算
- Token-aware: estimatePrompt 估算（compaction.ts:874）
```

### 5.2 Hermes Agent: ContextEngine 抽象

```python
# ContextEngine 接口
class ContextEngine(ABC):
    def should_compress(self, prompt_tokens: int) -> bool
    def compress(self, messages: List[Dict], current_tokens: int) -> List[Dict]
    def update_from_response(self, usage: Dict) -> None

# 内置实现: ContextCompressor (agent/context_compressor.py)
- 基于 token 阈值触发（compression.threshold）
- 调用 LLM 生成摘要，保护首尾 N 条消息
- 可选 proactive prune：无 LLM 的旧工具结果裁剪

# 可选实现: 外部 context engine 插件
- 通过 context.engine 配置选择（agent_init.py:1858）
- 从 plugins/context_engine/<name>/ 动态加载（如 lcm）
- 引擎可暴露自有工具给 agent
```

**特点**：

- **可插拔**：通过 `context.engine` 配置选择
- **Token-aware**：基于实际 token 使用情况决策
- **工具集成**：压缩引擎可以暴露工具给 agent

### 5.3 统一抽象的设计

| 统一接口方法 | OpenCode 实现 | Hermes 实现 |
| :-------------| :--------------| :-------------|
| `shouldCompress()` | Step 前检查（`SessionCompaction.compact` auto 触发，`runner/llm.ts:217`） | `ContextEngine.should_compress()` |
| `compress()` | `SessionCompaction.compact()`（`compaction.ts:205`） | `ContextEngine.compress()` |
| `updateTokenUsage()` | `estimatePrompt` 估算 + provider usage 回填 | `ContextEngine.update_from_response()` |
| `getStats()` | 读取 `SessionTable.summary_diffs` 等投影 | `ContextEngine.get_status()` |

---

## 6. 存储层对比

### 6.1 OpenCode: SQLite durable tables

```typescript
// SQLite 表结构（session/sql.ts）
SessionTable → session_v2: session 边界（含 permission 规则、summary_diffs 等列）
SessionMessageTable → session_message: durable 消息（seq 有序）
SessionPendingTable → session_pending: 待提升输入
SessionInboxTable → session_inbox: inbox 队列

// 特点
- 关系型为主，JSON 列承载结构化载荷
- durable event 先落库再投影，Bus 事件随结算发布
- WAL 模式支持并发读
```

### 6.2 Hermes Agent: SQLite + FTS5

```python
# SQLite 表结构（hermes_state.py / hermes_state_schema.py）
sessions: session 元数据
messages: 消息历史
messages_fts / messages_fts_trigram: FTS5 虚拟表（全文搜索，可加载 CJK 分词扩展）

# 特点
- 纯关系型
- FTS5 索引支持全文搜索
- WAL 模式 + 应用层重试（随机 jitter）
- 支持 session title 和跨 lineage 消息读取
```

### 6.3 统一抽象的存储接口

```typescript
interface IMessageStore {
  createSession(sessionId: string, metadata: SessionMetadata): Promise<void>
  writeMessage(sessionId: string, message: Message): Promise<string>
  readMessages(sessionId: string, options?: ReadOptions): Promise<Message[]>
  searchMessages(query: string, options?: SearchOptions): Promise<SearchResult[]>
  updateSession(sessionId: string, updates: Partial<SessionMetadata>): Promise<void>
}
```

**适配策略**：

- OpenCode: 用 `toLLMMessages()` 聚合 durable history 成完整 Message
- Hermes: 直接映射 messages 表
- 搜索: OpenCode 扩展支持 FTS，Hermes 直接用 FTS5

---

## 7. 事件机制对比

### 7.1 OpenCode: Core events and Server EventFeed

Core owns event meaning, durable publication, persistence, replay, and transactional projection. Server installs one global Core listener, filters and encodes each public event once, then offers the immutable SSE frame to an independent bounded queue for each connection.

- 每个连接的容量为 4,096 个公开 frame；
- 慢连接溢出只终止该连接，不阻塞健康连接或 Core publication；
- `server.connected` 与 heartbeat 是连接本地事件，不占 EventFeed 队列；
- 编码失败终止当前订阅者以避免静默缺口，但不会毒化后续连接。

### 7.2 Hermes Agent: 生命周期钩子

```python
# MemoryProvider 钩子
def on_turn_start(self, turn_number: int, message: str, **kwargs)
def on_session_end(self, messages: List[Dict])
def on_pre_compress(self, messages: List[Dict]) -> str
def on_memory_write(self, action: str, target: str, content: str)
def on_delegation(self, task: str, result: str, **kwargs)

# ContextEngine 钩子
def on_session_start(self, session_id: str, **kwargs)
def on_session_end(self, session_id: str, messages: List[Dict])
def on_session_reset(self)

# 特点
- 同步回调
- 容错设计（单个 provider 失败不影响其他）
- 无跨进程通信
```

### 7.3 统一抽象的事件模型

**策略**：统一接口不暴露事件机制，而是通过生命周期方法暴露关键时机

```typescript
interface IContextManager {
  onSessionStart?(sessionId: string, metadata: SessionMetadata): Promise<void>
  onSessionEnd?(sessionId: string): Promise<void>
  onTurnStart?(turnNumber: number, message: string): Promise<void>
  onTurnEnd?(turnNumber: number): Promise<void>
}

interface IMemoryProvider {
  onSessionStart?(sessionId: string): Promise<void>
  onSessionEnd?(sessionId: string, messages: Message[]): Promise<void>
  onPreCompress?(messages: Message[]): Promise<string>
  onMemoryWrite?(action: string, target: string, content: string): Promise<void>
}
```

**适配策略**：

- OpenCode: 在 Bus 事件处理器中调用生命周期方法
- Hermes: 直接映射到现有钩子

---

## 8. 工具集成对比

### 8.1 OpenCode: Tool service + MCP + Plugin

```typescript
// 工具来源
1. 内建工具（tool/plugin/ 下的 read/shell/glob 等 plugin tool）
2. Plugin 工具 (plugin hooks)
3. MCP 工具 (tool/mcp.ts)
4. Custom 工具 (config plugin)

// 权限控制
Permission.ask()/assert() 在每次工具调用前判断（permission.ts:223），
session 级规则持久化在 SessionTable.permission，已批准规则写入 PermissionSaved

// 特点
- 工具经 Tool service 注册，包装为 ToolDefinition 进入 request
- 支持 plugin hooks 修改工具行为
- MCP 工具与内建工具统一暴露给模型
```

### 8.2 Hermes Agent: tools/registry + MCP + Skills

```python
# 工具来源
1. 内建工具（tools/ 目录下 import 时 `registry.register()` 注册，40+ tools）
2. MCP 工具 (MCP servers)
3. Skills (动态生成的工具)
4. Memory 工具 (MemoryProvider.get_tool_schemas())

# 工具集合
registry（tools/registry.py）: 统一注册 schema、handler、toolset 成员和可用性
platform_toolsets: 按平台分发工具集（cli/telegram/discord/...）

# 特点
- Toolset 系统：按场景组织工具
- Skills 自动发现和索引
- Memory 工具由 provider 提供
```

### 8.3 统一抽象的工具接口

**策略**：统一接口不直接管理工具，而是通过 `IMemoryProvider` 暴露记忆相关工具

```typescript
interface IMemoryProvider {
  getToolSchemas(): ToolSchema[]
  handleToolCall(toolName: string, args: Record<string, any>): Promise<string>
}
```

**适配策略**：

- OpenCode: 扩展 `Tool` service 注册 memory 工具
- Hermes: 直接映射 MemoryManager 的工具接口

---

## 9. 配置系统对比

### 9.1 OpenCode: opencode.jsonc

```jsonc
{
  "agent": "build",
  "model": "anthropic:claude-sonnet-4",
  "user": {
    "system": "Custom system prompt"
  },
  "instructions": ["path/to/AGENTS.md"],
  "plugins": ["plugin-name"],
  "mcp": {
    "servers": {
      "server-name": {
        "command": "npx",
        "args": ["-y", "package-name"]
      }
    }
  }
}
```

### 9.2 Hermes Agent: config.yaml

```yaml
model:
  default: "anthropic/claude-opus-4.6"
  provider: "anthropic"   # openrouter / nous / openai-codex / copilot / gemini / ...

memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  nudge_interval: 10

context:
  engine: compressor   # 内置 ContextCompressor；可指向 plugins/context_engine/<name>/（如 lcm）

compression:
  enabled: true
  threshold: 0.50

platform_toolsets:
  cli: [hermes-cli]

skills:
  external_dirs:
    - /path/to/skills

mcp_servers:
  server-name:
    command: uvx
    args: [package-name]
```

### 9.3 统一配置接口

```typescript
interface ContextMemoryConfig {
  context: {
    engine: string
    maxTokens: number
    compressionThreshold: number
    instructionPaths?: string[]
  }
  memory: {
    provider: string
    prefetchEnabled: boolean
    autoSyncEnabled: boolean
    searchEnabled: boolean
  }
  compression: {
    strategy: string
    protectFirst: number
    protectLast: number
    summaryModel?: string
  }
  storage: {
    type: string
    path?: string
    connectionString?: string
  }
}
```

---

## 10. 关键设计决策总结

### 10.1 消息模型

**决策**：使用扁平 Message 列表作为统一接口，OpenCode 适配器负责聚合 durable history

**理由**：

- Hermes 的扁平模型更通用
- OpenCode 的 durable message 投影是实现细节，不应暴露给业务逻辑
- 通过 `metadata` 可以保留 message 级别的附加信息

### 10.2 上下文编译

**决策**：分离 system prompt 编译和 message 编译

**理由**：

- 两个系统的 system prompt 组装逻辑差异较大
- Message 编译相对统一（都是历史投影）
- 分离后可以独立优化

### 10.3 记忆系统

**决策**：使用 Provider 抽象，支持多个 provider 并行工作

**理由**：

- Hermes 的 MemoryManager 设计已经很成熟
- OpenCode 可以通过扩展 session diff（`session/diff.ts`）实现跨 session 记忆
- Provider 抽象支持外部记忆后端（Honcho / LangChain）

### 10.4 压缩策略

**决策**：使用 Engine 抽象，支持可插拔的压缩策略

**理由**：

- 两个系统的压缩触发机制差异较大
- Engine 抽象可以统一 token-based 和 agent-based 两种模式
- 支持第三方压缩策略（如 LCM）

### 10.5 事件机制

**决策**：不暴露事件机制，使用生命周期方法

**理由**：

- OpenCode 的 Bus 和 Hermes 的钩子语义不同
- 生命周期方法更通用，易于适配
- 业务逻辑不应依赖具体的事件实现

---

## 11. 实现优先级建议

### Phase 1: 核心接口（高优先级）

1. **IMessageStore**: 最基础，两个系统都需要
2. **IContextManager**: 上下文编译是核心功能
3. **ICompressionEngine**: 压缩策略可插拔性价值高

### Phase 2: 记忆系统（中优先级）

1. **IMemoryProvider**: 记忆系统是差异化能力
2. OpenCode 扩展: 实现跨 session 记忆
3. Hermes 适配: 封装 MemoryManager

### Phase 3: 生态扩展（低优先级）

1. 第三方存储后端（PostgreSQL / Redis）
2. 第三方压缩策略（LCM / DAG）
3. 第三方记忆提供者（Honcho / LangChain）

---

*文档版本: 1.0*  
*创建日期: 2026-04-17*  
*作者: Claude (Kiro)*

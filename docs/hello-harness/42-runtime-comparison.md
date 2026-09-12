---
layout: content
title: "OpenCode vs Hermes Agent: 运行时对比分析"
---

# OpenCode vs Hermes Agent: 运行时对比分析

> 为可插拔模块设计提供决策依据

本文档详细对比 OpenCode 和 Hermes Agent 两个运行时在上下文管理和记忆系统方面的实现差异，为统一抽象层的设计提供依据。

---

## 1. 核心架构对比

| 维度 | OpenCode v1.4.14 | Hermes Agent v0.16.0 |
| :------| :-----------------| :---------------------|
| **语言** | TypeScript | Python 3.11+ |
| **运行时** | Bun (原生 HTTP/SQLite) | CPython (标准库) |
| **并发模型** | 单线程事件循环 + Worker | 多线程 (gateway) / 单线程 (CLI) |
| **HTTP 服务器** | Bun.serve (原生) | Flask/Werkzeug (gateway) |
| **数据库** | SQLite (Bun 内置) | SQLite (sqlite3 标准库) |
| **事件机制** | Bus + GlobalBus (SSE) | 生命周期钩子 (同步回调) |

---

## 2. 消息模型对比

### 2.1 OpenCode: Message + Part 分离模型

```typescript
// Message 是 envelope/header
interface Message.Info {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  agent?: string
  model?: string
  tokens?: TokenUsage
  finish?: FinishReason
}

// Part 是 body/typed nodes
type Part = 
  | TextPart
  | ReasoningPart
  | ToolPart
  | StepPart
  | PatchPart
  | SubtaskPart
  | CompactionPart
```

**特点**：

- 细粒度节点：一个 message 可以包含多个 part
- 实时流式更新：part 可以增量写入（`updatePartDelta`）
- 类型安全：每种 part 有独立的 schema
- 适合 IDE 集成：可以精确定位到某个 tool call 或 reasoning 块

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
| Part 粒度不匹配 | 在 OpenCode 适配器中将 part 聚合成完整 message |
| 流式更新语义 | 统一接口只处理完整消息，流式更新由适配器内部处理 |
| 工具调用表示 | 使用 `metadata.toolCalls` 统一表示，适配器负责转换 |

---

## 3. 上下文编译对比

### 3.1 OpenCode: 运行时编译模型

```typescript
// 六个上下文来源
1. 用户原始输入 (createUserMessage)
2. 文件/MCP/agent 附件展开 (synthetic text)
3. Provider/agent 基础提示 (system.ts)
4. 环境/技能/指令文件 (instruction.ts)
5. 运行时提醒 (insertReminders)
6. Durable history 投影 (toModelMessages)

// 编译流程
prompt() → createUserMessage() → 写 SQLite
  → toModelMessages() 投影历史
  → insertReminders() 注入提醒
  → LLM.stream()
```

**特点**：

- **主动展开**：文件附件在写入前就被读取和展开
- **Synthetic text**：系统生成的解释性文本（如 "@agent 改写"）
- **多层合并**：system prompt 是多个来源的运行时合并结果
- **指令发现**：read tool 触发时还能补发现局部指令

### 3.2 Hermes Agent: 分层组装模型

```python
# 三个主要组件
1. PromptBuilder: 组装 system prompt
   - Identity (DEFAULT_AGENT_IDENTITY)
   - Platform hints (PLATFORM_HINTS)
   - Skills index (build_skills_system_prompt)
   - Context files (.hermes.md)
   - Memory guidance (MEMORY_GUIDANCE)

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
| `compileSystemPrompt()` | `system.ts` 多层合并 | `PromptBuilder.build_system_prompt()` |
| `compileMessages()` | `toModelMessages()` 投影 | 直接返回 messages 列表 |
| `injectReminders()` | `insertReminders()` | 通过 system prompt 注入 |
| `resolveInstructions()` | `InstructionPrompt.systemPaths()` | `find_hermes_md()` |

---

## 4. 记忆系统对比

### 4.1 OpenCode: Session 级文件变更追踪

```typescript
// SessionSummary 核心功能
1. computeDiff(): 从 step 快照计算文件 diff
2. summarize(): 并行计算 session 级和 message 级摘要
3. diff(): 读取缓存的 FileDiff[]

// 数据结构
interface FileDiff {
  file: string
  additions: number
  deletions: number
  changes: number
}

// 存储位置
Storage.write(['session_diff', sessionID], diffs)
```

**特点**：

- **Session 作用域**：记忆不跨 session
- **文件中心**：追踪文件级别的变更
- **快照驱动**：diff 来自 step 开始/结束快照
- **实时推送**：通过 Bus 推送 diff 事件到前端

### 4.2 Hermes Agent: 跨 Session 持久化知识

```python
# MemoryManager 核心功能
1. prefetch_all(): 从所有 provider 预取相关记忆
2. sync_all(): 同步当前轮次到所有 provider
3. handle_tool_call(): 路由 memory tool 调用

# BuiltinMemoryProvider 功能
- write(): 写入 MEMORY.md / USER.md
- search(): FTS5 全文搜索
- session_search(): 跨 session 搜索历史对话
- on_pre_compress(): 压缩前提取关键信息

# 数据结构
MEMORY.md: 持久化事实和偏好
USER.md: 用户画像和背景
SessionDB: SQLite + FTS5 索引
```

**特点**：

- **跨 Session**：记忆在所有对话中共享
- **知识中心**：追踪事实、偏好、技能
- **FTS5 搜索**：全文搜索历史对话
- **Provider 抽象**：支持外部记忆后端（Honcho）

### 4.3 统一抽象的桥接

| 统一接口方法 | OpenCode 实现 | Hermes 实现 |
| :-------------| :--------------| :-------------|
| `prefetch()` | 读取 session_diff（扩展） | `MemoryManager.prefetch_all()` |
| `syncTurn()` | 自动通过 updateMessage/Part | `MemoryManager.sync_all()` |
| `write()` | 写入 Storage | `memory` tool → MEMORY.md |
| `search()` | 基于 session_diff（扩展） | `session_search` tool + FTS5 |

---

## 5. 压缩策略对比

### 5.1 OpenCode: Compaction Agent

```typescript
// 触发机制
1. 历史超过阈值 → CompactionTask
2. 调用 summary agent 生成摘要
3. 旧历史标记为 compacted
4. filterCompacted() 过滤掉旧历史

// 投影方式
compaction part → "What did we do so far?" (user message)

// 特点
- Agent-driven: 由专门的 summary agent 生成摘要
- Durable: compaction 结果写回 SQLite
- Replay: 可以重放 compacted history
```

### 5.2 Hermes Agent: ContextEngine 抽象

```python
# ContextEngine 接口
class ContextEngine(ABC):
    def should_compress(self, prompt_tokens: int) -> bool
    def compress(self, messages: List[Dict], current_tokens: int) -> List[Dict]
    def update_from_response(self, usage: Dict) -> None

# 内置实现: ContextCompressor
- 基于 token 阈值触发
- 调用 LLM 生成摘要
- 保护首尾 N 条消息
- 支持多种压缩策略

# 可选实现: LCM (Long Context Memory)
- DAG-based 压缩
- 提供 lcm_grep / lcm_describe 工具
- 支持增量更新
```

**特点**：

- **可插拔**：通过 `context.engine` 配置选择
- **Token-aware**：基于实际 token 使用情况决策
- **工具集成**：压缩引擎可以暴露工具给 agent

### 5.3 统一抽象的设计

| 统一接口方法 | OpenCode 实现 | Hermes 实现 |
| :-------------| :--------------| :-------------|
| `shouldCompress()` | 检查历史长度 | `ContextEngine.should_compress()` |
| `compress()` | 触发 CompactionTask | `ContextEngine.compress()` |
| `updateTokenUsage()` | 更新 session tokens | `ContextEngine.update_from_response()` |
| `getStats()` | 读取 session summary | `ContextEngine.get_status()` |

---

## 6. 存储层对比

### 6.1 OpenCode: SQLite + JSON Storage

```typescript
// SQLite 表结构
SessionTable: session 边界
MessageTable: message header
PartTable: part 体

// JSON Storage
session_diff: FileDiff[]
其他派生数据

// 特点
- 关系型 + 文档型混合
- Database.effect() 保证先写库再发事件
- WAL 模式支持并发读
```

### 6.2 Hermes Agent: SQLite + FTS5

```python
# SQLite 表结构
sessions: session 元数据
messages: 消息历史
messages_fts: FTS5 虚拟表（全文搜索）

# 特点
- 纯关系型
- FTS5 索引支持全文搜索
- WAL 模式 + 应用层重试（随机 jitter）
- 支持 session title 和 lineage
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

- OpenCode: 聚合 message + parts 成完整 Message
- Hermes: 直接映射 messages 表
- 搜索: OpenCode 扩展支持 FTS，Hermes 直接用 FTS5

---

## 7. 事件机制对比

### 7.1 OpenCode: Bus + GlobalBus

```typescript
// 实例级 Bus
Bus.publish('message.updated', data)
Bus.subscribe('message.updated', handler)

// 进程级 GlobalBus
GlobalBus.emit('session.created', data)

// SSE 推送
/event → 实例级事件流
/global/event → 跨实例聚合流

// 特点
- 异步事件驱动
- 支持跨实例通信
- 前端通过 SSE 订阅
```

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

### 8.1 OpenCode: ToolRegistry + MCP + Plugin

```typescript
// 工具来源
1. 内建工具 (read/write/edit/bash/task/skill)
2. Plugin 工具 (plugin hooks)
3. MCP 工具 (MCP.tools())
4. Custom 工具 (config.tools)

// 权限控制
LLM.resolveTools() 根据 permission 规则裁剪

// 特点
- 工具集合晚绑定
- 支持 plugin hooks 修改工具行为
- MCP 工具自动转换成 AI SDK Tool
```

### 8.2 Hermes Agent: ToolRegistry + MCP + Skills

```python
# 工具来源
1. 内建工具 (40+ tools)
2. MCP 工具 (MCP servers)
3. Skills (动态生成的工具)
4. Memory 工具 (MemoryProvider.get_tool_schemas())

# 工具集合
toolsets: 预定义的工具组合
toolset_distributions: 按场景分发工具集

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

- OpenCode: 扩展 ToolRegistry 支持 memory 工具
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
model: anthropic:claude-sonnet-4
provider: anthropic

memory:
  provider: builtin
  prefetch_enabled: true

context:
  engine: compressor
  threshold_percent: 0.75

toolsets:
  - core
  - web
  - code

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

**决策**：使用扁平 Message 列表作为统一接口，OpenCode 适配器负责聚合 part

**理由**：

- Hermes 的扁平模型更通用
- OpenCode 的 part 粒度是实现细节，不应暴露给业务逻辑
- 通过 `metadata` 可以保留 part 级别的信息

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
- OpenCode 可以通过扩展 session_diff 实现跨 session 记忆
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

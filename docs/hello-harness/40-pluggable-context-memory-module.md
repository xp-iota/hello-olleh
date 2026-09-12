---
layout: content
title: "可插拔上下文与记忆模块：跨运行时内核的统一抽象"
---

# 可插拔上下文与记忆模块：跨运行时内核的统一抽象

> 基于 OpenCode v1.4.14 和 Hermes Agent v0.16.0 架构分析

本文档设计一个可插拔的上下文与记忆定制化模块，使其能够在 **OpenCode** 和 **Hermes Agent** 两个不同的运行时内核上完成相同的工作，实现真正的运行时无关性。

---

**目录**

- [1. 设计目标与原则](#1-设计目标与原则)
- [2. 架构对比分析](#2-架构对比分析)
- [3. 统一抽象层设计](#3-统一抽象层设计)
- [4. 核心接口定义](#4-核心接口定义)
- [5. 适配器实现](#5-适配器实现)
- [6. 使用示例](#6-使用示例)
- [7. 实现路线图](#7-实现路线图)

---

## 1. 设计目标与原则

### 1.1 核心目标

**统一接口，双内核兼容**：设计一套抽象接口，使得上下文管理和记忆系统的业务逻辑可以在 OpenCode（TypeScript/Bun）和 Hermes Agent（Python）两个完全不同的运行时上无缝运行。

**可插拔架构**：上下文编译策略、记忆存储后端、压缩算法都应该是可替换的组件，而不是硬编码在运行时内核中。

**保持各自优势**：不强求两个系统完全一致，而是提供统一的"能力契约"，让各自的特色功能（OpenCode 的 durable state、Hermes 的 learning loop）可以通过扩展点暴露。

### 1.2 设计原则

| 原则 | 说明 |
| :------| :------|
| **接口优先** | 先定义能力契约（interface），再实现适配器 |
| **最小公约数 + 扩展点** | 核心接口覆盖两个系统的交集，通过 metadata/hooks 暴露差异化能力 |
| **运行时无关** | 业务逻辑不依赖具体的 SQLite schema、Bus 实现或 Python/TypeScript 语言特性 |
| **渐进式迁移** | 可以先在一个系统上实现，再逐步移植到另一个系统 |

---

## 2. 架构对比分析

### 2.1 OpenCode 架构特点

| 维度 | OpenCode 实现 |
| :------| :--------------|
| **状态持久化** | SQLite（SessionTable / MessageTable / PartTable）+ JSON Storage |
| **上下文编译** | `SessionPrompt.prompt()` → `toModelMessages()` 投影 |
| **记忆系统** | Session 级文件变更追踪（`SessionSummary.computeDiff()`） |
| **事件机制** | `Bus` + `GlobalBus`（SSE 推送） |
| **工具集成** | `ToolRegistry` + MCP + Plugin |
| **语言/运行时** | TypeScript + Bun |

**核心流程**：

```
用户输入 → createUserMessage() → 写 SQLite
  → toModelMessages() 投影历史
  → LLM.stream()
  → SessionProcessor.process() 写 part
  → Bus.publish() → SSE → UI
```

### 2.2 Hermes Agent 架构特点

| 维度 | Hermes Agent 实现 |
| :------| :------------------|
| **状态持久化** | SQLite（sessions / messages 表）+ FTS5 全文搜索 |
| **上下文编译** | `PromptBuilder` + `ContextEngine` + `MemoryManager` |
| **记忆系统** | `MemoryProvider` 抽象（builtin + 可选外部 provider） |
| **事件机制** | 生命周期钩子（`on_turn_start` / `on_session_end` / `on_pre_compress`） |
| **工具集成** | `ToolRegistry` + MCP + Skills |
| **语言/运行时** | Python 3.11+ |

**核心流程**：

```
用户输入 → MemoryManager.prefetch_all()
  → PromptBuilder.build_system_prompt()
  → API 调用
  → MemoryManager.sync_all()
  → ContextEngine.compress() (if needed)
```

### 2.3 关键差异

| 维度 | OpenCode | Hermes Agent |
| :------| :----------| :--------------|
| **消息模型** | Message + Part（细粒度节点） | 扁平 messages 列表 |
| **压缩触发** | Compaction agent + summary | `ContextEngine.should_compress()` |
| **记忆语义** | Session 级文件 diff | 跨 session 持久化知识 + FTS5 搜索 |
| **扩展机制** | Plugin hooks（同步） | Provider 抽象（异步容错） |

---

## 3. 统一抽象层设计

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│          业务逻辑层（Runtime-Agnostic）                    │
│  - 自定义压缩策略                                          │
│  - 记忆检索算法                                            │
│  - 上下文优先级规则                                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│          统一抽象层（Unified Abstraction）                 │
│  - IContextManager                                       │
│  - IMemoryProvider                                       │
│  - ICompressionEngine                                    │
│  - IMessageStore                                         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────┬──────────────────────────────────┐
│  OpenCode Adapter    │  Hermes Agent Adapter            │
│  - OpenCodeContext   │  - HermesContextEngine           │
│  - OpenCodeMemory    │  - HermesMemoryProvider          │
│  - OpenCodeStore     │  - HermesSessionDB               │
└──────────────────────┴──────────────────────────────────┘
                          ↓
┌──────────────────────┬──────────────────────────────────┐
│  OpenCode Runtime    │  Hermes Agent Runtime            │
│  (TypeScript/Bun)    │  (Python)                        │
└──────────────────────┴──────────────────────────────────┘
```

### 3.2 核心抽象

#### 3.2.1 IContextManager（上下文管理器）

**职责**：编译和管理发送给 LLM 的上下文

```typescript
interface IContextManager {
  // 编译系统提示
  compileSystemPrompt(options: SystemPromptOptions): Promise<string>
  
  // 编译消息历史
  compileMessages(history: Message[], options: CompileOptions): Promise<Message[]>
  
  // 注入运行时提醒
  injectReminders(messages: Message[], context: RuntimeContext): Promise<Message[]>
  
  // 解析指令文件
  resolveInstructions(directory: string): Promise<Instruction[]>
  
  // 获取当前 token 使用情况
  getTokenUsage(): TokenUsage
}
```

#### 3.2.2 IMemoryProvider（记忆提供者）

**职责**：持久化和检索跨 session 的知识

```typescript
interface IMemoryProvider {
  // 预取相关记忆
  prefetch(query: string, sessionId: string): Promise<string>
  
  // 同步当前轮次
  syncTurn(userContent: string, assistantContent: string, sessionId: string): Promise<void>
  
  // 写入记忆
  write(target: string, content: string, metadata?: Record<string, any>): Promise<void>
  
  // 搜索记忆
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>
  
  // 获取工具 schema
  getToolSchemas(): ToolSchema[]
  
  // 处理工具调用
  handleToolCall(toolName: string, args: Record<string, any>): Promise<string>
}
```

#### 3.2.3 ICompressionEngine（压缩引擎）

**职责**：管理上下文压缩策略

```typescript
interface ICompressionEngine {
  // 判断是否需要压缩
  shouldCompress(messages: Message[], tokenCount: number): boolean
  
  // 执行压缩
  compress(messages: Message[], options: CompressionOptions): Promise<Message[]>
  
  // 更新 token 使用情况
  updateTokenUsage(usage: TokenUsage): void
  
  // 获取压缩统计
  getStats(): CompressionStats
}
```

#### 3.2.4 IMessageStore（消息存储）

**职责**：持久化消息历史

```typescript
interface IMessageStore {
  // 创建 session
  createSession(sessionId: string, metadata: SessionMetadata): Promise<void>
  
  // 写入消息
  writeMessage(sessionId: string, message: Message): Promise<string>
  
  // 读取消息历史
  readMessages(sessionId: string, options?: ReadOptions): Promise<Message[]>
  
  // 搜索消息
  searchMessages(query: string, options?: SearchOptions): Promise<SearchResult[]>
  
  // 更新 session 元数据
  updateSession(sessionId: string, updates: Partial<SessionMetadata>): Promise<void>
}
```

---

## 4. 核心接口定义

### 4.1 通用数据结构

```typescript
// 统一消息格式
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  metadata?: {
    model?: string
    tokens?: TokenUsage
    toolCalls?: ToolCall[]
    reasoning?: string
    [key: string]: any
  }
}

// Token 使用情况
interface TokenUsage {
  prompt: number
  completion: number
  total: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
}

// 压缩选项
interface CompressionOptions {
  targetTokens?: number
  protectFirst?: number
  protectLast?: number
  strategy?: 'summary' | 'dag' | 'sliding-window'
  model?: string
}

// 记忆条目
interface MemoryEntry {
  id: string
  target: string  // 'MEMORY.md', 'USER.md', etc.
  content: string
  timestamp: number
  metadata?: Record<string, any>
}

// Session 元数据
interface SessionMetadata {
  source: string  // 'cli', 'telegram', 'web', etc.
  model?: string
  userId?: string
  parentSessionId?: string
  startedAt: number
  endedAt?: number
  title?: string
}
```

### 4.2 配置接口

```typescript
interface ContextMemoryConfig {
  // 上下文管理
  context: {
    engine: 'opencode' | 'hermes' | string
    maxTokens: number
    compressionThreshold: number
    instructionPaths?: string[]
  }
  
  // 记忆系统
  memory: {
    provider: 'builtin' | 'honcho' | string
    prefetchEnabled: boolean
    autoSyncEnabled: boolean
    searchEnabled: boolean
  }
  
  // 压缩策略
  compression: {
    strategy: 'summary' | 'dag' | 'sliding-window'
    protectFirst: number
    protectLast: number
    summaryModel?: string
  }
  
  // 存储后端
  storage: {
    type: 'sqlite' | 'postgres' | string
    path?: string
    connectionString?: string
  }
}
```

---

## 5. 适配器实现

### 5.1 OpenCode 适配器

#### 5.1.1 OpenCodeContextManager

```typescript
class OpenCodeContextManager implements IContextManager {
  constructor(
    private session: Session,
    private prompt: SessionPrompt
  ) {}
  
  async compileSystemPrompt(options: SystemPromptOptions): Promise<string> {
    // 复用 OpenCode 的 system.ts 逻辑
    const parts = []
    
    // Provider prompt
    parts.push(await this.prompt.getProviderPrompt())
    
    // Environment + Skills + Instructions
    parts.push(await this.prompt.getEnvironmentPrompt())
    parts.push(await this.prompt.getSkillsPrompt())
    parts.push(await this.prompt.getInstructionsPrompt())
    
    // User system override
    if (options.userSystem) {
      parts.push(options.userSystem)
    }
    
    return parts.filter(Boolean).join('\n\n')
  }
  
  async compileMessages(history: Message[], options: CompileOptions): Promise<Message[]> {
    // 调用 MessageV2.toModelMessages()
    const durableHistory = await MessageV2.stream(this.session.id)
    const filtered = MessageV2.filterCompacted(durableHistory)
    return MessageV2.toModelMessages(filtered, options)
  }
  
  async injectReminders(messages: Message[], context: RuntimeContext): Promise<Message[]> {
    // 复用 prompt.ts 的 insertReminders() 逻辑
    return this.prompt.insertReminders(messages, context)
  }
  
  async resolveInstructions(directory: string): Promise<Instruction[]> {
    // 复用 instruction.ts 的发现逻辑
    return InstructionPrompt.systemPaths(directory)
  }
  
  getTokenUsage(): TokenUsage {
    return {
      prompt: this.session.lastPromptTokens || 0,
      completion: this.session.lastCompletionTokens || 0,
      total: this.session.lastTotalTokens || 0
    }
  }
}
```

#### 5.1.2 OpenCodeMemoryProvider

```typescript
class OpenCodeMemoryProvider implements IMemoryProvider {
  constructor(private storage: Storage) {}
  
  async prefetch(query: string, sessionId: string): Promise<string> {
    // OpenCode 当前没有跨 session 记忆，返回空
    // 可以扩展为读取 session_diff 或自定义记忆文件
    return ''
  }
  
  async syncTurn(userContent: string, assistantContent: string, sessionId: string): Promise<void> {
    // OpenCode 通过 Session.updateMessage/updatePart 自动同步
    // 这里可以添加额外的记忆提取逻辑
  }
  
  async write(target: string, content: string, metadata?: Record<string, any>): Promise<void> {
    // 写入自定义存储位置
    await this.storage.write(['memory', target], content)
  }
  
  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    // 实现基于 session_diff 或自定义索引的搜索
    return []
  }
  
  getToolSchemas(): ToolSchema[] {
    return []  // OpenCode 当前没有内置记忆工具
  }
  
  async handleToolCall(toolName: string, args: Record<string, any>): Promise<string> {
    throw new Error(`Unknown memory tool: ${toolName}`)
  }
}
```

### 5.2 Hermes Agent 适配器

#### 5.2.1 HermesContextManager

```python
class HermesContextManager(IContextManager):
    def __init__(self, prompt_builder: PromptBuilder, context_engine: ContextEngine):
        self.prompt_builder = prompt_builder
        self.context_engine = context_engine
    
    async def compile_system_prompt(self, options: SystemPromptOptions) -> str:
        # 复用 PromptBuilder 逻辑
        parts = []
        
        # Identity
        parts.append(self.prompt_builder.build_identity())
        
        # Platform hints
        if options.platform:
            parts.append(self.prompt_builder.build_platform_hints(options.platform))
        
        # Skills index
        parts.append(self.prompt_builder.build_skills_system_prompt(
            available_tools=options.available_tools,
            available_toolsets=options.available_toolsets
        ))
        
        # Context files
        parts.append(self.prompt_builder.build_context_files(options.cwd))
        
        return '\n\n'.join(filter(None, parts))
    
    async def compile_messages(self, history: List[Message], options: CompileOptions) -> List[Message]:
        # Hermes 的消息已经是扁平列表，直接返回
        # 可以添加过滤或转换逻辑
        return history
    
    async def inject_reminders(self, messages: List[Message], context: RuntimeContext) -> List[Message]:
        # Hermes 通过 system prompt 注入提醒，不修改消息列表
        return messages
    
    async def resolve_instructions(self, directory: str) -> List[Instruction]:
        # 查找 .hermes.md / HERMES.md
        return self.prompt_builder.find_hermes_md(Path(directory))
    
    def get_token_usage(self) -> TokenUsage:
        return TokenUsage(
            prompt=self.context_engine.last_prompt_tokens,
            completion=self.context_engine.last_completion_tokens,
            total=self.context_engine.last_total_tokens
        )
```

#### 5.2.2 HermesMemoryProvider

```python
class HermesMemoryProvider(IMemoryProvider):
    def __init__(self, memory_manager: MemoryManager):
        self.memory_manager = memory_manager
    
    async def prefetch(self, query: str, session_id: str) -> str:
        # 调用 MemoryManager.prefetch_all()
        return self.memory_manager.prefetch_all(query, session_id=session_id)
    
    async def sync_turn(self, user_content: str, assistant_content: str, session_id: str) -> None:
        # 调用 MemoryManager.sync_all()
        self.memory_manager.sync_all(user_content, assistant_content, session_id=session_id)
    
    async def write(self, target: str, content: str, metadata: Optional[Dict] = None) -> None:
        # 调用内置 memory tool
        args = {'action': 'write', 'target': target, 'content': content}
        self.memory_manager.handle_tool_call('memory', args)
    
    async def search(self, query: str, options: Optional[SearchOptions] = None) -> List[MemoryEntry]:
        # 调用 session_search tool
        args = {'query': query, 'limit': options.limit if options else 10}
        result = self.memory_manager.handle_tool_call('session_search', args)
        return self._parse_search_results(result)
    
    def get_tool_schemas(self) -> List[ToolSchema]:
        return self.memory_manager.get_all_tool_schemas()
    
    async def handle_tool_call(self, tool_name: str, args: Dict) -> str:
        return self.memory_manager.handle_tool_call(tool_name, args)
```

---

## 6. 使用示例

### 6.1 在 OpenCode 中使用

```typescript
// 初始化统一模块
const contextManager = new OpenCodeContextManager(session, prompt)
const memoryProvider = new OpenCodeMemoryProvider(storage)
const compressionEngine = new OpenCodeCompressionEngine(session)
const messageStore = new OpenCodeMessageStore(db)

// 编译上下文
const systemPrompt = await contextManager.compileSystemPrompt({
  platform: 'cli',
  userSystem: config.user.system
})

const messages = await contextManager.compileMessages(history, {
  includeCompacted: false,
  maxTokens: 100000
})

// 检查是否需要压缩
if (compressionEngine.shouldCompress(messages, tokenCount)) {
  const compressed = await compressionEngine.compress(messages, {
    targetTokens: 80000,
    protectFirst: 3,
    protectLast: 6,
    strategy: 'summary'
  })
  messages = compressed
}

// 调用 LLM
const response = await LLM.stream({
  system: systemPrompt,
  messages,
  tools: await toolRegistry.getTools()
})
```

### 6.2 在 Hermes Agent 中使用

```python
# 初始化统一模块
context_manager = HermesContextManager(prompt_builder, context_engine)
memory_provider = HermesMemoryProvider(memory_manager)
compression_engine = HermesCompressionEngine(context_engine)
message_store = HermesMessageStore(session_db)

# 预取记忆
memory_context = await memory_provider.prefetch(user_message, session_id)

# 编译上下文
system_prompt = await context_manager.compile_system_prompt(
    SystemPromptOptions(
        platform='telegram',
        available_tools=set(tool_registry.keys()),
        available_toolsets=set(config.toolsets)
    )
)

messages = await context_manager.compile_messages(history, CompileOptions())

# 检查是否需要压缩
if compression_engine.should_compress(messages, token_count):
    compressed = await compression_engine.compress(messages, CompressionOptions(
        target_tokens=80000,
        protect_first=3,
        protect_last=6,
        strategy='summary'
    ))
    messages = compressed

# 调用 LLM
response = await api_client.chat_completion(
    model=config.model,
    messages=[{'role': 'system', 'content': system_prompt}] + messages
)

# 同步记忆
await memory_provider.sync_turn(user_message, response.content, session_id)
```

### 6.3 跨运行时的自定义策略

```typescript
// 自定义压缩策略（可在两个运行时上运行）
class CustomCompressionEngine implements ICompressionEngine {
  shouldCompress(messages: Message[], tokenCount: number): boolean {
    // 自定义逻辑：根据消息类型和重要性判断
    const importantMessages = messages.filter(m => 
      m.metadata?.important || m.role === 'system'
    )
    return tokenCount > this.threshold && importantMessages.length < messages.length * 0.3
  }
  
  async compress(messages: Message[], options: CompressionOptions): Promise<Message[]> {
    // 自定义压缩算法
    const protected = [
      ...messages.slice(0, options.protectFirst),
      ...messages.slice(-options.protectLast)
    ]
    
    const toCompress = messages.slice(options.protectFirst, -options.protectLast)
    
    // 调用 LLM 生成摘要
    const summary = await this.generateSummary(toCompress, options.model)
    
    return [
      ...protected.slice(0, options.protectFirst),
      { role: 'system', content: summary, timestamp: Date.now() },
      ...protected.slice(-options.protectLast)
    ]
  }
}
```

---

## 7. 实现路线图

### Phase 1: 接口定义与验证（2 周）

- [ ] 完成核心接口定义（IContextManager / IMemoryProvider / ICompressionEngine / IMessageStore）
- [ ] 编写接口文档和使用示例
- [ ] 在 OpenCode 上实现最小可行适配器
- [ ] 验证接口设计的完整性

### Phase 2: OpenCode 完整适配（3 周）

- [ ] 实现 OpenCodeContextManager（复用现有 prompt.ts / system.ts 逻辑）
- [ ] 实现 OpenCodeMemoryProvider（扩展 session_diff 为跨 session 记忆）
- [ ] 实现 OpenCodeCompressionEngine（封装 compaction.ts）
- [ ] 实现 OpenCodeMessageStore（封装 message-v2.ts）
- [ ] 编写单元测试和集成测试

### Phase 3: Hermes Agent 完整适配（3 周）

- [ ] 实现 HermesContextManager（封装 PromptBuilder）
- [ ] 实现 HermesMemoryProvider（封装 MemoryManager）
- [ ] 实现 HermesCompressionEngine（封装 ContextEngine）
- [ ] 实现 HermesMessageStore（封装 SessionDB）
- [ ] 编写单元测试和集成测试

### Phase 4: 跨运行时验证（2 周）

- [ ] 实现一个自定义压缩策略，在两个运行时上运行
- [ ] 实现一个自定义记忆提供者，在两个运行时上运行
- [ ] 性能基准测试和优化
- [ ] 文档完善和示例代码

### Phase 5: 生态扩展（持续）

- [ ] 支持更多存储后端（PostgreSQL / Redis）
- [ ] 支持更多压缩策略（DAG / Sliding Window）
- [ ] 支持更多记忆提供者（Honcho / LangChain Memory）
- [ ] 提供 CLI 工具用于配置和迁移

---

## 8. 关键设计决策

### 8.1 为什么不直接统一两个系统？

**保持各自优势**：OpenCode 的 durable state 和细粒度 part 模型非常适合 IDE 集成和实时协作；Hermes 的 learning loop 和 FTS5 搜索非常适合长期知识积累。强行统一会丧失这些优势。

**渐进式演进**：通过抽象层，可以让两个系统独立演进，同时共享核心能力（如自定义压缩策略、记忆检索算法）。

### 8.2 为什么选择这些接口？

**最小公约数**：四个核心接口（Context / Memory / Compression / Store）覆盖了两个系统的核心能力交集。

**扩展点充足**：通过 `metadata` 字段和生命周期钩子，可以暴露各自的特色功能，而不破坏接口契约。

### 8.3 如何处理语言差异（TypeScript vs Python）？

**接口优先**：先用 TypeScript 定义接口（因为 OpenCode 是 TypeScript），然后用 Python 的 Protocol 或 ABC 实现等价接口。

**数据结构对齐**：使用 JSON-serializable 的数据结构（如 `Message` / `TokenUsage`），确保可以在两种语言间无损传递。

**适配器隔离**：语言特定的实现细节（如 SQLite 驱动、事件循环）封装在适配器内部，不暴露给业务逻辑层。

---

## 9. 未来展望

### 9.1 跨运行时的记忆共享

通过统一的 `IMessageStore` 接口，可以实现：

- OpenCode session 的历史可以被 Hermes Agent 搜索和引用
- Hermes Agent 的长期记忆可以被 OpenCode 读取和展示
- 两个系统共享同一个 SQLite 数据库（通过适配器隔离 schema 差异）

### 9.2 可插拔的压缩策略市场

开发者可以编写一次压缩策略（如 DAG-based compression），然后通过适配器在两个运行时上运行，形成一个"压缩策略市场"。

### 9.3 统一的配置和管理工具

提供一个 CLI 工具（如 `context-memory-cli`），可以：

- 在两个运行时间迁移配置
- 导出/导入记忆数据
- 性能分析和调优建议

---

*文档版本: 1.0*  
*创建日期: 2026-04-17*  
*作者: Claude (Kiro)*

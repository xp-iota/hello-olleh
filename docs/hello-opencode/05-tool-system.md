---
layout: content
title: "OpenCode 工具调用机制：Tool 注册、权限控制、执行闭环、结果写回 Durable State"
---
# OpenCode 工具调用机制：Tool 注册、权限控制、执行闭环、结果写回 Durable State

> 基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

---

**目录**

- [1. 工具系统架构总览](#1-工具系统架构总览)
- [2. 工具注册与汇总](#2-工具注册与汇总)
- [3. 权限控制系统](#3-权限控制系统)
- [4. 工具执行闭环](#4-工具执行闭环)
- [5. 结果写回 Durable State](#5-结果写回-durable-state)
- [6. 关键函数清单](#6-关键函数清单)
- [7. 各工具职责](#7-各工具职责)
- [8. plugin Hook 对工具的影响](#8-plugin-hook-对工具的影响)

---

## 1. 工具系统架构总览

```mermaid
flowchart TD
    subgraph Sources["工具来源"]
        Builtin["内建工具<br/>Read / Write / Edit / Bash / Task / ..."]
        Custom["Custom Tool<br/>.opencode/tools/*.ts"]
        Plugin["Plugin Tool<br/>plugin.tool"]
        MCP["MCP Tool<br/>mcp/tools()"]
    end

    subgraph Registry["ToolRegistry.tools()"]
        Collect["收集所有来源"]
        Filter["按 model / flag 过滤"]
        Permission["按 permission 裁剪"]
        PluginHook["plugin.tool.definition hook"]
    end

    subgraph Runtime["运行时"]
        Resolve["resolveTools()"]
        LLMResolve["LLM.resolveTools()"]
        Execute["Tool.execute()"]
    end

    subgraph Result["结果写回"]
        Durable["Session.updatePart()"]
        State["tool part 状态机"]
        Bus["Bus.publish()"]
    end

    Sources --> Registry --> Runtime --> Execute --> Result
```

---

## 2. 工具注册与汇总

### 2.1 四类工具来源

| 来源 | 代码坐标 | 注册方式 |
| :------| :---------| :---------|
| 内建工具 | `tool/*.ts` | 直接导入注册 |
| Custom Tool | `tool/registry.ts:85-98` | 扫描 `.opencode/tools/*.ts` |
| Plugin Tool | `tool/registry.ts:100-105` | `Plugin.list()` 的 `plugin.tool` |
| MCP Tool | `mcp/index.ts:606-646` | `MCP.tools()` |

### 2.2 `ToolRegistry.tools()`

`tool/registry.ts:85-190` 是"所有工具真正汇总"的地方：

```mermaid
flowchart LR
    A["内建工具"]
    B["Custom Tool<br/>(.opencode/tools/*.ts)"]
    C["Plugin Tool<br/>(plugin.tool)"]
    D["MCP Tool<br/>(MCP.tools())"]
    
    A --> Collect
    B --> Collect
    C --> Collect
    D --> Collect
    
    Collect["汇总所有工具"]
    Filter1["codesearch / websearch<br/>按 model 过滤"]
    Filter2["apply_patch / edit / write<br/>按 model type 互斥"]
    Filter3["LspTool / BatchTool<br/>按 flag 过滤"]
    Hook["plugin.tool.definition hook<br/>改 description / schema"]
    
    Collect --> Filter1 --> Filter2 --> Filter3 --> Hook
```

### 2.3 工具可见性裁剪

`tool/registry.ts:112-136`、`llm.ts:296-307` 分两次裁剪：

1. **第一次裁剪**（`tool/registry.ts`）：按 model、flag、互斥关系过滤
2. **第二次裁剪**（`llm.ts`）：按 agent permission、session permission、user 显式禁用

---

## 3. 权限控制系统

### 3.1 Permission 规则引擎

`permission/index.ts:166-267`：

```mermaid
flowchart LR
    Request["permission request<br/>permission / name / args"]
    Ruleset["ruleset<br/>allow / deny / ask"]
    Evaluate["evaluate()"]
    Result{"评估结果"}
    Allow["allow：直接执行"]
    Deny["deny：抛 PermissionDeniedError"]
    Ask["ask：发 permission.asked 事件<br/>等待 UI/CLI 回答"]

    Request --> Evaluate --> Result
    Result --> Allow
    Result --> Deny
    Result --> Ask
```

### 3.2 规则求值顺序

`permission/index.ts`：

1. 先用 ruleset 求 `allow/deny/ask`
2. `deny` 直接抛 `PermissionDeniedError`
3. `ask` 创建 pending request，发布 `permission.asked`
4. 等待 UI/CLI 通过 `/permission/:requestID/reply` 回答

### 3.3 批准规则持久化

`reply === "always"` 会把批准规则写进 `PermissionTable`，对同项目后续请求生效。

---

## 4. 工具执行闭环

### 4.1 tool 调用完整链路

```mermaid
sequenceDiagram
    participant LLM as LLM.stream()
    participant Proc as SessionProcessor
    participant Tool as Tool.execute()
    participant Durable as Session.updatePart()
    participant Bus as Bus.publish()

    LLM-->>Proc: tool-call event
    Proc->>Tool: execute(args, ctx)
    Tool->>Tool: 权限检查 Permission.ask()
    Tool->>Tool: 执行工具逻辑
    Tool-->>Proc: result / output / attachments
    Proc->>Durable: tool-result event
    Durable->>Bus: message.part.updated
    Proc-->>LLM: continue
```

### 4.2 `Tool.Context` 提供的回调

`session/prompt.ts:431-456` 传给 TaskTool 的 context：

```ts
{
  metadata(input)  // 允许 TaskTool 在运行中补写当前 tool part 的标题和元数据
  ask(req)       // 权限检查时，把 subagent 权限和 session 权限合并后再发起 Permission.ask()
}
```

### 4.3 doom loop 检测

`session/processor.ts:152-176`：连续三次同工具同输入时触发 `Permission.ask({ permission: "doom_loop" })`。

---

## 5. 结果写回 Durable State

### 5.1 tool part 状态机

| 状态 | 触发时机 | 写库操作 |
| :------| :---------| :---------|
| `pending` | `tool-input-start` | `Session.updatePart(pending)` |
| `running` | `tool-call` | `Session.updatePart(running)` + doom-loop 检测 |
| `completed` | `tool-result` | `Session.updatePart(completed)` + output / attachments |
| `error` | `tool-error` | `Session.updatePart(error)` |

### 5.2 退出前清理

`session/processor.ts:402-418`：即使中途出现异常，processor 仍会把所有未完成 tool part 改成 `error: "Tool execution aborted"`。

---

## 6. 关键函数清单

| 函数/类 | 文件坐标 | 功能 |
| :---------| :---------| :------|
| `ToolRegistry.tools()` | `tool/registry.ts:85-190` | 汇总所有来源工具，按 model/flag/permission 过滤 |
| `ToolRegistry.state()` | `tool/registry.ts:85-105` | Custom tool 扫描：`.opencode/tools/*.ts` |
| `Permission.evaluate()` | `permission/index.ts:166-267` | 规则求值：allow / deny / ask |
| `Permission.ask()` | `permission/index.ts` | 发起权限询问请求 |
| `Tool.execute()` | 各 tool 文件 | 工具执行逻辑 |
| `SessionProcessor.process()` | `processor.ts:46-425` | 消费 tool-call / tool-result / tool-error 事件 |
| `Session.updatePart()` | `session/index.ts:755-776` | 写 tool part 快照 |
| `Session.updatePartDelta()` | `session/index.ts:778-789` | 发布 part 增量事件 |
| `resolveTools()` | `prompt.ts:766-953` | 构造本轮可执行工具集 |
| `LLM.resolveTools()` | `llm.ts:296-307` | 按权限再裁剪工具 |

---

## 7. 各工具职责

| 工具 | 文件 | 职责 |
| :------| :------| :------|
| ReadTool | `tool/read.ts` | 文件/目录读取，LSP 预热 |
| WriteTool | `tool/write.ts` | 文件写入，写后 LSP.touchFile + diagnostics |
| EditTool | `tool/edit.ts` | 行级别编辑，写后 diagnostics 纠错 |
| ApplyPatchTool | `tool/apply_patch.ts` | patch 应用，diff 纠错 |
| BashTool | `tool/bash.ts` | Shell 命令执行 |
| TaskTool | `tool/task.ts` | Subagent 执行（新建/恢复 child session）|
| SkillTool | `tool/skill.ts` | 技能包加载 |
| LspTool | `tool/lsp.ts` | LSP 显式查询（实验态）|

---

## 8. plugin Hook 对工具的影响

| Hook | 调用点 | 作用 |
| :------| :-------| :------|
| `tool` | `ToolRegistry.state()` | 向 runtime 注入自定义 tool |
| `tool.definition` | `ToolRegistry.tools()` | 在 tool 暴露给模型前改 description/schema |
| `tool.execute.before` | `SessionPrompt.loop()` | 改 tool args |
| `tool.execute.after` | `SessionPrompt.loop()` | 改 tool title/output/metadata |

---

## 代码质量评估

**优点**

- **Plugin Hook 设计可组合**：`tool.definition`、`tool.execute.before`、`tool.execute.after` 三个切面拦截工具的定义阶段、执行前和执行后，插件可以不侵入核心代码就改变工具行为。
- **工具注册中心化**：`ToolRegistry` 统一管理内置工具和 MCP 工具，工具暴露给模型前经过单一裁剪点（`resolveTools()`），权限和集合控制清晰。
- **动态 MCP 工具支持**：MCP server 工具无需重启即可热注入，符合"插件即扩展"的设计理念。

**风险与改进点**

- **Hook 执行顺序无保证**：多个 plugin 同时注册 `tool.execute.before` 时，执行顺序依赖注册顺序，缺少优先级机制，可能产生冲突。
- **工具名冲突处理不透明**：MCP 工具和内置工具同名时的合并/覆盖策略不明确，难以预测哪个生效。
- **工具 schema 验证缺失**：工具参数通过 Zod schema 定义，但 MCP 工具的 schema 来自外部服务，没有运行时校验，恶意或格式错误的 schema 可能导致静默异常。
- **`tool.execute.after` 的副作用不可撤销**：Hook 对 output/metadata 的修改在执行后无法回滚，若 hook 产生问题，调试成本较高。

## 横向对齐补强：OpenCode 工具系统以 durable part 为结果中心

OpenCode 的工具闭环和其他项目的关键差异是结果会写回 durable part，而不仅是下一轮 prompt 的临时 tool result。

| 层级 | OpenCode 侧对象 | 横向对比 |
| --- | --- | --- |
| 工具注册 | `ToolRegistry.tools()` | 对应 Gemini ToolRegistry、Claude tools.ts、Codex tool specs |
| 权限 | `Permission.evaluate()` | 对应 Codex approval、Gemini PolicyEngine |
| 执行上下文 | `Tool.Context` | 提供 ask、session、agent、abort 等能力 |
| 结果写回 | MessageV2/Part | OpenCode durable-first 特色 |

## Tool part 状态机补强

OpenCode 的工具状态不是临时 UI state，而是 durable part 的状态字段。核心写入点在 processor：

| 状态 | 写入位置 | 含义 | UI / resume 影响 |
| --- | --- | --- | --- |
| `pending` | `sources/opencode/packages/opencode/src/session/processor.ts:121` | 模型已经发出 tool-call，但执行尚未真正开始 | UI 可先展示待执行工具；resume 时能看到未完成调用 |
| `running` | `sources/opencode/packages/opencode/src/session/processor.ts:142` | 工具进入执行阶段，输入已经固定 | CLI/TUI 可显示运行中；崩溃恢复时可把未完成工具标记为错误 |
| `completed` | `sources/opencode/packages/opencode/src/session/processor.ts:187` | 工具输出已返回并写入 part | 下一轮 `toModelMessages()` 能把结果投影回模型 |
| `error` | `sources/opencode/packages/opencode/src/session/processor.ts:211` | 工具失败或被拒绝 | 错误 part 进入 durable history，下一轮可见失败事实 |
| 兜底错误 | `sources/opencode/packages/opencode/src/session/processor.ts:405` | processor 收尾时发现非终态工具 | 避免 resume 时留下永久 running/pending part |

状态变化通过 `Session.updatePart()` 写库，再由 `sources/opencode/packages/opencode/src/session/session.ts:481` 发布 `message.part.updated`。CLI run 模式在 `sources/opencode/packages/opencode/src/cli/cmd/run.ts:460` 消费该事件，并在 `run.ts:464-480` 根据 `completed/error/running` 渲染不同输出。因此 OpenCode 的工具系统应按“durable part 状态机”阅读，而不是按一次函数调用阅读。

## 源码锚点补强

| 主题 | 源码锚点 | 说明 |
| --- | --- | --- |
| ToolRegistry | `sources/opencode/packages/opencode/src/tool/registry.ts:36`, `sources/opencode/packages/opencode/src/tool/registry.ts:155` | 工具注册命名空间与工具集合导出 |
| Permission evaluate | `sources/opencode/packages/opencode/src/permission/evaluate.ts:9`, `sources/opencode/packages/opencode/src/permission/index.ts:133` | rule 匹配入口 |
| Permission ask/reply | `sources/opencode/packages/opencode/src/permission/index.ts:166`, `sources/opencode/packages/opencode/src/permission/index.ts:203` | 交互式审批 |
| Session permission | `sources/opencode/packages/opencode/src/session/session.ts:587` | session 级 permission 写回 |
| Tool in prompt loop | `sources/opencode/packages/opencode/src/session/prompt.ts:813` | loop 中收集可用工具 |

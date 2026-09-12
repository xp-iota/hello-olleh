---
layout: content
title: "REPL 与交互层：Ink TUI、非交互模式与输入分发"
---
# REPL 与交互层：Ink TUI、非交互模式与输入分发

本文分析 Gemini CLI 的交互层实现，包括基于 Ink 的 TUI 渲染、非交互模式和输入事件处理。

**目录**

- [1. 双模式架构](#1-双模式架构)
- [2. Ink TUI 组件树](#2-ink-tui-组件树)
- [3. 非交互模式（Headless）](#3-非交互模式headless)
- [4. 输入处理](#4-输入处理)
- [5. 与 Claude Code REPL 的对比](#5-与-claude-code-repl-的对比)

---

## 1. 双模式架构

```
gemini [--prompt "..."] [--no-interactive]
  ├─ 交互模式（默认）→ Ink TUI
  └─ 非交互模式      → 标准输入/输出
```

真实分流点在 CLI 入口：`startInteractiveUI()` 负责启动 Ink UI（`sources/gemini-cli/packages/cli/src/gemini.tsx:227`），最终导入 `interactiveCli.tsx` 并渲染 `AppContainer`（`sources/gemini-cli/packages/cli/src/interactiveCli.tsx:56`, `sources/gemini-cli/packages/cli/src/interactiveCli.tsx:115`）。非交互模式走 `runNonInteractive()`（`sources/gemini-cli/packages/cli/src/nonInteractiveCli.ts:59`），主入口根据 `config.isInteractive()` 分派到两条路径（`sources/gemini-cli/packages/cli/src/gemini.tsx:648`, `sources/gemini-cli/packages/cli/src/gemini.tsx:737`）。

## 2. Ink TUI 组件树

```
<App>
  ├── <Header>（版本/模型信息）
  ├── <ConversationHistory>（对话历史，滚动）
  │     ├── <UserMessage>
  │     ├── <AssistantMessage>（支持 Markdown 渲染）
  │     └── <ToolCallView>（工具调用展示）
  ├── <InputBox>（用户输入，支持多行）
  └── <StatusBar>（Token 用量/审批状态/运行状态）
```

### 2.1 流式渲染

Ink 基于 React 模型，通过 `AppContainer`、`UIStateContext` 和 `ui/components/messages/*` 实现增量更新。下面这段只用于说明渲染思路，不对应单一真实文件：

```typescript
// gemini-cli/packages/cli/src/ui/AppContainer.tsx + ui/components/messages/*（示意）
function AssistantMessage({ turnId }: { turnId: string }) {
  const [content, setContent] = useState('');

  useEffect(() => {
    messageBus.on('token', (e) => {
      if (e.turnId === turnId) {
        setContent(prev => prev + e.content);
      }
    });
  }, [turnId]);

  return <Text>{content}</Text>;
}
```

### 2.2 工具审批 UI

当 `autoAcceptTools` 为 false 时，工具调用前展示审批界面：

```
╔═══════════════════════════════════╗
║  工具调用请求：run_shell_command   ║
║  命令：git commit -m "fix: bug"   ║
║                                   ║
║  [Y] 批准  [N] 拒绝  [A] 全部批准 ║
╚═══════════════════════════════════╝
```

## 3. 非交互模式（Headless）

```bash
# 管道输入
echo "分析 README.md" | gemini

# 直接参数
gemini --prompt "列出所有 TODO 注释" --no-interactive

# CI 场景（自动批准所有工具）
gemini --prompt "运行测试并修复失败" --yolo
```

```typescript
// gemini-cli/packages/cli/src/nonInteractiveCli.ts（简化）
export async function runNonInteractive(flags: CliFlags) {
  const prompt = flags.prompt ?? await readStdin();
  const agent = new GeminiClient(config);

  for await (const event of agent.run(prompt)) {
    if (event.type === 'token') process.stdout.write(event.content);
    if (event.type === 'error') { process.stderr.write(event.message); process.exit(1); }
  }
}
```

## 4. 输入处理

`InputBox` 组件处理键盘输入，支持：

| 快捷键 | 功能 |
| :--------| :------|
| `Enter` | 提交输入（单行模式）|
| `Shift+Enter` | 换行（多行模式）|
| `Ctrl+C` | 中断当前 Agent 运行 |
| `Ctrl+D` | 退出 |
| `↑` / `↓` | 历史命令导航 |

## 5. 与 Claude Code REPL 的对比

| 特性 | Gemini CLI | Claude Code |
| :------| :------------| :-------------|
| **UI 框架** | Ink（React/TS）| Ink（React/TS）|
| **Headless** | `--no-interactive` / pipe | `--print` / pipe |
| **Markdown 渲染** | ✅ | ✅ |
| **Slash 命令** | 少量（`/help`, `/clear`）| 丰富（可扩展）|
| **多行输入** | `Shift+Enter` | `Shift+Enter` |

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `AppContainer` | `sources/gemini-cli/packages/cli/src/ui/AppContainer.tsx:794` | CLI 顶层 React 组件：持有 resume、UI Action、生命周期管理 |
| `useGeminiStream` | `sources/gemini-cli/packages/cli/src/ui/hooks/useGeminiStream.ts:214` | 核心 hook：管理流处理、工具调度触发、工具结果回注 |
| `UIStateContext` | `sources/gemini-cli/packages/cli/src/ui/contexts/UIStateContext.tsx:213` | React Context：持有 currentTurn/messages/tools/status 等 UI 状态 |
| `startInteractiveUI()` | `sources/gemini-cli/packages/cli/src/gemini.tsx:227` | 交互模式启动入口：初始化 Ink + React render |
| `runNonInteractive()` | `sources/gemini-cli/packages/cli/src/nonInteractiveCli.ts:59` | Headless 模式入口：读取 stdin 或 prompt，直接调用模型 |
| `ToolScheduler` hook | `sources/gemini-cli/packages/cli/src/ui/hooks/useToolScheduler.ts:219` | 把工具确认、执行中、结果回注状态接入 stream |

---

## 代码质量评估

**优点**

- **Ink + React 组件化 TUI**：终端 UI 以 React 组件模型构建，state 变更自动触发差量重绘，无需手动管理终端输出缓冲区。
- **交互/非交互共用同一核心层**：`AppContainer` 和 Headless 模式都通过 `GeminiClient` 接入，无需维护两套请求链路。
- **`useGeminiStream` 集中状态管理**：流状态（工具调度、结果回注、UI 更新）集中在一个 hook 中，调用方无需关心流的内部状态机。

**风险与改进点**

## 横向对齐补强：REPL 状态由 CLI hook 聚合

Gemini CLI 的交互状态主要分布在 Ink UI、`useGeminiStream`、Scheduler 状态和 core client 流事件之间。它不是 OpenCode 那种 durable DB 真相，也不是 Codex 那种 Rust thread event 真相。

| 状态来源 | 职责 |
| --- | --- |
| Ink UI state | `sources/gemini-cli/packages/cli/src/ui/contexts/UIStateContext.tsx:213` | 输入框、渲染、用户确认、进度显示 |
| `useGeminiStream` | `sources/gemini-cli/packages/cli/src/ui/hooks/useGeminiStream.ts:214` | 把用户输入、模型流、工具结果和 continuation 串起来 |
| Scheduler state | `sources/gemini-cli/packages/cli/src/ui/hooks/useToolScheduler.ts:219` | 管理待确认、执行中、完成/失败工具 |
| Core client stream | `sources/gemini-cli/packages/core/src/core/client.ts:887` | 提供模型事件和 tool call 请求 |
| LoopDetectionService | `sources/gemini-cli/packages/core/src/services/loopDetectionService.ts:133` | 在 turn 前和流处理中插入自愈/中断信号 |

横向看，Gemini 的状态模型可读但分散；完善文档时要避免只讲 UI hook，而要把 Scheduler 和 core client 放进同一张状态图。

- **Ink 渲染性能瓶颈**：长会话下 `UIStateContext` 持有大量历史消息，每次状态更新触发全量 Context re-render，无虚拟化列表机制，可能导致UI 卡顿。
- **Headless 模式无流式输出**：非交互模式等待完整响应后才输出，对长输出场景用户体验差，无法像交互模式那样看到逐字流式结果。
- **`useGeminiStream` 与 `UIStateContext` 双向依赖**：hook 内部同时读写 Context，组件重渲后触发 hook 重新运行可能产生循环更新，需要依赖 `useCallback`/`useMemo` 谨慎防范。

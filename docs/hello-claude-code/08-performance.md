---
layout: content
title: "性能、缓存与长会话稳定性专题"
---
# 性能、缓存与长会话稳定性专题

本篇收拢启动性能、prompt cache、资源释放与长会话稳定性相关的工程设计。


**目录**

- [1. 问题范围](#1-问题范围)
- [2. 启动性能：把工作拆成三个窗口](#2-启动性能把工作拆成三个窗口)
- [2.1 顶层 side effect 窗口](#21-顶层-side-effect-窗口)
- [2.2 setup 窗口](#22-setup-窗口)
- [2.3 首屏后 deferred prefetch 窗口](#23-首屏后-deferred-prefetch-窗口)
- [3. prompt cache 稳定性是一级设计目标](#3-prompt-cache-稳定性是一级设计目标)
- [3.1 为什么一个 settings 临时文件路径都要做 content hash](#31-为什么一个-settings-临时文件路径都要做-content-hash)
- [3.2 `claude.ts` 里大量 header / beta latch 也是为 cache 稳定](#32-claudets-里大量-header-beta-latch-也是为-cache-稳定)
- [3.3 prompt cache break detection](#33-prompt-cache-break-detection)
- [4. 上下文治理已独立成篇](#4-上下文治理已独立成篇)
- [5. REPL 层对内存与 GC 非常敏感](#5-repl-层对内存与-gc-非常敏感)
- [5.1 替换 ephemeral progress 而不是持续 append](#51-替换-ephemeral-progress-而不是持续-append)
- [5.2 大量 stable callback / ref 是为了防闭包保留](#52-大量-stable-callback-ref-是为了防闭包保留)
- [5.3 rewind 时还要清 microcompact/context collapse 状态](#53-rewind-时还要清-microcompactcontext-collapse-状态)
- [6. `claude.ts` 对 streaming 资源泄漏有专门防护](#6-claudets-对-streaming-资源泄漏有专门防护)
- [7. query checkpoints 是贯穿式观测点](#7-query-checkpoints-是贯穿式观测点)
- [8. transcript 与持久化也被当成性能/稳定性问题处理](#8-transcript-与持久化也被当成性能稳定性问题处理)
- [9. `cache-safe request shaping` 的源码展开](#9-cache-safe-request-shaping-的源码展开)
- [10. 这套系统的性能设计关键词](#10-这套系统的性能设计关键词)
- [11. 关键源码锚点](#11-关键源码锚点)
- [12. 总结](#12-总结)

---

## 1. 问题范围

这套工程的大量复杂度并不直接来自业务功能，而是来自以下几类真实成本控制：

- 启动延迟
- 首轮响应延迟
- 长会话内存增长
- prompt cache 失效带来的 token 成本
- 上下文膨胀导致的请求失败
- streaming 与工具执行带来的资源泄露

下文将把散落在各处的“工程性设计”收拢为一条可追踪的主线。

## 2. 启动性能：把工作拆成三个窗口

## 2.1 顶层 side effect 窗口

关键代码：`src/main.tsx:1-20`

这里提前做：

- `profileCheckpoint`
- `startMdmRawRead()`
- `startKeychainPrefetch()`

本质上是在争取：

- “模块求值期间并行做别的事”

## 2.2 setup 窗口

关键代码：`src/setup.ts:287-381`

这里做的是：

- 首轮 query 前必须准备的注册与预热
- 但尽量不阻塞 REPL 首屏的东西

例如：

- `getCommands(...)` 预热
- plugin hooks 加载
- attribution hooks 注册
- sink 初始化

## 2.3 首屏后 deferred prefetch 窗口

关键代码：`src/main.tsx:382-431`

这里专门把：

- `getUserContext`
- `getSystemContext`
- `countFilesRoundedRg`
- analytics gates
- model capabilities

推迟到首屏之后。

### 2.3.1 性能优化目标的边界

它区分了：

- 进程可运行
- REPL 首屏可见
- 首轮输入性能准备充分

而不是把所有初始化糊成一坨。

## 3. prompt cache 稳定性是一级设计目标

关键代码：

- `src/main.tsx:445-456`
- `src/services/api/claude.ts:1358-1728`
- `src/services/api/promptCacheBreakDetection.ts`

## 3.1 为什么一个 settings 临时文件路径都要做 content hash

`src/main.tsx:445-456` 的注释非常典型：

- 如果临时 settings 路径用随机 UUID，每个进程都会不同。
- 这个路径会进入工具描述。
- 工具描述参与 prompt cache key。
- 结果是缓存前缀频繁失效。

所以它刻意使用 content-hash-based path。

这类代码集中体现了全工程的工程哲学：

> 任何会污染 prompt 前缀的“看似无关细节”都值得修正。

## 3.2 `claude.ts` 里大量 header / beta latch 也是为 cache 稳定

关键代码：`src/services/api/claude.ts:1405-1698`

这里有很多“sticky-on latch”：

- AFK mode header
- fast mode header
- cache editing header
- thinking clear latch

目的都是：

- 一旦这个 header 在本 session 某时刻开始发送，就尽量继续稳定发送
- 避免 session 中途来回切换导致 prompt cache key 波动

## 3.3 prompt cache break detection

`services/api/promptCacheBreakDetection.ts` 专门跟踪：

- system prompt 是否变了
- tool schema 是否变了
- cache read 是否突然掉太多
- cached microcompact 是否是“合法下降”而不是异常失效

这说明团队并不只“希望缓存命中”，而是把缓存失效当作可观测故障来监控。

## 4. 上下文治理已独立成篇

上下文治理的完整展开已经单独整理为：

- [11-context-management.md](./04-state-session-memory.md)

本篇只保留与性能和稳定性直接相关的三条结论：

1. `tool result budget -> snip -> microcompact -> context collapse -> autocompact -> reactive compact` 是一条按顺序尝试的梯度体系，而不是每轮都全部生效的并行机制。
2. `microcompact`、`context collapse`、`autocompact` 与 prompt cache、内存占用、resume 正确性彼此耦合，因此它们同时属于上下文治理问题和性能问题。
3. `context collapse` 启用后会 suppress proactive autocompact；`autocompact` 命中后又会先试 `SessionMemory compact`，这说明长会话稳定性依赖的是整条治理流水线，而不是单个压缩器。

## 5. REPL 层对内存与 GC 非常敏感

关键代码：

- `src/screens/REPL.tsx:2608-2627`
- `src/screens/REPL.tsx:3537-3545`
- `src/screens/REPL.tsx:3608-3621`
- `src/screens/REPL.tsx:3657-3688`

## 5.1 替换 ephemeral progress 而不是持续 append

原因：

- 某些 progress 每秒一条
- 全部 append 会让 messages 与 transcript 爆炸

## 5.2 大量 stable callback / ref 是为了防闭包保留

注释里明确提到：

- 不稳定 callback 会让旧 REPL render scope 被下游组件引用住
- 长会话下会明显增加内存占用

## 5.3 rewind 时还要清 microcompact/context collapse 状态

因为如果只回滚消息而不重置这些缓存态：

- 新的会话视图会引用旧的 tool_use_ids 或 collapsed state
- 导致严重不一致

## 6. `claude.ts` 对 streaming 资源泄漏有专门防护

关键代码：

- `src/services/api/claude.ts:1515-1526`
- 以及后续 cleanup 注释

源码明确写到：

- Response 持有 native TLS/socket buffers
- 这些不在 V8 heap 里
- 必须显式 cancel/release

这说明作者并不是泛泛而谈“避免泄漏”，而是针对 Node/SDK 真实行为做了防护。

## 7. query checkpoints 是贯穿式观测点

关键代码：

- `src/query.ts`
- `src/services/api/claude.ts`
- `src/screens/REPL.tsx:2767-2810`

常见 checkpoint 包括：

- `query_fn_entry`
- `query_snip_start/end`
- `query_microcompact_start/end`
- `query_autocompact_start/end`
- `query_api_streaming_start/end`
- `query_tool_execution_start/end`
- `query_context_loading_start/end`

意义：

- 可以把一次 turn 拆成多个阶段分析瓶颈。

## 8. transcript 与持久化也被当成性能/稳定性问题处理

例如 `QueryEngine.ts` 里会：

- 对 assistant 消息 transcript write 采用 fire-and-forget
- 对 compact boundary 前的 preserved tail 做提前 flush
- 在结果返回前做最后 flush

transcript 不是“顺便记一下”，而是会直接影响：

- resume 正确性
- SDK 进程被上层杀掉时的数据完整性

## 9. `cache-safe request shaping` 的源码展开

源码层面最稳定的结论不是“某个神秘 cache trick”，而是：

> Claude Code 在多个层面同时做 **byte-stable request shaping**

### 9.1 真正会影响 cache key 的四组工程手段

1. **system prompt 分段与边界稳定化**  
   `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`、`systemPromptSection(...)`、`splitSysPromptPrefix(...)` 共同把静态前缀和动态尾部切开，尽量让可缓存部分跨 turn 保持不变。

2. **动态 beta / header 的 sticky-on latch**  
   `claude.ts` 里对 AFK、fast mode、cache editing、thinking clear 都做了 sticky-on 处理。目的不是“记住用户偏好”，而是避免 session 中途 header 翻来覆去，直接打爆 server-side cache key。

3. **把高抖动能力信息从主前缀里挪走**  
   `defer_loading` + `tool_reference`、MCP instructions delta、defer-loading 工具从 cache hash 中排除，这些都属于“不要让晚到的工具/说明重写整个 prompt 前缀”。

4. **让子代理和配置路径也尽量保持字节稳定**  
   - `main.tsx` 用 content-hash temp path 固定 `--settings` 临时文件名  
   - fork subagent 继承父 system prompt + exact tools 以保持 `cache-identical prefix`  
   - `promptCacheBreakDetection.ts` 专门监控 cache break 是否来自 system / tools / betas / extra body

这四组机制合起来，构成了 Claude Code 的 cache-safe request shaping。

### 9.2 `200K` / `20K` / “字节级一致”的源码落点

相关数字与表述更准确地归属于上下文治理专题：

- `200K` 对应 [`src/utils/context.ts`](../../sources/claude-code/src/utils/context.ts) 里的 `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`，也就是默认上下文窗口上限。
- `20K` 对应 [`src/services/compact/autoCompact.ts`](../../sources/claude-code/src/services/compact/autoCompact.ts) 里的 `MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000`，这是 compaction summary 的预留输出预算，不是通用 memory 配额。
- “字节级一致”不是一句抽象口号，而是多处显式工程约束的合称：
  - system prompt 边界前后分块
  - sticky-on headers
  - content-hash 临时 settings 路径
  - fork child 继承 exact tools / exact prompt
  - defer-loading 工具不参与 cache break hash

所以，如果只用一句“Claude Code 很重视 prompt cache”来概括，会漏掉它真正的实现方式：  
它不是依赖单点缓存，而是在 **system prompt、tool schema、headers、attachments、subagent fork、临时文件路径** 上同时做稳定化。

## 10. 这套系统的性能设计关键词

可以总结为：

- 提前预取
- 延迟预取
- 缓存稳定
- 分层压缩
- 渐进恢复
- 稳定闭包
- 显式资源释放
- 埋点可观测

## 11. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| --- | --- | --- |
| 顶层启动优化 | `src/main.tsx:1-20` | 启动最早期 side effects |
| deferred prefetch | `src/main.tsx:382-431` | 首屏后预取 |
| settings 路径稳定化 | `src/main.tsx:445-456` | 避免随机路径破坏 prompt cache |
| 上下文治理阶梯 | `src/query.ts:396-468` | snip / microcompact / collapse / autocompact |
| API request cache 相关组装 | `src/services/api/claude.ts:1358-1728` | system blocks、betas、cache editing |
| prompt cache break detection | `src/services/api/promptCacheBreakDetection.ts` | 缓存异常监控 |
| REPL 内存控制 | `src/screens/REPL.tsx:2608-2627`, `3537-3621` | progress 替换与稳定 callback |
| stream 资源释放 | `src/services/api/claude.ts:1515-1526` | native 资源 cleanup |

## 12. 总结

这套工程最值得学习的地方之一，不是某个功能，而是它如何把“长期运行的 Agent 会话”当成一类需要精细治理的系统：

- 启动要分阶段。
- 缓存要稳定。
- 上下文要分层压缩。
- 闭包、stream、transcript 都要防泄漏与防失真。

这些机制共同构成了面向长会话、真实成本和真实故障模式的生产级运行时。

---

## 关键函数清单

| 函数/机制 | 文件 | 职责 |
|----------|------|------|
| `prefetchSkills()` | — | 首屏后异步预取 skill 文件，不阻塞 TUI 渲染 |
| `getMessagesAfterCompactBoundary()` | `src/query.ts` | 按 compact 边界裁剪历史，控制上下文 token 量 |
| `compactConversation()` | — | 触发上下文压缩：调用模型生成摘要并替换历史 |
| `withRetry()` | `src/services/api/claude.ts` | 含退避策略的重试，处理速率限制和网络抖动 |
| `asSystemPrompt()` | `src/query.ts:449` | 懒组装 system prompt，避免每次请求都重新计算静态部分 |
| `Ink render pipeline` | `src/REPL.tsx` | Ink 的批量 reconcile，避免 token 流中每个字符触发一次全量重渲染 |

---

## 代码质量评估

**优点**

- **三窗口启动策略**：顶层 side effect、`init()` 核心初始化、deferred prefetch 三阶段，首屏渲染时间可预测和可测量。
- **上下文分层压缩**：`compact` 边界 + summary 替换，避免长会话 token 暴涨；压缩路径明确，不依赖截断（截断会丢失上下文语义）。
- **Ink 批量渲染**：流式 token 到达时 Ink 做批量 DOM reconcile，不是每个 token 都强制重渲染，渲染效率和流式体验的平衡点较好。

**风险与改进点**

- **无性能基准（benchmark）**：当前代码库没有系统化的流式吞吐量和首屏渲染延迟 benchmark，性能改进无实测依据。
- **`compact` 触发时机非显而易见**：compact 由 token 阈值触发，阈值调整会直接影响用户感知的响应速度，当前没有运行时可观测指标暴露 compact 频率。
- **prefetch 无幂等保护**：若用户极快地多次触发会话，多个并发的 prefetch 可能产生重复请求，没有 dedup 机制。

## 横向对齐补强：Claude 性能重点在 prompt cache 和 React TUI

Claude Code 的性能分析要围绕 prompt cache 稳定性、context compaction、streaming tool execution 和 React/Ink 渲染成本展开。

| 路径 | Claude 侧关注点 | 横向对比 |
| --- | --- | --- |
| Prompt cache | dynamic boundary / cache TTL | 比 Gemini/Codex 更重视缓存稳定性 |
| Streaming tool | 工具可边流边执行 | 与 Gemini 流后调度不同 |
| React TUI | 高频 token 触发渲染 | 对应 Gemini Ink、Codex Ratatui |
| Compaction | token 阈值和摘要质量 | 四项目共享长会话瓶颈 |

## 可执行性能基准口径

| 基准项 | Claude 观测点 | 建议采样字段 | 横向对齐 |
| --- | --- | --- | --- |
| 首 token 延迟 | request 发出到首个 stream event | provider、model、cache hit/miss、prompt token | 对应 Codex/Gemini/OpenCode provider stream |
| 工具并发耗时 | tool_use start 到 tool_result 注入 | tool name、并发数、审批等待、执行耗时 | 对应工具治理章节 |
| React/Ink 渲染延迟 | stream event 到 UI 可见状态 | event batch size、render duration、dropped frame | 对应 Gemini Ink、Codex Ratatui |
| Compact 频率 | context 接近阈值到 summary 替换 | before/after token、summary token、触发原因 | 四项目长会话共同指标 |
| Prompt cache 稳定性 | cache boundary 与请求 metadata | cache key 变化、命中率、失效原因 | Claude 侧性能特色 |

源码定位上，context/token 统计和 cache 边界可从 `sources/claude-code/src/utils/messages.ts:2976`、`sources/claude-code/src/utils/messages.ts:3025`、`sources/claude-code/src/utils/messages.ts:4468`、`sources/claude-code/src/utils/messages.ts:4538` 跟起；模型流请求与重试在 `sources/claude-code/src/services/api/claude.ts:1869` 到 `sources/claude-code/src/services/api/claude.ts:1875`、`sources/claude-code/src/services/api/claude.ts:1945`、`sources/claude-code/src/services/api/claude.ts:1955`；session tracing 可从 `sources/claude-code/src/utils/telemetry/sessionTracing.ts:371`、`sources/claude-code/src/utils/telemetry/sessionTracing.ts:727` 补充横向埋点。

#!/usr/bin/env python3
"""把 dsh-example 的可跑示例挂进对应文档章节。

在指定 `## N.M` 标题之后插入一个「📐 配套可跑示例」块。幂等：已插入过则跳过。
"""
import os, re

DOCS = 'docs/hello-dsh'
EX = '../../dsh-example'
MARK = '📐 **配套可跑示例**'

BLOCKS = [
    # ---------- 03 能力缝与服务全景 ----------
    ('03-能力缝与服务全景.md', '3.1', f"""
> {MARK}：[`05-llm-adapter`]({EX}/05-llm-adapter/index.ts) 是三角色模型的最小实例 ——
> Definition 是真实包 `@deepseek-ai/dsh-llm` 导出的抽象类 `LlmAdapter`，Provider 是那个 `MockAdapter`，
> Consumer 是 agent-loop（示例里换成 `ctx.llm.stream(...)` 直接消费）；`npm run 05:minimax`
> 再用同一个循环消费真实 `minimax-m3` 路由，验证"换 provider 不换 Consumer"。
>
> ```ts
> class MockAdapter extends LlmAdapter {{        // ← Provider
>   async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {{ /* … */ }}
> }}
> ctx.llm.registerAdapter([config.routeName], new MockAdapter(config.reply))
> ```
"""),
    ('03-能力缝与服务全景.md', '3.8', f"""
> {MARK}：下面这张表里的每个 seam 都有一个能真跑的最小 provider / consumer ——
> `ctx.llm` → [05]({EX}/05-llm-adapter/index.ts)、`ctx.fs` / `ctx.subprocess` → [16]({EX}/16-fs-shell-side-effects/index.ts)、
> `ctx.shell` → [24]({EX}/24-shell-service/run.ts)、`ctx.sandbox` → [25]({EX}/25-sandbox-seam/index.ts)、
> `ctx.compaction` → [14]({EX}/14-compaction-provider/index.ts)、`ctx.subagents` → [15]({EX}/15-subagent-delegation/index.ts)、
> `ctx.jobs` → [21]({EX}/21-jobs-background/run.ts)、`ctx.goals` → [22]({EX}/22-goal-lifecycle/run.ts)、
> `ctx.settings` → [23]({EX}/23-settings-namespaces/index.ts)、`ctx.approval` → [13]({EX}/13-approval-answerer/index.ts)。
"""),
    ('03-能力缝与服务全景.md', '3.9', f"""
> {MARK}：[示例工程的能力索引]({EX}/README.md) 就是按同一套"四条扩展路径"组织的 ——
> 按注册（01/02/04/10/15/16/23）· 按事件（03/06/07/09/13/17/19/20）· 按服务（05/11/12/14/25）· 按数据（08）。
"""),

    # ---------- 04 扩展与生态 ----------
    ('04-扩展与生态.md', '4.1', f"""
> {MARK}：[`08-skill-code-review`]({EX}/08-skill-code-review/SKILL.md) 是"按数据扩展"的完整样本
> （一个 `SKILL.md`，零行 TypeScript）；它的 [`run.ts`]({EX}/08-skill-code-review/run.ts) 把这份 Markdown
> 注册进真实 `ctx.skills`，再用真实 `renderSkillContent` 渲染后经 `agent.inject()` 送进下一步上下文。
"""),
    ('04-扩展与生态.md', '4.3', f"""
> {MARK}：[`09-hooks-lifecycle-steering`]({EX}/09-hooks-lifecycle-steering/index.ts) 演示这些桥接器最终落到的那组拦截点
> （`agent/session-start` · `pre-step` · `request` · `turn-stopping`），并在轮末用 `agent.steer()` 真的多跑了一个 step。
"""),
    ('04-扩展与生态.md', '4.10', f"""
> {MARK}：这张全景表里的每个扩展点都有对应示例，逐条映射见
> [示例工程 README 的能力索引]({EX}/README.md)（26 个目录，全部跑在真实 `@deepseek-ai/*` 发布包上）。
"""),

    # ---------- 05 启动与 Cordis 落地 ----------
    ('05-启动与Cordis落地.md', '5.1', f"""
> {MARK}：[`cordis.yml`]({EX}/cordis.yml) 是一份"把一组插件挂进真实 agent"的 patch 示范 ——
> 每一行就是本节说的那种配置行（`id` / `name` / `config`）。
"""),
    ('05-启动与Cordis落地.md', '5.17', f"""
> {MARK}：[`17-dispatch-modes`]({EX}/17-dispatch-modes/index.ts) 在真实 `@deepseek-ai/cordis` 上把五种派发模式各跑一遍
> （含 `parallel` 的 `AggregateError`、`serial` 的截链、`waterfall` 的"最后一个实参就是内建默认"）；
> [`26-cordis-timer`]({EX}/26-cordis-timer/run.ts) 演示 effect 化的定时器与 fiber 卸载时的拒绝语义。
"""),
    ('05-启动与Cordis落地.md', '5.18', f"""
> {MARK}：[`11-tool-restrict`]({EX}/11-tool-restrict/index.ts) 是 scope 的最小落点 ——
> `agent.ctx.tools.restrict(...)` 在 plain context 上会**抛错**，示例把这条 fail-closed 连同
> "effect 归属被调用的那个 context"的实际后果一起打印出来。
"""),

    # ---------- 06 Agent 循环与会话日志 ----------
    ('06-Agent循环与会话日志.md', '6.4', f"""
> {MARK}：[`06-agent-events-telemetry`]({EX}/06-agent-events-telemetry/run.ts) 用真实 agent-loop 跑一个 turn，
> 把这里描述的边界事件逐条打印出来；实测序列是
> `turn/start → step/start → user/message → request/header → request/context → assistant/chunk* → assistant/message → step/end → turn/end`。
"""),
    ('06-Agent循环与会话日志.md', '6.8', f"""
> {MARK}：[`09-hooks-lifecycle-steering`]({EX}/09-hooks-lifecycle-steering/index.ts) 在这 9 个事件里挑了 4 个挂监听器，
> 并验证 `agent/turn-stopping` 的 serial 语义：监听者调 `agent.steer(...)` 后主循环**重读 inbox**，真的多跑了一个 step。
"""),
    ('06-Agent循环与会话日志.md', '6.9', f"""
> {MARK}：[`19-agent-inbox`]({EX}/19-agent-inbox/run.ts) 把四个入口各调一遍，
> 并把会话日志里的 `agent/inbox/spliced` 流水打出来 —— "谁在什么时候塞了什么"是可回放的。
"""),
    ('06-Agent循环与会话日志.md', '6.12', f"""
> {MARK}：[`18-session-log`]({EX}/18-session-log/run.ts) 逐条验证本节的不变量：
> seq 连续、事件深冻结（改写抛 `TypeError`）、`deriveMessages()` 只投影三类消息事件。
"""),
    ('06-Agent循环与会话日志.md', '6.15', f"""
> {MARK}：[`18-session-log`]({EX}/18-session-log/run.ts) 用真实 `replace` 折叠了两个节点并打印
> "模型现在看到的第一条"；两条 fail-closed 校验的抛错原文也在输出里：
>
> ```text
> surface replace: start seq 999 not found in surface
> surface replace: sourceEventSeqs must include every shadowed surface node; missing 16
> ```
"""),
    ('06-Agent循环与会话日志.md', '6.19', f"""
> {MARK}：[`18-session-log`]({EX}/18-session-log/run.ts) 第 ⑥ 节演示 fork 的稳定前缀要求 ——
> 边界落在未闭合的 turn 里会抛 `SessionForkError {{ code: 'OPEN_TURN' }}`。
"""),

    # ---------- 07 请求管线 ----------
    ('07-请求管线-LLM工具与提示.md', '7.2', f"""
> {MARK}：[`05-llm-adapter`]({EX}/05-llm-adapter/index.ts) 只实现这一个方法就接上了整条链；
> [`runtime/llm-minimax.ts`]({EX}/runtime/llm-minimax.ts) 是同一个抽象类的真实 HTTP/SSE 实现
> （MiniMax 的 Anthropic 兼容端点 → 同一份 StreamChunk 协议）；`npm run 05:minimax`
> 用同一个消费循环消费真实 `minimax-m3` 路由。
"""),
    ('07-请求管线-LLM工具与提示.md', '7.3', f"""
> {MARK}：[`20-llm-stream`]({EX}/20-llm-stream/index.ts) 注册两个监听器包在真实适配器外层 ——
> 外层改写 `text-delta`、内层统计 chunk 与 usage：
>
> ```ts
> ctx.on('llm/stream', (options, next) => (async function* () {{
>   for await (const chunk of next()) yield chunk.type === 'text-delta'
>     ? {{ ...chunk, text: chunk.text.toUpperCase() }} : chunk
> }})())
> ```
"""),
    ('07-请求管线-LLM工具与提示.md', '7.10', f"""
> {MARK}：[`01-tool-wordcount`]({EX}/01-tool-wordcount/index.ts) 是这份契约的最小实现。
> 两个真实 DSL 硬要求容易踩：object 型 `output.schema` **必须**显式写 `additionalProperties`，
> 必填字段写在**每个 property 上**（`required: true`），不是 JSON Schema 的 `required` 数组 ——
> 写错在 `defineTool` 就抛 `JsonSchemaError`。
"""),
    ('07-请求管线-LLM工具与提示.md', '7.11', f"""
> {MARK}：三段各有一个示例 ——
> pre-execute → [03 权限门]({EX}/03-permission-gate/index.ts)（返回 `deny` / `ask`）、
> post-execute + result → [07 结果转换与审计]({EX}/07-tool-result-transform/index.ts)、
> 以及 pre-execute **之后**仍无法翻案的 [12 单调守卫]({EX}/12-tool-guard/index.ts)。
"""),
    ('07-请求管线-LLM工具与提示.md', '7.14', f"""
> {MARK}：[`11-tool-restrict`]({EX}/11-tool-restrict/run.ts) 验证"展示 / 查找 / 执行三者对齐"——
> 被收紧掉的工具在 `schemas(scope)` 里消失，调用它直接得到 `unknown tool "write"`。
"""),
    ('07-请求管线-LLM工具与提示.md', '7.18', f"""
> {MARK}：section → [02 提示段]({EX}/02-prompt-section/index.ts)，
> variable + 整段 assemble → [10 提示变量与装配]({EX}/10-prompt-variable-assemble/index.ts)。
> 注意真实占位语法是 `{{{{name}}}}`，插值发生在 `renderPrompt(assembly)` 而不是 `assemble()`；
> 引用未注册的变量、或 provider 返回 `undefined`，都会让 `renderPrompt` **抛错**。
"""),
    ('07-请求管线-LLM工具与提示.md', '7.26', f"""
> {MARK}：[`10-prompt-variable-assemble`]({EX}/10-prompt-variable-assemble/index.ts) 的钩子演示了正确的包装写法 ——
> 先 `await next()` 拿到下游装配体，再往 `sections` 里插一段，**不要**把装配体拍平成字符串：
>
> ```ts
> ctx.on('system-prompt/assemble', async (assembly, _context, next) => {{
>   const downstream = await next()
>   return {{ ...downstream, sections: [{{ name: 'runtime-preamble', text: '…' }}, ...downstream.sections] }}
> }})
> ```
"""),

    # ---------- 08 执行侧服务 ----------
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.2', f"""
> {MARK}：[`16-fs-shell-side-effects`]({EX}/16-fs-shell-side-effects/index.ts) 的 `write_note` 工具只用
> `resolve` → `writeText` → `processPath` 三个口，就在真实 `LocalFileSystem`（`@deepseek-ai/dsh-fs-local`）上落了盘。
"""),
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.11', f"""
> {MARK}：[`24-shell-service`]({EX}/24-shell-service/run.ts) 把三个方法都跑了一遍 ——
> `resolve` 把 999999ms 的请求夹到实现上限（实测 600000）、`run` 对非零退出/超时/取消都 **resolve**、
> `start` 的 `readOutput()` 是消费性增量读。注意 `stdout`/`stderr` 是 `CollectedOutput`（`{{ text, truncated }}`）而不是裸字符串。
"""),
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.18', f"""
> {MARK}：[`25-sandbox-seam`]({EX}/25-sandbox-seam/index.ts) 提供两个后端演示两端 ——
> `WrapSandbox` 返回可强制执行的 argv，`RefuseSandbox` 对强制不了的模式抛 `SandboxUnavailableError`。
>
> ```ts
> export class RefuseSandbox extends SandboxProvider {{
>   confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {{
>     if (policy.mode === 'read-only') return {{ /* 可强制执行的包装 */ }}
>     throw new SandboxUnavailableError(policy.mode, '本后端只会 read-only')   // ← fail-closed
>   }}
> }}
> ```
"""),
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.21', f"""
> {MARK}：[`13-approval-answerer`]({EX}/13-approval-answerer/index.ts) 把四值 outcome 的三种局面都跑了一遍。
> 它还暴露了一条容易踩的不变量：`approval.request()` **必须在打开的 turn 内**
> （`approval/asked` + `approval/decided` 这对审计事件要被 turn 包住），所以示例用一个会调工具的 mock 适配器
> 让真实 agent-loop 在轮内派发，实测事件序列是 `tool/call → approval/asked → approval/decided → tool/result`。
"""),
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.27', f"""
> {MARK}：[`15-subagent-delegation`]({EX}/15-subagent-delegation/index.ts) 写了第七种（一个离线的
> `local-reviewer`），并把它暴露成模型工具。注意 `start()` 返回的是**句柄**而不是结果：
> `{{ id, localAgent, result: Promise<SubagentResult>, dispose() }}` —— 正因如此
> `subagent/start` 与 `subagent/end` 才能分成两个事件。
"""),
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.33', f"""
> {MARK}：[`14-compaction-provider`]({EX}/14-compaction-provider/index.ts) 是这个抽象类的最小 provider，
> 形状与 25 的沙箱后端同型：继承 → `static inject` / `static Config` → 构造里 `super(ctx)` 即挂到
> `ctx.compaction` → `export default`。**没有** `ctx.provide('compaction', engine)` 这种写法。
"""),
    ('08-执行侧服务-文件Shell沙箱子代理压缩.md', '8.34', f"""
> {MARK}：[`14-compaction-provider`]({EX}/14-compaction-provider/run.ts) 实测把 12 个 surface 节点折成 4 个
> （摘要 + 保留最近 3 条），返回的 `CompactionResult` 报出 `summarySeq` / `shadowedRange` / `shadowedSeqs` /
> `shadowedTokenCount` 这份可核对的账。两个真实约束：摘要只能以 `assistant/message` 进 surface，
> 且**必须带 model 来源**（消息本体要经 `createAssistantMessage` 铸造）。
"""),

    # ---------- 09 宿主与运行面 ----------
    ('09-宿主与运行面-Web网关编排存储类型.md', '9.17', f"""
> {MARK}：[`23-settings-namespaces`]({EX}/23-settings-namespaces/run.ts) 走完
> 默认值 → `update` 合并 → 过期 `expectedRevision` 冲突 → `mutate` 路径编辑 → `replace({{}})` 重置 → 重复注册抛错。
> 命名空间不是自由字符串，要用 `settingsNamespace('demo')` 铸一个 branded 值。
"""),
    ('09-宿主与运行面-Web网关编排存储类型.md', '9.20', f"""
> {MARK}：[`21-jobs-background`]({EX}/21-jobs-background/run.ts) 覆盖 JobHooks 拉模型、增量读、
> `wait` 结算、属主栅栏、`kill`，以及**没有 controller 时 start 被拒**的准入。
> 注意 `JobKind` 是封闭词表（`'bash' | 'subagent'`），`label` 必填。
"""),
    ('09-宿主与运行面-Web网关编排存储类型.md', '9.23', f"""
> {MARK}：[`22-goal-lifecycle`]({EX}/22-goal-lifecycle/run.ts) 走完
> create → pause → resume → block → complete → clear，中间演示一次过期 `GoalRef` 的 CAS 冲突；
> 最后用会话日志里的 `goal/change` 事件数说明"状态完全折叠自日志"。
"""),
]


def insert(path, sec, block):
    full = os.path.join(DOCS, path)
    text = open(full, encoding='utf-8').read()
    head = re.compile(r'^## %s .*$' % re.escape(sec), re.M)
    m = head.search(text)
    if not m:
        print('!! no section %s in %s' % (sec, path))
        return
    end = m.end()
    following = text[end:end + 400]
    if MARK in following:
        return  # 幂等
    open(full, 'w', encoding='utf-8').write(text[:end] + '\n' + block.rstrip() + '\n' + text[end:])
    print('inserted %s § %s' % (path, sec))


for path, sec, block in BLOCKS:
    insert(path, sec, block)
print('done: %d blocks' % len(BLOCKS))

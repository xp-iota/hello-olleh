# dsh-guardrail-demo —— 自写安全护栏：从「看见」到四种决定

一个完全独立的工程：把整个目录拷到任何地方，`npm install` 之后 `npm start`（Node）或
`npm run start:bun`（Bun）即可运行。**全程离线**——不需要任何 API key，五个场景全部
用 `callTool` 直接驱动真实工具管线（与模型步同一条 pre-execute → execute 路径）。

配套文章：[07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)
（§7.11 三段 waterfall、§7.13 ToolExecution 类型层级、§7.14 ToolsService 注册表）。
版本面：`@deepseek-ai/*` **0.2.2-rc.3**（与 `sources/deepseek-harness` 快照同版）、
`@deepseek-ai/cordis` **4.1.0**、`@deepseek-ai/schemastery` **3.18.5**。

## 1. 问题

「给工具调用加一道安全门」在 dsh 里有两条缝，能力不对等：

| 缝 | 形状 | 能做什么 | 本示例怎么用 |
|:---|:-----|:---------|:-------------|
| `tools/pre-execute` | waterfall，`(exec, next)` | **allow / deny / ask / cancel** 四种决定 | 自写护栏插件挂在这里 |
| `ctx.tools.guard()` | 单调函数，返回拒绝理由或 undefined | 只能拒绝，不能放行；在 pre-execute 之后求值 | S5 对照 |

护栏插件的两个阶段在本示例里同时可见：**可观测**（allow 的调用打印一行脱敏预览，
日志先于工具函数体）与**策略**（deny / ask / cancel 由 config 驱动，任何非 allow
决定先留痕再返回）。策略全部来自配置——改规则不改代码，摘插件不改管线。

### 架构位置

![dsh-lab 三层同心结构](architecture.svg)

三层同心圆：最内层是 cordis 运行时内核（Context / Fiber / Loader 等），中间是 dsh
能力包（agent-loop、tools、llm、session），最外层是本工程自己的组合层。护栏位于
最外层，监听中间层 `tools` 服务暴露的 `pre-execute` 事件，不改动任何内层代码。
（图随旧工程迁来，版本标注已更新到当前版本面。）

## 2. 装配树

`cordis.yml` 是空树 `[]`，全部装配来自 `cordis.patch.yml`（九行 base + 审批服务 +
自写护栏 + 探针工具，共 12 行）：

```yaml
# 安全护栏的最小树：九行 base + 审批服务 + 自写护栏 + 探针工具，共 12 行。
# 本示例不跑模型 turn：全部场景用 callTool 直接驱动工具管线（与模型步同一条
# pre-execute → execute → post-execute 路径），ask 场景需要一个 agent 路由审批。
# 依赖链：safety-guardrail 注入 tools（pre-execute 事件来自工具注册表）；
#         probe-tools 注入 tools；user-approval 注入 sessionProjections（base 已有）。
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'

    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

    - id: tools
      name: '@deepseek-ai/dsh-tools'

    - id: tool-executor-native
      name: '@deepseek-ai/dsh-tool-executor-native'

    - id: session
      name: '@deepseek-ai/dsh-session'

    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'

    - id: agent
      name: '@deepseek-ai/dsh-agent'

    - id: llm
      name: '@deepseek-ai/dsh-llm'

    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # ── 审批缝：policy ask = 交给 approval/request waterfall 的回答器组合 ───
    # 护栏返回 { kind: 'ask' } 时，管线自己调 approval.request；无回答器 fail-closed。
    - id: user-approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: ask

    # ── 自写护栏：本地插件一行装配，策略全部来自 config ─────────────────────
    # sink 默认 stderr（不打断 REPL 的 stdout 流式渲染）；演示用 stdout 让
    # 护栏日志与场景输出同流，顺序确定、便于双运行时逐行对比。
    - id: safety-guardrail
      name: './src/plugins/safety-guardrail/index.ts'
      config:
        sink: stdout
        previewChars: 240
        denyTools: [demo_danger]
        denyCommandPatterns: ['rm -rf']
        askTools: [demo_ask]
        cancelTools: [demo_cancel]

    # ── 探针工具：六个 demo_* 工具，函数体记录执行顺序 ──────────────────────
    - id: probe-tools
      name: './src/plugins/probe-tools.ts'
```

护栏的配置面（schemastery 校验，未显式给出的取默认值）：

| 配置 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| `previewChars` | natural | `240` | 参数预览最大字符数，超出截断加 `…` |
| `redactKeys` | string[] | apiKey / api_key / authorization / cookie / credential / password / secret / token | 脱敏键名（规范化后精确/后缀匹配） |
| `sink` | `'stderr' \| 'stdout'` | `stderr` | 日志输出流 |
| `prefix` | string | `[safety-guardrail]` | 日志行前缀 |
| `denyTools` | string[] | `[]` | 直接拒绝的工具名 |
| `denyCommandPatterns` | string[] | `[]` | command 参数命中即拒绝的子串 |
| `askTools` | string[] | `[]` | 需要人工审批的工具名 |
| `cancelTools` | string[] | `[]` | 直接取消的工具名 |

`decide()` 的优先级即列表顺序：**cancel > deny（名单）> deny（命令模式）> ask > allow**。

## 3. 实测输出

`npm start`（Node v26.12.1）完整输出，原文粘贴（护栏日志与场景输出同流，顺序即真实顺序）：

```text
runtime = node v26.12.1

=== S1 观察与脱敏 ===
[safety-guardrail] pre-execute tool=demo_echo agent=(standalone) args={"text":"hello guardrail","apiKey":"[REDACTED]","authorization":"[REDACTED]","maxTokens":4096}
echo 结果：echo: hello guardrail
日志先于函数体：true
脱敏：[REDACTED] 在场=true，明文密钥缺席=true，maxTokens 未误伤=true

=== S2 deny：名单与命令模式 ===
[safety-guardrail] deny tool=demo_danger agent=(standalone) reason=tool "demo_danger" is on the guardrail deny list
名单 deny：isError=true，留痕=true
[safety-guardrail] deny tool=demo_shell agent=(standalone) reason=command contains forbidden pattern "rm -rf"
模式 deny：isError=true，reason=Error: command contains forbidden pattern "rm -rf"
函数体从未执行：true

=== S3 ask：审批缝 ===
[safety-guardrail] ask tool=demo_ask agent=guardrail-demo-ask
回答器批准：isError=false（allowed-once → 执行）
[safety-guardrail] ask tool=demo_ask agent=guardrail-demo-ask
回答器拒绝：code=APPROVAL_REJECTED
[safety-guardrail] ask tool=demo_ask agent=guardrail-demo-ask
无回答器：code=APPROVAL_UNAVAILABLE
[safety-guardrail] ask tool=demo_ask agent=(standalone)
无 agent：code=APPROVAL_UNAVAILABLE

=== S4 cancel：规范取消 ===
[safety-guardrail] cancel tool=demo_cancel agent=(standalone)
cancel 结果：Error: tool call aborted before dispatch
函数体未执行：true

=== S5 guard 对照：单调拒绝 ===
[safety-guardrail] pre-execute tool=demo_guarded agent=(standalone) args={}
guard 在场：isError=true（pre-execute 仍 allow，日志 × 1）
[safety-guardrail] pre-execute tool=demo_guarded agent=(standalone) args={}
guard 摘除：isError=false

GUARDRAIL_DEMO_OK
```

`npm run start:bun`（Bun 1.4.4）除首行 `runtime = bun 1.4.4` 外**逐行一致**（30 行，
`Compare-Object` 验证）。输出留档在 [runtime-out-node.txt](runtime-out-node.txt) 与
[runtime-out-bun.txt](runtime-out-bun.txt)。**Bun 直接跑通，无需任何补丁**。

纯函数单测（脱敏 / 预览 / 策略优先级）双运行时也各跑一遍：

```bash
npm test        # node --test：4 pass / 0 fail
npm run test:bun  # bun test：4 pass / 0 fail
```

## 4. 逐场景机制

### S1 观察与脱敏：日志先于工具函数体

allow 的调用打印一行预览：`pre-execute tool=<名> agent=<id 或 (standalone)> args=<一行 JSON>`。
证据链由探针工具产生：每个工具函数体开始时检查「护栏日志是否已写出」
（`bodySawGuardrail`），并把执行事实记进 `bodyOrder`。脱敏有两条规则：

- `redactValue()` 递归脱敏（深度上限 8），只替换命中键的**值**为 `[REDACTED]`，
  键名保留——看得出「这里本来有密钥」。键名规范化（转小写、去非字母数字）后
  **精确或后缀匹配**：`apiKey` / `access_token` / `clientSecret` 命中，
  `maxTokens` 不被 `token` 误伤。
- `previewArguments()` 超长按 `previewChars` 截断加 `…`；循环引用输出
  `[unserializable]`，绝不因日志搞崩一次工具调用。

### S2 deny：先留痕再拦截

名单拒绝与命令模式拒绝都先打印 `deny tool=… reason=…` 留痕行，再把决定返回管线——
这是「谁在什么时候被哪条规则拦下」的唯一证据。被拒绝的工具函数体**绝不执行**
（`bodyOrder` 里没有它）。模型看到的是 `Error: <reason>`，turn 照常收尾。

### S3 ask：管线自动走 approval 缝

护栏只返回 `{ kind: 'ask', reason }`，**不自己调审批**——管线把 ask 映射为
`approval.request()`（带真实 callId），四种结局一一映射：

| 审批结局 | 工具结果 |
|:---------|:---------|
| 回答器 `allowed-once` | 照常执行 |
| 回答器 `rejected` | deny，`error.info.code = APPROVAL_REJECTED` |
| 无回答器 | fail-closed，`APPROVAL_UNAVAILABLE` |
| 无 agent（standalone 调用） | 没有路由对象，`APPROVAL_UNAVAILABLE` |

关键约束：**审批必须在 open turn 内**。`approval.request()` 检查 approvalState 投影的
`turnOpen`，turn 外直接抛错——审计对（approval/asked + approval/decided）必须被 turn
包住，否则崩溃重载时会留下不完整的垃圾记录。真实部署里 turn 由 agent-loop 打开；本示例直接驱动
管线，所以手动 `session.append('turn/start', { turn: 1 })` 把门打开（收尾 append turn/end）。

### S4 cancel：规范取消，不呈现策略拒绝

cancel 与 deny 的区别在模型视角：deny 给模型一条拒绝理由（它能据此改道），
cancel 走规范取消结果 `Error: tool call aborted before dispatch`
（`error.info = { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' }`），
不呈现任何策略身份。函数体同样不执行。

### S5 guard 对照：单调拒绝

`ctx.tools.guard()` 注册的守卫在**每个 pre-execute 监听之后**才求值：护栏对
`demo_guarded` 是 allow（日志照打），guard 仍然拒绝。guard 没有 allow 结果，
所以监听顺序不能把拒绝翻回放行——这是「单调」的含义。摘除 guard（release）后
同一调用立即恢复放行。

## 5. 坑（全部实测踩过）

1. **审批必须在 open turn 内**。直接 `callTool` 带 agent 调 ask 工具，即使回答器
   在场也拿到 `APPROVAL_UNAVAILABLE`——`approval.request()` 在 turn 外抛错，
   管线降级为 unavailable。修法：手动 append `turn/start`（或走真实 turn）。
2. **名单优先级会掩盖模式规则**。`demo_danger` 既在 denyTools 又带 `rm -rf` 命令时，
   reason 永远是名单——模式规则要用不在名单上的干净工具（demo_shell）才能单独看见。
3. **取消错误码的常量名与值不同**：`TOOL_ABORTED_BEFORE_DISPATCH` 常量的值是
   `'ABORTED_BEFORE_DISPATCH'`（contracts.ts），断言要写值不是常量名。
4. **sink 默认 stderr 是对的，演示要切 stdout**。stderr 不打断 REPL 的 stdout
   流式渲染；但双流合并时顺序不确定，演示用 stdout 让护栏日志与场景输出同流，
   双运行时才能逐行对比。
5. **agent id 要确定化**。护栏日志带 `agent=<id>`；用固定 SessionId
   （`guardrail-demo-ask`）而不是时间戳后缀，输出才可复现对比。
6. **脱敏是后缀匹配不是包含匹配**：`maxTokens` 不被 `token` 误伤是设计目标；
   反过来 `my_api_key` 会命中 `api_key`——规范化后后缀相同。
7. **循环引用不能进批接口**：`ToolCallBlock.arguments` 是 JSON 字符串，
   循环参数在 `JSON.stringify` 就抛了；`[unserializable]` 防线只在纯函数单测里验证。
8. **本地插件一行装配**：`name: './src/plugins/safety-guardrail/index.ts'` 相对
   工程根；schemastery Config 的默认值在 patch 缺省时自动补齐。
9. **stdout 包装器要透传**：收集护栏行的包装器必须调用原始 write，否则场景输出
   全部消失；`bind(process.stdout)` 保住 this。
10. **Bun 无缝**：不挂 ptc/subprocess，`node:test` 在 Bun 下由 `bun test` 兼容跑，
    无需任何补丁。

## 6. 从零复现

```text
dsh-guardrail-demo/
├── package.json              # 18 依赖，全部精确 pin
├── tsconfig.json             # NodeNext + allowImportingTsExtensions
├── cordis.yml                # 空树 []
├── cordis.patch.yml          # 12 行装配（上文全文）
├── architecture.svg          # 三层同心圆（版本标注已更新）
├── .gitignore                # node_modules/ .dsh-home/
└── src/
    ├── index.ts              # 五场景，约 165 行
    ├── tools.ts              # executeTool / callTool 批接口封装
    └── plugins/
        ├── safety-guardrail/
        │   ├── index.ts      # 护栏本体（Config / redact / preview / decide / apply）
        │   └── index.test.ts # 纯函数单测 ×4
        └── probe-tools.ts    # 六个探针工具 + 顺序证据
```

版本面：`@deepseek-ai/*` 0.2.2-rc.3（npm `next` 通道）、`@deepseek-ai/cordis` 4.1.0、
cordis-plugin-timer 1.2.0、loader/include/group 1.1.0、schemastery 3.18.5、
typescript 5.9.3、@types/node 22.10.2。运行时：Node ≥ 22.18（实测 v26.12.1）或
Bun ≥ 1.4.4（实测 1.4.4）。

```bash
npm install
npm run typecheck   # tsc 0 错误
npm test            # 4 pass（Node）
npm start           # Node：末行 GUARDRAIL_DEMO_OK
npm run start:bun   # Bun：输出逐行一致
npm run test:bun    # 4 pass（Bun）
```

不需要 `.env`、不需要 API key、不需要网络。

## 7. 小结

- 护栏是装配清单里的**一行本地插件**：观察与策略都挂在 `tools/pre-execute`
  waterfall 上，策略全部来自 config，改规则不改代码，摘插件不改管线。
- 四种决定各有处理方式：allow 留脱敏预览、deny 留拒绝理由、ask 交审批缝（必须在
  open turn 内）、cancel 走规范取消；官方 guard 是它们之后的单调兜底。
- 兄弟示例：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)（管线五段
  机制本身）、[dsh-hitl-demo](../dsh-hitl-demo/README.md)（审批缝的完整词汇表与
  真实 turn 内的工具审批）。
# dsh-chat-demo —— 完整交互式终端（chat / sessions / traj / info）

一个**完全独立**的 dsh 交互式终端：把整个目录拷到任何地方，`npm install` 之后就能
`npm start` 进入 REPL 与真实模型对话，`npm run sessions` / `npm run traj` 回看会话，
`npm run info` 跑启动探针。不依赖仓库里任何其他目录；Node 与 Bun 双运行时实测等价。

它是本系列 21 个示例的「集大成」：89 行完整装配清单 + 自写模型适配器副本 + 自写护栏副本
+ REPL/流式渲染/人机交互/trajectory 回看。前面各示例拆开的接缝，在这里拼回一个能用的产品。

## 1. 问题：一个能用的 dsh 终端最少要拼上什么？

| 能力 | 靠什么 | 本示例的落点 |
|:--|:--|:--|
| 服务装配 | 官方 `boot()` + 声明式 patch | `cordis.patch.yml` 89 行（与旧 dsh-lab 根工程同树） |
| 模型路由 | 自写 Anthropic 兼容适配器 | `src/plugins/anthropic-compat/`（llm-adapter-demo 的副本） |
| 安全护栏 | `tools/pre-execute` waterfall | `src/plugins/safety-guardrail/`（guardrail-demo 的副本） |
| 交互 REPL | agents.create + 事件订阅 | `src/cli/repl.ts`：流式渲染、审批菜单、提问菜单 |
| 会话回看 | session-persistence-jsonl + replay | `src/cli/traj.ts`：turn 折叠、事件明细、surface |
| 装配自检 | 19 必检服务 + 工具数断言 | `src/cli/bin.ts info`：`BOOT_PROBE` 机器可读标记 |

**两份副本是完全独立的代价**：anthropic-compat 与 safety-guardrail 各自和
[dsh-llm-adapter-demo](../dsh-llm-adapter-demo/README.md)、
[dsh-guardrail-demo](../dsh-guardrail-demo/README.md) 同源但互不引用——
拷走本目录不需要带上兄弟示例，改一处也不会波及另一处。

## 2. 装配树：89 行 patch 驱动一切

`cordis.yml` 留空（`[]`），全部装配来自 [`cordis.patch.yml`](cordis.patch.yml)（89 个 `- id:` 行）。
关键行摘录：

```yaml
# 自写适配器：默认路由，maxTokens 8192（thinking 预算，见 §5）
- id: llm-anthropic-compat
  name: './src/plugins/anthropic-compat/index.ts'
  config: { provider: anthropic-compat, apiKeyEnv: LLM_API_KEY, maxTokens: 8192 }

# 默认路由选择（rc.3 起只是配置服务，入口要自己读，见 §5）
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: !!js "process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'"
    model: !!js "process.env.DSH_MODEL ?? process.env.LLM_MODEL ?? 'MiniMax-M3'"

# 自写护栏：DSH_GUARDRAIL=0 可关掉做对照
- id: safety-guardrail
  name: './src/plugins/safety-guardrail/index.ts'
  disabled: !!js "process.env.DSH_GUARDRAIL === '0'"

# 会话落盘 + 内存查询索引
- id: session-persistence-jsonl
  config: { root: !!js "dshHomePath('sessions')" }
- id: session-query-sqlite
  config: { path: ':memory:', openAt: never }

# rc.3 的 web-deepseek-api 不再接受 baseURL/apiKeyEnv/apiKey 配置字段
- id: web-deepseek-api
  name: '@deepseek-ai/dsh-web-deepseek-api'
```

依赖链：`boot()` → loader 读 patch → 89 行插件按 inject 拓扑激活 →
`llm`（两条路由）/ `sessions` / `tools`（27 个）/ `agentLoop` / `approval` / `jobs` /
`invariants` 等 19 个必检服务在场。装配哲学与逐行读法见
[dsh-boot-demo](../dsh-boot-demo/README.md)。

## 3. 实测输出（Node v26.12.1 / Bun 1.4.4，Windows）

### 3.1 启动探针：`npm run info` 与 `npm run info:bun` 输出逐行一致

```text
dsh-chat-demo 装配概况
  工程      D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-chat-demo
  harness   D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-chat-demo\.dsh-home
  路由      anthropic-compat, deepseek-official
  服务      19/19 必检在场
  工具      27
  命令      /compact, /feedback, /goal, /permission, /plan
  护栏      pre-execute 日志（开启）

BOOT_PROBE {"missing":[],"tools":27}
```

探针硬断言：缺任何一个必检服务、或工具数不是 27，就非零退出。
Bun 下若 ptc-runtime 的 shim 没生效，工具会静默掉到 26——探针专抓这种退化。
（留档：[probe-out-node.txt](probe-out-node.txt) / [probe-out-bun.txt](probe-out-bun.txt)）

### 3.2 真实对话：`npm start`（fuyao 网关，`.env` 提供 key）

```text
dsh-chat-demo · 交互式会话
  session  4ab49e51-b55e-4040-ba7b-2f26cf7327c6
  route    anthropic-compat / fuyao-coding
  tools    27 个

  直接输入问题；/help 看命令；Ctrl-D 退出。

… thinking
  ┌ thinking
  └
dsh 的服务装配由官方 `boot()` 加声明式 `cordis.patch.yml`（89 行插件/服务配置行）
驱动的 Cordis 插件化装配树完成，并非手工编写代码来接线。
— turn 1 completed
```

Bun（`npm run start:bun`）同问题同路由，回答措辞略有差异（模型非确定性），
turn 同样 completed。（留档：[chat-real-node.txt](chat-real-node.txt) / [chat-real-bun.txt](chat-real-bun.txt)）

### 3.3 缺 key 明确失败（fail-loud）

移走 `.env` 后直接提问，不静默、不假回答：

```text
… thinking
✗ llm-anthropic-compat: 缺少 LLM_API_KEY；导出 LLM_API_KEY（或写进本目录 .env）
  后再调用模型；只跑装配探针（npm run info）不需要 key
— turn 1 error
```

`info` / `sessions` / `traj` 与 `/help` 等本地命令不需要 key，照常可用。
（留档：[chat-nokey-node.txt](chat-nokey-node.txt)）

### 3.4 会话回看：`npm run traj`（默认最近会话）

```text
trajectory 642ebb94-93bb-4bf6-895b-d5ad766cd43e
  标题      dsh 服务装配的驱动方式
  事件      20 条
  turn      1 个
  工具调用  0 次
  耗时      2.9s
  token     0 in / 124 out

turn 大纲
  #   seq          时间           耗时    步  工具  提示词
   1     4→19    19:51:58.830    2.9s   1     0  用一句话回答：dsh 的服务装配靠什么驱动？…

事件明细
     0 19:51:58.824  权限预设 workspace-write
     4 19:51:58.830  turn 1 开始
     8 19:51:59.142  user     用一句话回答：dsh 的服务装配靠什么驱动？…
    17 19:52:01.704  assistant dsh 的服务装配由声明式配置驱动：官方 `boot()` 读取…
    19 19:52:01.706  turn 1 结束 (completed)
```

标题来自 `session-title-first-prompt-llm` 的辅助调用（适配器的 `purpose` 路径）。
`token 0 in` 是 fuyao 网关的 `message_start` 不带输入用量，不是统计 bug。
（留档：[traj-out-node.txt](traj-out-node.txt)；冒烟：[chat-smoke-node.txt](chat-smoke-node.txt) / [chat-smoke-bun.txt](chat-smoke-bun.txt)）

### 3.5 测试与类型

- `npm run typecheck`：0 错误。
- `npm test` / `npm run test:bun`：**22 pass / 0 fail**（traj 折叠 6 + 适配器纯函数 12 + 护栏 4），双运行时一致。

## 4. 逐场景机制

### 4.1 chat：REPL 的三类交互监听

`repl.ts` 在 `agents.create` 的 `setup` 回调里注册 **agent 作用域**的 waterfall：
`approval/request` 翻成终端审批菜单（返回 `allowed-once` / `rejected`），
`user-questions/request` 翻成选项菜单——agent 释放时自动解绑。
全局监听则负责渲染：`agent/assistant-stream` 逐 chunk 画流式文本与 thinking 块，
`session/event` 处理 `turn/end` 与 `tool/call` + `tool/result`，`agent/error` 保证运行期错误可见。
斜杠命令分两类：本地命令（`/help` `/traj` `/sessions` `/new` `/model`）不进会话日志；
官方命令（`/compact` `/goal` `/permission` `/plan` …）走 `ctx.commands.execute`，落进日志。

### 4.2 sessions / traj：落盘与折叠

会话由 `session-persistence-jsonl` 写进 `.dsh-home/sessions/`；`traj.ts` 的 `foldTurns`
把事件流折叠成 turn（过滤人类消息的 `source.kind`、累计 assistant usage），
`renderTrajectory` 先 replay 校验再渲染概览/大纲/明细，`--surface` 走 readSurface。
这套折叠逻辑有 6 个纯函数测试钉住（含「没有 turn/end 的尾部 turn」边界）。

### 4.3 info：启动探针判据

19 个必检服务逐一 `ctx.get` 断言在场；工具数断言 **27**（rc.1 基线 26，rc.3 新增
`wait_agent`，与旧根工程逐项 diff 确认只差这一个）。输出 `BOOT_PROBE {...}` 机器可读标记，
失败非零退出。判据从旧 dsh-lab 的 `runtime/boot-probe.ts` 迁入。

### 4.4 默认路由兜底

rc.3 的 `agentDefaultModel` 只是配置服务（`currentSelection()` / `saveSelection()`），
不再自动填进 AgentOptions。`startAgent` 在未显式指定路由时读 `currentSelection()` 兜底，
否则首轮直接报 `has no provider/model`（§5 第 3 条）。

## 5. 坑（全部实测）

1. **`legacy-peer-deps` 不装 peer 依赖**。`dsh-invariants` 上游未发 rc.3（最新 0.2.0-rc.2），
   其 peer 声明 cordis ~4.0.4 与本示例的 4.1.0 冲突，只能 `.npmrc` 放宽 peer 解析——
   副作用是 npm **不再自动安装任何 peerDependencies**，首跑报
   `ERR_MODULE_NOT_FOUND '@deepseek-ai/dsh-error'`。解法：把 26 个被声明为 peer 的包
   （dsh-error / dsh-scope / dsh-fs / dsh-shell / dsh-subprocess / dsh-compaction …）
   全部显式写进 dependencies（均 pin 0.2.2-rc.3），迭代两轮收敛到 127 个依赖、缺失 peer 为 NONE。
   其他示例没有 `.npmrc`，peers 自动安装，所以没撞上。
2. **rc.3 工具数 26→27**。新增 `wait_agent`；探针判据与文档同步改 27，
   不能拿 rc.1 的旧判据断言 rc.3 的树。
3. **rc.3 默认路由不再自动注入**。`agentDefaultModel` 从「自动填 AgentOptions」退成纯配置服务，
   入口必须自己 `currentSelection()` 兜底（本示例 repl 已修；症状是首轮
   `agent "…" has no provider/model`）。
4. **thinking 预算**。fuyao 网关的推理模型会把小额 maxTokens 全花在 thinking 上
   （实测 1024 仍零正文、finish=max-tokens），patch 里适配器配 **8192** 才有正文。
5. **Bun 两条缝**（rc.3 形态未变）：`dsh-ptc-runtime-node` 依赖
   `node:module.stripTypeScriptTypes`（Bun 没有），`dsh-subprocess-local` 的 runner
   协议依赖私有 `--` 分隔符（Bun 吞掉）。`runtime/bun-preload.mjs` + `lib/bun-shim.mjs`
   + `lib/spawn.mjs` 三件套在加载期修补，**不改 node_modules**；preload 必须经
   `BUN_OPTIONS` 注入（runner 是孙进程，只继承环境变量）。缺 shim 时工具静默 27→26，
   info 探针专抓。
6. **rc.3 `web-deepseek-api` 配置面收窄**：baseURL / apiKeyEnv / apiKey 不再是 schema 字段，
   patch 中该行不带 config；`web-search-deepseek` 仍接受 apiKeyEnv。
7. **Windows 沙箱 TEMP 探针**：沙箱 ACL 授权要求父目录 WRITE_DAC/WRITE_OWNER，
   `boot.ts` 用 `dsh-sandbox-windows-acl` 自己的 API 做可写探针（icacls 会给假阳性），
   候选目录逐个试；`DSH_CHAT_TEMP=keep` 可禁用。
8. **`.env` 只读本目录**：`bin.ts` 启动时读示例根的 `.env`，不覆盖已存在的环境变量；
   机制路径（info/sessions/traj）完全不受 key 影响。

## 6. 从零复现

```text
dsh-chat-demo/
├── cordis.yml               # []：装配全在 patch
├── cordis.patch.yml         # 89 行完整装配清单
├── package.json             # 127 依赖（含 26 个显式 peer）+ 11 scripts
├── .npmrc                   # legacy-peer-deps（invariants 冲突，上游发新版后移除）
├── .env.example             # 真实对话所需变量模板
├── tsconfig.json
├── runtime/                 # 迷你双运行时层（自包含，不依赖根工程）
│   ├── run.mjs              # Node/Bun 调度器（:bun 脚本全走这里）
│   ├── bun-preload.mjs      # 两条 Bun 缝的加载期修补
│   └── lib/{bun-shim.mjs,spawn.mjs}
└── src/
    ├── boot.ts              # bootChatDemo + TEMP 探针 + .dsh-home
    ├── services.ts          # dshHomePath 等装配辅助
    ├── cli/{bin.ts,repl.ts,term.ts,traj.ts,traj.test.ts}
    └── plugins/
        ├── anthropic-compat/   # 适配器副本（含 12 个纯函数测试）
        └── safety-guardrail/   # 护栏副本（含 4 个测试）
```

版本面：`@deepseek-ai/*` **0.2.2-rc.3**（npm `next` 通道；例外 `dsh-invariants` 0.2.0-rc.2）、
`@deepseek-ai/cordis` **4.1.0**、`@deepseek-ai/schemastery` 3.18.5、commander ^15、
typescript 5.9.3。运行时：Node **>= 22.18**（原生 TS 剥离，实测 v26.12.1）、Bun **>= 1.4.4**。

```powershell
npm install
npm run typecheck
npm run info            # 装配探针（不需要 key）
npm run info:bun        # Bun 下同一判据
npm test                # 22 tests；npm run test:bun 同
npm start               # 交互式 REPL（真实对话需要 .env）
npm run start:bun
npm run sessions        # 列出落盘会话
npm run traj            # 最近会话的 trajectory（--surface / --no-events 可选）
```

真实对话：`Copy-Item .env.example .env`，填入 `LLM_API_KEY` / `LLM_BASE_URL` /
`LLM_VENDOR` / `LLM_MODEL`。缺 key 时 chat 启动照常，首次提问明确报错（§3.3）。

## 7. 小结

- 一个能用的 dsh 终端 = 89 行声明式装配 + 两份自写插件副本 + 一层 REPL/回看 CLI；
  服务树本身一行手工接线都没有。
- rc.1→rc.3 的三处行为差（peer 安装、默认路由注入、wait_agent）都在入口层消化，
  装配清单与探针判据随之演进——这正是「探针判据要跟着版本走」的实例。
- 双运行时的差异被限制在 `runtime/` 三件套里，业务代码对 Bun 零感知。

兄弟示例：[dsh-llm-adapter-demo](../dsh-llm-adapter-demo/README.md)（适配器本体）、
[dsh-guardrail-demo](../dsh-guardrail-demo/README.md)（护栏本体）、
[dsh-trajectory-probe-demo](../dsh-trajectory-probe-demo/README.md)（trajectory 机制）、
[dsh-session-demo](../dsh-session-demo/README.md)（会话落盘）、
[dsh-boot-demo](../dsh-boot-demo/README.md)（装配哲学）。
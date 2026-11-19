# 21 · dsh 的 chat 示例

本示例演示一个**完全独立**的 dsh 交互式终端：把整个目录拷到任何地方，`pnpm install` 之后就能 `pnpm start` 进入 REPL 与真实模型对话，`pnpm run sessions` / `pnpm run traj` 回看会话，`pnpm run info` 跑启动探针。全部装配都在 `cordis.patch.yml`（89 行）里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。基于 `@deepseek-ai/*` 0.2.2-rc.5（例外：`dsh-invariants` 0.2.0-rc.2）与 `@deepseek-ai/cordis` 4.1.0，Node v26.12.1 与 Bun 1.4.4 双运行时实测等价。

它是本系列 21 个示例的「集大成」：89 行完整装配清单 + 自写模型适配器副本 + 自写护栏副本 + REPL/流式渲染/人机交互/trajectory 回看。前面各示例拆开的接缝，在这里拼回一个能用的产品。

## 1 一个能用的 dsh 终端最少要拼上什么

| 能力 | 靠什么 | 本示例的落点 |
|:--|:--|:--|
| 服务装配 | 官方 `boot()` + 声明式 patch | `cordis.patch.yml` 89 行 |
| 模型路由 | 自写 Anthropic 兼容适配器 | `src/plugins/anthropic-compat/`（llm-adapter-demo 的副本） |
| 安全护栏 | `tools/pre-execute` waterfall | `src/plugins/safety-guardrail/`（guardrail-demo 的副本） |
| 交互 REPL | agents.create + 事件订阅 | `src/cli/repl.ts`：流式渲染、审批菜单、提问菜单 |
| 会话回看 | session-persistence-jsonl + replay | `src/cli/traj.ts`：turn 折叠、事件明细、surface |
| 装配自检 | 19 必检服务 + 工具目录断言 | `src/cli/bin.ts info`：`BOOT_PROBE` 机器可读标记 |

> 两份副本是完全独立的代价：anthropic-compat 与 safety-guardrail 各自和 [dsh-llm-adapter-demo](../10-dsh-llm-adapter-demo/README.md)、[dsh-guardrail-demo](../20-dsh-guardrail-demo/README.md) 同源但互不引用——拷走本目录不需要带上兄弟示例，改一处也不会波及另一处。实测逐行 diff：适配器副本只差头注释与缺 key 报错文案（「只跑无 key 路径（pnpm run info）不需要 key」），护栏副本只差头注释，其余逐字一致。

## 2 装配树：89 行 patch 驱动一切

`cordis.yml` 留空（`[]`），全部装配来自 [`cordis.patch.yml`](cordis.patch.yml)：一个顶层数组内含一条 `insert`，一次性挂载 89 行服务。按功能分 13 组：

| 组 | 行数 | 代表行 |
|:--|--:|:--|
| 基础设施 | 1 | timer |
| 模型接入层 | 5 | llm、llm-retry、llm-anthropic-compat（自写）、llm-deepseek、agent-default-model |
| 会话核心 | 11 | session、session-log-deepseek、session-persistence-jsonl、session-query-sqlite、session-title-llm |
| 存储栈 | 5 | storage、storage-json、storage-domain、session-projection-cache、session-reference |
| Agent 循环 | 2 | agent、agent-loop（agents 空表，REPL 运行时创建） |
| 上下文工程 | 9 | system-prompt、token-meter、compaction-basic、tool-result-pruner、spill-policy |
| 工具运行时 | 4 | tools、tool-executor-native、safety-guardrail（自写）、timeout-policy |
| 人机交互 | 9 | user-approval、user-questions、commands、plan-mode、permission |
| 文件与进程边界 | 16 | subprocess、sandbox-policy、fs-sandbox、tool-fs、pwsh-sandbox（Windows） |
| 委派 | 6 | subagent-spawn、subagent-fork、tool-subagent、tool-subagent-control |
| 长期运行 | 8 | jobs、goal、ptc-runtime、workflow-ptc、tool-workflow |
| 外部能力接入 | 10 | skill-filesystem、agent-instructions、mcp-resources、web、tool-web |
| 凭据与诊断 | 3 | authorization、credentials、invariants |

关键行摘录（完整清单见文件本体）：

```yaml
# 本示例的自写 provider：Anthropic Messages 兼容适配器。
# 路由名 anthropic-compat；MiniMax / Fuyao 等 Anthropic 兼容网关走这里。
- id: llm-anthropic-compat
  name: './src/plugins/anthropic-compat/index.ts'
  config:
    provider: anthropic-compat
    apiKeyEnv: LLM_API_KEY
    maxTokens: 8192

# Agent 默认走到哪条路由。默认指向本示例的 anthropic-compat，
# 可用 DSH_MODEL_PROVIDER / DSH_MODEL 覆盖（例如切到 deepseek-official）。
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: !!js "process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'"
    model: !!js "process.env.DSH_MODEL ?? process.env.LLM_MODEL ?? 'MiniMax-M3'"

# 本示例的安全护栏插件（副本）：pre-execute 观察 + 脱敏预览，
# 默认只观察不拦截；DSH_GUARDRAIL=0 可整行关掉做对照。
- id: safety-guardrail
  name: './src/plugins/safety-guardrail/index.ts'
  disabled: !!js "process.env.DSH_GUARDRAIL === '0'"
  config:
    previewChars: 240

# trajectory 的落盘：每会话一份 JSONL，根目录在本示例 .dsh-home/sessions。
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')

# trajectory 的读取：ctx.sessionQuery（精确读、标题、lineage）。
# openAt: never = 不落 SQLite、不做全文索引；精确读照常可用。
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: ':memory:'
    openAt: never

# rc.3：baseURL/apiKeyEnv/apiKey 已不是 schema 字段，凭据跟随会话选择。
- id: web-deepseek-api
  name: '@deepseek-ai/dsh-web-deepseek-api'
```

> 依赖链：`boot()` → loader 读 patch → 89 行插件按 inject 拓扑激活 → `llm`（两条路由）/ `sessions` / `tools`（27 个）/ `agentLoop` / `approval` / `jobs` / `invariants` 等 19 个必检服务在场。与 dsh-base 刻意不同的地方只有「去掉冗余」：不挂 profile 专属行（plugin-manager、hmr、config-editor、settings、api-gateway、otel 遥测——它们是桌面/Web 产品外壳，需要 profileContext 才可用），agent-loop 的 agents 保持空表。装配方式与逐行读法见 [dsh-boot-demo](../07-dsh-boot-demo/README.md)。

两处配置值得单独看。适配器的 `maxTokens: 8192` 是实测值：fuyao 网关的推理
模型会把小额 maxTokens 全花在 thinking 上（实测 1024 仍零正文、
finish=max-tokens），8192 才有正文。`web-deepseek-api` 行不带 config：rc.3 里
baseURL/apiKeyEnv/apiKey 不再是 schema 字段，凭据跟随会话选择；
`web-search-deepseek` 仍接受 apiKeyEnv。

## 3 逐场景机制

### chat：REPL 的三类交互监听

`repl.ts` 在 `agents.create` 的 `setup` 回调里注册 **agent 作用域**的 waterfall：`approval/request` 翻成终端审批菜单（返回 `allowed-once` / `rejected`），`user-questions/request` 翻成选项菜单（支持自由回答）——agent 释放时自动解绑，不用手工记 disposer。全局监听负责渲染：`agent/assistant-stream` 逐 chunk 画流式文本与 thinking 块，`session/event` 处理 `turn/end` 与 `tool/call` + `tool/result`，`agent/error` 保证运行期错误可见。

两个容易读错的签名在代码注释里留了痕：`session/event` 是**两个位置参数** `(session, event)`，不像 `agent/*` 收一个 payload 对象——按 payload 解构会永远拿不到事件且不报错；`tool/result` 的消息体在 `data.message` 里，不是摊在 `data` 上。

斜杠命令分两类：本地命令（`/help` `/traj` `/sessions` `/new` `/model`）不进会话日志——它们是「看会话」的动作，不是会话内容；官方命令（`/compact` `/goal` `/permission` `/plan` `/feedback`）走 `ctx.commands.execute`，落进日志。普通输入只有一句：`agent.followup(createUserMessage(...))` 塞进 inbox 再 `await agent.whenIdle()`——**没有第二套循环**，turn/step 推进、工具调度、压缩、重试全部由 dsh-agent-loop 完成。

### sessions / traj：落盘与折叠

会话由 `session-persistence-jsonl` 写进 `.dsh-home/sessions/`；`traj.ts` 的数据来源是官方 `ctx.sessionQuery.readSession()`——先做一次完整 replay 校验，读出来的事件序列就是真正被信任的那一份。`foldTurns` 把事件流折叠成 turn：只认人类消息的 `source.kind`（runtime-context、skills 提示也是 `user/message`，过滤掉）、只取 turn 里第一条人类消息当提示词、累计 assistant usage。`renderTrajectory` 渲染概览/大纲/明细，`--surface` 走 `readSurface()` 打印模型实际看到的折叠上下文。这套折叠逻辑有 6 个纯函数测试钉住（含「没有 turn/end 的尾部 turn」边界）。

### info：启动探针判据

19 个必检服务逐一 `ctx.get` 断言在场；工具按**完整目录**断言（`EXPECTED_TOOL_NAMES` 27 项，rc.1 基线 26，rc.3 新增 `wait_agent`，与旧根工程逐项 diff 确认只差这一个）——数量抓得住增删，抓不住一换一替换（27 里换掉一个仍是 27），所以同时比对 extra / absent 两向。输出 `BOOT_PROBE {...}` 机器可读标记，失败非零退出。Bun 下若 ptc-runtime 的 shim 没生效，工具会静默掉到 26——单测可能全绿，只有把服务清单与工具目录变成断言才抓得住这种退化。`commands.list` 按 agent 作用域求值，info 借一个临时 agent 做全局盘点后即释放。

### 默认路由兜底

rc.3 的 `agentDefaultModel` 只是配置服务（`currentSelection()` / `saveSelection()`），不再自动填进 AgentOptions。`startAgent` 在未显式指定路由时读 `currentSelection()` 兜底，否则首轮直接报 `has no provider/model`。

## 4 运行 chat 示例

前置：`pnpm install`（peer 冲突由 `pnpm-workspace.yaml` 的 `peerDependencyRules` 放行，见 §5 pnpm 设置节）。探针、测试、会话回看全程不需要 key；真实对话需要本目录 `.env`（模板见 §5）。

根配置全文（装配全在 patch）：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`src/boot.ts` 的启动核心（完整文件见 §5）：

```ts
export async function bootChatDemo(options: {
  prepare?: (ctx: Context) => void | Promise<void>
} = {}): Promise<ChatDemo> {
  ensureWritableTemp()
  const home = ensureDemoHome()

  if (!existsSync(ROOT_CONFIG)) throw new Error(`dsh-chat-demo: 缺少根配置 ${ROOT_CONFIG}`)
  if (!existsSync(PATCH_CONFIG)) throw new Error(`dsh-chat-demo: 缺少装配清单 ${PATCH_CONFIG}`)

  // loadOverlayPatches 做结构校验，并把 `name: './src/...'` 相对路径锚定成
  // 本文件同目录的 file:// URL。返回的已是扁平 PatchOptions[]，不要再套数组。
  const patches = loadOverlayPatches('dsh-chat-demo', PATCH_CONFIG)

  const ctx = await boot(
    'dsh-chat-demo',
    ROOT_CONFIG,
    patches,
    options.prepare,
    pathToFileURL(DEMO_ROOT + '/').href,
  )

  return {
    ctx,
    home,
    async dispose() {
      // 根 fiber 卸载按注册逆序跑完全部 disposer（flush 会话日志、关 SQLite、
      // 停子进程、注销工具）。
      await ctx.fiber.dispose()
    },
  }
}
```

命令：

```bash
# 安装与类型检查
pnpm install
pnpm run typecheck

# 启动探针：19 服务 + 27 工具，不需要 key
pnpm run info
pnpm run info:bun

# 单测：traj 折叠 6 + 适配器纯函数 13 + 护栏 4
pnpm test
pnpm run test:bun

# 交互式 REPL：真实对话需要 .env
pnpm start
pnpm run start:bun

# 会话回看：不需要 key
pnpm run sessions
pnpm run traj
```

启动探针（`pnpm run info` 与 `pnpm run info:bun` 输出逐行一致）：

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

真实对话（`pnpm start`，fuyao 网关，`.env` 提供 key；问题经 stdin 喂入后 `/quit`）：

```text
dsh-chat-demo · 交互式会话
  session  e43912b2-d0c4-4eaa-a812-60608e941147
  route    anthropic-compat / fuyao-coding
  tools    27 个

  直接输入问题；/help 看命令；Ctrl-D 退出。

… thinking
  ┌ thinking
  └
dsh 的服务装配由声明式装配清单 `cordis.patch.yml` 驱动：官方 `boot()` 读取这份清单，在 Cordis 的依赖注入容器里按声明逐条加载插件、注册服务，运行时无需手工装配。
— turn 1 completed
```

Bun（`pnpm run start:bun`）同问题同路由，turn 同样 completed；模型非确定性，回答措辞与 thinking 块的有无都会变（本次 Bun 就没有 thinking 块）。

缺 key 明确失败（移走 `.env` 后直接提问，不静默、不假回答）：

```text
dsh-chat-demo · 交互式会话
  session  fd464e33-d08f-4b3c-8706-b83ddebfb182
  route    anthropic-compat / MiniMax-M3
  tools    27 个

  直接输入问题；/help 看命令；Ctrl-D 退出。

… thinking
✗ llm-anthropic-compat: 缺少 LLM_API_KEY；导出 LLM_API_KEY（或写进本目录 .env）后再调用模型；只跑无 key 路径（pnpm run info）不需要 key
— turn 1 error
```

会话回看（`pnpm run traj`，默认最近会话）：

```text
trajectory e43912b2-d0c4-4eaa-a812-60608e941147
  标题      dsh 服务装配的驱动机制
  cwd       D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-chat-demo
  事件      20 条
  turn      1 个
  工具调用  0 次
  耗时      10.0s
  token     0 in / 106 out

turn 大纲
  #   seq          时间           耗时    步  工具  提示词
   1     4→19    16:57:23.975   10.0s   1     0  用一句话回答：dsh 的服务装配靠什么驱动？不要调用任何工具。

事件明细
     0 16:57:23.967  权限预设 workspace-write
     1 16:57:23.969  沙箱模式 workspace-write
     2 16:57:23.970  审批策略 ask
     4 16:57:23.975  turn 1 开始
     6 16:57:24.254  step 1 开始
     8 16:57:24.256  user     用一句话回答：dsh 的服务装配靠什么驱动？不要调用任何工具。
     9 16:57:24.257  context  <system-reminder> The following workspace instructions may be relevan…
    10 16:57:24.257  context  <system-reminder> The following information describes your current se…
    11 16:57:24.257  context  <system-reminder> A skill is a reusable set of task-specific instruct…
    17 16:57:33.938  assistant dsh 的服务装配由声明式装配清单 `cordis.patch.yml` 驱动：官方 `boot()` 读取这份清单，在 Cordis 的依赖注入容器里按声明逐条加载插件、注册服…
    18 16:57:33.938  step 1 结束
    19 16:57:33.938  turn 1 结束 (completed)
```

标题来自 `session-title-first-prompt-llm` 的辅助调用（适配器的 `purpose` 路径）。留档里的 `token 0 in` 是修复前的现象：当时适配器只从 `message_start` 读输入用量，而 fuyao 网关把 `input_tokens` 报在 `message_delta` 里；现在两个事件都读全量 usage，输入用量不再因事件位置而丢。

测试与类型：`pnpm run typecheck` 0 错误；`pnpm test` / `pnpm run test:bun` 均 **23 pass / 0 fail**（traj 折叠 6 + 适配器纯函数 13 + 护栏 4）。

7 个值得注意的数字：

- **89** 行装配清单，`cordis.yml` 是空表，代码里零手工接线。
- **127** 个依赖，其中 26 个是显式声明的 peer；peer 冲突由 `peerDependencyRules` 放行（见 §5 pnpm 设置节）。
- **19/19** 必检服务、**27** 个工具，双运行时探针输出逐行一致。
- **22** 个测试（6 + 12 + 4），双侧 0 fail。
- **5** 个官方斜杠命令：/compact、/feedback、/goal、/permission、/plan。
- 真实对话一条 turn：**20** 条事件、0 次工具调用，replay 校验后折叠渲染。
- 缺 key 时 chat 启动照常，首次提问在调用期 fail loud；探针与回看完全不受影响。

留档：[probe-out-node.txt](probe-out-node.txt) / [probe-out-bun.txt](probe-out-bun.txt)、[chat-real-node.txt](chat-real-node.txt) / [chat-real-bun.txt](chat-real-bun.txt)、[chat-nokey-node.txt](chat-nokey-node.txt)、[traj-out-node.txt](traj-out-node.txt)、冒烟 [chat-smoke-node.txt](chat-smoke-node.txt) / [chat-smoke-bun.txt](chat-smoke-bun.txt)。

## 5 从零复现：完整文件与运行路径

前置条件：Node >= 22.18（入口经 tsx 加载 .ts，实测 v26.12.1）或 Bun >= 1.4.4；`pnpm install` 一次（`pnpm-workspace.yaml` 已放行已知 peer 冲突）。探针、测试、会话回看不需要任何 key；真实对话复制 `.env.example` 为 `.env` 并填入网关与 key。`.env` 只读本目录：`bin.ts` 启动时读示例根的 `.env`，不覆盖已存在的环境变量，机制路径（info/sessions/traj）完全不受 key 影响。会话、存储、凭据都落在本目录 `.dsh-home/`（gitignored），刻意不继承外层 shell 的 `DSH_HOME`，不污染用户目录。Windows 上沙箱对 TEMP 目录有要求：`boot.ts` 用 `dsh-sandbox-windows-acl` 自己的 API 做可写探针（icacls 只碰 DACL，会给假阳性），候选目录逐个试，`DSH_CHAT_TEMP=keep` 可禁用。

### 目录结构

```text
dsh-chat-demo/
├── cordis.yml               # []：装配全在 patch
├── cordis.patch.yml         # 89 行完整装配清单（§2 有分组与摘录）
├── package.json             # 127 依赖（含 26 个显式 peer）+ 11 scripts
├── pnpm-workspace.yaml      # pnpm 设置：allowBuilds + peerDependencyRules，不声明 packages
├── pnpm-lock.yaml           # pnpm 锁文件
├── .env.example             # 真实对话所需变量模板
├── tsconfig.json
├── runtime/                 # 迷你双运行时层（自包含，不依赖根工程）
│   ├── run.mjs              # Node/Bun 调度器（:bun 脚本全走这里）
│   ├── bun-preload.mjs      # 两条 Bun 缝的加载期修补
│   └── lib/{bun-shim.mjs,spawn.mjs}
└── src/
    ├── boot.ts              # bootChatDemo + TEMP 探针 + .dsh-home
    ├── services.ts          # 服务类型增强的一次性集中 import
    ├── cli/{bin.ts,repl.ts,term.ts,traj.ts,traj.test.ts}
    └── plugins/
        ├── anthropic-compat/   # 适配器副本（含 12 个纯函数测试）
        └── safety-guardrail/   # 护栏副本（含 4 个测试）
```

### package.json（完整版）

```json
{
  "name": "dsh-chat-demo",
  "private": true,
  "type": "module",
  "description": "完整交互式终端：89 行装配清单 + chat/sessions/traj/info 子命令 + REPL 流式渲染 + 审批/提问/斜杠命令 + anthropic-compat 与 safety-guardrail 副本。Node 与 Bun 双运行时（Bun 经自带迷你 runtime 层）。",
  "engines": {
    "node": ">=22.18"
  },
  "scripts": {
    "start": "node src/cli/bin.ts chat",
    "start:bun": "node runtime/run.mjs --runtime bun src/cli/bin.ts chat",
    "info": "node src/cli/bin.ts info",
    "info:bun": "node runtime/run.mjs --runtime bun src/cli/bin.ts info",
    "sessions": "node src/cli/bin.ts sessions",
    "sessions:bun": "node runtime/run.mjs --runtime bun src/cli/bin.ts sessions",
    "traj": "node src/cli/bin.ts traj",
    "traj:bun": "node runtime/run.mjs --runtime bun src/cli/bin.ts traj",
    "test": "node --test src/cli/traj.test.ts src/plugins/anthropic-compat/index.test.ts src/plugins/safety-guardrail/index.test.ts",
    "test:bun": "bun test src/cli/traj.test.ts src/plugins/anthropic-compat/index.test.ts src/plugins/safety-guardrail/index.test.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/cordis-plugin-group": "1.1.0",
    "@deepseek-ai/cordis-plugin-include": "1.1.0",
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/cordis-plugin-timer": "1.2.0",
    "@deepseek-ai/dsh-agent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-default-model": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-instructions": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-preset-registry": "0.2.2-rc.5",
    "@deepseek-ai/dsh-anonymous-user-id": "0.2.2-rc.5",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.5",
    "@deepseek-ai/dsh-attachment": "0.2.2-rc.5",
    "@deepseek-ai/dsh-attachment-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-authorization": "0.2.2-rc.5",
    "@deepseek-ai/dsh-bash-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-bash-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-cmdline": "0.2.2-rc.5",
    "@deepseek-ai/dsh-command-compact": "0.2.2-rc.5",
    "@deepseek-ai/dsh-command-feedback": "0.2.2-rc.5",
    "@deepseek-ai/dsh-command-goal": "0.2.2-rc.5",
    "@deepseek-ai/dsh-commands": "0.2.2-rc.5",
    "@deepseek-ai/dsh-compaction": "0.2.2-rc.5",
    "@deepseek-ai/dsh-compaction-basic": "0.2.2-rc.5",
    "@deepseek-ai/dsh-compaction-image-offload": "0.2.2-rc.5",
    "@deepseek-ai/dsh-compaction-tool-result-pruner": "0.2.2-rc.5",
    "@deepseek-ai/dsh-credentials": "0.2.2-rc.5",
    "@deepseek-ai/dsh-credentials-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-deepseek-account": "0.2.2-rc.5",
    "@deepseek-ai/dsh-deepseek-llm-api-extensions": "0.2.2-rc.5",
    "@deepseek-ai/dsh-error": "0.2.2-rc.5",
    "@deepseek-ai/dsh-file-reference": "0.2.2-rc.5",
    "@deepseek-ai/dsh-file-reference-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-observation-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-goal": "0.2.2-rc.5",
    "@deepseek-ai/dsh-hmr": "0.2.2-rc.5",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.5",
    "@deepseek-ai/dsh-host-webserver": "0.2.2-rc.5",
    "@deepseek-ai/dsh-http-proxy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-invariants": "0.2.0-rc.2",
    "@deepseek-ai/dsh-jobs": "0.2.2-rc.5",
    "@deepseek-ai/dsh-jobs-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm-deepseek": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm-deepseek-account": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm-deepseek-api-key": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm-retry": "0.2.2-rc.5",
    "@deepseek-ai/dsh-mcp-resources": "0.2.2-rc.5",
    "@deepseek-ai/dsh-message-feedback": "0.2.2-rc.5",
    "@deepseek-ai/dsh-permission-presets": "0.2.2-rc.5",
    "@deepseek-ai/dsh-plan-mode": "0.2.2-rc.5",
    "@deepseek-ai/dsh-ptc-runtime": "0.2.2-rc.5",
    "@deepseek-ai/dsh-ptc-runtime-node": "0.2.2-rc.5",
    "@deepseek-ai/dsh-pwsh-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-pwsh-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-repeat-tool-reminder": "0.2.2-rc.5",
    "@deepseek-ai/dsh-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-sandbox-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-sandbox-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-sandbox-windows-acl": "0.2.2-rc.5",
    "@deepseek-ai/dsh-scope": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-checkpoint-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-log-deepseek": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-persistence": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-persistence-jsonl": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-projection-cache": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-query": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-query-sqlite": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-reference": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-stats": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-title": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-title-first-prompt-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-title-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-turn-outline": "0.2.2-rc.5",
    "@deepseek-ai/dsh-settings": "0.2.2-rc.5",
    "@deepseek-ai/dsh-shell": "0.2.2-rc.5",
    "@deepseek-ai/dsh-shell-env": "0.2.2-rc.5",
    "@deepseek-ai/dsh-skill": "0.2.2-rc.5",
    "@deepseek-ai/dsh-skill-filesystem": "0.2.2-rc.5",
    "@deepseek-ai/dsh-spill": "0.2.2-rc.5",
    "@deepseek-ai/dsh-spill-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-spill-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-storage": "0.2.2-rc.5",
    "@deepseek-ai/dsh-storage-domain": "0.2.2-rc.5",
    "@deepseek-ai/dsh-storage-json": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subagent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subagent-fork-in-process": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subagent-spawn-in-process": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subprocess": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subprocess-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.5",
    "@deepseek-ai/dsh-token-meter": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-ask-user": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-bash": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-call-timeout-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-fs": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-fs-search": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-goal": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-jobs": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-pwsh": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-skill": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-subagent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-subagent-control": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-todo": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-web": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-workflow": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-working-directory": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.5",
    "@deepseek-ai/dsh-user-approval": "0.2.2-rc.5",
    "@deepseek-ai/dsh-user-questions": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web-deepseek-api": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web-fetch-http": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web-search-deepseek": "0.2.2-rc.5",
    "@deepseek-ai/dsh-workflow": "0.2.2-rc.5",
    "@deepseek-ai/dsh-workflow-ptc": "0.2.2-rc.5",
    "@deepseek-ai/dsh-working-directory": "0.2.2-rc.5",
    "@deepseek-ai/dsh-workspace": "0.2.2-rc.5",
    "@deepseek-ai/schemastery": "3.18.5",
    "commander": "^15.0.0"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

`tsconfig.json` 与 [dsh-agent-loop-demo 的 tsconfig.json](../11-dsh-agent-loop-demo/tsconfig.json) 逐字一致（ES2023 / nodenext / strict / noEmit / allowImportingTsExtensions），不再重复。

### pnpm 设置（完整版）

`pnpm-workspace.yaml` 只承载设置、不声明 `packages`——本示例仍是独立安装域：

```yaml
allowBuilds:
  # tsx 的原生二进制依赖，必须放行安装脚本。
  esbuild: true
  # 子进程 / PTY / FFI 边界，安装期需要编译或挑选平台二进制。
  '@deepseek-ai/dsh-subprocess-local': true
  koffi: true
  node-pty: true

peerDependencyRules:
  allowedVersions:
    '@deepseek-ai/cordis': '4.1.0'
    '@deepseek-ai/schemastery': '3.18.5'

minimumReleaseAge: 0
```

peer 冲突的来历：`dsh-invariants` 上游未发 rc.3（最新仍是 0.2.0-rc.2），其 peer 声明
cordis ~4.0.4，与本示例的 cordis 4.1.0 冲突；`dsh-settings` 想要 schemastery ~3.19.0，
本示例按上游 lock 里的 3.18.5 实测可用。与 DSH 仓库同样的做法：不改上游 peer 声明，
用 `allowedVersions` 显式放行。26 个 peer 包仍显式写进 dependencies（均 pin 0.2.2-rc.5），
收敛到 127 个依赖；其余示例没有冲突，peers 由 pnpm 自动安装。

### .env.example（完整版）

```bash
# 真实对话（chat 里发消息）需要这些变量；info/sessions/traj 与 /help 等本地命令不需要。
# 复制本文件为 .env（已 gitignore），填入你自己的网关与 key。
LLM_API_KEY=
# Anthropic 兼容网关基地址（不含 /v1/messages）
LLM_BASE_URL=https://api.minimaxi.com/anthropic
# 供应商风格：minimax（回放 thinking 签名）或 fuyao（允许省略无签名 thinking）
LLM_VENDOR=minimax
LLM_MODEL=MiniMax-M3
# 可选：覆盖默认路由与模型
# DSH_MODEL_PROVIDER=anthropic-compat
# DSH_MODEL=MiniMax-M3
# 可选：权限模式 read-only / workspace-write（默认）/ danger-full-access
# DSH_PERMISSION_MODE=workspace-write
# 可选：DSH_GUARDRAIL=0 关掉护栏行做对照
# 可选：web 搜索用的 DeepSeek 官方 key（不填则搜索不可用，fetch 照常）
# DEEPSEEK_API_KEY=
```

### src/boot.ts（完整版）

```ts
/**
 * boot.ts —— 用官方装配机制启动本示例的完整服务树。
 *
 * 只做三件事：
 *   1. 把 `DSH_HOME` 默认指向示例内的 `.dsh-home/`（会话、存储、凭据都落在这里，
 *      示例自带状态，不污染用户目录）；
 *   2. 调用 `@deepseek-ai/dsh-app-boot` 的 `boot()`：创建 cordis Context、挂 Loader，
 *      把 `cordis.yml`（空表）+ `cordis.patch.yml`（89 行）组合成服务树；
 *   3. 把启动结果（Context + home + dispose）交给调用方。
 *
 * 为什么不再手写装配：boot() 已经把"读配置 → 组合 patch 层 → 校验行 → 失败即大声
 * 报错"做完了，行 id、!!js 表达式、相对路径插件导入、依赖注入顺序都是配置树的语义，
 * 手写只会把它们复述一遍并且更容易漂移。
 */
import { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 示例根目录（本文件在 `<root>/src/boot.ts`）。 */
export const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 装配清单路径：根表 + patch 层。 */
export const ROOT_CONFIG = join(DEMO_ROOT, 'cordis.yml')
export const PATCH_CONFIG = join(DEMO_ROOT, 'cordis.patch.yml')

/**
 * 确保 `TEMP`/`TMP` 指向一个沙箱**能**在下面建临时授权的目录。
 *
 * 真实踩到的坑：Windows 沙箱跑命令前会 `mkdtempSync(join(tmpdir(), 'dsh-'))`，
 * 再给该目录加一条针对"临时写 SID"的 ACL——那次 ACL 写入要求**父目录**上有
 * WRITE_DAC/WRITE_OWNER。若 TEMP 被指到无此权限的目录（如 D:\TEMP），沙箱报：
 *
 *     sandbox-local windows-acl temp grant materialization failed and its cleanup also failed
 *
 * 修法：让本进程用一个可写的临时根（%LOCALAPPDATA%\Temp 通常可写），
 * 并且**只在默认临时根不可用时**才改。可用 DSH_CHAT_TEMP 显式指定；
 * 设成 keep 表示"别碰 TEMP"。
 */
function ensureWritableTemp(): void {
  const override = process.env.DSH_CHAT_TEMP?.trim()
  if (override === 'keep') return

  const candidates = override
    ? [resolve(override)]
    : [
        process.env.TEMP ?? '',
        process.env.TMP ?? '',
        join(process.env.LOCALAPPDATA ?? '', 'Temp'),
        join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'Temp'),
      ]

  for (const candidate of candidates) {
    if (candidate === '') continue
    if (canHostSandboxTemp(candidate)) {
      if (candidate !== process.env.TEMP) {
        process.env.TEMP = candidate
        process.env.TMP = candidate
      }
      return
    }
  }
  // 一个都不行：不做假动作，让沙箱自己报错——那时错误信息是有意义的。
}

/** 判断某个目录能否作为沙箱临时根：真跑一次沙箱要做的授权。 */
function canHostSandboxTemp(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // 探针必须**复现沙箱的真实动作**：icacls 只碰 DACL，而沙箱那次
    // SetNamedSecurityInfoW 同时写 DACL 和完整性标签，icacls 探针会给假阳性。
    // 所以直接调沙箱自己的 API——探针和被测对象是同一个实现。
    const probe = join(dir, `.dsh-chat-probe-${process.pid.toString(36)}-${Date.now().toString(36)}`)
    mkdirSync(probe, { recursive: true })
    try {
      return aclGrantProbe(probe)
    } finally {
      try {
        rmSync(probe, { recursive: true, force: true })
      } catch {
        // 探针残留不影响判断。
      }
    }
  } catch {
    return false
  }
}

/** 用沙箱自己的 ACL 授权实现试写一次（仅 Windows 有意义）。 */
function aclGrantProbe(dir: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    const require = createRequire(import.meta.url)
    const acl = require('@deepseek-ai/dsh-sandbox-windows-acl') as {
      tempWriteSid: (dir: string) => unknown
      AclWriteGrant: {
        create: (sid: unknown) => { add: (dir: string) => void; dispose: () => void }
      }
    }
    const grant = acl.AclWriteGrant.create(acl.tempWriteSid(dir))
    try {
      grant.add(dir)
      return true
    } finally {
      try {
        grant.dispose()
      } catch {
        // 撤销失败不影响"刚才那次授权成功"这个事实。
      }
    }
  } catch {
    return false
  }
}

/**
 * 把 `DSH_HOME` 指向示例内的 `.dsh-home/`。
 *
 * 刻意**不**继承外层 shell 的 `DSH_HOME`：本示例是独立工程，会话、存储、凭据
 * 都应当留在示例目录里。确实要共享时用 `DSH_CHAT_HOME` 显式指定。
 */
export function ensureDemoHome(): string {
  const configured = process.env.DSH_CHAT_HOME?.trim()
  const home = configured ? resolve(configured) : join(DEMO_ROOT, '.dsh-home')
  process.env.DSH_HOME = home
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  return home
}

/** 一次启动的产物。 */
export interface ChatDemo {
  /** 装配好的 cordis 根 Context。 */
  readonly ctx: Context
  /** 生效的 harness home。 */
  readonly home: string
  /** 释放整棵树（等价于官方 CLI 的 graceful shutdown）。 */
  dispose(): Promise<void>
}

/**
 * 启动服务树。
 *
 * @param options.prepare - 服务树激活前运行的钩子（可 ctx.provide() 注入启动参数）。
 * @throws 装配清单不可读、行无法激活、依赖缺失等任何启动期问题（fail loud）。
 */
export async function bootChatDemo(options: {
  prepare?: (ctx: Context) => void | Promise<void>
} = {}): Promise<ChatDemo> {
  ensureWritableTemp()
  const home = ensureDemoHome()

  if (!existsSync(ROOT_CONFIG)) throw new Error(`dsh-chat-demo: 缺少根配置 ${ROOT_CONFIG}`)
  if (!existsSync(PATCH_CONFIG)) throw new Error(`dsh-chat-demo: 缺少装配清单 ${PATCH_CONFIG}`)

  // loadOverlayPatches 做结构校验，并把 `name: './src/...'` 相对路径锚定成
  // 本文件同目录的 file:// URL。返回的已是扁平 PatchOptions[]，不要再套数组。
  const patches = loadOverlayPatches('dsh-chat-demo', PATCH_CONFIG)

  const ctx = await boot(
    'dsh-chat-demo',
    ROOT_CONFIG,
    patches,
    options.prepare,
    pathToFileURL(DEMO_ROOT + '/').href,
  )

  return {
    ctx,
    home,
    async dispose() {
      // 根 fiber 卸载按注册逆序跑完全部 disposer（flush 会话日志、关 SQLite、
      // 停子进程、注销工具）。
      await ctx.fiber.dispose()
    },
  }
}
```

### src/services.ts（完整版）

```ts
/**
 * services.ts —— 一次导入所有服务的 Context 类型增强。
 *
 * cordis 的服务声明是 declare module '@deepseek-ai/cordis' { interface Context { ... } }
 * 的形式，只有 import 了那个包，TypeScript 才能看到 ctx.xxx。运行时由
 * cordis.patch.yml 提供，编译期由这一个文件集中引入，避免每个文件各写一遍。
 *
 * @module dsh-chat-demo/services
 */
import '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-session-query'
import '@deepseek-ai/dsh-session-projection'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-agent-loop'
import '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-token-meter'
import '@deepseek-ai/dsh-user-approval'
import '@deepseek-ai/dsh-user-questions'
import '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-storage'
import '@deepseek-ai/dsh-storage-domain'
import '@deepseek-ai/dsh-credentials'
import '@deepseek-ai/dsh-skill'
import '@deepseek-ai/dsh-subagent'
import '@deepseek-ai/dsh-jobs'
import '@deepseek-ai/dsh-goal'
import '@deepseek-ai/dsh-workflow'
import '@deepseek-ai/dsh-sandbox'
import '@deepseek-ai/dsh-invariants'
import '@deepseek-ai/dsh-plan-mode'
import '@deepseek-ai/dsh-message-feedback'
```

### src/cli/bin.ts（完整版）

```ts
#!/usr/bin/env node
/**
 * dsh-chat-demo CLI 入口。
 *
 * 四个子命令，覆盖"人怎么用它"的全部路径：
 *
 *   chat              交互式会话（REPL：聊天/审批/提问/斜杠命令）
 *   sessions          列出已落盘的会话
 *   traj [id]         查看某个会话的 trajectory
 *   info              打印装配树概况，并断言 19 服务 + 27 工具（启动探针）
 *
 * 设计原则：**启动一次树，做完事，优雅释放**。`chat` 以外的子命令都只读，
 * 不创建对话、不调模型，因此不需要 LLM_API_KEY——只有真正发消息的路径才要求 key
 * （缺 key 时适配器在调用期报 MISSING_CREDENTIAL，fail loud）。
 *
 * `info` 同时是启动探针：Bun 缺 node:module.stripTypeScriptTypes 时是**静默少 1 个
 * 工具**（26 对 27），单测也可能全绿，只有把服务清单与工具数变成断言才抓得住。
 */
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootChatDemo, DEMO_ROOT } from '../boot.ts'
import { line, style } from './term.ts'

/**
 * 读示例根的 .env（若存在）。已存在的环境变量不覆盖。
 *
 * 本示例不引 dotenv，自己解析（只有 KEY=VALUE 与 # 注释两种形态）。
 * 解析行为（含值两侧成对引号的剥离）与 10-dsh-llm-adapter-demo 的
 * src/env.ts 是同源约定——改一边必须同步另一边。只做解析、无副作用：
 * `.dsh-home` 由 bootChatDemo() 里的 ensureDemoHome() 统一创建。
 */
function loadDotEnv(): void {
  const path = `${DEMO_ROOT}/.env`
  try {
    const text = readFileSync(path, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // 没有 .env 是正常情况：用户也可能直接用环境变量。
  }
}

loadDotEnv()

const program = new Command()
program
  .name('dsh-chat-demo')
  .description('基于 @deepseek-ai/dsh 0.2.2-rc.5 的独立交互式示例：完整 89 行装配 + REPL + trajectory')
  .version('0.1.0')

program
  .command('chat')
  .description('交互式会话（REPL）')
  .option('-r, --resume <id>', '恢复已有会话')
  .option('-p, --provider <route>', '覆盖模型路由（如 anthropic-compat / deepseek-official）')
  .option('-m, --model <name>', '覆盖模型名')
  .action(async (options: { resume?: string; provider?: string; model?: string }) => {
    const { Repl } = await import('./repl.ts')
    const demo = await bootChatDemo()
    try {
      await new Repl(demo.ctx).run(options)
    } finally {
      await demo.dispose()
    }
  })

program
  .command('sessions')
  .description('列出已落盘的会话')
  .action(async () => {
    const { renderSessionList } = await import('./traj.ts')
    const demo = await bootChatDemo()
    try {
      await renderSessionList(demo.ctx)
    } finally {
      await demo.dispose()
    }
  })

program
  .command('traj')
  .argument('[sessionId]', '会话 id（省略时列出最近一个）')
  .description('查看 trajectory')
  .option('--surface', '同时打印模型表面折叠结果')
  .option('--no-events', '只打印概览与 turn 大纲')
  .action(async (sessionId: string | undefined, options: { surface?: boolean; events?: boolean }) => {
    const { renderTrajectory } = await import('./traj.ts')
    const demo = await bootChatDemo()
    try {
      let id = sessionId
      if (id === undefined) {
        const records = await demo.ctx.sessionQuery.listSessions()
        if (records.length === 0) {
          line(style.dim('还没有任何会话。先 `pnpm start` 聊一句。'))
          return
        }
        id = String(records[0]!.header.id)
        line(style.dim(`(默认最近会话 ${id})`))
      }
      await renderTrajectory(demo.ctx, id, { surface: options.surface, events: options.events })
    } finally {
      await demo.dispose()
    }
  })

/** 启动探针的必检服务（与旧 dsh-lab boot-probe 判据一致）。 */
const REQUIRED_SERVICES = [
  'llm',
  'sessions',
  'sessionQuery',
  'sessionProjections',
  'tools',
  'agents',
  'agentLoop',
  'systemPrompt',
  'tokenMeter',
  'approval',
  'userQuestions',
  'commands',
  'storage',
  'skills',
  'subagents',
  'jobs',
  'goals',
  'workflowEngine',
  'invariants',
] as const

/**
 * 期望的工具**目录**（Node 下的实测值，按名排序；Bun 必须相同才算通过）。
 * rc.1 基线是 26 个；rc.3 新增 wait_agent（子代理等待），实测 27 个——
 * 与旧根工程逐项 diff 确认只差这一个。
 *
 * 为什么钉住目录而不只钉数量：数量抓得住增删，抓不住**一换一替换**或
 * 错误工具在场（27 个里换掉一个仍是 27）。上游升版增删工具时这里会
 * fail loud，按新目录更新本清单即可。
 */
const EXPECTED_TOOL_NAMES = [
  'ask_user_question',
  'create_goal',
  'edit',
  'exit_plan_mode',
  'get_goal',
  'glob',
  'grep',
  'interrupt_agent',
  'job_kill',
  'job_list',
  'job_output',
  'list_agents',
  'pwsh',
  'read',
  'read_image',
  'send_message',
  'skill',
  'subagent',
  'subagent_fork',
  'todo_write',
  'update_goal',
  'wait_agent',
  'web_fetch',
  'web_search',
  'workflow',
  'working_directory',
  'write',
] as const

/** 期望的工具数（由目录推出，单一事实源）。 */
const EXPECTED_TOOLS = EXPECTED_TOOL_NAMES.length

program
  .command('info')
  .description('打印装配树概况，并断言 19 服务 + 27 工具（启动探针）')
  .action(async () => {
    const demo = await bootChatDemo()
    try {
      const missing = REQUIRED_SERVICES.filter((name) => demo.ctx.get(name as never) === undefined)
      const tools = demo.ctx.tools.schemas()
      // commands.list 按 agent 作用域求值；info 只想要全局盘点，所以借一个临时 agent。
      const probe = await demo.ctx.agents.create({
        sessionId: SessionId(`info-${Date.now().toString(36)}`),
        meta: { cwd: process.cwd() },
      })
      const commands = demo.ctx.commands.list(probe.agent)
      await probe.dispose()
      const providers = demo.ctx.llm.listProviders()
      line()
      line(style.bold('dsh-chat-demo 装配概况'))
      line(`  工程      ${DEMO_ROOT}`)
      line(`  harness   ${demo.home}`)
      line(`  路由      ${providers.map((p: { id?: string; provider?: string }) => p.id ?? p.provider).join(', ') || '(未注册)'}`)
      line(`  服务      ${REQUIRED_SERVICES.length - missing.length}/${REQUIRED_SERVICES.length} 必检在场`)
      line(`  工具      ${tools.length}`)
      line(`  命令      ${commands.map((c: { name: string }) => '/' + c.name).join(', ')}`)
      line(`  护栏      pre-execute 日志（${process.env.DSH_GUARDRAIL === '0' ? '已关闭' : '开启'}）`)
      line()
      // 机器可读标记 + 硬断言：缺服务、工具数不对或**工具目录**对不上就非零退出。
      const actualNames = tools.map((tool: { name: string }) => tool.name).sort()
      const expectedNames: string[] = [...EXPECTED_TOOL_NAMES].sort()
      const extraTools = actualNames.filter((name: string) => !expectedNames.includes(name))
      const absentTools = expectedNames.filter((name) => !actualNames.includes(name))
      console.log(`BOOT_PROBE ${JSON.stringify({ missing, tools: tools.length })}`)
      if (missing.length > 0 || extraTools.length > 0 || absentTools.length > 0) {
        throw new Error(
          `启动探针失败：missing=${JSON.stringify(missing)} tools=${tools.length}/${EXPECTED_TOOLS}` +
          ` extra=${JSON.stringify(extraTools)} absent=${JSON.stringify(absentTools)}。` +
          'Bun 下少 1 个工具通常是 ptc-runtime 的 stripTypeScriptTypes shim 未生效，检查 runtime/bun-preload.mjs；' +
          '上游升版增删工具时请按新目录更新 EXPECTED_TOOL_NAMES。',
        )
      }
    } finally {
      await demo.dispose()
    }
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  line(style.red(`✗ ${error instanceof Error ? error.message : String(error)}`))
  process.exitCode = 1
})
```

### src/cli/repl.ts（结构说明）

REPL 本体 461 行，全文在 [repl.ts](src/cli/repl.ts)，这里给结构地图：

- `Repl.run()`：startAgent → renderBanner → 读-求值循环（EOF / `/quit` 退出）→ teardown。
- `startAgent()`：rc.3 默认路由 `currentSelection()` 兜底；`agents.create` / `agents.resume` 的 `setup` 回调里调 `composeAgentScope`。
- `composeAgentScope()`：agent 作用域的两个 waterfall 回答器——`approval/request`（y/n → `allowed-once` / `rejected`）与 `user-questions/request`（选项菜单 + 自由回答）。
- `installGlobalListeners()`：`agent/assistant-stream`（流式帧）、两个 `session/event`（turn 收尾 / 工具行，注意两位置参数签名）、`agent/error`、`agent/status`。
- `renderChunk()`：block-start / text-delta / reasoning-delta / block-end 的状态机，thinking 块只在 TTY 下灰字刷新。
- `handleInput()`：官方命令走 `ctx.commands.execute`，本地命令（/help /traj /sessions /new /model）不落日志，其余 `agent.followup(createUserMessage(...))` + `whenIdle()`。

### src/cli/traj.ts（结构说明）

trajectory 视图 384 行，全文在 [traj.ts](src/cli/traj.ts)：

- `foldTurns()`（导出，6 个测试钉住）：turn/start 开新 turn、user/message 只认人类首条、step/tool 计数、assistant usage 累计、turn/end 收尾；尾部无 turn/end 也闭合。
- `messageOf()`：认两种负载形状——消息事件负载在 `data` 本身，`tool/result` 在 `data.message`。
- `renderTrajectory()`：readSession（replay 校验）→ 概览 / turn 大纲 / 事件明细 / `--surface` 走 readSurface。
- `describeEvent()`：扩展包事件（permission/preset 等）先按字符串比，再进核心 SessionEvent 的穷尽 switch。
- `renderSessionList()`：listSessions + readTitle，live / persisted 两列。

### src/cli/term.ts（结构说明）

终端渲染工具 162 行，全文在 [term.ts](src/cli/term.ts)：`style`（ANSI 着色，非 TTY 自动退化为纯文本）、`width()`、`line()` / `tag()`、`StreamRenderer`（流式文本按终端宽度换行）、`Prompter`（readline 封装：read / confirm / choose）。

### src/plugins/（两份副本，结构说明）

- `anthropic-compat/index.ts`（607 行）：与 [dsh-llm-adapter-demo 的适配器](../10-dsh-llm-adapter-demo/src/plugins/anthropic-compat/index.ts) 逐行 diff 只差头注释与缺 key 报错文案。结构地图见那篇 README §5：Config schema 8 字段、5 个导出纯函数（parseSseData / splitSystem / toAnthropicMessages / toAnthropicTool / tokenUsage）、apply 里的环境变量覆盖与每次请求解析凭据。12 个单测在 [index.test.ts](src/plugins/anthropic-compat/index.test.ts)。
- `safety-guardrail/index.ts`（153 行）：与 [dsh-guardrail-demo 的护栏](../20-dsh-guardrail-demo/src/plugins/safety-guardrail/index.ts) 只差头注释。`inject = ['tools']`，Config 8 字段全默认值（默认只观察不拦截）；`decide()` 优先级 cancel > deny 名单 > deny 命令模式 > ask > allow；`redactValue()` 规范化键名后精确/后缀匹配脱敏（`maxTokens` 不会被 `token` 误伤）；apply 注册一个 `tools/pre-execute` 监听，非 allow 决定先留痕再返回，日志走 stderr 不打断流式渲染。4 个测试在 [index.test.ts](src/plugins/safety-guardrail/index.test.ts)。

### runtime/（迷你双运行时层，结构说明）

四个文件共 395 行，与 dsh-lab 根工程的 runtime 同构但完全自包含：

- [run.mjs](runtime/run.mjs)（119 行）：`--runtime node|bun` 调度器；版本门槛 Node >= 22.18 / Bun >= 1.4.4；Windows 上认 bun.exe 与 bun.cmd 两种形态；`DSH_NODE` / `DSH_BUN` 可显式指定可执行文件。
- [bun-preload.mjs](runtime/bun-preload.mjs)（89 行）：两条缝的加载期修补——ptc-runtime 入口的 `from "node:module"` 精确替换为本地 shim（不匹配就 emitWarning，不静默失效）；runner 入口（`DSH_SUBPROCESS_RUNNER` + 文件名双重判定）补回被 Bun 吞掉的 `--`。
- [lib/bun-shim.mjs](runtime/lib/bun-shim.mjs)（138 行）：`Bun.Transpiler` 实现的 `stripTypeScriptTypes`，保留上游 `slice(35, -2)` 依赖的 35 字节前缀 / `\n}` 后缀。
- [lib/spawn.mjs](runtime/lib/spawn.mjs)（74 行）：`BUN_OPTIONS` 注入（孙进程只继承环境变量）；清掉继承的 NODE_OPTIONS / BUN_OPTIONS；路径正斜杠 + 反斜杠转义空格（Bun 不认引号）；.cmd 回退显式走 `cmd.exe /d /s /c` 避开 DEP0190。

### 按顺序验证

```bash
# 1 安装与类型
pnpm install
pnpm run typecheck

# 2 探针：双侧 BOOT_PROBE {"missing":[],"tools":27}
pnpm run info
pnpm run info:bun

# 3 测试：双侧 23 pass / 0 fail
pnpm test
pnpm run test:bun

# 4 冒烟：空输入进 REPL 即 EOF 退出，不需要 key
pnpm start
pnpm run start:bun

# 5 真实对话（先 Copy-Item .env.example .env 并填 key）
pnpm start
pnpm run traj
```

机制路径（info / sessions / traj / test / 冒烟）不依赖任何环境变量、端口或外部服务；真实对话只多一个本目录 `.env`。

## 6 小结

这个示例验证了 4 件事：

- 一个能用的 dsh 终端 = 89 行声明式装配 + 两份自写插件副本 + 一层 REPL/回看 CLI；服务树本身一行手工接线都没有。
- rc.1→rc.3 的三处行为差（peer 安装、默认路由注入、wait_agent）都在入口层消化，装配清单与探针判据随之演进——探针判据要跟着版本走。
- 双运行时的差异被限制在 `runtime/` 三件套里，业务代码对 Bun 零感知；静默退化（27→26）只有硬断言抓得住。
- 完全独立是有代价的：127 个依赖、两份插件副本、一套自带 runtime——拷走即用，改一处不波及兄弟示例。

兄弟示例：[dsh-llm-adapter-demo](../10-dsh-llm-adapter-demo/README.md)（适配器本体）、[dsh-guardrail-demo](../20-dsh-guardrail-demo/README.md)（护栏本体）、[dsh-trajectory-probe-demo](../13-dsh-trajectory-probe-demo/README.md)（trajectory 机制）、[dsh-session-demo](../12-dsh-session-demo/README.md)（会话落盘）、[dsh-boot-demo](../07-dsh-boot-demo/README.md)（装配方式）。
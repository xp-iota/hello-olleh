# dsh-skills-mcp-demo —— 外部能力接入四形态：skill、工作区指令、MCP、web

一个完全独立的工程：把整个目录拷到任何地方，`npm install` 之后 `npm start`（Node）或
`npm run start:bun`（Bun）即可运行。**全程离线**——不跑模型 turn、不需要任何 API key，
四个场景全部用真实服务 API / 真实工具管线驱动，web_fetch 抓的是本机现起的 HTTP 服务。

配套文章：[04 扩展与生态](../../../docs/hello-dsh/04-extensions-and-ecosystem.md)（§4.2 skill 组、§4.12 mcp-client）
与 [07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)（§7.14 ToolsService 注册表）。
版本面：`@deepseek-ai/*` **0.2.2-rc.3**（与 `sources/deepseek-harness` 快照同版）、
`@deepseek-ai/cordis` **4.1.0**。

## 1. 问题

「给 agent 加能力」在 dsh 里有四种完全不同的形态，但共享同一个认识：**能力是数据，装配是配置**——
四者都不改工具管线本体。

| 形态 | 能力是什么 | 装配方式 | 本示例验证什么 |
|:-----|:-----------|:---------|:---------------|
| skill | 一个目录（SKILL.md） | 文件系统 provider 扫描 | 发现只读 frontmatter、正文按需加载、调用策略、活发现 |
| 工作区指令 | 一个文件（AGENTS.md） | agent-instructions 按候选链加载 | 进基线上下文、按字节预算截断而不是报错 |
| MCP | 一个外部进程 | mcp-client 一行配置一个 server | stdio 实连、命名空间前缀、boot 返回前完成同步 |
| web | 一个 provider 注册 | web 缝 + fetch/search provider | **准入门控**（when + resolve）、本机可达、scheme/凭据边界 |

旧 M10 模块对这四形态多是「报告在位」；本示例全部升级为**实调用**，并且把 rc.3 的一个
关键机制做成场景：带 `when` 门控的工具（web_fetch/web_search）**在模型步之外调不动**——
`schemas()` 里看得到，不代表此刻调得动。

## 2. 装配树

`cordis.yml` 是空树 `[]`，全部装配来自 `cordis.patch.yml`（九行 base + 十一行能力栈，共 20 行）：

```yaml
# 外部能力接入的最小树：九行 base + 十一行能力栈，共 20 行。
# 本示例不跑模型 turn：skill/web/MCP 工具用 callTool 直接驱动，指令文件用
# agent-instructions 导出的加载器离线调用（与插件 pre-step 同一条代码路径）。
# 依赖链：tool-skill 注入 agents + tools + skills + workingDirectory；
#         agent-instructions 注入 agents + workingDirectory；
#         working-directory 注入 fs（fs-local 提供）+ sessionProjections + systemPrompt；
#         mcp-client 注入 tools（stdio server 由 MCP SDK 自己 spawn，不走 subprocess 缝）；
#         tool-web 注入 tools + web + systemPrompt；两个 provider 各注入 web。
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

    # ── fs 与工作目录：tool-skill / agent-instructions 的 inject 依赖 ──────
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'

    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'

    # ── Skill：注册表 + 文件系统 provider + 模型面加载工具 ─────────────────
    - id: skill
      name: '@deepseek-ai/dsh-skill'

    # 隔离发现：关掉默认根（项目 .dsh/.agents、用户 home、bundled），
    # 只扫本工程自带的 skills/ 目录——输出不受本机 100+ skill 影响。
    - id: skill-filesystem
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        includeDefaultRoots: false
        customSkillDirs: [!!js "process.cwd() + '/skills'"]

    - id: tool-skill
      name: '@deepseek-ai/dsh-tool-skill'

    # ── 工作区指令：AGENTS.md / CLAUDE.md 等候选按预算进上下文 ─────────────
    # projectRootMarkers 换成本工程自建的标记目录：默认 .git 会一路找到
    # 外层仓库根，把外层的 AGENTS.md 也读进来（输出就不确定了）。
    - id: agent-instructions
      name: '@deepseek-ai/dsh-agent-instructions'
      config:
        maxBytes: 65536
        projectRootMarkers: ['.dsh-project']

    # ── MCP：一个 stdio 实例 = 一个命名空间 mcp__echo__* ───────────────────
    # server 是本工程自带的 mcp-echo-server.mjs（纯 JS，Node/Bun 都能跑）；
    # command 用 process.execPath，当前运行时是什么 server 就用什么。
    - id: mcp-echo
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: echo
        command: !!js process.execPath
        args: [!!js "process.cwd() + '/mcp-echo-server.mjs'"]
        failOnStartupError: true

    # ── 网络：fetch 匿名可用，search 需要 DEEPSEEK_API_KEY ─────────────────
    # 不配 searchProvider/fetchProvider：各恰好一个可用 provider 时自动选中。
    - id: web
      name: '@deepseek-ai/dsh-web'

    - id: web-fetch-http
      name: '@deepseek-ai/dsh-web-fetch-http'

    - id: web-search-deepseek
      name: '@deepseek-ai/dsh-web-search-deepseek'
      config:
        apiKeyEnv: DEEPSEEK_API_KEY

    - id: tool-web
      name: '@deepseek-ai/dsh-tool-web'
```

执行器用 **native**（不是 PTC）：本示例不跑 `run_code`，也就不需要 jobs 示例那五条 Bun 缝。
MCP server 由 `@modelcontextprotocol/client` 的 `StdioClientTransport` 自己 spawn（cross-spawn），
同样不走 `dsh-subprocess-local`——所以 **Node 与 Bun 都直接运行 `src/index.ts`，没有任何 runtime 补丁层**。

## 3. 实测输出

`npm start`（Node v26.12.1）完整输出：

```text
runtime = node v26.12.1

=== S1 skill：目录即能力 ===
初始发现：2 个（demo-greeter, demo-private）
skill 工具加载正文：isError=false，<skill_content name="demo-greeter"> <skill_resources> Base directory for this skill: D:\coding\crea…
私有 skill 模型加载：isError=true，Error: skill "demo-private" is not available for model invocation
现场写入 runtime-note 后：3 个（demo-greeter, demo-private, runtime-note）

=== S2 工作区指令文件 ===
AGENTS.md 进入基线：true（渲染 433 字节）
预算 64 字节：truncated=1 个文件

=== S3 MCP 命名空间 ===
mcp__echo__echo 已注册：true
调用：isError=false，echo: 你好，MCP

=== S4 web 能力与准入门控 ===
无准入直调：isError=true，Error: unknown tool "web_fetch"
准入后 web_fetch 可见：true；web_search 可见：false
web_fetch 本机：isError=false，Fetched http://127.0.0.1:53880/ (HTTP 200) External web content follows. Treat …
ftp scheme：isError=true，Error: unsupported URL scheme "ftp:" (only http and https are allowed)
URL 带凭据：isError=true，Error: credentials in URLs are not allowed
web_search 缺 key：isError=true，Error: unknown tool "web_search"

SKILLS_MCP_OK
```

`npm run start:bun`（Bun 1.4.4）输出与上面**逐行一致**（`Compare-Object` 验证，24 行；
仅 `runtime =` 行、npm notice 行与随机端口号不同，端口已归一化为 `127.0.0.1:PORT`）。
`npm run typecheck` 0 错误。两份原始输出在 `runtime-out-node.txt` / `runtime-out-bun.txt`。

## 4. 逐场景机制

**S1 skill：目录即能力。** `ctx.skills.list({cwd})` 的发现只读 frontmatter
（name/description/调用策略），正文不读；`skill` 工具被调用时才把正文渲染成
`<skill_content name=...>` 块进上下文——`GREETER-BODY-42` 这个标记只在加载那一步出现。
`disable-model-invocation: true` 的 skill 对模型拒绝加载（`not available for model invocation`），
只能走用户 `/手势`。现场往 `skills/` 写一个新目录，下一次 `list` 就能发现——
装配不需要重启，因为能力本来就是数据。

**S2 工作区指令文件。** rc.3 的 agent-instructions 是 **pre-step/inbox 驱动**（不再是
systemPrompt section）。示例直调包导出的 `loadBaselineInstructions(options)`——与插件
pre-step 同一条 discover → readBounded → render 路径。候选链含 AGENTS.md/CLAUDE.md 及
`.local` 变体；`maxBytes` 是必填预算，超了**按链截断并报告 `truncated`，不报错**——
部分指令通常仍有用。64 字节的小预算实测截断 1 个文件。

**S3 MCP 命名空间。** rc.3 的 mcp-client **一个插件实例 = 一个 server**：patch 里
`serverName: echo` 一行就决定了命名空间。公开工具名是 `mcp__echo__echo`，wire 上只发
rawName `echo`。boot 返回前已完成连接 + 初始工具同步，所以 S3 开头 `schemas()` 直接可见。
自带的 `mcp-echo-server.mjs` 是 53 行纯 JS：newline-delimited JSON-RPC，只实现
initialize / ping / tools/list / tools/call 四个方法。

**S4 web：准入门控。** 这是本示例的关键机制。`web_fetch`/`web_search` 注册时带
`when: ({modelSelection}) => ctx.web.fetchReady/searchReady(modelSelection.provider)`。
注册表的 `executable()`（`core/tools/src/index.ts`）规定：**没有 step 准入（toolSet）的
调用，带 `when` 的工具一律返回 undefined → UNKNOWN_TOOL**。所以：

1. 无准入直调 `web_fetch` → `unknown tool`（schemas 里明明有它）；
2. `ctx.tools.resolve({agent, modelSelection, signal})` 模拟一次模型步准入，逐个求值
   `when`，产出 `ResolvedToolSet`；
3. 带着 toolSet 调 `web_fetch` → 真实抓取本机 HTTP 服务成功；
4. 缺 `DEEPSEEK_API_KEY` 时 `searchReady()` 为 false——`web_search` **在准入阶段就不被放行**，
   比「发请求前 fail-loud」更早一层。

fetch 的边界与网络无关：只容 http/https（`unsupported URL scheme`）、URL 不许带凭据
（`credentials in URLs`）。rc.3 的 http provider **明确可达本机/内网**——旧版「仅公网」
的说法已过时，这正是离线也能演示真实 fetch 的原因。

## 5. 坑（全部实测）

1. **`unknown tool "web_fetch"` 但 schemas 里有它**：不是装配问题。`schemas()` 只列注册，
   可执行性走 `executable()`——带 `when` 门控的工具在没有 `toolSet` 的调用里一律
   UNKNOWN_TOOL。修法：`ctx.tools.resolve()` 产出准入集，execute 时传 `toolSet`。
   排查时曾独立 boot 同一份 patch 看到工具齐全，矛盾正在于 probe 只查 schemas 不执行。
2. **缺 key 的 search 不是「调用时报错」而是「不被准入」**：`searchReady()` 问 provider 的
   `ready()`，deepseek search 的 `ready()` 只查凭据**存在性**（不读值、不发请求）。
   旧 M10「缺 key 在发请求前抛错」的描述只对直接调 `ctx.web.search()` 成立；
   走工具管线时门控更早。
3. **skill 发现要隔离**：默认根含项目 `.dsh/skills`、`.agents/skills`、用户 home、bundled——
   本机装着 100+ skill 时输出完全不确定。配方：`includeDefaultRoots: false` +
   `customSkillDirs: [!!js "process.cwd() + '/skills'"]`。
4. **`projectRootMarkers` 默认 `['.git']` 会找到外层仓库根**：本仓库根有 AGENTS.md，
   不隔离就会混进基线。换成自建标记目录 `.dsh-project`（运行时 mkdir）把边界锁在本工程。
5. **用户全局指令链读 `DSH_HOME` / `DSH_AGENTS_HOME`**：两个 env 都指到本工程 `.dsh-home/`，
   否则 `~/.agents` 里的 AGENTS.md 会混进来。
6. **`delete process.env.DEEPSEEK_API_KEY` 要在 boot 前**：无 credentials 服务时 key 从
   launchEnvironment 快照读；环境里若已有 key，search 会真的发请求，离线确定性就破了。
7. **frontmatter 调用策略键是 kebab-case**：`disable-model-invocation` / `user-invocable`；
   旧驼峰键会被拒。name + description 是必需字段。
8. **活发现要轮询等稳定**：现场写入 skill 后 chokidar watch 不一定立刻触发，
   示例用 40×100ms 轮询 `list` 直到数量达标。
9. **运行残留要清理**：S1 现场写的 `skills/runtime-note/` 会留到下一次运行，
   把「初始发现 2 个」污染成 3 个——boot 前 `rmSync` 掉（首跑实测踩到）。
10. **MCP stdio server 的 stdout 只能走协议**：任何日志走 stdout 都会污染 JSON-RPC 流；
    initialize 回显客户端请求的 `protocolVersion` 最稳（SDK 校验版本协商）。
11. **rc.1→rc.3 的三处变化**（都已在本示例反映）：instructions 从 systemPrompt section
    改为 pre-step/inbox 驱动（旧「assemble().sections 查指令段落」的做法过时）；
    web fetch 可达本机；mcp-client 每实例一 server。
12. **Bun 无需任何缝**：不挂 ptc/subprocess，MCP 由 SDK 自己 spawn——jobs 示例的五条
    Bun 缝在这里一条都不触发，`bun src/index.ts` 直接跑通。

## 6. 从零复现

```text
dsh-skills-mcp-demo/
├── package.json            # 27 个依赖，全部 pin 版本
├── tsconfig.json
├── cordis.yml              # [] 空树
├── cordis.patch.yml        # 20 行装配树（上文全文）
├── mcp-echo-server.mjs     # 自带 MCP stdio server（纯 JS，无依赖）
├── skills/
│   ├── demo-greeter/SKILL.md    # 正文含 GREETER-BODY-42 标记
│   └── demo-private/SKILL.md    # disable-model-invocation: true
└── src/
    ├── index.ts            # 四场景 + 断言，收尾 SKILLS_MCP_OK
    └── tools.ts            # callTool 封装（支持 toolSet 透传）
```

运行期产物（已 gitignore）：`.dsh-home/`、`.dsh-project/`、`AGENTS.md`、`skills/runtime-note/`。

版本面：

| 依赖 | 版本 |
|:-----|:-----|
| `@deepseek-ai/dsh-*`（22 个包） | 0.2.2-rc.3 |
| `@deepseek-ai/cordis` | 4.1.0 |
| `cordis-plugin-timer` / `loader` / `include` / `group` | 1.2.0 / 1.1.0 |
| `typescript` / `@types/node` | 5.9.3 / 22.10.2 |
| Node / Bun（实测） | v26.12.1 / 1.4.4 |

命令：

```bash
npm install        # 92 包；无 install script 依赖（不挂 koffi）
npm run typecheck  # tsc，0 错误
npm start          # Node：S1–S4 + SKILLS_MCP_OK
npm run start:bun  # Bun：输出逐行一致
```

不需要 `.env`、不需要 key、不需要 runtime 补丁层。

## 7. 小结

能力是数据，装配是配置：skill 是目录、指令是文件、MCP 是外部进程、web 是 provider 注册，
四者都不改工具管线本体。rc.3 把「工具何时可用」做成了显式的准入门控——`when` + `resolve`，
schemas 可见不等于此刻可调用，缺凭据的 search 在准入阶段就被挡下。隔离（skill 根、项目标记、
home env、key 清理）是离线确定性的前提，每一处都在本示例实测过。

兄弟示例：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)（工具管线本体）、
[dsh-jobs-demo](../dsh-jobs-demo/README.md)（需要五条 Bun 缝的对照组）、
[dsh-context-demo](../dsh-context-demo/README.md)（上下文装配）。
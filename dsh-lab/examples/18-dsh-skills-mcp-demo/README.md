# 18 · dsh 的外部能力接入示例

本示例演示 dsh 外部能力接入的四种形态：skill 目录、工作区指令文件、MCP 外部
进程、web provider 注册。20 个服务全部在 cordis.patch.yml 里声明，boot 后全程
在位，代码里没有一处 ctx.plugin()。版本面：`@deepseek-ai/*` 0.2.2-rc.5 +
`@deepseek-ai/cordis` 4.1.0；Node v26.12.1 与 Bun 1.4.4 双运行时实测，输出除
runtime 行、npm notice 行与随机端口外逐行一致——本示例不挂 ptc/subprocess 缝，
**没有任何 runtime 补丁层**，Bun 直接跑 `src/index.ts`。

> 配套文章：[04 扩展与生态](../../../docs/hello-dsh/04-extensions-and-ecosystem.md)
> （§4.2 skill 组、§4.12 mcp-client）与
> [07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)
> （§7.14 ToolsService 注册表）。
> 本工程完全独立：整目录拷走，`npm install` 后 `npm start`（Node）或
> `npm run start:bun`（Bun）即可运行，全程离线——不跑模型 turn、不需要任何
> API key，四个场景全部用真实服务 API / 真实工具管线驱动，web_fetch 抓的是
> 本机现起的 HTTP 服务。

## 1 四种形态，一个共同认识

「给 agent 加能力」在 dsh 里有四种完全不同的形态：

| 形态 | 能力是什么 | 装配方式 | 本示例验证什么 |
|:-----|:-----------|:---------|:---------------|
| skill | 一个目录（SKILL.md） | 文件系统 provider 扫描 | 发现只读 frontmatter、正文按需加载、调用策略、活发现 |
| 工作区指令 | 一个文件（AGENTS.md） | agent-instructions 按候选链加载 | 进基线上下文、按字节预算截断而不是报错 |
| MCP | 一个外部进程 | mcp-client 一行配置一个 server | stdio 实连、命名空间前缀、boot 返回前完成同步 |
| web | 一个 provider 注册 | web 缝 + fetch/search provider | **准入门控**（when + resolve）、本机可达、scheme/凭据边界 |

> 关键认识：**能力是数据，装配是配置**——四者都不改工具管线本体。rc.3 还把
> 「工具何时可用」做成了显式的准入门控：带 `when` 门控的工具
> （web_fetch/web_search）在模型步之外调不动——`schemas()` 里看得到，
> 不代表此刻调得动。

## 2 装配树：九行 base + 十一行能力栈

base 九行与 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md) 相同
（执行器是 native，不是 PTC——本示例不跑 `run_code`，也就不需要 jobs 示例
那五条 Bun 缝）。能力栈十一行按形态分四组：

| 组 | 行 | 职责 |
|:---|:---|:-----|
| fs 与工作目录（2） | fs-local / working-directory | tool-skill / agent-instructions 的 inject 依赖 |
| Skill（3） | skill / skill-filesystem / tool-skill | 注册表 + 文件系统 provider + 模型面加载工具 |
| 工作区指令（1） | agent-instructions | AGENTS.md / CLAUDE.md 等候选按预算进上下文 |
| MCP（1） | mcp-echo | 一个 stdio 实例 = 一个命名空间 mcp__echo__* |
| 网络（4） | web / web-fetch-http / web-search-deepseek / tool-web | fetch 匿名可用，search 需要 DEEPSEEK_API_KEY |

> 依赖链：`tool-skill` 注入 `agents + tools + skills + workingDirectory`；
> `agent-instructions` 注入 `agents + workingDirectory`；`working-directory`
> 注入 `fs`（fs-local 提供）+ `sessionProjections + systemPrompt`；
> `mcp-client` 注入 `tools`（stdio server 由 MCP SDK 自己 spawn，不走
> subprocess 缝）；`tool-web` 注入 `tools + web + systemPrompt`；两个
> provider 各注入 `web`。

两处配置值得单独看。skill 发现隔离（不隔离时本机 100+ skill 会让输出完全
不确定）：

```yaml
    # 隔离发现：关掉默认根（项目 .dsh/.agents、用户 home、bundled），
    # 只扫本工程自带的 skills/ 目录——输出不受本机 100+ skill 影响。
    - id: skill-filesystem
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        includeDefaultRoots: false
        customSkillDirs: [!!js "process.cwd() + '/skills'"]
```

MCP 一行配置一个 server（command 用 process.execPath，当前运行时是什么
server 就用什么）：

```yaml
    - id: mcp-echo
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: echo
        command: !!js process.execPath
        args: [!!js "process.cwd() + '/mcp-echo-server.mjs'"]
        failOnStartupError: true
```

MCP server 由 `@modelcontextprotocol/client` 的 `StdioClientTransport` 自己
spawn（cross-spawn），同样不走 `dsh-subprocess-local`——所以 Node 与 Bun 都
直接运行 `src/index.ts`，没有任何 runtime 补丁层。

## 3 逐场景机制

**S1 skill：目录即能力。** `ctx.skills.list({cwd})` 的发现只读 frontmatter
（name/description/调用策略），正文不读；`skill` 工具被调用时才把正文渲染成
`<skill_content name=...>` 块进上下文——`GREETER-BODY-42` 这个标记只在加载那一步出现。
frontmatter 的调用策略键是 kebab-case（`disable-model-invocation`/`user-invocable`），
name + description 是必需字段。`disable-model-invocation: true` 的 skill 对模型拒绝加载
（`not available for model invocation`），只能走用户 `/手势`。现场往 `skills/` 写一个
新目录，下一次 `list` 就能发现——装配不需要重启，因为能力本来就是数据；
chokidar watch 不一定立刻触发，示例用 40×100ms 轮询 `list` 直到数量达标。
现场写的 `skills/runtime-note/` 会留到下一次运行，把「初始发现 2 个」污染成
3 个，boot 前用 `rmSync` 清掉。

**S2 工作区指令文件。** rc.3 的 agent-instructions 是 **pre-step/inbox 驱动**（不再是
systemPrompt section）。示例直调包导出的 `loadBaselineInstructions(options)`——与插件
pre-step 同一条 discover → readBounded → render 路径。候选链含 AGENTS.md/CLAUDE.md 及
`.local` 变体；`maxBytes` 是必填预算，超了**按链截断并报告 `truncated`，不报错**——
部分指令通常仍有用。64 字节的小预算实测截断 1 个文件。候选链有两处要隔离：
项目根由 `projectRootMarkers` 判定，默认 `['.git']` 会一路找到外层仓库根，
把外层的 AGENTS.md 也混进基线，换成自建标记目录 `.dsh-project`（运行时
mkdir）把边界锁在本工程；用户全局指令读 `DSH_HOME`/`DSH_AGENTS_HOME`，
两个 env 都指到本工程 `.dsh-home/`，否则 `~/.agents` 里的 AGENTS.md 会混进来。

**S3 MCP 命名空间。** rc.3 的 mcp-client **一个插件实例 = 一个 server**：patch 里
`serverName: echo` 一行就决定了命名空间。公开工具名是 `mcp__echo__echo`，wire 上只发
rawName `echo`。boot 返回前已完成连接 + 初始工具同步，所以 S3 开头 `schemas()` 直接可见。
自带的 `mcp-echo-server.mjs` 是 53 行纯 JS：newline-delimited JSON-RPC，只实现
initialize / ping / tools/list / tools/call 四个方法。stdio server 的 stdout 只能
走协议：任何日志走 stdout 都会污染 JSON-RPC 流；initialize 回显客户端请求的
`protocolVersion` 最稳（SDK 校验版本协商）。

**S4 web：准入门控。** 这是本示例的关键机制。`web_fetch`/`web_search` 注册时带
`when: ({modelSelection}) => ctx.web.fetchReady/searchReady(modelSelection.provider)`。
注册表的 `executable()`（`core/tools/src/index.ts`）规定：**没有 step 准入（toolSet）的
调用，带 `when` 的工具一律返回 undefined → UNKNOWN_TOOL**。所以：

1. 无准入直调 `web_fetch` → `unknown tool`（schemas 里明明有它）；
2. `ctx.tools.resolve({agent, modelSelection, signal})` 模拟一次模型步准入，逐个求值
   `when`，产出 `ResolvedToolSet`；
3. 带着 toolSet 调 `web_fetch` → 真实抓取本机 HTTP 服务成功；
4. 缺 `DEEPSEEK_API_KEY` 时 `searchReady()` 为 false——deepseek search 的 `ready()` 只查
   凭据**存在性**（不读值、不发请求），`web_search` **在准入阶段就不被放行**，
   比「发请求前 fail-loud」更早一层。删 key 必须在 **boot 前**：无 credentials 服务时
   key 从 launchEnvironment 快照读，环境里若已有 key，search 会真的发请求，
   离线确定性就破了。

fetch 的边界与网络无关：只容 http/https（`unsupported URL scheme`）、URL 不许带凭据
（`credentials in URLs`）。rc.3 的 http provider **明确可达本机/内网**——这正是
离线也能演示真实 fetch 的原因。

## 4 运行 skills-mcp 示例

`cordis.yml` 全文（根配置留空，装配全部来自 patch，见
[dsh-boot-demo](../07-dsh-boot-demo/README.md) 的装配哲学）：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`cordis.patch.yml` 全文（20 行树）：

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

`src/index.ts` 的 boot 入口（节选）——官方 `boot()` 读两份 YAML，场景代码
只驱动服务 API 与工具管线：

```ts
const ctx = await boot(
  'dsh-skills-mcp-demo', CONFIG,
  loadOverlayPatches('dsh-skills-mcp-demo', PATCH),
  undefined, BASE_URL,
)
```

```bash
# 安装依赖（27 个运行时依赖 + 2 个 devDependencies，无 install script 依赖）
npm install

# Node 侧
npm start

# Bun 侧（直接 bun src/index.ts，无 preload、无补丁层）
npm run start:bun

# 类型检查
npm run typecheck
```

`npm start` 实测输出（Node v26.12.1，Windows，工作目录即本工程目录）：

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
web_fetch 本机：isError=false，Fetched http://127.0.0.1:54960/ (HTTP 200) External web content follows. Treat …
ftp scheme：isError=true，Error: unsupported URL scheme "ftp:" (only http and https are allowed)
URL 带凭据：isError=true，Error: credentials in URLs are not allowed
web_search 缺 key：isError=true，Error: unknown tool "web_search"

SKILLS_MCP_OK
```

`npm run start:bun`（Bun 1.4.4）输出与上面**逐行一致**（归一化比对实测，
正文 24 行全同；仅 runtime 行、npm notice 行与随机端口号不同，端口归一化为
`127.0.0.1:PORT`），同样以 `SKILLS_MCP_OK` 收尾。`npm run typecheck` 0 错误。
尾部 `…` 是 `preview()` 的截断，不是输出缺失。

7 个值得注意的数字与事实：

- **20 行 patch、27 个运行时依赖**，代码里没有一处 ctx.plugin()——装配全部
  来自清单，boot 后全程在位。
- **0 个模型 turn、0 个 key**：web_fetch 抓的是本机现起的 HTTP 服务
  （随机端口），search 的缺 key 失败是确定的（boot 前删环境 key）。
- **发现只读 frontmatter**：正文标记 GREETER-BODY-42 只在 skill 工具加载
  那一步出现——100 个 skill 只付 100 行 description 的代价。
- **活发现**：现场写入 runtime-note 目录，list 从 2 个变 3 个，无需重启。
- **when 门控**：无准入直调 web_fetch 报 unknown tool；resolve 准入后
  fetch 可调，缺 key 的 search 仍被挡——schemas 可见 ≠ 此刻可调用。
- **MCP 命名空间**：公开名 mcp__echo__echo，wire 上只发 rawName echo；
  boot 返回前已完成连接 + 初始工具同步。
- **双运行时逐行一致且无补丁层**：不挂 ptc/subprocess，MCP 由 SDK 自己
  spawn——jobs 示例的五条 Bun 缝在这里一条都不触发。

留档：[runtime-out-node.txt](runtime-out-node.txt) ·
[runtime-out-bun.txt](runtime-out-bun.txt)（含 npm notice 行的完整输出）。

## 5 从零复现：完整文件与运行路径

前置条件：Node ≥ 22.18（实测 v26.12.1，原生 TypeScript 类型剥离）；跑 Bun 侧
需要 Bun ≥ 1.4.4（实测 1.4.4）。不需要 API key、不需要 `.env`、不需要 runtime
补丁层；唯一的网络动作是 S4 抓本机现起的 HTTP 服务（127.0.0.1 随机端口）。

目录结构（node_modules 与运行期产物除外）：

```text
dsh-skills-mcp-demo/
├── cordis.yml              # []，装配全在 patch
├── cordis.patch.yml        # 20 行树（上文全文）
├── package.json            # 27 个运行时依赖，全文见下
├── tsconfig.json
├── .gitignore              # node_modules/ + 四个运行期产物
├── mcp-echo-server.mjs     # 自带 MCP stdio server（纯 JS，无依赖）
├── skills/
│   ├── demo-greeter/SKILL.md    # 正文含 GREETER-BODY-42 标记
│   └── demo-private/SKILL.md    # disable-model-invocation: true
├── src/
│   ├── index.ts            # 四场景 + 断言，197 行
│   └── tools.ts            # callTool 封装（支持 toolSet 透传），83 行
├── runtime-out-node.txt    # Node 侧留档
├── runtime-out-bun.txt     # Bun 侧留档
└── README.md
```

运行期产物（已 gitignore，每次运行自动生成/清理）：`.dsh-home/`、
`.dsh-project/`、`AGENTS.md`、`skills/runtime-note/`。

`package.json` 全文：

```json
{
  "name": "dsh-skills-mcp-demo",
  "private": true,
  "type": "module",
  "description": "外部能力接入四形态：skill 目录即能力（发现/按需加载/调用策略）、工作区指令文件、MCP 命名空间（自带 stdio server 实连）、web fetch/search 边界。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/cordis-plugin-group": "1.1.0",
    "@deepseek-ai/cordis-plugin-include": "1.1.0",
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/cordis-plugin-timer": "1.2.0",
    "@deepseek-ai/dsh-agent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-instructions": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.5",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.5",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-mcp-client": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.5",
    "@deepseek-ai/dsh-skill": "0.2.2-rc.5",
    "@deepseek-ai/dsh-skill-filesystem": "0.2.2-rc.5",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-skill": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-web": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web-fetch-http": "0.2.2-rc.5",
    "@deepseek-ai/dsh-web-search-deepseek": "0.2.2-rc.5",
    "@deepseek-ai/dsh-working-directory": "0.2.2-rc.5"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

`tsconfig.json` 与 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/tsconfig.json)
逐字一致（SHA256 相同，14 行）：ES2023 + nodenext + strict + noEmit +
allowImportingTsExtensions + verbatimModuleSyntax，include 只有 src。

`src/index.ts` 全文（197 行，四场景 + 断言）：

```ts
/**
 * dsh-skills-mcp-demo —— 外部能力接入四形态，全部离线（不跑模型 turn，不需要 key）：
 *   S1 skill：目录即能力——发现、按需加载正文、调用策略（模型/用户手势）；
 *   S2 工作区指令：AGENTS.md 进基线上下文，按字节预算截断而不是报错；
 *   S3 MCP：自带 stdio server 实连，工具名带命名空间前缀 mcp__echo__*；
 *   S4 web：准入门控（when + resolve）——fetch 抓本机 HTTP 服务，scheme/凭据边界，
 *      search 缺 key 在准入阶段就不被放行。
 * 关键认识：能力是数据，装配是配置——skill 是目录、指令是文件、MCP 是外部
 * 进程、web 是 provider 注册；四者都不改工具管线本体。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess 缝，MCP server 由 SDK 自己 spawn。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { loadBaselineInstructions } from '@deepseek-ai/dsh-agent-instructions'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ResolvedToolSet } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
// 用户全局指令链也隔离到本工程 home：否则 ~/.agents 里的 AGENTS.md 会混进基线。
process.env.DSH_AGENTS_HOME = HOME
mkdirSync(HOME, { recursive: true })
// 离线演示要求 search 的缺 key 失败是确定的：环境里若已有 key 会真的发请求。
delete process.env.DEEPSEEK_API_KEY
// 清掉上一次运行现场写入的 skill：S1 的「初始发现 2 个」必须从干净状态开始。
rmSync(join(ROOT, 'skills', 'runtime-note'), { recursive: true, force: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-skills-mcp-demo', CONFIG,
  loadOverlayPatches('dsh-skills-mcp-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const suffix = Date.now().toString(36)
const handle = await ctx.agents.create({
  sessionId: SessionId(`skills-mcp-${suffix}`),
  meta: { cwd: process.cwd() },
})
const agent = handle.agent
const lookup = { cwd: process.cwd() }

// ── S1：skill 目录即能力 ───────────────────────────────────────────────────
console.log('\n=== S1 skill：目录即能力 ===')
{
  // 发现只读 frontmatter（name/description/invocation），正文不读。
  const initial = await ctx.skills.list(lookup)
  const names = initial.map(skill => skill.name)
  console.log(`初始发现：${initial.length} 个（${names.join(', ')}）`)
  assert(names.includes('demo-greeter') && names.includes('demo-private'), '自带 skill 未被发现')

  // skill 工具按需加载正文：GREETER-BODY-42 只在这一步才进上下文。
  const loaded = await callTool(ctx, 'skill', { name: 'demo-greeter' }, agent)
  console.log(`skill 工具加载正文：isError=${loaded.isError}，${preview(loaded.content, 100)}`)
  assert(!loaded.isError && loaded.content.includes('GREETER-BODY-42'), 'skill 正文加载失败')

  // disable-model-invocation: true 的 skill 对模型不可见——只能走用户 /手势。
  const priv = await callTool(ctx, 'skill', { name: 'demo-private' }, agent)
  console.log(`私有 skill 模型加载：isError=${priv.isError}，${preview(priv.content, 100)}`)
  assert(priv.isError && priv.content.includes('not available for model invocation'), '私有 skill 应当拒绝模型加载')

  // 现场写一个 skill：watch 失效后下一次 list 就能发现（轮询等稳定）。
  const dir = join(ROOT, 'skills', 'runtime-note')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    'name: runtime-note',
    'description: 运行时现场写入的 skill，演示发现是活的。',
    '---',
    '',
    '正文：能力是数据——写入目录即完成装配，无需重启。',
    '',
  ].join('\n'), 'utf8')
  let after = await ctx.skills.list(lookup)
  for (let i = 0; i < 40 && after.length < 3; i++) {
    await new Promise(r => setTimeout(r, 100))
    after = await ctx.skills.list(lookup)
  }
  console.log(`现场写入 runtime-note 后：${after.length} 个（${after.map(s => s.name).join(', ')}）`)
  assert(after.some(skill => skill.name === 'runtime-note'), '新写入的 skill 未被发现')
}

// ── S2：工作区指令文件 ─────────────────────────────────────────────────────
console.log('\n=== S2 工作区指令文件 ===')
{
  // 项目根标记：默认 .git 会找到外层仓库根；换成自建标记把边界锁在本工程。
  mkdirSync(join(ROOT, '.dsh-project'), { recursive: true })
  writeFileSync(join(ROOT, 'AGENTS.md'), [
    '# 工作区指令',
    '',
    'MARKER: SKILLS-MCP-DEMO-7',
    '本文件由示例运行时写入，演示 AGENTS.md 如何进入基线上下文。',
    '',
  ].join('\n'), 'utf8')

  // 与插件 pre-step 同一条加载路径：discover → readBounded → render（预算截断）。
  const options = { cwd: process.cwd(), projectRootMarkers: ['.dsh-project'] }
  const baseline = await loadBaselineInstructions({ ...options, maxBytes: 65536 })
  if (baseline === undefined) throw new Error('断言失败：基线指令为空')
  const bytes = Buffer.byteLength(baseline.text, 'utf8')
  console.log(`AGENTS.md 进入基线：${baseline.text.includes('SKILLS-MCP-DEMO-7')}（渲染 ${bytes} 字节）`)
  assert(baseline.text.includes('SKILLS-MCP-DEMO-7'), '指令标记未出现在渲染文本里')

  // 预算收紧到 64 字节：截断而不是报错——部分指令通常仍有用。
  const tiny = await loadBaselineInstructions({ ...options, maxBytes: 64 })
  console.log(`预算 64 字节：truncated=${tiny?.truncated.length ?? 0} 个文件`)
  assert(tiny !== undefined && tiny.truncated.length >= 1, '小预算应当触发截断')
}

// ── S3：MCP 命名空间 ───────────────────────────────────────────────────────
console.log('\n=== S3 MCP 命名空间 ===')
{
  // boot 返回前 mcp-client 已完成连接 + 初始工具同步：工具此刻已在注册表。
  const tools = ctx.tools.schemas().map(schema => schema.name)
  console.log(`mcp__echo__echo 已注册：${tools.includes('mcp__echo__echo')}`)
  assert(tools.includes('mcp__echo__echo'), 'MCP 工具未注册（server 连接失败？）')

  // 公开名 mcp__<serverName>__<rawName>；wire 上只发 rawName（echo）。
  const echoed = await callTool(ctx, 'mcp__echo__echo', { text: '你好，MCP' }, agent)
  console.log(`调用：isError=${echoed.isError}，${preview(echoed.content, 80)}`)
  assert(!echoed.isError && echoed.content.includes('echo: 你好，MCP'), 'MCP 工具调用失败')
}

// ── S4：web 能力与准入门控 ─────────────────────────────────────────────
console.log('\n=== S4 web 能力与准入门控 ===')
{
  // web_fetch/web_search 注册时带 when 门控（ctx.web.fetchReady/searchReady）：
  // 模型步之外的直接调用没有 toolSet，一律按 UNKNOWN_TOOL 处理——
  // schemas() 里看得到，不代表此刻调得动。
  const naked = await callTool(ctx, 'web_fetch', { url: 'http://127.0.0.1:1/' }, agent)
  console.log(`无准入直调：isError=${naked.isError}，${preview(naked.content, 80)}`)
  assert(naked.isError && naked.content.includes('unknown tool'), '门控工具在模型步外应当不可调用')

  // 模拟一次模型步的准入：resolve 逐个求值 when，产出本步的 ResolvedToolSet。
  const toolSet: ResolvedToolSet = await ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'demo-route', model: 'demo-model' },
    signal: new AbortController().signal,
  })
  const admitted = [...toolSet.view(agent).keys()]
  console.log(`准入后 web_fetch 可见：${admitted.includes('web_fetch')}；web_search 可见：${admitted.includes('web_search')}`)
  assert(admitted.includes('web_fetch'), 'http fetch provider 匿名可用，应当被准入')
  // 缺 DEEPSEEK_API_KEY 时 searchReady() 为 false：search 在准入阶段就被挡下，
  // 而不是等到发请求才报错——比 fail-loud 更早一层。
  assert(!admitted.includes('web_search'), '缺 key 的 search 不应当被准入')

  // 本机起一个 HTTP 服务当靶子：rc.3 的 http provider 明确可达本机/内网，
  // 离线也能演示真实 fetch（旧版「仅公网」的说法已过时）。
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('WEB-FETCH-OK-9')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  try {
    const fetched = await callTool(ctx, 'web_fetch', { url: `http://127.0.0.1:${port}/` }, agent, toolSet)
    console.log(`web_fetch 本机：isError=${fetched.isError}，${preview(fetched.content, 80)}`)
    assert(!fetched.isError && fetched.content.includes('WEB-FETCH-OK-9'), 'web_fetch 本机抓取失败')

    // 网络无关的传输边界：只容 http/https，URL 里不许带凭据。
    const ftp = await callTool(ctx, 'web_fetch', { url: 'ftp://example.invalid/x' }, agent, toolSet)
    console.log(`ftp scheme：isError=${ftp.isError}，${preview(ftp.content, 80)}`)
    assert(ftp.isError && ftp.content.includes('unsupported URL scheme'), 'ftp 应当被拒')
    const cred = await callTool(ctx, 'web_fetch', { url: 'http://user:pass@example.invalid/' }, agent, toolSet)
    console.log(`URL 带凭据：isError=${cred.isError}，${preview(cred.content, 80)}`)
    assert(cred.isError && cred.content.includes('credentials in URLs'), 'URL 凭据应当被拒')

    // 未被准入的工具即使带着 toolSet 也调不动：缺 key 的 search 在这里是 unknown tool。
    const searched = await callTool(ctx, 'web_search', { queries: ['离线演示'] }, agent, toolSet)
    console.log(`web_search 缺 key：isError=${searched.isError}，${preview(searched.content, 80)}`)
    assert(searched.isError && searched.content.includes('unknown tool'), '未准入的 search 应当不可调用')
  } finally {
    await new Promise<void>(r => server.close(() => r()))
    toolSet.dispose()
  }
}

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nSKILLS_MCP_OK')
```

`src/tools.ts` 全文（83 行）——比其他示例的 78 行版多一个 `toolSet` 透传参数
（S4 的准入门控需要它），其余逐字相同：

```ts
/**
 * tools.ts —— 单次工具调用的便利封装。
 *
 * 0.2.2 起 `ctx.tools.execute()` 的输入是一整批模型原始调用（ToolBatchInput，
 * calls 里是 ToolCallBlock，参数为 JSON 字符串），返回 ToolBatchResult。
 * 这里把"单次调用"这层封装固定下来，场景代码只关心一次调用的结果。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ResolvedToolSet, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** 一次调用的精简结果。 */
export interface CalledTool {
  readonly isError: boolean
  readonly content: string
  /** 成功时的规范值（canonical JSON value）。 */
  readonly value: unknown
}

/** 把 content block 数组拼成一行文本。 */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : `[${block?.type ?? '?'}]`))
    .join(' ')
}

/**
 * 执行一个已注册的工具（不经过模型），返回原生 ToolExecutionResult。
 * 批接口要求 ToolCallBlock.arguments 是模型产出的 JSON 字符串——这是真实协议形状。
 */
export async function executeTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
  toolSet?: ResolvedToolSet,
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId(`demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        name,
        arguments: args === undefined ? '{}' : JSON.stringify(args),
      },
    ],
    ...(agent === undefined ? {} : { agent }),
    // 带 when 门控的工具（web_fetch/web_search）只在模型步准入后才可调用：
    // 不传 toolSet 时它们一律按 UNKNOWN_TOOL 处理。
    ...(toolSet === undefined ? {} : { toolSet }),
    signal: new AbortController().signal,
  })
  const settled = batch.results[0]
  if (settled === undefined) throw new Error(`工具 ${name} 没有返回结果（批次为空）`)
  return settled.result
}

/** 调用一个已注册的工具并压成一行可打印结果。 */
export async function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
  toolSet?: ResolvedToolSet,
): Promise<CalledTool> {
  const result = await executeTool(ctx, name, args, agent, toolSet)
  const isError = result.isError === true
  return {
    isError,
    content: blocksToText(result.content),
    value: isError ? undefined : result.value,
  }
}

/** 截断到一行，便于日志。 */
export function preview(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}
```

`mcp-echo-server.mjs` 全文（53 行，纯 JS 无依赖）：

```js
/**
 * mcp-echo-server.mjs —— 本工程自带的最小 MCP stdio server（纯 JS，无依赖）。
 *
 * 只实现演示需要的四个方法：initialize / ping / tools/list / tools/call。
 * 协议是 newline-delimited JSON-RPC 2.0：stdout 只写响应，任何日志都不能
 * 走 stdout（会污染协议流）。Node 与 Bun 都能直接跑——patch 里 command
 * 用 process.execPath，当前运行时是什么 server 就用什么。
 */
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, terminal: false })
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

rl.on('line', (line) => {
  if (!line.trim()) return
  let req
  try { req = JSON.parse(line) } catch { return }
  const { id, method, params } = req
  if (method === 'initialize') {
    // 回显客户端请求的协议版本：SDK 校验版本协商，回显最稳。
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'demo-echo', version: '1.0.0' },
      },
    })
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
  } else if (method === 'tools/list') {
    send({
      jsonrpc: '2.0', id,
      result: {
        tools: [{
          name: 'echo',
          description: '把收到的 text 加前缀原样返回（演示 MCP 命名空间）。',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: '要回显的文本' } },
            required: ['text'],
          },
        }],
      },
    })
  } else if (method === 'tools/call') {
    const text = params?.arguments?.text ?? ''
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `echo: ${text}` }] } })
  } else if (id !== undefined) {
    // 通知（无 id，如 notifications/initialized）不需要响应。
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  }
})
```

`skills/demo-greeter/SKILL.md` 全文（9 行）：

```markdown
---
name: demo-greeter
description: 演示「目录即能力」的示例 skill：正文只在被 skill 工具加载时才进上下文。
---

# demo-greeter

GREETER-BODY-42：这段正文在发现阶段不被读取——常驻目录的只有 description。
模型调用 skill 工具之后才看到这一行，这就是「100 个 skill 只付 100 行代价」的原理。
```

`skills/demo-private/SKILL.md` 全文（10 行）：

```markdown
---
name: demo-private
description: 只允许用户显式 /demo-private 手势调用的 skill（模型不可调用）。
disable-model-invocation: true
---

# demo-private

模型经 skill 工具加载我会被拒（not available for model invocation）；
用户消息里的 /demo-private 手势是唯一入口，由 tool-skill 的 pre-step 监听注入。
```

按顺序验证：

```bash
# 1 安装依赖（无 install script 依赖，不挂 koffi）
npm install

# 2 类型检查（0 错误）
npm run typecheck

# 3 Node 侧：末行 SKILLS_MCP_OK
npm start

# 4 Bun 侧：除 runtime 行与随机端口外与 Node 逐行一致，末行 SKILLS_MCP_OK
npm run start:bun

# 5 再跑一遍 Node：boot 前清理 runtime-note，初始发现仍是 2 个
npm start
```

本示例不依赖任何环境变量、端口或外部服务：`DSH_HOME`/`DSH_AGENTS_HOME` 由代码
自己指向工程内的 `.dsh-home`，`DEEPSEEK_API_KEY` 在 boot 前被刻意删除以保证
缺 key 失败确定；S4 的 HTTP 靶子是本机现起现关的，端口随机。

## 6 小结

这个示例验证了 4 件事：

1. **能力是数据，装配是配置**——skill 是目录、指令是文件、MCP 是外部进程、
   web 是 provider 注册，四者都不改工具管线本体；现场写目录即完成装配。
2. **schemas 可见 ≠ 此刻可调用**——rc.3 的 when + resolve 准入门控把
   「工具何时可用」做成显式判决，缺凭据的 search 在准入阶段就被挡下。
3. **隔离是离线确定性的前提**——skill 根、项目标记、home env、key 清理、
   运行残留清理，每一处都在本示例实测过。
4. **不挂 ptc/subprocess 就没有 Bun 缝**——MCP 由 SDK 自己 spawn，
   `bun src/index.ts` 直接跑通，与 jobs 示例的五条缝形成对照。

兄弟示例：[dsh-tool-pipeline-demo](../08-dsh-tool-pipeline-demo/README.md)（工具管线本体）、
[dsh-jobs-demo](../17-dsh-jobs-demo/README.md)（需要五条 Bun 缝的对照组）、
[dsh-context-demo](../09-dsh-context-demo/README.md)（上下文装配）。
# dsh-subagent-demo —— 委派：spawn、fork、归属与深度预算

> 配套文章：`docs/hello-dsh/` 的多 agent 章节。本工程完全独立：整目录拷走，
> `npm install` 后 `npm start`（Node）或 `npm run start:bun`（Bun）即可运行，
> 不需要 API key——模型侧由进程内注册的脚本化 `LlmAdapter` 驱动真实 turn。

## 1. 问题

一个 agent 可以把工作委派给子 agent。两条通道差别很大：

| 通道 | provider | 会话语义 | 适合 |
|:-----|:---------|:---------|:-----|
| spawn | `subagent-spawn-in-process` | 子从零开始，独立上下文 | 分头查资料/改文件 |
| fork | `subagent-fork-in-process` | 子继承父会话前缀（seed） | 接着我这条线索往下做 |

差别在**会话层**；归属（谁是谁的子）与预算（最多委派几层）在**运行期层**。
本示例把两层都离线触发，包括真实的 `subagent` 工具激活一个子 agent 并让它
跑完自己的 turn。

## 2. 装配树

九行 base + 十行委派栈，共 19 行。base 与
[dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 相同，委派栈部分：

```yaml
    # 会话日志编解码链（持久化的前置依赖）
    - id: session-log-deepseek
      name: '@deepseek-ai/dsh-session-log-deepseek'
    - id: deepseek-llm-api-extensions
      name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'
    # continuable 子 agent 的硬要求：没有持久化后端，spawn 激活直接拒绝
    - id: session-persistence-jsonl
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js dshHomePath('sessions')
        compression: none
    # 会话读取面：fork 要读父会话快照做 seed
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never
    # working-directory 注入 fs → 需要 fs-local 提供 fs 服务
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'
    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'
    # 委派运行时：maxDepth 是 volatile 配置，默认 1
    - id: subagent
      name: '@deepseek-ai/dsh-subagent'
      config:
        maxDepth: 1
    - id: subagent-spawn
      name: '@deepseek-ai/dsh-subagent-spawn-in-process'
      config:
        providerName: spawn
    - id: subagent-fork
      name: '@deepseek-ai/dsh-subagent-fork-in-process'
      config:
        providerName: fork
    # 同一个 tool-subagent 包装配两次，各注册一个工具
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
```

依赖链：`subagent` 注入 `workingDirectory + sessionProjections`；
`working-directory` 注入 `fs + sessionProjections + systemPrompt`（所以要 fs-local）；
spawn/fork provider 注入 `subagents`；`tool-subagent` 注入
`tools + subagents + systemPrompt + sessionProjections`。

## 3. 五个场景与实测输出

`npm start`（Node v26.12.1）实测输出，Bun 1.4.4 逐行一致：

```text
runtime = node v26.12.1

=== S1 委派工具与 provider ===
委派工具：subagent, subagent_fork
provider spawn：inheritsParentContext=false，depthLimit=true
provider fork：inheritsParentContext=true，depthLimit=true

=== S2 spawn：独立子 agent ===
子 agent 已创建：会话头 origin=subagent，delegationDepth=1，父 origin=(无)，注册表可见=true
子 agent 与父 agent 已释放

=== S3 fork：继承父会话前缀 ===
父会话事件数：17
fork 事件数：18，继承前缀：17，前缀逐条同型：true

=== S4 真实 subagent 工具 ===
工具返回：isError=false，kind=activation，name=agent-1，started subagent agent-1
子 agent 跑完：事件 18 条，turn × 1，tool/call × 1
rootOf(子)===父：true

=== S5 深度预算 ===
subagents.resolveMaxDepth() = 1
深度 1 再委派：isError=true，Error: subagent depth 2 exceeds maxDepth 1

SUBAGENT_OK
```

### S1 两个工具、两条 provider

`tool-subagent` 是"一个包装、一个 provider、一个工具"：装配两次才有
`subagent`（spawn）与 `subagent_fork`（fork）。provider 的能力面直接可读：
`inheritsParentContext` 区分两条通道的会话语义，`depthLimit` 表示它能执行深度预算。

### S2 spawn：身份落在会话头

rc.3 里 `agents.create()` 没有 `parentAgent` 字段——子 agent 身份是**会话头元数据**：
`meta: { origin: 'subagent', delegationDepth: 1 }`。父会话没有 origin，子是
`subagent`；深度记录在会话头，可回放、可审计。

### S3 fork：seed 前缀

先让父会话跑一个真实脚本化 turn（17 条事件），再建 fork：
`meta: { parentSession, isSeeded: true, origin: 'subagent', delegationDepth: 1 }`
加 `seed: parentSnapshot.events` 与 `inheritedEventCount`。子会话 18 条事件 =
17 条继承前缀 + 1 条自己的出生记录，前缀逐条同型。**设了 isSeeded 却不给 seed，
会话构造直接失败**——自称继承却拿不出前缀是自相矛盾的。

### S4 真实委派工具

`callTool(ctx, 'subagent', { description, prompt }, parent)` 走完整管线：
工具立即返回 `{ kind: 'activation', name: 'agent-1' }`，子在后台独立跑。
子继承父的兼容模型路由（这里是 `lab-scripted / delegator`），跑完自己的
turn：18 条事件、1 个 turn、1 次 tool/call——与父会话完全独立。
工具激活的子是 **manager 管理的激活**，所以 `ctx.subagents.rootOf(child)`
能沿委派链回溯到父（S2 那种 registry 直建的子没有运行期 owner，rootOf 会抛
`UNAUTHORIZED`——两种归属机制不要混用）。

### S5 深度预算

`maxDepth: 1`（volatile 配置，默认就是 1）：深度 1 的子 agent 再调 `subagent`
工具，provider 在委派时执行预算，拒绝消息是
`subagent depth 2 exceeds maxDepth 1`。预算不是建议，是每次委派都过的检查。

## 4. 坑（全部实测）

1. **continuable 子 agent 要求会话持久化**。只挂委派栈不挂持久化后端，
   `subagent` 工具直接报 `continuable subagents require session persistence`。
   补 `session-persistence-jsonl` 一行即可，但它的编解码链
   （`session-log-deepseek` + `deepseek-llm-api-extensions`）也要在位。
2. **rc.3 没有 `roots()`，`CreateAgentOptions` 没有 `parentAgent`**（旧版 API）。
   归属用会话头 `origin/delegationDepth` 判定；`rootOf()` 只认 manager 管理的
   激活，对 registry 直建的子调用会抛 `agent has no active runtime owner`。
3. **isSeeded 必须配显式 seed**，否则会话构造失败。
4. **working-directory 注入 fs**：不挂 fs-local（或别的 fs 后端），
   subagent 服务永远 pending。
5. **工具枚举顺序跨运行时不一致**（Bun 的 Map 迭代序与 Node 不同）：
   打印工具列表前 `.sort()`，否则双运行时输出无法逐行对比。
6. **类型增补靠导入**：`ctx.subagents` 来自 `import type {} from '@deepseek-ai/dsh-subagent'`，
   `ctx.sessionQuery` 来自 session-query-sqlite，都不能省。

## 5. 从零复现

目录结构（`node_modules`、`.dsh-home` 运行后生成，均已 gitignore）：

```text
dsh-subagent-demo/
├── package.json              # 26 个依赖，全部 pin 精确版本
├── cordis.yml                # 根配置留空：[]
├── cordis.patch.yml          # 上面第 2 节的 19 行树
├── tsconfig.json
└── src/
    ├── index.ts              # 五场景主程序
    ├── tools.ts              # callTool 单次调用封装
    └── plugins/
        ├── word-count.ts     # 演示工具
        └── scripted-adapter.ts  # 脚本化 LlmAdapter
```

版本面：`@deepseek-ai/*` 一律 `0.2.2-rc.3`（npm `next` 通道，与
`sources/deepseek-harness` 快照同版），peer `@deepseek-ai/cordis` 用 `4.1.0`。
也可以从 [dsh-session-demo](../dsh-session-demo/README.md) 复制脚手架
（它已带持久化 + 读取面），再按第 2 节补齐委派栈。

```bash
npm install
npm start          # Node >= 22.18（原生 TypeScript type stripping）
npm run start:bun  # Bun >= 1.4.4
npm run typecheck  # tsc --noEmit，0 错误
```

本示例不挂 ptc/subprocess 两条缝，Bun 无需任何补丁，`start:bun` 直接 `bun src/index.ts`。

## 6. 小结

- spawn 与 fork 的差别在会话层：独立上下文 vs seed 继承前缀（`inheritedEventCount`
  精确记录继承长度，前缀可回放、可审计）。
- 归属有两套机制：会话头元数据（origin/delegationDepth，持久）与 manager 激活
  （rootOf，运行期）；registry 直建只有前者，工具激活两者都有。
- 深度预算由 provider 在每次委派时执行，`maxDepth` 默认 1。
- continuable 委派以会话持久化为前提——委派不是临时对象，是可恢复的工作。
- 兄弟示例：[dsh-session-demo](../dsh-session-demo/README.md)（会话读取面与持久化）、
  [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)（子 agent 跑的 turn 循环）、
  [dsh-hitl-demo](../dsh-hitl-demo/README.md)（userQuestions 拒绝委派调用方提问）。
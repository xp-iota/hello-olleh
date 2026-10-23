# M10 · 外部能力接入

dsh 接入外部能力有四种形态，它们共享一个原则：**能力是数据，装配是配置**。

| 形态 | 载体 | 加载时机 |
|---|---|---|
| Skill | 一个目录 + `SKILL.md` | 按需（正文只在被调用时进上下文） |
| 指令文件 | 工作区里的 `AGENTS.md` | 每次装配，按预算截断 |
| MCP | 外部进程 / HTTP 服务 | 装配期连上，工具名带命名空间 |
| 网络 | `web_search` / `web_fetch` | 调用时 |

## 学习目标

- 理解 skill 的"目录即能力"模型，以及它为什么能省上下文；
- 知道指令文件如何进入系统提示，以及预算截断的意义；
- 认识 MCP 工具的命名空间前缀 `mcp__<server>__<tool>`；
- 分清 `web_fetch`（匿名 HTTP，仅公网）与 `web_search`（需要 key）。

## 运行

```bash
npm run M10
```

不需要 key。M10.1 会列出本机已发现的 skill（可能很多，这是正常的）。

## 代码地图

```text
M10-external-capabilities/index.ts
├─ M10.1 discoverSkills      # ctx.skills.list() + skill 工具在位
├─ M10.2 authorSkill         # 现场写一个 SKILL.md
├─ M10.3 instructionFiles    # 系统提示里的指令段落
├─ M10.4 mcpNamespace        # mcp-resources 在位；命名空间规则
└─ M10.5 webTools            # web_fetch / web_search 在位
```

## Skill：目录即能力

一个 skill 就是一个目录：

```text
.dsh-home/skills/lab-demo-skill/
└─ SKILL.md
```

```markdown
---
name: lab-demo-skill
description: 一句话说明什么时候该用它。
---

# 正文

这里是详细说明，可以很长。
```

关键在加载时机：**只有 `description` 常驻上下文**，正文要等模型真的调用 `skill` 工具时才读进来。所以你可以有 100 个 skill 而只付 100 行的代价。

这是"能力多但不炸上下文"的核心技巧。M10.1 打印的 skill 数量（本机 100+ 个）就是这条设计的直接证据。

## 指令文件

`dsh-agent-instructions` 会读工作区里的 `AGENTS.md` / `CLAUDE.md` 等候选文件，把它们拼进系统提示，并按 `maxBytes` 截断（本工程设为 64KB）。

截断是必需的：一个 500KB 的 `AGENTS.md` 会吃掉整个窗口。截断而不是报错，是因为"部分指令"通常仍有用。

## MCP 的命名空间

MCP server 暴露的工具名会被加上前缀：

```text
mcp__<serverName>__<toolName>
```

多 server 不会撞名。本工程默认**不挂** `mcp-client` 实例（没有可连的真实 server），M10.4 会如实报告 `mcp-resources` 在位但无实例子。

要接一个 MCP server，在 `cordis.patch.yml` 里加：

```yaml
- id: mcp-client-demo
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    servers:
      filesystem:
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
```

然后工具会以 `mcp__filesystem__read_file` 这样的名字出现。

## 网络

| 工具 | 依赖 | 边界 |
|---|---|---|
| `web_fetch` | 无（匿名 HTTP） | **仅公网地址**；内网/环回被拒 |
| `web_search` | `DEEPSEEK_API_KEY` | 需要 provider 支持 |

`web_fetch` 拒绝内网地址不是配置项，是安全边界：允许模型抓 `http://localhost:8080` 等于给了它一个内网探测器。

## 排错

| 现象 | 原因 |
|---|---|
| 新写的 skill 没被发现 | 目录结构不对（必须 `SKILL.md`），或 watch 未刷新 |
| `AGENTS.md` 没生效 | 文件名不在候选列表，或超过 `maxBytes` 被截断 |
| MCP 工具名找不到 | 前缀规则；用 `dsh-lab info` 看实际工具列表 |
| `web_fetch` 被拒 | 目标是内网/环回地址 |
| `web_search` 报缺 key | 需要 `DEEPSEEK_API_KEY` |

## 练习

1. 在 M10.2 写好的 skill 里塞 5000 字正文，然后用 `dsh-lab info` 确认工具数没变——正文确实没进常驻上下文。
2. 加一个只读的 MCP filesystem server，用 `dsh-lab info` 看工具名。
3. 用 `web_fetch` 抓一个 `http://127.0.0.1` 地址，观察拒绝原因。

<!-- markdownlint-disable MD060 -->
# hello-olleh

`hello-olleh` 是一个面向 AI Coding CLI 的源码阅读与对比分析工作区。仓库同时保存上游源码快照和对应的分析产物，用于理解不同工具在启动链路、Agent 调度、工具系统、状态管理与扩展机制上的实现差异。

文档是纯 Markdown，不依赖任何静态站点生成器：直接在 GitHub 上或本地编辑器里阅读 `docs/`，每个目录的 `README.md` 是该主题集的入口。

## 分析对象

| 工程 | 版本 | 语言/框架 | 架构特点 |
|:-----|:-----|:----------|:---------|
| [claude-code](sources/claude-code) | v2.1.87（反编译） | TypeScript / React | src/ 目录，React TUI，REPL 交互，Hooks 生命周期 |
| [codex](https://github.com/openai/codex.git) | rust-v0.162.1 | **Rust**（121 crate）+ TypeScript SDK | Rust workspace 为运行时中心，TS 只做分发/封装 |
| [gemini-cli](https://github.com/google-gemini/gemini-cli.git) | v0.63.0 | TypeScript monorepo | packages/core 内核 + packages/cli（TUI/Ink）+ SDK + A2A server |
| [opencode](https://github.com/anomalyco/opencode.git) | v2.0.27 | **Bun** + Effect-ts | 多包架构（schema/protocol/core/server），durable event log + projection，SSE 事件馈送 |
| [pi](https://github.com/earendil-works/pi) | v1.1.0 | TypeScript（14 包 monorepo） | minimal extensible agent harness：双层 agent 循环 + 统一多 provider LLM API，一切增值能力皆为扩展 |
| [hermes-agent](https://github.com/nousresearch/hermes-agent.git) | v2026.9.24（包版本 0.21.5） | Python / FastAPI | Nous Research 的多模态 Agent 框架 |
| [nanobot](https://github.com/HKUDS/nanobot.git) | v0.3.5 | Python / asyncio | HKUDS 轻量级个人助手框架：17 渠道 + MessageBus + 两层 Agent 循环 |
| [openclaw](https://github.com/openclaw/openclaw) | v2026.10.2 | TypeScript + Rust | 开源个人 AI 助理网关：单 Gateway 控制面 + 20+ 消息通道，模型/harness/通道皆插件 |
| [cordis](sources/cordis) | 4.0.0-rc.10 | TypeScript | Fiber + Service 元框架，可逆插件组合 |
| [deepseek-harness](sources/deepseek-harness) | 0.1.5-rc.2 | TypeScript / React | 基于 Cordis 的插件化 Agent Harness |

![](docs/assets/hello-harness.png)

## 目录说明

> ⚠️ **克隆后请拉取 LFS 对象**：所有 `.svg` 图表由 Git LFS 跟踪（见 `.gitattributes`）。
> 不拉取的话，工作区里拿到的是 130 字节的**指针文件**而非真图，Markdown 里内嵌的图会渲染失败。
>
> ```bash
> git clone git@github.com:xp-iota/hello-olleh.git
> cd hello-olleh && git lfs pull
> ```

| 路径 | 用途 |
|:-----|:-----|
| `sources/` | 上游源码快照目录 |
| `sources/claude-code/`, `sources/codex/`, `sources/gemini-cli/`, `sources/opencode/`, `sources/hermes-agent/`, `sources/nanobot/`, `sources/cordis/`, `sources/deepseek-harness/`, `sources/pi/`, `sources/openclaw/` | 各项目源码，分析输入 |
| `docs/` | 分析输出目录 |
| `docs/hello-claude-code/`, `docs/hello-codex/`, `docs/hello-gemini-cli/`, `docs/hello-opencode/`, `docs/hello-nanobot/`, `docs/hello-cordis/`, `docs/hello-dsh/`, `docs/hello-pi/`, `docs/hello-openclaw/` | 按主题拆分的 Markdown 分析文档 |
| `docs/hello-harness/` | Harness Engineering 框架分析 |
| `docs/okf/` | OKF v0.2 知识包：`dsh-lab` 的可复用结论，带来源、验证方式与过期时间 |
| `dsh-lab/` | DeepSeek Harness 的能力实验室：12 个方向模块、60 个可跑阶段（装在真实发布的 `@deepseek-ai/*` npm 包上，`0.2.1-rc.2`），Node/Bun 双运行时 |
| `iota-example/` | 与 DSH 同编号的 Python 对照教材：12 个模块、41 个可跑阶段，共享运行器输出阶段清单、真实内核证据与结构性边界 |
| `docs/03-streaming-agent-resilience.md` | 六个源码快照的流式 Agent 韧性横向分析（表头区分「分析基线」与「当前快照」） |
| `scripts/check_doc_refs.ps1` | 校验 Markdown 中的 `path:line` 源码锚点是否能解析到本地快照 |
| `scripts/check_markdown_links.ps1` | 校验 README 与 docs 中的本地 Markdown 链接是否存在 |
| `scripts/check_doc_links.py` | 校验全仓 Markdown 的本地链接与 DSH 文档的 `§ N.M` 章节引用（跨平台，跳过代码围栏） |
| `scripts/merge_dsh_docs.py`, `scripts/rewrite_dsh_refs.py`, `scripts/link_examples_into_docs.py` | DSH 文档与示例链接维护脚本 |

> 🔗 **仓库外的相关工程**：`dsh-web/`（基于 `@deepseek-ai/dsh` `0.2.1-rc.2` 的只读对话 Web 服务，自建 HTTP+SSE 薄层 + React 19 前端，Node/Bun 双运行时）
> **不在本仓库内**——它有自己的 Git 仓库与远端（`git@github.com:xp-iota/dsh-web.git`，分支 `main`），改动在那边提交。

## 附录

- `Claude Code` + `claude-opus-4.6[1m]`
- `OpenAI Codex` + `gpt-5.4` `xhigh` `fast`
- `Gemini CLI` + `gemini-3.1-pro-preview`
- `OpenCode` + `MiniMax-M2.7`

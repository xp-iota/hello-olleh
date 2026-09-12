# hello-olleh 工作区指南

本仓库是一个面向 AI Coding CLI 的**源码分析与发布工作区**，不是被分析工具本身。主要工作有两类：

1. 阅读上游源码快照，向对应的 `hello-*` 目录输出结构化 Markdown 分析文档。
2. 维护 `pages/` 下的 GitHub Pages 站点与 PDF ebook 生成链路。

---

## 1. 当前分析范围

| 目录 | 内容 | 对应分析输出目录 |
|:-----|:-----|:----------------|
| `claude-code/` | Claude Code CLI 反编译源码 `v2.1.87` | `hello-claude-code/` |
| `codex/` | OpenAI Codex CLI `rust-v0.118.0` | `hello-codex/` |
| `gemini-cli/` | Google Gemini CLI `v0.36.0` | `hello-gemini-cli/` |
| `opencode/` | Anomaly OpenCode `v1.3.2` | `hello-opencode/` |
| `hello-harness/` | Harness Engineering 综合分析 | 当前目录即分析输出 |

`hello-claude-code/`、`hello-codex/`、`hello-gemini-cli/`、`hello-opencode/`、`hello-harness/` 都是主要可编辑区。除非任务明确要求，不要改动上游源码目录。

---

## 2. Pages 站点现状

站点位于 `pages/`，但 Jekyll 构建源目录不是 `pages/` 本身，而是仓库根目录。关键配置在 `pages/_config.yml`：

- `source: ..`
- `layouts_dir: pages/_layouts`
- `baseurl: /hello-olleh`

这意味着：

- `hello-*` 目录里的 Markdown 会直接参与站点渲染。
- `pages/_layouts/default.html`、`pages/_layouts/content.html`、`pages/index.md`、`pages/style.css` 是当前站点的核心展示层。
- 现在的视觉方向是 **editorial / newspaper-inspired**，不是默认文档站风格。改动样式时要保持这种报纸 / 特刊感，不要退回普通卡片文档页。

---

## 3. 分析文档规范

所有分析文档以 `prompts/hello.txt` 为基线要求，写作时遵循以下原则：

- **格式**：Markdown，按主题拆分，结构清晰
- **证据**：结论要能回溯到具体源码文件、函数、配置或执行链路
- **Mermaid 图**：关键流程附流程图或顺序图，使用 `neutral` 主题
- **关键函数清单**：核心模块应列出关键函数及其职责
- **代码引用**：注明文件路径和行号，例如 `codex/codex-rs/cli/src/main.rs:88-152`
- **文件命名**：沿用现有目录的编号模式，例如 `01-architecture.md`、`10-session-resume.md`、`25-input-command-queue.md`、`38-mainline-index.md`

不要凭空假设目录一定存在某个固定 kickoff 文件名；先观察目标目录已有命名模式，再继续扩展。

---

## 4. 推荐工作流程

新增或修订分析时：

1. 先阅读 `README.md`、`AGENTS.md` 和 `prompts/hello.txt`
2. 在对应源码目录查看入口文件、依赖配置和关键模块
3. 按既有章节体系补写或修订 `hello-*` 文档
4. 如果内容会影响网页呈现，再同步验证 `pages/`

修改站点时：

1. 优先检查 `pages/_layouts/default.html`
2. 再看 `pages/_layouts/content.html`
3. 确认 `pages/index.md` 的信息架构
4. 最后统一在 `pages/style.css` 调整视觉系统和响应式行为

---

## 5. 常用命令

```bash
# 查看分析输出文件
rg --files hello-*

# 检查当前改动
git status --short

# 刷新上游仓库
bash ./sync_repos.sh

# 本地预览站点
cd pages && npm run serve

# 构建站点
cd pages && npm run build

# 生成 PDF ebook
cd pages && npm run pdf
```

说明：

- `cd pages && npm run build` 是页面改动后的首选验证命令。
- 当前构建过程中可能出现来自 `openclaw/docs/start/showcase.md` 的 Liquid warning；若本次任务未触及该区域，可视为已有告警，不算本次回归。

---

## 6. 不要做的事

- 不要默认修改 `claude-code/`、`codex/`、`gemini-cli/`、`opencode/` 中的源码文件
- 不要把分析输出写到源码目录；应写入对应的 `hello-*` 目录
- 不要在改页面时硬编码 `/hello-olleh/`，优先使用 `relative_url`
- 不要把 `pages/` 的视觉风格改回普通模板化 docs UI
- 不要提交无关的同步噪音、生成产物或 vendored 代码漂移

---

## 7. 提交身份

如果 Copilot 产生了可提交改动，提交身份必须与工具身份匹配。以 Codex 为例：

```bash
git commit -m "docs: update instructions" \
  --author="Codex <noreply@openai.com>" \
  -m "Co-authored-by: Codex <noreply@openai.com>"
```

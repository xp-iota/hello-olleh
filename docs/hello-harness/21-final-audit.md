---
layout: content
title: "21 - 最终验收与维护索引"
---
<!-- markdownlint-disable MD060, MD024 -->

# 最终验收与维护索引

本页是 `hello-olleh` 当前分析成果的收口入口。它不替代单项目章节，而是回答：五个目录是否围绕同一组主题完成了横向验收、证据密度是否足够、术语是否统一、后续维护风险在哪里。

## 1. 验收口径

每个主干主题章按同一组问题验收：

| 问题 | 要看什么 |
| --- | --- |
| 入口在哪里 | CLI/TUI/SDK/server/API route 如何进入 runtime |
| 核心状态机是什么 | turn、loop、session、thread、stream、tool lifecycle 如何推进 |
| 工具/权限如何流转 | registry、approval、permission、policy、sandbox、result 回注是否讲清 |
| Prompt 如何流转 | system/developer/user prompt、项目指令、skill、tool spec 如何进入模型请求 |
| 恢复边界在哪里 | resume、checkpoint、ghost snapshot、durable state、retry、降级是否区分 |
| 失败时怎么降级 | 网络、模型、工具、权限、上下文爆炸、循环卡死如何处理 |

## 2. 目录级完成度

| 目录 | 完成度 | 证据等级 | 当前判断 |
| --- | --- | --- | --- |
| `docs/hello-claude-code/` | 高 | 源码确认 + 反编译风险 | `03/05/10-13/15-25` 主干已具备横向对比基础；维护重点是继续标注反编译快照的不确定性 |
| `docs/hello-codex/` | 高 | 源码确认 | Codex 低证据页已补强 Skill、Config、LSP、Observability；`13` 已从“无 Skill 系统”修正为 `core-skills` 真实链路 |
| `docs/hello-gemini-cli/` | 高 | 源码确认 | Gemini 的 resilience、LSP、REPL、Bridge 低锚点页已补源码行号；LSP 明确写成能力缺口和 MCP/工具化补偿 |
| `docs/hello-opencode/` | 高 | 源码确认 | durable state、session loop、processor、MCP、LSP 深挖充分；维护重点是控制 `03` 与 `27-29` 重复 |
| `docs/hello-harness/` | 高 | 横向归纳 + 源码回链 | `14-21` 已形成质量标准、主题矩阵、工具/Prompt/MCP/入口对比、合并计划和最终验收入口 |

## 3. 关键主题验收矩阵

| 主题 | Claude | Codex | Gemini | OpenCode | Harness 横向页 |
| --- | --- | --- | --- | --- | --- |
| `05` 工具系统 | 达标 | 达标 | 达标 | 达标 | `16-tool-governance-comparison.md` |
| `10` 会话恢复 | 达标 | 达标 | 达标 | 达标 | `06-context-and-memory.md`, `19-runtime-surface-comparison.md` |
| `11` Prompt 系统 | 达标 | 达标 | 达标 | 达标 | `17-prompt-systems-comparison.md` |
| `12` 多代理 | 达标 | 达标 | 达标 | 达标 | `09-multi-agent-verification.md` |
| `13` Skill 系统 | 达标 | 已纠偏补强 | 达标 | 达标 | `18-extension-mcp-comparison.md` |
| `15` SDK/传输 | 达标 | 达标 | 达标 | 达标 | `19-runtime-surface-comparison.md` |
| `16` 韧性 | 达标 | 达标 | 已补行号锚点 | 达标 | `04-feedback-controls.md` |
| `17` 设置配置 | 达标 | 已补行号锚点 | 达标 | 达标 | `02-control-plane.md` |
| `18` LSP | 达标 | 已纠偏为能力边界 | 已纠偏为能力边界 | 达标 | `11-extensibility.md`, `19-runtime-surface-comparison.md` |
| `19` Hooks | 达标 | 达标 | 达标 | 达标 | `03-feedforward-controls.md` |
| `20` REPL 状态 | 达标 | 达标 | 已补行号锚点 | 达标 | `19-runtime-surface-comparison.md` |
| `21` Bridge | 达标 | 达标 | 已补行号锚点 | 达标 | `19-runtime-surface-comparison.md` |
| `23` 输入队列 | 达标 | 达标 | 达标 | 达标 | `19-runtime-surface-comparison.md` |
| `24` MCP | 达标 | 达标 | 达标 | 达标 | `18-extension-mcp-comparison.md` |
| `25` 调试 | 达标 | 达标 | 达标 | 达标 | `14-source-analysis-quality.md` |

## 4. 当前证据密度

当前 repo-root `path:line` 源码锚点粗略统计：

| 目录 | 锚点数 | 判断 |
| --- | ---: | --- |
| `docs/hello-claude-code/` | 549 | 高，注意反编译风险标注 |
| `docs/hello-codex/` | 314 | 已从低位补到可维护水平，后续重点是 line anchor 漂移 |
| `docs/hello-gemini-cli/` | 324 | 主干达标，边界章已补关键行号 |
| `docs/hello-opencode/` | 694 | 最高，注意避免深挖章互相重复 |
| `docs/hello-harness/` | 325 | 横向归纳足够，但新增判断仍需回链单项目章或源码 |

这组数字只用于维护优先级，不作为机械加引用指标。真正的标准是关键判断是否能回到入口、状态机、工具治理、Prompt 注入和恢复边界。

## 5. 术语表

| 术语 | 本仓库统一含义 | 避免混用 |
| --- | --- | --- |
| turn | 一次用户输入驱动的模型/工具执行回合 | 不等同于完整 session |
| loop | runtime 在一个 turn 内反复模型调用、工具调用、结果回注的执行环 | 不等同于 REPL 主循环 |
| session | 可恢复的会话事实、配置快照和历史边界 | 不等同于 UI tab 或 thread |
| thread | Codex 等系统中面向客户端/协议的会话线程抽象 | 不泛化到所有项目 |
| message | 对话级消息或协议事件中的消息项 | 不等同于 provider part |
| part | provider API 的内容片段，如 text/tool_call/tool_result | 不等同于 Markdown 段落 |
| prompt | 发送给模型的 system/developer/user/tool spec 组合 | 不只指自然语言模板 |
| approval | 用户或策略对高风险工具动作的确认 | 不等同于 sandbox |
| permission | 工具执行前的能力授权或 policy 结果 | 不等同于 approval UI |
| policy | 可配置的治理规则集合 | 不等同于单次权限结果 |
| sandbox | 文件/网络/进程隔离执行环境 | 不等同于 approval |
| bridge | 外部宿主、IDE、SDK、A2A、MCP 与 runtime 的协议边界 | 不只指 IDE bridge |

## 6. 剩余维护风险

| 风险 | 影响 | 维护动作 |
| --- | --- | --- |
| 上游版本漂移 | 行号锚点失效或行为变化 | 每次快照升级后跑引用校验并抽查关键主题 |
| Claude 反编译命名漂移 | 函数名和行号稳定性弱于源码仓库 | 保留“反编译风险”证据等级 |
| Codex Skill/Plugin 快速演进 | `core-skills`、MCP dependency 和 TUI 管理面可能继续变化 | 优先复核 `13/24/21` |
| Gemini Bridge/LSP 边界易误写 | 容易把 MCP/IDE 补偿写成原生 LSP | 继续把 `18` 写成能力缺口而非主干能力 |
| OpenCode 深挖重复 | `03` 总览与 `27-29` 细节可能互相覆盖 | `03` 保持总览，深挖留在附录 |
| Pages 渲染环境 | 本机缺 Ruby/Bundler 会阻塞 Jekyll build | 交付前在有 Jekyll 环境的机器跑 `cd pages && npm run build` |

## 7. 验证命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_doc_refs.ps1 -DocDirs hello-claude-code,hello-codex,hello-gemini-cli,hello-opencode,hello-harness
cd pages
npm run build
```

允许既有 Liquid warning 保持为已知噪声；新增 broken link、无效行号或页面构建失败需要先修复。

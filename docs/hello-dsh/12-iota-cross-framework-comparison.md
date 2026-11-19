# DSH 与 iota 跨框架对照

本页按工具、上下文、会话和任务编排等 12 个方向，对比 DSH 与 iota 的功能、替换单元和责任归属。

> **对照基线**：DSH 侧取配套工程 [dsh-lab](../../dsh-lab/README.md)（`@deepseek-ai/*` **0.2.2-rc.3** 发布包，与 `sources/deepseek-harness` 快照同版，见 [README § 一](README.md)），iota 侧取 `iota-example/`。两侧源码行号会随版本漂移，因此证据一律用**符号名**而非行号锚定。

## 三种关系

- **语义等价**：结构不同，但运行结果与责任边界可以对位。
- **机制补齐**：复用 iota-core 已有通用机制，在示例层补出可运行路径。
- **结构性边界**：能力由具体内核或宿主提供，不属于编排层接口。

完整的“文件::符号/章节”证据原本在 `iota-example/docs/dsh-vs-iota.md`；`iota-example/` 目录已从当前工作区移除（如需对照可从 git 历史恢复）。

## M01–M12 导航

> iota 侧单元格保留模块目录名作为锚点（`iota-example/` 当前不在工作树中）。

| 模块 | DSH 教材 | iota 教材 | 关系摘要 |
|---|---|---|---|
| M01 工具管线 | [DSH](../../dsh-lab/examples/08-dsh-tool-pipeline-demo/README.md) | `M01-tool-pipeline` | ToolPipeline 可补齐编排层工具阶段；内核可见性保持边界 |
| M02 上下文装配 | [DSH](../../dsh-lab/examples/09-dsh-context-demo/README.md) | `M02-context-assembly-economics` | 作用域记忆等价；完整 Prompt 压缩属于内核 |
| M03 推理接入 | [DSH](../../dsh-lab/examples/10-dsh-llm-adapter-demo/README.md) | `M03-inference-service-access` | DSH 换 LLM Adapter；iota 换整个 KernelAdapter |
| M04 循环干预 | [DSH](../../dsh-lab/examples/11-dsh-agent-loop-demo/README.md) | `M04-agent-loop-intervention` | 事件和节点 hook 等价；mid-turn 状态归内核 |
| M05 会话面 | [DSH](../../dsh-lab/examples/12-dsh-session-demo/README.md) | `M05-session-surface` | 存储语义可对位；日志投影不变量不同 |
| M06 人机协作 | [DSH](../../dsh-lab/examples/14-dsh-hitl-demo/README.md) | `M06-human-in-the-loop` | permission fail-closed 等价；计划模式归宿主 |
| M07 执行后端 | [DSH](../../dsh-lab/examples/15-dsh-sandbox-demo/README.md) | `M07-execution-backends` | DSH 在 harness 提供 seam；iota 将执行栈留给内核 |
| M08 委派 | [DSH](../../dsh-lab/examples/16-dsh-subagent-demo/README.md) | `M08-delegation-presets` | SubagentProvider 与 GraphSpec DAG 语义对位 |
| M09 长任务 | [DSH](../../dsh-lab/examples/17-dsh-jobs-demo/README.md) | `M09-long-running-orchestration` | iota 另有租约队列、checkpoint 与恢复语义 |
| M10 外部能力 | [DSH](../../dsh-lab/examples/18-dsh-skills-mcp-demo/README.md) | `M10-external-capabilities` | Skill 数据与 MCP server 均有真实路径 |
| M11 配置数据 | [DSH](../../dsh-lab/examples/19-dsh-storage-demo/README.md) | `M11-config-data-infrastructure` | Profile/store 可对位；凭证附件归宿主 |
| M12 框架机制 | [DSH](../../dsh-lab/examples/01-cordis-seam-demo/README.md) | `M12-framework-mechanisms` | 可逆 effect 等价；不复制事件总线与 Proxy/Fiber 架构 |

## 建议阅读方法

1. 配置模型服务后，运行同编号的两个模块并对照输出；两侧运行均需要网络和凭证。
2. 再读两侧 README 的“完整链路/边界”，确认替换单元和责任归属。
3. 最后查证据表中的稳定符号锚点；不要仅凭命名相似就判断等价。

DSH 在 harness 内提供较细的服务替换接口；iota 以整个 `KernelAdapter` 为替换单元，在编排层提供节点、事件、存储和任务管理接口。

## DSH 侧 rc.3 的增量对照点

`0.2.2-rc.3` 把 DSH 的 seam 面进一步拉宽（详见 [03 篇](03-capability-seams-and-services.md)），对照时可以额外关注三处：

| 新 seam / 机制 | 对位 iota 的哪一层 | 读法 |
|---|---|---|
| **`ctx.ptcRuntime`**（PTC 模式） | iota 没有"模型写代码调工具"的等价 seam；执行栈完全留给内核 | 模型侧能力属于 harness，编排层只需决定是否暴露 `run_code` |
| **`packages/ssh/*`**（第四个执行世界） | iota 的执行栈边界之外 | 换 `fs` + `subprocess` 两个 provider 即整体切到远端，与 DSH 的"seam 三角色"同构 |
| **`deliverables` / `team`** | iota 的任务编排（GraphSpec DAG、租约队列） | DSH 用插件组合表达交付物与多代理协作；iota 用编排图表达 |

💡 **会话格式的版本化**也是新对照维度：DSH 的 `SESSION_FORMAT_VERSION = 4` 配合 v0→v4 迁移链，而 iota 的会话/检查点语义由内核负责。这类"格式演进归谁"的问题，比单个 API 的相似度更能说明两套框架的责任边界。

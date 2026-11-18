---
type: Harness Concept
title: "装配枢纽：cordis.patch.yml 装配清单"
description: dsh-lab 的每个 dsh 示例自持一份声明式装配清单，因此每个示例可以只写自己那一个扩展点。
tags: [okf, dsh-lab, cordis, architecture]
status: stable
sources:
  - id: patch-yml
    resource: "dsh-lab/examples/15-dsh-chat-demo/cordis.patch.yml"
    title: 装配清单（唯一装配来源）
  - id: boot-ts
    resource: "dsh-lab/examples/15-dsh-chat-demo/src/boot.ts"
    title: boot() 调用点与环境兜底
  - id: services-ts
    resource: "dsh-lab/examples/15-dsh-chat-demo/src/services.ts"
    title: Context 类型增强（服务包的类型侧导入）
  - id: graphify-measure
    resource: "docs/okf/references/01-graphify-dsh-lab.md"
    title: graphify 建图测量值与其适用范围
  - id: dsh-05
    resource: "docs/hello-dsh/05-startup-and-cordis-runtime.md"
    title: DSH 启动链路与 Cordis 落地分析
generated: { by: mcode/minimax-m3.1-flash, at: 2026-10-23T10:00:00Z }
verified:
  - { by: "process:graphify-0.9.53", at: 2026-09-12T12:25:04Z }
  - { by: "process:graphify-0.9.53", at: 2026-10-23T10:05:00Z }
  - { by: "mcode/minimax-m3.1-flash", at: 2026-10-23T10:00:00Z }
  - { by: "process:npm-run-verify-checks-63", at: 2026-11-17T00:00:00Z }
stale_after: 2027-04-30T00:00:00Z
---
# 装配枢纽：cordis.patch.yml 装配清单

## 结论

`dsh-lab/` 的 15 个 dsh 示例**各自持有一棵** cordis 服务树，每棵都由一份声明式清单装配：
示例自己的 `cordis.yml`（空根表）+ `cordis.patch.yml`（全部行）交给官方 `@deepseek-ai/dsh-app-boot`
的 `boot()`。**工程里没有一行手工 `new` 出来的服务**——以最全的 `dsh-chat-demo` 为例，`src/boot.ts` 只做三件事：
把 `DSH_HOME` 指向示例内的 `.dsh-home/`、调用 `boot()`、把 `Context` 交回调用方。
（2026-11-17 重构前是 12 个模块共享同一棵树；现在每个示例整目录拷走即可独立装配运行。）

- **装配来源每示例一份**：最全的 `dsh-lab/examples/15-dsh-chat-demo/cordis.patch.yml` 里 89 条 `- id:` 记录，覆盖基础设施、
  会话核心、存储栈、Agent 循环、上下文工程、工具运行时、人机交互、文件与进程边界、
  委派、长期运行、外部能力、凭据与诊断十二组；其余示例按主题裁剪出更小的树。
- **类型增强不是装配**：`dsh-chat-demo/src/services.ts` 只有 24 个 `import '@deepseek-ai/dsh-*'`——
  那是 `declare module '@deepseek-ai/cordis'` 的类型侧增强，运行时一行都不产生。
- **示例自持运行时**：装配清单负责挂服务；示例 `src/index.ts`（或 CLI）实现扩展点；
  推理协议适配在 `dsh-llm-adapter-demo/src/plugins/anthropic-compat/index.ts`（`dsh-chat-demo` 持独立副本）。
- **压缩与沙箱**：这两个后端由官方包（`@deepseek-ai/dsh-compaction-basic`、
  `@deepseek-ai/dsh-sandbox-local`）在装配清单里提供，本工程不再自己实现。

![旧模块体系的拓扑：一份装配清单驱动一棵共享 cordis 服务树（历史快照）](../../hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../../hello-dsh/diagrams/12-example-topology.html)　·
IR 源：[12-example-topology.architecture.json](../../hello-dsh/diagrams/12-example-topology.architecture.json)

- **上图是历史快照**：画的是已退役的 12 模块共享树；当前形态是 21 个独立示例，但"清单驱动装配"的结论不变。
- **装配只有清单**：`dsh-chat-demo` 的 `cordis.yml` 是空表（2 行）；
  `cordis.patch.yml` 457 行、89 条 `- id:` 行；`boot()` 来自官方 `@deepseek-ai/dsh-app-boot`。
- **示例与验证**：21 个示例，每个自带 `start` / `start:bun` / `typecheck`；根层 `npm run verify`
  跑满 63 项检查；需要 key 的示例缺 `LLM_API_KEY` 立即失败，没有 mock 或离线回退。
- **provider 只有一处自写**：`AnthropicCompatAdapter` 在 `dsh-llm-adapter-demo`（`dsh-chat-demo` 持副本）；
  其余走官方包；沙箱是官方 `LocalSandboxProvider`（`dsh-sandbox-demo` 实测）。

## 证据

装配的唯一来源可以直接数出来：

```bash
rg -c '^\s*- id:' dsh-lab/examples/15-dsh-chat-demo/cordis.patch.yml      # 89
rg -c "^import '@deepseek-ai/" dsh-lab/examples/15-dsh-chat-demo/src/services.ts   # 24
python3 -c "from pathlib import Path; print(len(Path('dsh-lab/examples/15-dsh-chat-demo/cordis.patch.yml').read_text(encoding='utf-8').splitlines()))"   # 457
```

两个数字都不是「服务数」：行数是**配置层**的，装配的运行时部分由官方 `boot()` 负责，
`src/boot.ts` 里没有 `new` 任何服务。真正被断言过的运行期口径是另一组数——`dsh-chat-demo`
的装配探针（`npm run info`）会检查 19 个必检服务是否到位，并把工具数断言为 **27**
（rc.1 基线 26，rc.3 新增 `wait_agent`；Node 与 Bun 双运行时实测一致）。

关于「装配枢纽」的历史口径：本工程的前身 `dsh-example/` 用手写函数 `createHarness()`
承担同一角色，它的图谱特征（唯一枢纽、度数 66）记录在
[graphify 建图结果](../references/01-graphify-dsh-lab.md) 的历史小节里。那组数字来自
2026-09-12 对**已删除的旧工程**的建图，**不能当作 dsh-lab 的结构事实**。

2026-10-23 按同一流程对**当时的旧模块结构**建图（51 文件 / 396 节点 / 600 边 / 32 社区），
得到的形状与更早的 `dsh-example/` **不同**。该结构已于 2026-11-17 退役，以下观察只作历史参考，
但其中两条方法论结论对当前示例集仍然成立：

- （历史）12 个模块的 `index.ts` 全部 import `src/lab/runner.ts`，没有一个 import `boot.ts`；
  代码侧最接近「枢纽」的入口 `bootLab` 度数只有 9。
- **装配清单本身在图上不可见**：`cordis.yml` 与 `cordis.patch.yml` 贡献了 0 个节点——
  graphify 的结构化提取走 tree-sitter 的代码语法，YAML 不在其中。这条对当前每个示例的清单同样成立。

所以旧工程「装配枢纽 = 图上最大度的节点」这条口径在 dsh-lab 上**不可移植**：枢纽搬到了
图覆盖不到的地方，本页关于「装配来源是声明式清单」的结论只能靠读文件与数行成立。

## 为什么这样设计

真实产品里，服务装配由 `@deepseek-ai/dsh-base` 这类 bundle 或 profile 负责。dsh-lab
同样不手写一份等价装配，而是直接用官方 `boot()` + 声明式 patch 层，好处有三个：

1. **配置树语义由官方实现**：`boot()` 已经把「读配置 → 组合 patch 层 → 校验行 →
   失败即大声报错」做完了，手写只会复述一遍并且更容易漂移。
2. **行 id 稳定，可用 patch 就地覆盖**：同一个 `- id: <已有 id>` + `config:` 就能改配置
   （M12.3 演示的就是它），比改代码轻得多。
3. **依赖注入顺序不再由人排**：`static inject` 未满足时 fiber 停在 PENDING，
   官方 boot 会等，而不是让人手写一串 `await fiber.await()`。

## 什么时候这条结论会失效

- dsh-lab 示例改为挂载别的 profile / bundle（装配清单不再是该示例的唯一来源）。
- 上游把 patch 层的语法或 `boot()` 的语义改掉。

复核方式：读 `dsh-lab/examples/15-dsh-chat-demo/cordis.patch.yml` 与 `dsh-lab/examples/15-dsh-chat-demo/src/boot.ts`，确认上面两个计数
与「没有手写服务清单」这两条；图谱口径按
[graphify 重建步骤](../references/01-graphify-dsh-lab.md#重建) 重跑，
并注意 YAML 装配清单**不会**进 AST 图——枢纽节点的排名变了，不代表装配结构变了。

## 相关

- [能力缝的三角色](02-capability-seam.md)
- [推理服务可替换](03-provider-swap.md)
- 长文分析：[05 启动与 Cordis 落地](../../hello-dsh/05-startup-and-cordis-runtime.md)

上一层：[Concepts](index.md)。

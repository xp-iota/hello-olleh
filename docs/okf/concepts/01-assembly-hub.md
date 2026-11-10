---
type: Harness Concept
title: "装配枢纽：cordis.patch.yml 装配清单"
description: dsh-lab 把全部装配成本集中在一份声明式清单里，因此每个模块可以只写自己那一个扩展点。
tags: [okf, dsh-lab, cordis, architecture]
status: stable
sources:
  - id: patch-yml
    resource: "dsh-lab/cordis.patch.yml"
    title: 装配清单（唯一装配来源）
  - id: boot-ts
    resource: "dsh-lab/src/boot.ts"
    title: boot() 调用点与环境兜底
  - id: services-ts
    resource: "dsh-lab/src/lab/services.ts"
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
stale_after: 2027-04-30T00:00:00Z
---
# 装配枢纽：cordis.patch.yml 装配清单

## 结论

`dsh-lab/` 的 12 个模块、60 个阶段共享**同一棵** cordis 服务树。它由一份声明式清单装配：
`cordis.yml`（空根表）+ `cordis.patch.yml`（全部行）交给官方 `@deepseek-ai/dsh-app-boot`
的 `boot()`。**工程里没有一行手工 `new` 出来的服务**——`src/boot.ts` 只做三件事：
把 `DSH_HOME` 指向工程内的 `.dsh-home/`、调用 `boot()`、把 `Context` 交回调用方。

- **唯一装配来源**：`dsh-lab/cordis.patch.yml` 里 88 条 `- id:` 记录，覆盖基础设施、
  会话核心、存储栈、Agent 循环、上下文工程、工具运行时、人机交互、文件与进程边界、
  委派、长期运行、外部能力、凭据与诊断十二组。
- **类型增强不是装配**：`src/lab/services.ts` 只有 24 个 `import '@deepseek-ai/dsh-*'`——
  那是 `declare module '@deepseek-ai/cordis'` 的类型侧增强，运行时一行都不产生。
  图上它只有 4 条入向 `imports_from`（M01 的 `index.ts`、`src/cli/repl.ts`、
  `src/cli/traj.ts`、`src/lab/runner.ts`）。
- **共享运行时**：装配清单负责挂服务；各模块 `index.ts` 实现扩展点；
  `src/llm/anthropic-compat/index.ts` 负责推理协议适配。
- **压缩与沙箱**：这两个后端由官方包（`@deepseek-ai/dsh-compaction-basic`、
  `@deepseek-ai/dsh-sandbox-local`）在装配清单里提供，本工程不再自己实现。

![dsh-lab 的真实拓扑：一份装配清单驱动一棵 cordis 服务树](../../hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../../hello-dsh/diagrams/12-example-topology.html)　·
IR 源：[12-example-topology.architecture.json](../../hello-dsh/diagrams/12-example-topology.architecture.json)

- **装配只有一份清单**：`cordis.yml` 是空表 `[]`（11 行全是注释）；
  `cordis.patch.yml` 439 行、88 条 `- id:` 行；`boot()` 来自官方 `@deepseek-ai/dsh-app-boot`。
- **模块与阶段**：12 个模块、60 个阶段，每个模块一个 `index.ts`；`src/lab/runner.ts` 驱动，
  阶段失败即非零退出；缺 `LLM_API_KEY` 立即失败，没有 mock 或离线回退。
- **provider 只有一处自写**：自写 `src/llm/anthropic-compat/index.ts` 的
  `AnthropicCompatAdapter`；其余走官方包（24 个 `@deepseek-ai/dsh-*` 服务包）；
  沙箱是官方 `LocalSandboxProvider`（M07.3 实测）。

## 证据

装配的唯一来源可以直接数出来：

```bash
rg -c '^\s*- id:' dsh-lab/cordis.patch.yml      # 88
rg -c "^import '@deepseek-ai/" dsh-lab/src/lab/services.ts   # 24
python3 -c "from pathlib import Path; print(len(Path('dsh-lab/cordis.patch.yml').read_text(encoding='utf-8').splitlines()))"   # 439
```

两个数字都不是「服务数」：行数是**配置层**的，装配的运行时部分由官方 `boot()` 负责，
`src/boot.ts` 里没有 `new` 任何服务。真正被断言过的运行期口径是另一组数——启动探针
`dsh-lab/runtime/boot-probe.ts` 会检查 19 个必检服务是否到位，并把工具数断言为 26。

关于「装配枢纽」的历史口径：本工程的前身 `dsh-example/` 用手写函数 `createHarness()`
承担同一角色，它的图谱特征（唯一枢纽、度数 66）记录在
[graphify 建图结果](../references/01-graphify-dsh-lab.md) 的历史小节里。那组数字来自
2026-09-12 对**已删除的旧工程**的建图，**不能当作 dsh-lab 的结构事实**。

2026-10-23 按同一流程对 dsh-lab 重新建图（51 文件 / 396 节点 / 600 边 / 32 社区），
得到的形状与旧工程**不同**，而且不同本身就是结论：

- **12 个模块的 `index.ts` 全部 import `src/lab/runner.ts`，没有一个 import `boot.ts`**。
  服务树是在 CLI（`src/cli/bin.ts`）或探针启动时建好的，模块阶段只是共用它。
- 代码侧最接近「枢纽」的入口是 `bootLab`（`src/boot.ts` L180），度数只有 9：
  2 条出向 `calls`（`ensureWritableTemp`、`ensureLabHome`）+ 6 条入向 `imports`
  （`src/cli/bin.ts`、`src/boot.test.ts`、`runtime/boot-probe.ts` 与 `scripts/` 下三个探针）
  + 1 条来自文件节点的 `contains`。
- **装配清单本身在图上不可见**：`cordis.yml` 与 `cordis.patch.yml` 贡献了 0 个节点——
  graphify 的结构化提取走 tree-sitter 的代码语法，YAML 不在其中。

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

- dsh-lab 改为挂载别的 profile / bundle（装配清单不再是唯一来源）。
- 上游把 patch 层的语法或 `boot()` 的语义改掉。

复核方式：读 `dsh-lab/cordis.patch.yml` 与 `dsh-lab/src/boot.ts`，确认上面两个计数
与「没有手写服务清单」这两条；图谱口径按
[graphify 重建步骤](../references/01-graphify-dsh-lab.md#重建) 重跑，
并注意 YAML 装配清单**不会**进 AST 图——枢纽节点的排名变了，不代表装配结构变了。

## 相关

- [能力缝的三角色](02-capability-seam.md)
- [推理服务可替换](03-provider-swap.md)
- 长文分析：[05 启动与 Cordis 落地](../../hello-dsh/05-startup-and-cordis-runtime.md)

上一层：[Concepts](index.md)。
